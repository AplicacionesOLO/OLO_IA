# OLO_IA - DEPLOYMENT Y INFRAESTRUCTURA

## 1. INTRODUCCIÓN

Este documento define la estrategia de deployment, infraestructura, CI/CD, entornos y operaciones de OLO_IA.

---

## 1.1 DECISIÓN DE PLATAFORMA

> **Decisión DR-008 (aprobada).** El despliegue de Fases 0-2 es **PaaS**.
> **Kubernetes queda pospuesto.**

| Aspecto | Fases 0-2 | Cuándo se reevalúa |
|---------|-----------|-------------------|
| Orquestación | **PaaS** (Cloud Run / Fly.io / Railway) | Ver umbrales abajo |
| Kubernetes | **Pospuesto** | Ver umbrales abajo |
| Base de datos | Supabase Cloud (managed) | Si Supabase limita la escala |
| CDN / Frontend | Vercel o CloudFlare Pages | — |
| Cola de trabajos | Sin Redis hasta el primer caso real | Sprint 1.4 |

### 1.1.1 Por qué PaaS y no Kubernetes

| Razón | Detalle |
|-------|---------|
| Equipo pequeño | K8s exige conocimiento operacional dedicado que el equipo inicial no tiene disponible |
| Sin beneficio a esta escala | Con 2-3 contenedores, K8s añade complejidad sin resolver ningún problema real |
| Supabase ya es managed | La base de datos, auth y storage no viven en el cluster: el cluster orquestaría muy poco |
| Coste | Un cluster gestionado con nodos mínimos cuesta más que el equivalente en PaaS a bajo volumen |
| Reversible | Los contenedores son los mismos. Migrar de PaaS a K8s es cambiar la capa de orquestación, no la aplicación |

### 1.1.2 Umbrales para reevaluar Kubernetes

Se reevalúa cuando se cumpla **cualquiera**:

| Umbral | Medición |
|--------|----------|
| > 50 req/s sostenidos | p95 durante horario laboral, 2 semanas consecutivas |
| > 5 workers GPU simultáneos | Necesidad de scheduling fino de GPU |
| > 10 servicios independientes | El PaaS deja de ser más simple |
| Requisito de cliente enterprise | On-premise o cloud privado con K8s existente |
| Necesidad de multi-región activa | PaaS gestionado no cubre el caso |

Hasta entonces, la sección §5 de este documento (Kubernetes) es **referencia futura,
no plan de Fase 0-2**.

---

## 2. ENTORNOS

| Entorno | Propósito | Infra | Deploy |
|---------|----------|-------|--------|
| **local** | Desarrollo individual | Docker Compose + Supabase local | Manual |
| **staging** | Pre-producción, QA | **PaaS** + Supabase Cloud (proyecto staging) | Automático (merge to main) |
| **production** | Clientes reales | **PaaS** + Supabase Cloud (proyecto dedicado) | Manual approval |

> El entorno `dev` compartido se elimina: con Supabase local en Docker Compose, cada
> desarrollador tiene su propio entorno aislado. Un `dev` compartido añade un entorno
> que mantener sin resolver un problema.

### 2.1 Topología por entorno

```
LOCAL
  Docker Compose
  ├── backend (FastAPI, hot reload)
  ├── frontend (Vite dev server)
  └── supabase-local (PostgreSQL + Auth + Storage + Realtime)
  [Redis comentado hasta Sprint 1.4]

STAGING
  PaaS
  ├── backend container (1 instancia)
  └── frontend estático (CDN)
  Supabase Cloud (proyecto staging)

PRODUCTION
  PaaS
  ├── backend container (2+ instancias, autoscale)
  ├── worker container (desde Fase 1)
  └── frontend estático (CDN)
  Supabase Cloud (proyecto producción dedicado)
```

---

## 3. DOCKER

### 3.1 Estructura de Contenedores

```
┌─────────────────────────────────────────────────────┐
│              DOCKER COMPOSE (Local Dev)               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ frontend │  │ backend  │  │ ai-service       │  │
│  │ (Vite)   │  │ (FastAPI)│  │ (FastAPI + GPU)  │  │
│  │ :3000    │  │ :8000    │  │ :8001            │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ postgres │  │  redis   │  │ supabase-local   │  │
│  │ :5432    │  │  :6379   │  │ (Auth+Storage)   │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 Dockerfile Backend

```dockerfile
# Backend: Multi-stage build
FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

FROM base AS deps
COPY requirements/prod.txt .
RUN pip install --no-cache-dir -r prod.txt

FROM deps AS app
COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini .

# Non-root user
RUN adduser --disabled-password --gecos '' appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 3.3 Dockerfile AI Service

```dockerfile
# AI Service: Con soporte GPU
FROM nvidia/cuda:12.1-runtime-ubuntu22.04 AS base
WORKDIR /app

RUN apt-get update && apt-get install -y python3.12 python3-pip libgl1 libglib2.0-0
COPY requirements/ai.txt .
RUN pip install --no-cache-dir -r ai.txt

COPY src/ai_service/ ./src/ai_service/

RUN adduser --disabled-password --gecos '' appuser
USER appuser

EXPOSE 8001
CMD ["uvicorn", "src.ai_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### 3.4 Docker Compose (Dev)

```yaml
version: "3.9"
services:
  backend:
    build: 
      context: .
      dockerfile: docker/backend.Dockerfile
    ports: ["8000:8000"]
    env_file: .env.local
    volumes: ["./src:/app/src"]
    depends_on: [postgres, redis]
    
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports: ["3000:3000"]
    volumes: ["./frontend/src:/app/src"]
    
  ai-service:
    build:
      context: .
      dockerfile: docker/ai.Dockerfile
    ports: ["8001:8001"]
    env_file: .env.local
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
    
  postgres:
    image: supabase/postgres:15.1.0.117
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: postgres
    volumes: ["pgdata:/var/lib/postgresql/data"]
    
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

---

## 4. CI/CD PIPELINE

### 4.1 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Backend lint (Ruff)
        run: ruff check src/
      - name: Backend type check (mypy)
        run: mypy src/ --strict
      - name: Frontend lint (ESLint)
        run: cd frontend && npm run lint
      - name: Frontend type check (tsc)
        run: cd frontend && npm run typecheck

  test-backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: pip install -r requirements/test.txt
      - name: Run tests
        run: pytest --cov=src --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: cd frontend && npm ci
      - name: Run tests
        run: cd frontend && npm run test:run
      - name: Build check
        run: cd frontend && npm run build

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Dependency scan
        run: pip-audit -r requirements/prod.txt
      - name: Secret scan
        uses: trufflesecurity/trufflehog@main
      - name: Container scan
        run: trivy image backend:latest

  deploy-staging:
    if: github.ref == 'refs/heads/main'
    needs: [lint-and-type-check, test-backend, test-frontend, security-scan]
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to staging
        run: echo "Deploy to staging environment"
```

### 4.2 Pipeline Stages

```
PR Created
    │
    ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Lint &  │  │  Tests   │  │ Security │  │  Build   │
│  Format  │  │  (unit+  │  │  Scan    │  │  Check   │
│          │  │  integ)  │  │          │  │          │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │              │              │              │
     └──────────────┴──────────────┴──────────────┘
                         │
                         ▼ (all pass)
                    PR Approved
                         │
                         ▼ (merge to main)
                ┌────────────────┐
                │  Build Images  │
                │  Push to ECR   │
                └────────┬───────┘
                         │
                         ▼ (auto)
                ┌────────────────┐
                │  Deploy to     │
                │  Staging       │
                └────────┬───────┘
                         │
                         ▼ (manual approval)
                ┌────────────────┐
                │  Deploy to     │
                │  Production    │
                └────────────────┘
```

---

## 5. KUBERNETES — REFERENCIA FUTURA (NO APLICA A FASES 0-2)

> **Decisión DR-008: Kubernetes está pospuesto.** Esta sección se conserva como
> referencia de diseño para cuando se superen los umbrales de §1.1.2. **No es el plan
> de despliegue de Fases 0-2.** El despliegue vigente está en §1.1 y §9.

### 5.1 Arquitectura K8s (futura)

```
┌─────────────────────────────────────────────────────────────┐
│                    KUBERNETES CLUSTER                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  NAMESPACE: olo-ia-prod                                      │
│                                                              │
│  ┌─────────────────────────────────────────────────┐        │
│  │  Ingress (nginx/traefik)                        │        │
│  └──────────────────┬──────────────────────────────┘        │
│                     │                                        │
│     ┌───────────────┼────────────────┐                      │
│     ▼               ▼                ▼                       │
│  ┌────────┐   ┌──────────┐   ┌───────────┐                 │
│  │backend │   │ frontend │   │ai-service │                  │
│  │(Deploy)│   │ (Deploy) │   │ (Deploy)  │                  │
│  │ x3     │   │  x2      │   │  x2+GPU  │                  │
│  └────────┘   └──────────┘   └───────────┘                 │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐               │
│  │  Redis  │  │  Worker  │  │  CronJobs   │               │
│  │(StatefulS│  │(Deploy) │  │(sync,reports)│               │
│  └─────────┘  └─────────┘  └──────────────┘               │
│                                                              │
│  EXTERNAL:                                                   │
│  • Supabase (PostgreSQL, Auth, Storage, Realtime)           │
│  • CloudFlare (CDN, DDoS)                                   │
│  • Monitoring (Grafana Cloud)                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Scaling Strategy

| Service | Min | Max | Metric | Threshold |
|---------|-----|-----|--------|-----------|
| backend | 2 | 10 | CPU | 70% |
| ai-service | 1 | 5 | GPU util + Queue depth | 80% / 20 jobs |
| frontend | 2 | 5 | RPS | 1000 rps |
| worker | 1 | 5 | Queue depth | 50 jobs |

### 5.3 Health Checks

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /ready
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## 6. ZERO-DOWNTIME DEPLOYMENTS

### 6.1 Estrategia: Rolling Update

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

### 6.2 Database Migrations

1. Las migraciones son backwards-compatible (expand/contract pattern).
2. Migrate ANTES del deploy de la nueva versión.
3. Nuevo código funciona con schema viejo y nuevo.
4. Cleanup del schema viejo en siguiente release.

---

## 7. MONITORING Y ALERTAS

### 7.1 Stack de Observabilidad

| Componente | Herramienta | Propósito |
|-----------|-------------|----------|
| Metrics | Prometheus + Grafana | Dashboards, alertas |
| Logs | Loki | Aggregación de logs |
| Traces | Tempo + OpenTelemetry | Distributed tracing |
| Errors | Sentry | Error tracking |
| Uptime | UptimeRobot / Checkly | Synthetic monitoring |

### 7.2 Alertas Críticas

| Alerta | Condición | Acción |
|--------|-----------|--------|
| Service down | Health check fails 3x | PagerDuty → On-call |
| High error rate | > 5% 5xx en 5 min | PagerDuty → Team |
| DB connection pool exhausted | Available < 5 | Auto-scale + alert |
| Disk usage > 85% | Storage fill rate | Alert → Cleanup |
| GPU OOM | Out of memory | Alert + restart pod |
| SSL cert expiring | < 14 days | Alert → Renew |

---

## 8. DISASTER RECOVERY

| Escenario | RTO | RPO | Procedimiento (PaaS) |
|-----------|-----|-----|---------------------|
| Container crash | 30s | 0 | Auto-restart del PaaS |
| Instancia degradada | 1 min | 0 | El PaaS enruta a instancia sana |
| Región del PaaS caída | 1 hora | 5 min | Redeploy en región alternativa |
| DB corruption | 1 hora | 5 min | Point-in-time recovery de Supabase |
| Complete failure | 4 horas | 5 min | Full restore desde backup |

---

## 9. GESTIÓN DE SECRETOS

> **Decisión aprobada.** Los secretos **nunca** están en el repositorio.

### 9.1 Reglas

| Regla | Implementación |
|-------|---------------|
| Ningún secreto en el repositorio | `.gitignore` incluye `.env.local`, `.env.*.local`, `*.pem`, `*.key` |
| `.env.example` sí se versiona | Solo nombres de variables y comentarios, **nunca** valores reales |
| `.env.local` nunca se versiona | Uso exclusivamente local, generado por cada desarrollador |
| Detección automática | `trufflehog` en pre-commit y en CI |
| Secretos de CI | GitHub Actions Secrets |
| Secretos de runtime | Variables de entorno del PaaS (secret manager del proveedor) |
| Credenciales de integración WMS | Encriptadas AES-256 en la BD, clave en secret manager |
| Rotación | Ver `SECURITY.md` §7.2 |

### 9.2 Inventario de secretos por entorno

| Secreto | local | staging | production |
|---------|-------|---------|-----------|
| `SUPABASE_URL` | Local (Docker) | Secret manager | Secret manager |
| `SUPABASE_ANON_KEY` | Local | Secret manager | Secret manager |
| `SUPABASE_SERVICE_ROLE_KEY` | Local | Secret manager, **acceso restringido** | Secret manager, **acceso restringido** |
| `OLO_APP_DB_PASSWORD` | Local | Secret manager | Secret manager |
| `DATABASE_URL` (rol olo_app) | Local | Secret manager | Secret manager |
| `REDIS_URL` | N/A hasta Sprint 1.4 | Secret manager | Secret manager |
| SMTP credentials | Mailhog local | Secret manager | Secret manager |

### 9.3 Uso de `service_role`

> **Decisión DR-002.** `service_role` tiene `BYPASSRLS`. Su exposición equivale a
> exponer todos los tenants.

| Regla | Detalle |
|-------|---------|
| Nunca en el frontend | Ni en variables de build, ni en el bundle, ni en localStorage |
| Nunca en el contenedor de la API pública | El backend que atiende requests de usuario usa `olo_app` |
| Solo en servicios privilegiados aislados | Un servicio o job separado, con su propio secreto |
| Auditoría obligatoria | Cada invocación de una operación con `service_role` genera un audit event |
| Lista enumerada de operaciones | Ver `SECURITY.md` §3.6 categoría C |

Verificación en CI: el pipeline falla si `SUPABASE_SERVICE_ROLE_KEY` aparece referenciada
en `frontend/`.

---

## 10. COLA DE TRABAJOS E INFRAESTRUCTURA DIFERIDA

> **Decisión DR-009 (aprobada).**

### 10.1 Qué se instala y cuándo

| Componente | Fase 0 | Fase 1 | Justificación |
|-----------|--------|--------|--------------|
| FastAPI BackgroundTasks | Sí (parte de FastAPI) | Sí | Cero infraestructura |
| Interfaz `JobDispatcher` | Sí (definida) | Sí | Evita acoplamiento futuro |
| `InlineJobDispatcher` | Sí (implementación trivial) | Se retira | Suficiente para Fase 0 |
| **Redis** | **No se instala** | Sí, en Sprint 1.4 | Primer caso real: sync de conector WMS |
| **ARQ + workers** | **No se instala** | Sí, en Sprint 1.4 | Requiere Redis |

### 10.2 Por qué no instalar Redis en Fase 0

En Fase 0 no existe ningún trabajo que requiera persistencia, reintentos o scheduling.
Instalar Redis produciría: un servicio más en Docker Compose, un secreto más que
gestionar, un punto de fallo más en health checks, y un coste en staging. Sin ningún
trabajo que encolar.

La interfaz `JobDispatcher` se define en Fase 0 precisamente para que agregar Redis en
Sprint 1.4 no requiera tocar el código de aplicación.

### 10.3 Primer caso real que dispara la instalación

**Sprint 1.4, tarea 076** (sync engine del conector WMS): el primer trabajo que debe
sobrevivir a un reinicio, reintentar con backoff, y ser consultable por el usuario.
En ese momento se instalan Redis y ARQ.

### 10.4 Alternativas descartadas y futuras

| Opción | Estado | Razón |
|--------|--------|-------|
| ARQ + Redis | **Elegida** | Async nativo, ligero, integra con asyncio/FastAPI |
| Celery + Redis | Alternativa futura | Más maduro pero más pesado; su modelo síncrono encaja peor con async |
| Dramatiq | Alternativa futura | Buena opción, menos ecosistema async |
| Temporal | Alternativa futura | Potente para workflows complejos y de larga duración; complejidad operacional injustificada ahora |
| pg_cron + tablas de cola | Descartada | Reimplementar una cola sobre PostgreSQL es más trabajo que usar una |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
