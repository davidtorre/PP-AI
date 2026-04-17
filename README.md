# PP-AI — Guía de Despliegue

## Inicio rápido — Docker Desktop (local)

> Requisito: tener **Docker Desktop** instalado y corriendo.

```bash
# 1. Levantar toda la aplicación (construye las imágenes la primera vez)
make up

# 2. Cargar usuarios de ejemplo
make seed

# 3. Abrir en el navegador
open http://localhost
```

| Cuenta | Contraseña | Rol |
|---|---|---|
| admin@app.com | admin123 | Administrador |
| editor@app.com | editor123 | Editor |
| viewer@app.com | viewer123 | Solo lectura |

**Otros comandos útiles:**

```bash
make logs          # Ver logs en tiempo real
make ps            # Estado de los contenedores
make down          # Detener la aplicación
make reset         # ⚠ Borrar todo (incluye datos)
make shell-backend # Terminal dentro del backend
make shell-db      # psql dentro de la base de datos
```

**Puertos disponibles en local:**

| Servicio | URL |
|---|---|
| Aplicación (frontend) | http://localhost:80 |
| API backend (directo) | http://localhost:3003 |
| PostgreSQL | localhost:5435 (user: `ppai`, pass: `ppai_local_2024`) |

---

## Guía de Despliegue en Kubernetes

## Contenido

- [Arquitectura](#arquitectura)
- [Requisitos previos](#requisitos-previos)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Paso 1 — Preparar el cluster](#paso-1--preparar-el-cluster)
- [Paso 2 — Configurar secretos y variables](#paso-2--configurar-secretos-y-variables)
- [Paso 3 — Ajustar el storageClass](#paso-3--ajustar-el-storageclass)
- [Paso 4 — Configurar el dominio](#paso-4--configurar-el-dominio)
- [Paso 5 — Desplegar](#paso-5--desplegar)
- [Paso 6 — Verificar el despliegue](#paso-6--verificar-el-despliegue)
- [Paso 7 — Cargar datos iniciales (seed)](#paso-7--cargar-datos-iniciales-seed)
- [TLS / HTTPS con Let's Encrypt](#tls--https-con-lets-encrypt)
- [Backup y Restore de la base de datos](#backup-y-restore-de-la-base-de-datos)
- [Actualizar la aplicación](#actualizar-la-aplicación)
- [Referencia de imágenes Docker Hub](#referencia-de-imágenes-docker-hub)
- [Referencia de manifests](#referencia-de-manifests)
- [Troubleshooting](#troubleshooting)

---

## Arquitectura

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│  Ingress NGINX  (ppai.dominio.com)  │
└──────────┬──────────────────────────┘
           │ /          │ /api  /uploads
           ▼            ▼
    ┌──────────┐  ┌───────────┐
    │ Frontend │  │  Backend  │──► PostgreSQL
    │  (nginx) │  │ (Node.js) │    StatefulSet
    │ 2 répl.  │  │  1 répl.  │
    └──────────┘  └───────────┘
```

| Componente | Imagen | Réplicas |
|---|---|---|
| Frontend | `humbertobellizzi/bellizzihub:ppai-frontend-latest` | 2 (HPA: 2–6) |
| Backend | `humbertobellizzi/bellizzihub:ppai-backend-latest` | 1 |
| Base de datos | `postgres:16-alpine` | 1 (StatefulSet) |

> El backend se mantiene en 1 réplica porque el volumen de uploads es `ReadWriteOnce`.
> Para escalar el backend se requiere migrar los uploads a object storage (S3, Azure Blob, GCS).

---

## Requisitos previos

### Herramientas locales

| Herramienta | Versión mínima | Instalación |
|---|---|---|
| `kubectl` | 1.28 | https://kubernetes.io/docs/tasks/tools/ |
| acceso al cluster | — | `kubectl cluster-info` |

### Componentes en el cluster

Los siguientes componentes deben estar instalados **antes** de aplicar los manifests:

#### 1. NGINX Ingress Controller
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/cloud/deploy.yaml

# Verificar que esté listo
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

#### 2. Metrics Server (requerido para HPA)
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Verificar
kubectl get deployment metrics-server -n kube-system
```

#### 3. cert-manager (opcional — solo para TLS automático)
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Verificar
kubectl wait --namespace cert-manager \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/instance=cert-manager \
  --timeout=120s
```

---

## Estructura del repositorio

```
PP-AI-DEPLOY/
├── docker-compose.yml          # Deploy con Docker Compose (alternativa local)
├── .env.example                # Plantilla de variables de entorno
├── backend/                    # Código fuente + Dockerfile del backend
├── frontend/                   # Código fuente + Dockerfile del frontend
└── k8s/                        # Manifests de Kubernetes (aplicar en orden)
    ├── 01-namespace.yaml           Namespace "ppai"
    ├── 02-secrets.yaml             Contraseñas y tokens  ⚠ editar antes de aplicar
    ├── 03-configmap.yaml           Config no-sensible (hosts, puertos, flags)
    ├── 04-database-statefulset.yaml  PostgreSQL 16 con volumen persistente
    ├── 05-database-service.yaml    Service headless para el StatefulSet
    ├── 06-backend-pvc.yaml         Volumen para archivos subidos (/app/uploads)
    ├── 07-backend-deployment.yaml  API Node.js + initContainer wait-for-db
    ├── 08-backend-service.yaml     ClusterIP :3001
    ├── 09-frontend-configmap-nginx.yaml  nginx.conf con hostname K8s correcto
    ├── 10-frontend-deployment.yaml Frontend Nginx, 2 réplicas
    ├── 11-frontend-service.yaml    ClusterIP :80
    ├── 12-ingress.yaml             Ingress NGINX con rate-limit y CORS
    ├── 13-hpa.yaml                 Autoscaling frontend (2–6 réplicas)
    ├── 14-networkpolicy.yaml       Tráfico mínimo-privilegio entre pods
    ├── 15-backup-pvc.yaml          Volumen 20 Gi para los dumps de Postgres
    ├── 16-backup-cronjob.yaml      pg_dump diario a las 02:00 hora local
    ├── 17-restore-job.yaml         Job de restore manual (plantilla)
    └── 18-seed-job.yaml            Carga datos de ejemplo (primer deploy)
```

---

## Paso 1 — Preparar el cluster

Verificar que `kubectl` apunta al cluster correcto:

```bash
kubectl config current-context
kubectl cluster-info
```

Para cambiar de contexto si hay varios clusters configurados:

```bash
kubectl config get-contexts
kubectl config use-context <nombre-del-contexto>
```

---

## Paso 2 — Configurar secretos y variables

### 2.1 Secretos (`k8s/02-secrets.yaml`)

Abrir el archivo y reemplazar **todos** los valores `CAMBIAR_*`:

```yaml
stringData:
  DB_PASSWORD: "CAMBIAR_PASSWORD_POSTGRES"    # ← contraseña fuerte
  JWT_SECRET:  "CAMBIAR_JWT_SECRET_CON_32_CHARS_MINIMO"  # ← mínimo 32 chars
  SMTP_HOST:   ""   # opcional
  SMTP_USER:   ""   # opcional
  SMTP_PASS:   ""   # opcional
  GOOGLE_CLIENT_ID:     ""  # opcional
  GOOGLE_CLIENT_SECRET: ""  # opcional
```

Generar un JWT_SECRET seguro:
```bash
openssl rand -hex 32
```

> **Importante:** Este archivo no debe commitearse con valores reales.
> En entornos de producción utilizar [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
> o [External Secrets Operator](https://external-secrets.io/) en lugar de este archivo.

### 2.2 ConfigMap (`k8s/03-configmap.yaml`)

Actualizar el dominio en las dos líneas indicadas:

```yaml
data:
  FRONTEND_URL:        "https://ppai.midominio.com"   # ← tu dominio real
  GOOGLE_CALLBACK_URL: "https://ppai.midominio.com/api/auth/google/callback"
```

---

## Paso 3 — Ajustar el storageClass

Los tres PVCs usan `storageClassName: "standard"`. Cambiar al valor correcto según el cluster:

| Plataforma | storageClassName |
|---|---|
| K3s / Rancher Desktop | `local-path` |
| AWS EKS | `gp3` |
| Azure AKS | `managed-premium` |
| GCP GKE | `standard-rwo` |
| On-premise | verificar con `kubectl get storageclass` |

Archivos a modificar:
- `k8s/04-database-statefulset.yaml` (volumeClaimTemplate)
- `k8s/06-backend-pvc.yaml`
- `k8s/15-backup-pvc.yaml`

Ejemplo para K3s:
```bash
# Reemplazar en los tres archivos de una vez
sed -i 's/storageClassName: "standard"/storageClassName: "local-path"/g' \
  k8s/04-database-statefulset.yaml \
  k8s/06-backend-pvc.yaml \
  k8s/15-backup-pvc.yaml
```

---

## Paso 4 — Configurar el dominio

Editar `k8s/12-ingress.yaml` y reemplazar `ppai.midominio.com` por el dominio real:

```yaml
rules:
  - host: ppai.midominio.com   # ← CAMBIAR
```

Obtener la IP pública del Ingress Controller para configurar el DNS:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Copiar la columna EXTERNAL-IP y crear un registro A en tu proveedor DNS
```

---

## Paso 5 — Desplegar

Aplicar todos los manifests en orden numérico:

```bash
kubectl apply -f k8s/
```

`kubectl apply -f k8s/` aplica los archivos en orden alfabético, lo que respeta el orden numérico `01-` → `18-`.

O aplicar uno a uno para mayor control:

```bash
kubectl apply -f k8s/01-namespace.yaml
kubectl apply -f k8s/02-secrets.yaml
kubectl apply -f k8s/03-configmap.yaml
kubectl apply -f k8s/04-database-statefulset.yaml
kubectl apply -f k8s/05-database-service.yaml
kubectl apply -f k8s/06-backend-pvc.yaml
kubectl apply -f k8s/07-backend-deployment.yaml
kubectl apply -f k8s/08-backend-service.yaml
kubectl apply -f k8s/09-frontend-configmap-nginx.yaml
kubectl apply -f k8s/10-frontend-deployment.yaml
kubectl apply -f k8s/11-frontend-service.yaml
kubectl apply -f k8s/12-ingress.yaml
kubectl apply -f k8s/13-hpa.yaml
kubectl apply -f k8s/14-networkpolicy.yaml
kubectl apply -f k8s/15-backup-pvc.yaml
kubectl apply -f k8s/16-backup-cronjob.yaml
```

---

## Paso 6 — Verificar el despliegue

```bash
# Ver todos los recursos del namespace
kubectl get all -n ppai

# Salida esperada:
# NAME                                  READY   STATUS    RESTARTS
# pod/ppai-backend-xxxxx                1/1     Running   0
# pod/ppai-frontend-xxxxx               1/1     Running   0
# pod/ppai-frontend-xxxxx               1/1     Running   0
# pod/ppai-database-0                   1/1     Running   0
#
# NAME                   TYPE        CLUSTER-IP    PORT(S)
# service/ppai-backend   ClusterIP   10.x.x.x      3001/TCP
# service/ppai-frontend  ClusterIP   10.x.x.x      80/TCP
# service/ppai-database  ClusterIP   None           5432/TCP
#
# NAME                             READY   UP-TO-DATE   AVAILABLE
# deployment.apps/ppai-backend     1/1     1            1
# deployment.apps/ppai-frontend    2/2     2            2
#
# NAME                               READY   AGE
# statefulset.apps/ppai-database     1/1     ...

# Ver el Ingress y su IP asignada
kubectl get ingress -n ppai

# Ver estado del autoscaling
kubectl get hpa -n ppai

# Verificar el health del backend
kubectl exec -n ppai deploy/ppai-backend -- \
  wget -qO- http://localhost:3001/api/health
```

---

## Paso 7 — Cargar datos iniciales (seed)

Solo necesario la **primera vez** en un cluster nuevo, o después de un restore en blanco.
Crea las cuentas de prueba: `admin@app.com`, `editor@app.com`, `viewer@app.com` (password: `*123`).

```bash
# Aplicar el job
kubectl apply -f k8s/18-seed-job.yaml

# Seguir el progreso
kubectl logs -n ppai -l job-name=ppai-seed -f

# Limpiar el job cuando termine
kubectl delete -f k8s/18-seed-job.yaml
```

---

## TLS / HTTPS con Let's Encrypt

### 1. Crear el ClusterIssuer

```yaml
# cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: tu@email.com          # ← tu email real
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

```bash
kubectl apply -f cluster-issuer.yaml
```

### 2. Habilitar TLS en el Ingress

Editar `k8s/12-ingress.yaml` y descomentar/agregar las secciones TLS:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"   # ← descomentar

spec:
  tls:                                                    # ← descomentar bloque
    - hosts:
        - ppai.midominio.com
      secretName: ppai-tls-cert

  rules:
    - host: ppai.midominio.com
```

```bash
kubectl apply -f k8s/12-ingress.yaml

# Verificar que el certificado se emitió (puede tardar 1-2 min)
kubectl get certificate -n ppai
kubectl describe certificate ppai-tls-cert -n ppai
```

---

## Backup y Restore de la base de datos

### Backup automático

El CronJob `ppai-backup` ejecuta `pg_dump` todos los días a las **02:00 hora de Bogotá**.
Los backups se guardan en el PVC `ppai-backups-pvc` con el formato `ppai_YYYYMMDD_HHMMSS.dump`
y se purgan automáticamente después de 30 días.

**Ejecutar un backup manual ahora:**
```bash
kubectl create job --from=cronjob/ppai-backup ppai-backup-manual -n ppai

# Ver el progreso
kubectl logs -n ppai -l job-name=ppai-backup-manual -f
```

### Listar backups disponibles

```bash
kubectl run -n ppai list-backups --rm -it --restart=Never \
  --image=alpine \
  --overrides='{
    "spec": {
      "volumes": [{"name":"b","persistentVolumeClaim":{"claimName":"ppai-backups-pvc"}}],
      "containers": [{
        "name":"c", "image":"alpine",
        "command":["ls","-lht","/backups"],
        "volumeMounts":[{"name":"b","mountPath":"/backups"}]
      }]
    }
  }'
```

### Restaurar desde un backup

```bash
# 1. Escalar el backend a 0 para evitar escrituras durante el restore
kubectl scale deployment ppai-backend -n ppai --replicas=0

# 2. Editar el nombre del archivo en el job de restore
#    Cambiar la línea: value: "ppai_YYYYMMDD_HHMMSS.dump"
nano k8s/17-restore-job.yaml

# 3. Aplicar el job
kubectl apply -f k8s/17-restore-job.yaml

# 4. Seguir el progreso
kubectl logs -n ppai -l job-name=ppai-restore -f

# 5. Restaurar el backend cuando el restore termine
kubectl scale deployment ppai-backend -n ppai --replicas=1

# 6. Limpiar el job
kubectl delete -f k8s/17-restore-job.yaml
```

---

## Actualizar la aplicación

Cuando se publica una nueva imagen en Docker Hub:

```bash
# Forzar re-descarga de la imagen (sin cambiar los YAMLs)
kubectl rollout restart deployment/ppai-backend  -n ppai
kubectl rollout restart deployment/ppai-frontend -n ppai

# Verificar que el rollout completó sin errores
kubectl rollout status deployment/ppai-backend  -n ppai
kubectl rollout status deployment/ppai-frontend -n ppai
```

Para hacer rollback a la versión anterior:
```bash
kubectl rollout undo deployment/ppai-backend  -n ppai
kubectl rollout undo deployment/ppai-frontend -n ppai
```

---

## Referencia de imágenes Docker Hub

| Servicio | Imagen |
|---|---|
| Backend | `humbertobellizzi/bellizzihub:ppai-backend-latest` |
| Frontend | `humbertobellizzi/bellizzihub:ppai-frontend-latest` |

Las imágenes se construyen desde este repositorio con:

```bash
# Construir
docker compose build

# Publicar en Docker Hub
docker tag pp-ai-deploy-backend  humbertobellizzi/bellizzihub:ppai-backend-latest
docker tag pp-ai-deploy-frontend humbertobellizzi/bellizzihub:ppai-frontend-latest
docker push humbertobellizzi/bellizzihub:ppai-backend-latest
docker push humbertobellizzi/bellizzihub:ppai-frontend-latest
```

---

## Referencia de manifests

| Archivo | Recurso K8s | Descripción |
|---|---|---|
| `01-namespace.yaml` | Namespace | Namespace `ppai` que agrupa todos los recursos |
| `02-secrets.yaml` | Secret | Passwords y tokens (editar antes de aplicar) |
| `03-configmap.yaml` | ConfigMap | Variables no-sensibles: hosts, puertos, dominio |
| `04-database-statefulset.yaml` | StatefulSet | PostgreSQL 16 con volumen persistente |
| `05-database-service.yaml` | Service (headless) | DNS estable para el StatefulSet de Postgres |
| `06-backend-pvc.yaml` | PVC | Volumen 10 Gi para `/app/uploads` |
| `07-backend-deployment.yaml` | Deployment | API Node.js — espera a Postgres vía initContainer |
| `08-backend-service.yaml` | Service (ClusterIP) | Expone el backend en `:3001` dentro del cluster |
| `09-frontend-configmap-nginx.yaml` | ConfigMap | nginx.conf con proxy al nombre de servicio K8s |
| `10-frontend-deployment.yaml` | Deployment | Frontend Nginx, 2 réplicas, monta el ConfigMap |
| `11-frontend-service.yaml` | Service (ClusterIP) | Expone el frontend en `:80` dentro del cluster |
| `12-ingress.yaml` | Ingress | Punto de entrada externo con rate-limit y CORS |
| `13-hpa.yaml` | HorizontalPodAutoscaler | Escala el frontend entre 2 y 6 réplicas por CPU/RAM |
| `14-networkpolicy.yaml` | NetworkPolicy | Solo backend habla con Postgres; solo Ingress habla con frontend |
| `15-backup-pvc.yaml` | PVC | Volumen 20 Gi para almacenar dumps de Postgres |
| `16-backup-cronjob.yaml` | CronJob | `pg_dump` diario, retiene 30 días de historial |
| `17-restore-job.yaml` | Job | Restore manual — editar `BACKUP_FILE` y aplicar |
| `18-seed-job.yaml` | Job | Carga datos de ejemplo (solo primer deploy) |

---

## Troubleshooting

### Los pods no arrancan

```bash
# Ver eventos recientes del namespace
kubectl get events -n ppai --sort-by=.lastTimestamp | tail -20

# Describir un pod con problemas
kubectl describe pod <nombre-del-pod> -n ppai
```

### El backend falla con "environment variable is not set"

El backend hace `process.exit(1)` si falta `JWT_SECRET`, `DB_HOST`, `DB_NAME`, `DB_USER`
o `DB_PASSWORD`. Verificar que el Secret y el ConfigMap se aplicaron correctamente:

```bash
kubectl get secret ppai-secrets   -n ppai
kubectl get configmap ppai-config -n ppai
```

### No se puede acceder a la aplicación por el dominio

```bash
# Verificar que el Ingress tiene IP asignada
kubectl get ingress -n ppai

# Verificar que el DNS apunta a esa IP
nslookup ppai.midominio.com

# Probar directamente por IP (saltando DNS)
curl -H "Host: ppai.midominio.com" http://<EXTERNAL-IP>/api/health
```

### Ver logs en tiempo real

```bash
kubectl logs -n ppai -l app.kubernetes.io/name=ppai-backend  -f
kubectl logs -n ppai -l app.kubernetes.io/name=ppai-frontend -f
kubectl logs -n ppai -l app.kubernetes.io/name=ppai-database -f
```

### Conectarse directamente a la base de datos

```bash
kubectl exec -n ppai -it statefulset/ppai-database -- psql -U ppai -d ppai
```

### Eliminar todo el despliegue

```bash
# ⚠ Esto elimina todos los recursos incluyendo los datos persistentes
kubectl delete namespace ppai
```
