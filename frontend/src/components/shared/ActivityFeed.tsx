import type { ActividadItem } from '../../types';
import { Clock, Plus, Pencil, Trash2, Zap, Target } from 'lucide-react';

const TIPO_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  tarea_creada:      { icon: Plus,         color: 'text-green-500',  label: 'Tarea creada' },
  tarea_actualizada: { icon: Pencil,       color: 'text-blue-500',   label: 'Tarea actualizada' },
  tarea_eliminada:   { icon: Trash2,       color: 'text-red-500',    label: 'Tarea eliminada' },
  sprint_creado:     { icon: Zap,          color: 'text-purple-500', label: 'Sprint creado' },
  sprint_actualizado:{ icon: Zap,          color: 'text-purple-400', label: 'Sprint actualizado' },
  sprint_eliminado:  { icon: Zap,          color: 'text-red-400',    label: 'Sprint eliminado' },
  hito_creado:       { icon: Target,       color: 'text-yellow-500', label: 'Hito creado' },
  hito_actualizado:  { icon: Target,       color: 'text-yellow-400', label: 'Hito actualizado' },
  hito_eliminado:    { icon: Target,       color: 'text-red-400',    label: 'Hito eliminado' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export default function ActivityFeed({ actividad }: { actividad: ActividadItem[] }) {
  if (actividad.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-400">No hay actividad registrada aún</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Actividad del Proyecto</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{actividad.length} eventos recientes</p>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-700/50 max-h-[600px] overflow-y-auto">
        {actividad.map(item => {
          const cfg = TIPO_CONFIG[item.tipo] || { icon: Clock, color: 'text-gray-400', label: item.tipo };
          const Icon = cfg.icon;
          return (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200">{item.descripcion}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.usuario_nombre}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="text-xs text-gray-400">{timeAgo(item.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
