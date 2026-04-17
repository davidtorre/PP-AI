import { FileSpreadsheet, FileText } from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Proyecto, Tarea, Hito } from '../../types';
import { getEstadoLabel, formatDate } from '../../utils/format';
import toast from 'react-hot-toast';

interface ExportButtonsProps {
  proyecto: Proyecto;
  tareas: Tarea[];
  hitos: Hito[];
}

export default function ExportButtons({ proyecto, tareas, hitos }: ExportButtonsProps) {
  const exportExcel = async () => {
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'PP-AI';
      wb.created = new Date();

      // Tareas sheet
      const wsTareas = wb.addWorksheet('Tareas');
      wsTareas.columns = [
        { header: 'Tarea', key: 'tarea', width: 30 },
        { header: 'Estado', key: 'estado', width: 15 },
        { header: 'Responsable', key: 'responsable', width: 20 },
        { header: 'Fecha Inicio', key: 'fecha_inicio', width: 14 },
        { header: 'Fecha Fin', key: 'fecha_fin', width: 14 },
        { header: 'Duración (días)', key: 'duracion', width: 14 },
      ];

      // Style header row
      wsTareas.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { vertical: 'middle' };
      });

      tareas.forEach(t => {
        wsTareas.addRow({
          tarea: t.nombre,
          estado: getEstadoLabel(t.estado),
          responsable: t.responsable_nombre || 'Sin asignar',
          fecha_inicio: t.fecha_inicio || '',
          fecha_fin: t.fecha_fin || '',
          duracion: t.duracion_dias || '',
        });
      });

      // Hitos sheet
      const wsHitos = wb.addWorksheet('Hitos');
      wsHitos.columns = [
        { header: 'Hito', key: 'hito', width: 30 },
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Estado', key: 'estado', width: 14 },
      ];

      wsHitos.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { vertical: 'middle' };
      });

      hitos.forEach(h => {
        wsHitos.addRow({
          hito: h.nombre,
          fecha: h.fecha,
          estado: h.completado ? 'Completado' : 'Pendiente',
        });
      });

      // Generate and download
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${proyecto.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_tareas.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Excel exportado');
    } catch {
      toast.error('Error al exportar Excel');
    }
  };

  const exportPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Title
      doc.setFontSize(18);
      doc.setTextColor(30, 58, 95);
      doc.text(proyecto.nombre, 14, 22);

      // Project info
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Estado: ${getEstadoLabel(proyecto.estado)}  |  Prioridad: ${proyecto.prioridad}  |  Avance: ${proyecto.porcentaje_avance}%`, 14, 30);
      doc.text(`Responsable: ${proyecto.responsable_nombre || 'Sin asignar'}  |  Fechas: ${formatDate(proyecto.fecha_inicio)} → ${formatDate(proyecto.fecha_fin)}`, 14, 36);
      if (proyecto.descripcion) {
        doc.text(proyecto.descripcion.substring(0, 100), 14, 42);
      }

      // Separator
      doc.setDrawColor(200);
      doc.line(14, 46, pageWidth - 14, 46);

      // Tasks table
      doc.setFontSize(12);
      doc.setTextColor(30, 58, 95);
      doc.text('Tareas', 14, 54);

      autoTable(doc, {
        startY: 58,
        head: [['Tarea', 'Estado', 'Responsable', 'Inicio', 'Fin']],
        body: tareas.map(t => [
          t.nombre,
          getEstadoLabel(t.estado),
          t.responsable_nombre || '—',
          t.fecha_inicio || '—',
          t.fecha_fin || '—',
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 58, 95], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 25 },
          2: { cellWidth: 35 },
          3: { cellWidth: 25 },
          4: { cellWidth: 25 },
        },
      });

      // Milestones
      if (hitos.length > 0) {
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(12);
        doc.setTextColor(30, 58, 95);
        doc.text('Hitos', 14, finalY);

        autoTable(doc, {
          startY: finalY + 4,
          head: [['Hito', 'Fecha', 'Estado']],
          body: hitos.map(h => [h.nombre, h.fecha, h.completado ? 'Completado' : 'Pendiente']),
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255 },
          alternateRowStyles: { fillColor: [245, 247, 250] },
        });
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`PP-AI | ${proyecto.nombre} | Generado: ${new Date().toLocaleDateString('es-ES')} | Página ${i}/${pageCount}`, 14, doc.internal.pageSize.getHeight() - 10);
      }

      doc.save(`${proyecto.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_reporte.pdf`);
      toast.success('PDF exportado');
    } catch {
      toast.error('Error al exportar PDF');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
        <FileSpreadsheet className="w-4 h-4 text-green-600" /> Excel
      </button>
      <button onClick={exportPDF} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
        <FileText className="w-4 h-4 text-red-600" /> PDF
      </button>
    </div>
  );
}
