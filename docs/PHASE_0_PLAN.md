# OLO_IA - PLAN DETALLADO FASE 0 (FUNDACIÓN)

> Versión 2.0 — Actualizado con resoluciones aprobadas (DR-001 a DR-016).

## 1. ALCANCE

Esta fase establece la base técnica completa. Al finalizarla, el equipo debe poder construir cualquier módulo de negocio sobre una infraestructura segura, multi-tenant y observable.

### Incluye
- Repositorio monorepo con CI/CD
- Backend FastAPI con Clean Architecture
- Frontend React con design system base
- Supabase configurado (local + cloud)
- PostgreSQL con schemas, RLS (v2.0), triggers
- Custom Access Token Hook (función PL/pgSQL)
- Autenticación completa con JWT mínimo
- Modelo de roles: authenticated / olo_app / service_role
- Multi-tenant context propagation
- RBAC funcional (roles predefinidos + custom)
- Auditoría append-only
- Interfaz `JobDispatcher` (sin Redis hasta que se necesite)
- Observabilidad básica (logging estructurado, health checks, correlation IDs)
- Tests de aislamiento RLS
- Docker Compose para dev
- Deploy a PaaS (staging)

### NO incluye
- YOLO ni ningún motor de IA
- Drones ni streaming
- AutoCAD/DWG/DXF
- Conectores WMS
- Datasets ni entrenamiento
- Inferencia
- Módulo de inventarios (es Fase 1)
- Kubernetes
- Billing
- Redis (se agrega cuando exista primer caso real)
- ARQ workers (se agrega con Redis)

---

## 2. DECISIONES VIGENTES PARA ESTA FASE

| ID | Decisión | Impacto en Fase 0 |
|----|----------|-------------------|
| DR-001 | RLS v2.0 fuente de verdad | Toda policy sigue patrón RESTRICTIVE + PERMISSIVE |
| DR-002 | authenticated + olo_app + service_role | Tres caminos de acceso claramente separados |
| DR-003 | JWT mínimo | Hook solo publica tenant_id + tenant_wide_access |
| DR-004 | Registro admin-only | No construir self-service, solo endpoint interno |
| DR-005 | Países híbridos | public.countries + core.tenant_countries |
| DR-008 | PaaS para deploy | Docker Compose local, Cloud Run / Fly para staging |
| DR-009 | BackgroundTasks + interfaz JobDispatcher | Sin Redis hasta Fase 1 |
| DR-011 | revoked_at en user_warehouse_access | Columna presente desde migración |
| DR-012 | Hook PL/pgSQL | Implementar y registrar en Supabase Auth |
| DR-015 | FORCE RLS | En toda tabla de negocio |
| DR-016 | Soft delete fuera de RLS | Vistas _active |

---

## 3. SPRINT 0.1 — REPOSITORIO E INFRAESTRUCTURA (Semanas 1-2)

### Entregables

| # | Tarea | Criterio Done |
|---|-------|---------------|
| 001 | Crear monorepo: `backend/`, `frontend/`, `docker/`, `supabase/`, `docs/`, `infra/` | Estructura existe, .gitignore, README |
| 002 | `backend/pyproject.toml`: Python 3.12, Ruff, mypy strict, pytest, pre-commit | `ruff check .` y `mypy .` sin errores |
| 003 | `frontend/package.json`: React 18, Vite, TS strict, ESLint, Prettier, Vitest | `npm run lint && tsc --noEmit` sin errores |
| 004 | `docker/docker-compose.dev.yml`: supabase-local (PG + Auth + Storage), Redis comentado | `docker compose up` levanta Supabase local |
| 005 | `.github/workflows/ci.yml`: lint + type-check + test (backend y frontend) | PR de prueba pasa CI |
| 006 | Crear proyecto Supabase cloud (entorno dev) | Conexión verificada desde backend |
| 007 | `Makefile`: setup, dev, test, lint, migrate, seed, check-rls | `make setup && make dev` < 30 min |
| 008 | `.pre-commit-config.yaml`: ruff, mypy, trufflehog (secrets) | Commit con secret rechazado |
| 009 | `.env.example` documentado | Todas las variables con comentarios |
| 010 | ADRs: 001-monolith, 002-supabase, 003-rls-v2, 004-jwt-minimal, 005-role-model | 5 ADRs en docs/adr/ |
| 011 | Backend: FastAPI app factory + health endpoints (/health, /ready) | Responden 200 sin auth |
| 012 | Backend: Structured logging (JSON) + correlation ID middleware | Logs con request_id en cada línea |
| 013 | Backend: interfaz `JobDispatcher` (abstract, implementación noop para Fase 0) | Protocolo definido en application/common/ |

### Verificación
- Nuevo dev productivo en < 30 minutos.
- CI pasa con health endpoint funcional.
- Logs estructurados visibles en stdout.

---

## 4. SPRINT 0.2 — BASE DE DATOS Y RLS (Semanas 3-4)

### Entregables

| # | Tarea | Criterio Done |
|---|-------|---------------|
| 014 | Configurar Alembic multi-schema (core, inventory, ai, devices, integrations, spatial, audit, platform) | `alembic upgrade head` ejecuta sin error |
| 015 | Crear rol `olo_app` (LOGIN, NOBYPASSRLS, NOINHERIT) con GRANTs por schema | Rol verificado en PG |
| 016 | Migración: `public.countries` (catálogo global, RLS read-only para authenticated) | Tabla con 250 países seed |
| 017 | Migración: `core.tenants` | CHECK constraints, slug unique |
| 018 | Migración: `core.tenant_countries` (activación per-tenant) | FK a public.countries y core.tenants |
| 019 | Migración: `core.companies` + FK + RLS Plantilla A | Policy RESTRICTIVE + PERMISSIVE |
| 020 | Migración: `core.warehouses` + RLS Plantilla B (can_access_warehouse) | Warehouse isolation funcional |
| 021 | Migración: `core.areas`, `core.locations` + RLS Plantilla B | Jerarquía completa con RLS |
| 022 | Migración: `core.users` (con auth_id, status, etc.) + RLS Plantilla A | Unique email per tenant |
| 023 | Migración: `core.roles` + RLS especial (NULL = system role visible) | System roles + tenant customs |
| 024 | Migración: `core.user_role_assignments` + RLS Plantilla A | Scope type + scope IDs |
| 025 | Migración: `core.user_warehouse_access` con `revoked_at` + RLS Plantilla A (sin llamar a can_access_warehouse) | Índice para RLS query |
| 026 | Migración: `audit.events` (particionada mensual, append-only) | REVOKE UPDATE/DELETE de authenticated y olo_app |
| 027 | Funciones: `current_tenant_id()`, `current_auth_id()`, `current_user_id()` (SQL, STABLE, search_path='') | Sin SECURITY DEFINER excepto accessible_warehouse_ids |
| 028 | Funciones: `has_tenant_wide_access()`, `accessible_warehouse_ids()` (SECURITY DEFINER), `can_access_warehouse()` | Predicado único para todas las policies B |
| 029 | Triggers: `set_updated_at()`, `prevent_tenant_change()` (IS DISTINCT FROM) | Aplicados a todas las tablas |
| 030 | `FORCE ROW LEVEL SECURITY` en todas las tablas de core, audit | Script de verificación en CI |
| 031 | Seed: 1 tenant, 1 company, 1 warehouse, 3 áreas, 10 locations, 1 user admin | `make seed` funcional |
| 032 | Seed: roles predefinidos (tenant_admin, warehouse_manager, operator, viewer) con permisos JSONB | Roles insertados |
| 033 | Tests RLS: cross-tenant isolation (5+ tests) | Sin contexto = 0 filas; otro tenant = 0 filas |
| 034 | Tests RLS: warehouse isolation (3+ tests) | Sin acceso al warehouse = 0 filas |
| 035 | Tests RLS: audit append-only (UPDATE/DELETE denegados) | Excepción al intentar modificar |
| 036 | Tests RLS: prevent_tenant_change trigger | Excepción al cambiar tenant_id |
| 037 | Script `make check-rls`: verifica que TODA tabla en schemas de negocio tiene ENABLE + FORCE | Falla si alguna tabla no tiene RLS |
| 038 | Benchmark: EXPLAIN ANALYZE de queries con RLS + índices | Todas usan Index Scan, no Seq Scan |

### Verificación
- `make check-rls` pasa (todas las tablas protegidas).
- Tests de aislamiento 100% passing.
- Benchmark demuestra < 5ms overhead por RLS.

---

## 5. SPRINT 0.3 — AUTENTICACIÓN Y SEGURIDAD (Semanas 5-6)

### Entregables

| # | Tarea | Criterio Done |
|---|-------|---------------|
| 039 | **PoC Custom Access Token Hook**: función PL/pgSQL registrada en Supabase | Claims tenant_id y tenant_wide_access presentes en JWT de login |
| 040 | Hook: fail-secure (usuario sin membresía activa no recibe claims custom) | Login de usuario inactivo → JWT sin tenant_id → RLS deniega |
| 041 | Hook: permisos correctos (solo supabase_auth_admin ejecuta) | REVOKE verificado |
| 042 | Backend middleware (camino authenticated): extraer JWT, validar firma vía Supabase JWKS | 401 sin token o token inválido |
| 043 | Backend middleware: NO usar set_config cuando hay JWT (PostgREST/RLS lee directamente claims) | Verificar que RLS funciona solo con JWT claims |
| 044 | Backend middleware (camino olo_app): set_config parameterizado para workers internos | Worker con contexto → RLS filtra correctamente |
| 045 | Endpoint: POST /v1/auth/login (delega a Supabase Auth) | Retorna access_token + refresh_token |
| 046 | Endpoint: POST /v1/auth/refresh | Nuevo access_token con claims actualizados |
| 047 | Endpoint: POST /v1/auth/logout (invalida refresh en Supabase) | Token invalidado |
| 048 | Endpoint: GET /v1/auth/me (perfil desde core.users) | Retorna user con roles y warehouses |
| 049 | Endpoint: POST /v1/auth/forgot-password | Email de reset enviado |
| 050 | Endpoint: POST /v1/auth/reset-password | Contraseña cambiada |
| 051 | Account lockout: bloquear tras 5 intentos fallidos (configurable) | Cuenta bloqueada, 403 en login |
| 052 | RBAC middleware: verificar permission + scope en cada endpoint protegido | 403 sin permiso |
| 053 | Permission evaluation: consulta roles + scope desde DB (no desde JWT) | Revocación inmediata verificada |
| 054 | Audit: registrar login, logout, failed_login, password_change en audit.events | Eventos verificables en DB |
| 055 | Rate limiting middleware: por IP (anon), por user (auth) | 429 al exceder |
| 056 | Security headers (HSTS, X-Frame-Options, CSP, etc.) | Headers presentes en responses |
| 057 | CORS: configuración restrictiva por entorno | Solo origins permitidos |
| 058 | Tests E2E: login → request protegido con RLS → ver solo datos propios → logout | Flujo completo funcional |
| 059 | Tests: RBAC deniega sin permiso (3+ scenarios) | 403 verificados |
| 060 | Tests: rate limiting (exceder → 429) | Test automatizado |
| 061 | Tests: usuario de Tenant A no puede acceder a datos de Tenant B via API | API-level isolation |

### Verificación
- Login produce JWT con claims correctos (verificable en jwt.io).
- Request con JWT → RLS filtra sin set_config manual (camino authenticated).
- Worker con olo_app + set_config → RLS filtra correctamente (camino olo_app).
- Permission revocada → siguiente request denegado (sin re-login).
- Audit trail completo de operaciones auth.

---

## 6. SPRINT 0.4 — FRONTEND FOUNDATION (Semanas 7-8)

### Entregables

| # | Tarea | Criterio Done |
|---|-------|---------------|
| 062 | Proyecto React + Vite + TypeScript strict + path aliases | Build sin errores |
| 063 | Tailwind CSS + tema custom (dark mode default) + CSS variables | Toggle dark/light persistente |
| 064 | Design system: Button (primary, secondary, ghost, destructive, loading) | Accesible, keyboard |
| 065 | Design system: Input, Textarea, Select, Checkbox, Switch | Estados: default, focus, error, disabled |
| 066 | Design system: Modal, Drawer, Dropdown, Toast, Command Palette | Animaciones, ESC, focus trap |
| 067 | Design system: Table (sort, pagination, loading skeleton, empty state) | Responsive |
| 068 | Design system: Badge, Avatar, Card, Spinner, Breadcrumb | Variantes |
| 069 | Layout: MainLayout (collapsible sidebar + header + content) | Responsive |
| 070 | Layout: AuthLayout (centrado minimal) | Branding |
| 071 | React Router: rutas protegidas, redirect sin auth a /login | Funcional |
| 072 | React Query: client config, interceptor auth (401 → refresh → retry) | Transparente |
| 073 | Zustand: authStore (token, user, login, logout, refresh) | Persistencia localStorage |
| 074 | Zustand: tenantStore (tenant, currentWarehouse, switchWarehouse) | Selector funcional |
| 075 | Zustand: uiStore (sidebar, theme) | Persistente |
| 076 | API client: fetch/axios con baseURL + auth header + correlation ID | Interceptors |
| 077 | Página: LoginPage con form, validación, error handling | Login real funciona |
| 078 | Página: DashboardPage (placeholder con saludo y warehouse selector) | Renderiza tras login |
| 079 | Página: 404 NotFoundPage | Catch-all |
| 080 | i18n: setup react-i18next con archivos ES/EN (textos base) | Toggle idioma funcional |
| 081 | Tests: 10+ tests de componentes (Vitest + Testing Library) | Passing |
| 082 | Build producción: sin errores, bundle analizado | < 500KB gzip initial |

### Verificación
- Login → Dashboard con sidebar funcional.
- Cambiar warehouse → UI refleja cambio.
- Cambiar tema dark/light.
- Cambiar idioma es/en.
- Build producción exitoso.

---

## 7. KPIs DE FASE 0

| Métrica | Target | Medición |
|---------|--------|----------|
| Setup time nuevo dev | < 30 min | Cronometrar |
| CI build time | < 5 min | GitHub Actions |
| Test coverage backend | > 80% | pytest-cov |
| Test coverage frontend | > 60% | vitest coverage |
| Vulnerabilidades críticas | 0 | pip-audit + npm audit |
| RLS isolation tests | 100% passing | pytest markers |
| RLS performance overhead | < 5ms por query | EXPLAIN ANALYZE |
| Custom Hook latency | < 50ms | Supabase logs |
| Frontend bundle | < 500KB gzip | vite build |
| API p95 latency (auth) | < 200ms | Local benchmark |

---

## 8. RIESGOS DE FASE 0

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| Custom Access Token Hook PL/pgSQL no soportado en plan Supabase | Media | PoC en día 1 de Sprint 0.3. Plan B: usar supabase.auth.admin.updateUser() para escribir app_metadata desde backend |
| `olo_app` role conflicts con Supabase internal roles | Baja | Verificar en Sprint 0.1 con Supabase local |
| `accessible_warehouse_ids()` SECURITY DEFINER recursión | Baja | Policy de user_warehouse_access no llama a can_access_warehouse (ya documentado) |
| Design system toma más tiempo del estimado | Media | Usar Radix UI primitives + Tailwind. No reinventar |
| Alembic migraciones + Supabase local: conflictos de schema | Media | Deshabilitar migraciones automáticas de Supabase, usar solo Alembic |

---

## 9. CRITERIO DE ÉXITO

La Fase 0 está **COMPLETA** cuando:

- [ ] `docker compose up` + `make seed` → sistema funcional en < 5 min.
- [ ] Login → Dashboard → Logout funciona E2E.
- [ ] JWT contiene SOLO sub, role, tenant_id, tenant_wide_access.
- [ ] `make check-rls` pasa (100% tablas con ENABLE + FORCE).
- [ ] Tests cross-tenant = 0 filas (CI verde).
- [ ] Tests warehouse isolation = 0 filas (CI verde).
- [ ] RBAC deniega sin permiso (403 verificado).
- [ ] Audit events registrados para todas las operaciones auth.
- [ ] Frontend renderiza con design system y es navegable.
- [ ] CI pipeline verde (lint + types + tests + security scan).
- [ ] Deploy a staging (PaaS) funcional.
- [ ] Documentación de setup verificada por persona externa.

---

*Documento actualizado con resoluciones aprobadas.*
*Versión: 2.0*
*Fecha: Julio 2026*
