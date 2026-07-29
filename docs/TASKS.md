# OLO_IA - TAREAS DE IMPLEMENTACIÓN

## 1. INTRODUCCIÓN

Este documento desglosa las tareas de implementación organizadas por fase y sprint. Cada tarea tiene un estimado de esfuerzo, dependencias y criterios de completitud.

### Estimados de Esfuerzo
- **XS**: < 2 horas
- **S**: 2-4 horas
- **M**: 4-8 horas (1 día)
- **L**: 2-3 días
- **XL**: 4-5 días
- **XXL**: > 1 semana (debe dividirse)

---

## 1.1 ESTADO DE AUTORIZACIÓN DE SPRINTS

> **Solo Sprint 0.1 está autorizado a comenzar.** Los sprints posteriores tienen
> condiciones de entrada explícitas que deben cumplirse antes de iniciarlos.

| Sprint | Estado | Bloqueado por |
|--------|--------|--------------|
| **Sprint 0.1** — Infraestructura | **AUTORIZADO** | — |
| Sprint 0.2 — Base de datos y RLS | **BLOQUEADO** | Ver §1.3 (condiciones de entrada) |
| Sprint 0.3 — Autenticación | **BLOQUEADO** | Sprint 0.2 completo + PoC del Auth Hook |
| Sprint 0.4 — Frontend | **BLOQUEADO** | Sprint 0.1 completo (contratos de API definidos) |
| Fase 1+ | **BLOQUEADO** | Fase 0 completa |

### 1.2 Restricción crítica de Sprint 0.1

> **Sprint 0.1 NO puede crear migraciones definitivas de dominio.**

| Permitido en Sprint 0.1 | Prohibido en Sprint 0.1 |
|------------------------|------------------------|
| Configurar Alembic (env.py, alembic.ini, estructura) | Crear migraciones de tablas de dominio |
| Migración de prueba y su reverso, para validar el pipeline | Migraciones de `core.*`, `inventory.*`, etc. |
| Verificar que `upgrade`/`downgrade` funcionan | Definir el schema real |
| Documentar el proceso de migración | Crear funciones RLS o policies |
| Crear `alembic_version` | Crear roles de PostgreSQL definitivos |

**Motivo**: el schema definitivo depende de la auditoría técnica paralela en curso.
Crear migraciones de dominio antes de incorporar esos hallazgos produciría migraciones
que habría que revertir o corregir, con el riesgo de divergencia entre entornos.

La migración de prueba de Sprint 0.1 debe ser trivial y desechable:

```
migrations/versions/0001_smoke_test.py
  upgrade():   CREATE TABLE public._migration_smoke_test (id int primary key);
  downgrade(): DROP TABLE public._migration_smoke_test;
```

Esta migración se elimina al iniciar Sprint 0.2.

### 1.3 Condiciones de entrada a Sprint 0.2

Sprint 0.2 **no puede comenzar** hasta que se cumplan **todas**:

| # | Condición | Verificable por |
|---|-----------|----------------|
| C1 | Sprint 0.1 completado y verificado (todas sus tareas Done) | Checklist de Sprint 0.1 |
| C2 | Auditoría técnica de Claude entregada | Documento de hallazgos recibido |
| C3 | Hallazgos de Claude reconciliados con DECISION_REGISTER.md | Nuevas decisiones registradas con estado |
| C4 | Documentos originales sincronizados (SECURITY, DATABASE_DESIGN, MULTITENANT, ARCHITECTURE, DEPLOYMENT, TASKS, FOLDER_STRUCTURE) | CHANGELOG_ARCHITECTURE_SYNC.md actualizado |
| C5 | Cero contradicciones abiertas entre RLS_STRATEGY v2.0 y el resto de documentos | Revisión cruzada |
| C6 | Schema de dominio congelado y aprobado por el owner | Aprobación explícita |
| C7 | Aprobación explícita del owner para iniciar Sprint 0.2 | — |

**Si cualquier condición no se cumple, Sprint 0.2 permanece bloqueado.**

---

## 2. FASE 0: FUNDACIÓN

### Sprint 0.1 - Infraestructura  **[AUTORIZADO]**

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 001 | Crear repositorio con estructura de carpetas definida | S | - | Carpetas creadas, .gitignore, README |
| 002 | Configurar pyproject.toml (ruff, mypy, pytest) | S | 001 | Linting y type checking funcional |
| 003 | Configurar package.json frontend (eslint, prettier, vitest) | S | 001 | Lint y format funcional |
| 004 | Crear Docker Compose para desarrollo local | M | 001 | `docker compose up` levanta todo |
| 005 | Configurar CI pipeline (GitHub Actions: lint + test) | M | 002, 003 | PR trigger, jobs verdes |
| 006 | Crear proyecto Supabase y conectar | S | - | Conexión verificada |
| 007 | Crear scripts de setup (make setup, make dev) | S | 004 | Nuevo dev productivo en < 30 min |
| 008 | Configurar pre-commit hooks (lint, format, secrets) | S | 002 | Hooks ejecutan en cada commit |
| 009 | Crear ADRs: 001-monolith, 002-supabase, 003-rls-v2, 004-jwt-minimal, 005-role-model, 006-paas-deploy, 007-job-dispatcher | M | - | 7 documentos en docs/adr/ |
| 010 | Configurar `.env.example` (raíz, versionado) y `.env.local` (raíz, en .gitignore) | XS | 006 | Variables documentadas, .env.local ignorado por git |
| 011 | Configurar Alembic: env.py, alembic.ini, estructura en `/migrations` | M | 006 | Estructura lista. **SIN migraciones de dominio** |
| 012 | Migración smoke test (`0001_smoke_test`) para validar el pipeline up/down | S | 011 | `upgrade` y `downgrade` funcionan. Se elimina en Sprint 0.2 |
| 013 | Definir interfaz `IJobDispatcher` en application/common/jobs.py | S | 002 | Protocolo definido, sin implementación de Redis |
| 014 | Implementar `InlineJobDispatcher` (ejecución síncrona, sin Redis) | S | 013 | Tests unitarios pasando |
| 015 | Crear estructura `workers/` con READMEs de contrato, sin implementaciones | S | 001 | Directorios con `__init__.py` y README explicando el contrato |
| 016 | Backend: FastAPI app factory + health endpoints (/health, /ready) | M | 002 | Responden 200 sin auth |
| 017 | Backend: logging estructurado JSON + middleware de correlation ID | M | 016 | Cada log lleva request_id |
| 018 | Verificación CI: fallar si `SUPABASE_SERVICE_ROLE_KEY` se referencia en `frontend/` | S | 005 | Job de CI que falla ante la referencia |

### Sprint 0.1 — Tareas de reconciliación documental

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| R01 | Recibir e inventariar hallazgos de la auditoría técnica de Claude | M | - | Documento de hallazgos inventariado |
| R02 | Clasificar cada hallazgo: confirmado / rechazado / requiere decisión | M | R01 | Tabla de clasificación completa |
| R03 | Registrar hallazgos confirmados en DECISION_REGISTER.md con ID DR-0XX | M | R02 | Cada hallazgo tiene entrada con estado |
| R04 | Detectar contradicciones entre hallazgos de Claude y decisiones ya aprobadas | M | R03 | Lista de contradicciones, sin resolver unilateralmente |
| R05 | Escalar contradicciones al owner para decisión | S | R04 | Owner notificado con opciones y recomendación |
| R06 | Actualizar CHANGELOG_ARCHITECTURE_SYNC.md con la segunda ronda de sincronización | M | R05 | Trazabilidad completa |
| R07 | Verificación cruzada final: cero contradicciones abiertas entre los 18 documentos + RLS v2.0 | L | R06 | Matriz de consistencia sin celdas rojas |
| R08 | Congelar el schema de dominio y obtener aprobación explícita del owner | S | R07 | Aprobación registrada |

### Sprint 0.1 — Criterio de completitud

- [ ] Tareas 001-018 en estado Done.
- [ ] Tareas R01-R08 en estado Done.
- [ ] `make setup && make dev` funciona para un desarrollador nuevo en < 30 min.
- [ ] CI verde: lint + type check + test + secret scan.
- [ ] `.env.local` verificado como no versionado.
- [ ] Migración smoke test aplicada y revertida con éxito.
- [ ] Cero migraciones de dominio creadas.
- [ ] Condiciones C1-C7 de §1.3 evaluadas.

---

### Sprint 0.2 - Base de Datos  **[BLOQUEADO — ver §1.3]**

> **No iniciar hasta cumplir las condiciones C1-C7 de §1.3.**
> La primera tarea de este sprint es eliminar la migración smoke test de Sprint 0.1.

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 011 | Configurar Alembic con multi-schema support | M | 006 | Migraciones up/down funcional |
| 012 | Crear schema core + tabla tenants | S | 011 | Migración aplicada |
| 013 | Crear tablas countries, companies | S | 012 | FK a tenants, índices |
| 014 | Crear tablas warehouses, areas, locations | M | 013 | Jerarquía completa |
| 015 | Crear tablas users, roles, user_role_assignments | M | 012 | Relaciones correctas |
| 016 | Implementar RLS policies para schema core | L | 012-015 | Policies activas, testeadas |
| 017 | Crear funciones helper (current_tenant_id, prevent_tenant_change) | M | 016 | Funciones operativas |
| 018 | Crear triggers (updated_at, prevent_tenant_change) | S | 017 | Triggers aplicados |
| 019 | Crear seed data (tenant demo, roles default, catálogo de países global) | M | 015 | Dev environment poblado |

### Sprint 0.2 — Suite de pruebas de seguridad multi-tenant

> Estas pruebas son **condición de salida** de Sprint 0.2. Sin ellas en verde, el sprint
> no se considera completo y Sprint 0.3 permanece bloqueado.

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| T01 | Test: query sin contexto de tenant retorna 0 filas en todas las tablas de negocio | M | 016 | Una aserción por tabla |
| T02 | Test: query con `tenant_id` de otro tenant retorna 0 filas | M | 016 | Cross-tenant SELECT bloqueado |
| T03 | Test: INSERT con `tenant_id` ajeno es rechazado | M | 016 | Excepción de policy |
| T04 | Test: UPDATE de filas de otro tenant afecta 0 filas | M | 016 | rowcount = 0 |
| T05 | Test: DELETE de filas de otro tenant afecta 0 filas | M | 016 | rowcount = 0 |
| T06 | Test: trigger `prevent_tenant_change` impide mover una fila entre tenants | S | 018 | Excepción lanzada |
| T07 | Test: `audit.events` rechaza UPDATE y DELETE desde `olo_app` y `authenticated` | S | 016 | Excepción de privilegios |
| T08 | Test: `FORCE ROW LEVEL SECURITY` activo en el 100% de tablas de negocio | S | 016 | Script que consulta `pg_tables` y `pg_class.relforcerowsecurity` |

### Sprint 0.2 — Pruebas de fuga horizontal (entre pares del mismo nivel)

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| H01 | Test: usuario con acceso a warehouse A no ve datos de warehouse B del mismo tenant | M | 016 | 0 filas de B |
| H02 | Test: usuario sin `user_warehouse_access` y sin `tenant_wide_access` no ve ningún warehouse | M | 016 | Usuario recién creado ve 0 warehouses (regresión del bug de centinela de array vacío) |
| H03 | Test: `revoked_at` surte efecto inmediato — revocar y consultar en el mismo test | M | 016 | Antes: N filas. Después de revocar: 0 filas. Sin nuevo login |
| H04 | Test: usuario de company A no ve datos de company B del mismo tenant | M | 016 | 0 filas de B |
| H05 | Test: `X-Warehouse-Id` de un warehouse sin acceso no otorga acceso | M | 016 | 0 filas, no error 500 |
| H06 | Test: usuario de tenant_country A no ve companies de tenant_country B | M | 016 | 0 filas |

### Sprint 0.2 — Pruebas de escalamiento vertical (elevación de privilegios)

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| V01 | Test: `tenant_wide_access` no puede activarse desde el cliente (solo el hook lo emite) | M | 016 | JWT manipulado es rechazado por firma |
| V02 | Test: usuario sin permiso no puede auto-asignarse un rol | M | 016 | 403 en el endpoint |
| V03 | Test: usuario no puede conceder `user_warehouse_access` a sí mismo sin permiso | M | 016 | Policy o aplicación lo bloquea |
| V04 | Test: rol `authenticated` no puede ejecutar funciones de `platform.*` sin ser platform admin | M | 016 | Excepción 42501 |
| V05 | Test: rol `olo_app` no tiene `BYPASSRLS` | S | 015 | Consulta a `pg_roles.rolbypassrls` = false |
| V06 | Test: `authenticated` no puede modificar `public.countries` | S | 016 | REVOKE efectivo |
| V07 | Test: funciones `SECURITY DEFINER` tienen `search_path` fijado | S | 017 | Consulta a `pg_proc.proconfig` |
| V08 | Test: `authenticated` no puede crear tenants | S | 016 | Sin policy de INSERT en `core.tenants` |
| V09 | Test: usuario no puede modificar su propio `tenant_id` en `core.users` | S | 018 | Trigger lo impide |

### Sprint 0.2 — Criterio de salida

- [ ] Tareas 011-019 en estado Done (numeración de Sprint 0.2).
- [ ] Suite T01-T08 en verde.
- [ ] Suite H01-H06 en verde (fuga horizontal).
- [ ] Suite V01-V09 en verde (escalamiento vertical).
- [ ] `make check-rls` pasa: 100% de tablas de negocio con ENABLE + FORCE.
- [ ] EXPLAIN ANALYZE de queries con RLS: Index Scan, no Seq Scan.
- [ ] Aprobación explícita del owner para iniciar Sprint 0.3.

---

### Sprint 0.3 - Autenticación  **[BLOQUEADO]**

> **Condición de entrada**: Sprint 0.2 completo + PoC del Custom Access Token Hook
> exitosa (tarea P01 abajo).

### Sprint 0.3 — PoC del Custom Access Token Hook

> **Responsable: Claude** (auditoría técnica paralela).
> Esta PoC es **condición de entrada** al resto de Sprint 0.3. No se implementa
> autenticación hasta que la PoC confirme que el mecanismo funciona en el plan de
> Supabase contratado.

| # | Tarea | Responsable | Esfuerzo | Criterio Done |
|---|-------|-------------|----------|---------------|
| P01 | Verificar que el plan de Supabase contratado soporta Custom Access Token Hooks PL/pgSQL | Claude | S | Confirmación documentada con evidencia |
| P02 | Implementar la función `auth.custom_access_token_hook(event JSONB)` según DECISION_REGISTER §B | Claude | M | Función creada en entorno de PoC |
| P03 | Registrar el hook en la configuración de Supabase Auth | Claude | S | Hook activo |
| P04 | Verificar que el JWT emitido contiene `tenant_id` y `tenant_wide_access` | Claude | S | Token decodificado muestra los claims |
| P05 | Verificar que los claims obligatorios de Supabase se conservan (`sub`, `role`, `aud`, `exp`, `iat`, `iss`) | Claude | S | Ningún claim estándar perdido |
| P06 | Verificar fail-secure: usuario sin membresía activa recibe token sin `tenant_id` | Claude | S | RLS deniega todo para ese usuario |
| P07 | Verificar permisos: solo `supabase_auth_admin` puede ejecutar la función | Claude | S | `anon`, `authenticated`, `PUBLIC` revocados |
| P08 | Medir latencia añadida al login | Claude | S | < 50ms de overhead |
| P09 | Documentar el resultado: GO / NO-GO, con plan B si es NO-GO | Claude | M | Informe entregado al owner |

**Plan B si P01 resulta NO-GO**: escribir `app_metadata` desde el backend vía
`supabase.auth.admin.updateUserById()` en el momento del provisioning y de cada cambio
de membresía. Menos elegante (el claim puede quedar obsoleto hasta el siguiente refresh),
pero funcional. Requiere decisión del owner.

### Sprint 0.3 — Tareas de autenticación (tras PoC exitosa)

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 021 | Integrar Supabase Auth (sign up, sign in, sign out) | M | 006, 015 | Flujo completo funcional |
| 022 | Implementar JWT validation middleware | M | 021 | Endpoints protegidos, 401 correctos |
| 023 | Implementar tenant context middleware | M | 022, 016 | SET LOCAL ejecuta, RLS filtra |
| 024 | Crear endpoint GET /v1/auth/me | S | 022 | Retorna perfil del usuario actual |
| 025 | Implementar refresh token handling | M | 021 | Rotación automática funcional |
| 026 | Implementar logout con invalidación | S | 021 | Token invalidado post-logout |
| 027 | Implementar forgot/reset password flow | M | 021 | Email enviado, reset funciona |
| 028 | Implementar account lockout tras N intentos | M | 022 | Bloqueo después de 5 fallos |
| 029 | Crear audit events para auth (login, logout, failed) | M | 022 | Eventos en audit.events |
| 030 | Implementar RBAC middleware (permission checking, consultando BD no JWT) | L | 015, 022 | 403 correcto sin permiso |
| 030b | Test: revocar un permiso surte efecto en el siguiente request, sin re-login | M | 030 | Verificación de DR-013 (TTL corto sin membership_version) |

### Sprint 0.4 - Frontend Foundation  **[BLOQUEADO — requiere contratos de API]**

> **Condición de entrada**: los contratos de API (OpenAPI spec) de los endpoints que
> el frontend consumirá deben estar definidos y publicados. No se construyen pantallas
> contra endpoints inexistentes.

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 031 | Setup proyecto React + Vite + TypeScript strict | M | 003 | Build sin errores |
| 032 | Configurar Tailwind CSS con tema custom (dark mode) | M | 031 | Theme toggle funcional |
| 033 | Crear componentes base: Button, Input, Badge | L | 032 | Variantes, estados, a11y |
| 034 | Crear componentes: Modal, Toast, Dropdown | L | 033 | Animaciones, keyboard nav |
| 035 | Crear componentes: Table, Pagination | L | 033 | Sort, filter, responsive |
| 036 | Crear layout MainLayout (Sidebar + Header + Content) | M | 033 | Responsive, collapsible |
| 037 | Configurar React Router con rutas protegidas | M | 031 | Redirect sin auth |
| 038 | Configurar React Query (queryClient, interceptors) | M | 031 | Error handling global |
| 039 | Implementar AuthStore (Zustand) + login/logout flow | M | 037, 038 | Login → dashboard |
| 040 | Crear TenantStore + warehouse selector | M | 039 | Switch warehouse funcional |

---

## 3. FASE 1: CORE PLATFORM

### Sprint 1.1 - Administración

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 041 | Backend: CRUD API para countries | M | 020, 030 | Endpoints funcionales con tests |
| 042 | Backend: CRUD API para companies | M | 041 | CRUD completo + validation |
| 043 | Backend: CRUD API para warehouses | M | 042 | Con settings independientes |
| 044 | Backend: CRUD API para areas | M | 043 | Jerarquía correcta |
| 045 | Backend: CRUD API para locations (+ bulk create) | L | 044 | Generación por patrón |
| 046 | Frontend: Página Countries (list + form) | M | 041, 035 | CRUD funcional en UI |
| 047 | Frontend: Página Companies (list + form + detail) | L | 042, 035 | Con logo upload |
| 048 | Frontend: Página Warehouses (list + form + detail) | L | 043, 035 | Con config panel |
| 049 | Frontend: Página Areas + Locations (tree view) | L | 044, 045 | Jerárquico, bulk create |
| 050 | Frontend: Dashboard del Super Admin | M | 043 | Métricas de tenants |

### Sprint 1.2 - Usuarios y Permisos

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 051 | Backend: CRUD API para users (+ invite flow) | L | 030 | Email invitation funcional |
| 052 | Backend: CRUD API para roles (+ permission matrix) | L | 030 | Permisos granulares |
| 053 | Backend: Assign/revoke roles con scope | M | 051, 052 | Scoped assignments |
| 054 | Backend: User warehouse access management | M | 051, 043 | Grant/revoke access |
| 055 | Backend: Permission evaluation en todos los endpoints | L | 053 | 403 correcto everywhere |
| 056 | Frontend: Página Users (list, invite, detail) | L | 051, 035 | Invitación por email |
| 057 | Frontend: Página Roles (list, create, permission matrix) | L | 052 | Grid visual de permisos |
| 058 | Frontend: User profile page (self-service) | M | 051 | Editar propio perfil |
| 059 | Frontend: Permission-based UI rendering | M | 055 | Elementos ocultos sin permiso |
| 060 | Frontend: Warehouse access selector in user form | M | 054 | Multi-select warehouses |

### Sprint 1.3 - Inventarios

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 061 | Backend: Crear schema inventory + migraciones | M | 020 | Tablas creadas, RLS activo |
| 062 | Backend: CRUD API productos (+ import CSV) | L | 061 | Import con validación |
| 063 | Backend: API stock records (query, reserve, move) | L | 061, 062 | Operaciones de stock |
| 064 | Backend: API counts (create, start, record, complete) | XL | 063 | Workflow completo |
| 065 | Backend: API adjustments (create, approve, apply) | L | 063 | Con workflow aprobación |
| 066 | Backend: API incidents (CRUD + resolve + close) | M | 063 | Lifecycle completo |
| 067 | Frontend: Página Products (list, form, import) | L | 062 | Drag&drop CSV import |
| 068 | Frontend: Página Stock (por ubicación, por producto) | L | 063 | Vistas múltiples |
| 069 | Frontend: Página Counts (workflow completo) | XL | 064 | Crear → Ejecutar → Cerrar |
| 070 | Frontend: Página Adjustments (con aprobación) | L | 065 | Workflow visual |
| 071 | Frontend: Página Incidents (list, detail, resolve) | M | 066 | Estado y asignación |
| 072 | Frontend: Dashboard inventarios (KPIs) | M | 063-066 | Métricas en tiempo real |

### Sprint 1.4 - Integraciones Base

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 073 | Backend: Crear schema integrations + tablas | M | 020 | Tablas con RLS |
| 074 | Backend: IWMSConnector interface + registry | M | 073 | Interfaz definida |
| 075 | Backend: GenericRESTConnector implementation | L | 074 | Configurable, funcional |
| 076 | Backend: Sync engine (fetch, transform, compare, apply) | XL | 075 | Pipeline completo |
| 077 | Backend: Retry logic + error handling | M | 076 | Backoff, dead letter |
| 078 | Backend: API for connectors (CRUD, test, sync) | L | 076 | Endpoints funcionales |
| 079 | Frontend: Página Connectors (list, wizard, detail) | L | 078 | Configuración guiada |
| 080 | Frontend: Field mapping UI (visual) | L | 078 | Drag & drop mapping |
| 081 | Frontend: Sync monitor (status, logs) | M | 078 | Progress en tiempo real |

### Sprint 1.5 - Reportes Base

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 082 | Backend: Report generation engine (PDF, Excel, CSV) | L | 063 | Templates funcionales |
| 083 | Backend: Predefined report templates | L | 082 | 5+ templates listos |
| 084 | Backend: Async report generation for large data | M | 082 | Background job, download |
| 085 | Backend: Report scheduling (cron) | M | 082 | Email delivery |
| 086 | Frontend: Reports page (templates, filters, generate) | L | 082 | UI completa |
| 087 | Frontend: Dashboard analytics (charts, KPIs) | L | 063 | Gráficos interactivos |

---

## 4. FASE 2: IA Y VISIÓN

### Sprint 2.1 - Arquitectura IA

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 088 | Backend: IInferenceEngine + ITrainingEngine interfaces | M | - | Interfaces definidas |
| 089 | Backend: Engine registry + factory | M | 088 | Registro funcional |
| 090 | Backend: YOLOInferenceEngine implementation | L | 088 | Predict funcional |
| 091 | Backend: YOLOTrainingEngine implementation | L | 088 | Training funcional |
| 092 | Backend: Crear schema ai + tablas + RLS | M | 020 | Schema completo |
| 093 | Backend: API models (CRUD, deploy, undeploy) | L | 092, 090 | Lifecycle completo |
| 094 | Backend: Inference queue (task queue) | L | 090 | Async processing |
| 095 | Frontend: AI Models page (list, upload, deploy) | L | 093 | Gestión completa |

### Sprint 2.2 - Datasets

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 096 | Backend: API datasets (CRUD, upload images) | L | 092 | Bulk upload funcional |
| 097 | Backend: Annotation storage and retrieval | M | 096 | CRUD annotations |
| 098 | Backend: Dataset split (train/val/test) | M | 096 | Splitting funcional |
| 099 | Backend: Dataset export (YOLO, COCO, VOC formats) | L | 096 | 3 formatos exportables |
| 100 | Frontend: Dataset page (create, manage, stats) | L | 096 | UI completa |
| 101 | Frontend: Image annotation tool (bounding boxes) | XL | 097 | Canvas interactive tool |
| 102 | Frontend: Dataset statistics dashboard | M | 096 | Distribución de clases |

### Sprint 2.3 - Training

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 103 | Backend: Training job API (create, monitor, cancel) | L | 091 | Lifecycle completo |
| 104 | Backend: Training progress via WebSocket/Realtime | M | 103 | Updates en vivo |
| 105 | Backend: Training results (metrics, confusion matrix) | M | 103 | Post-training eval |
| 106 | Backend: Model comparison endpoint | M | 093 | Side-by-side metrics |
| 107 | Frontend: Training config page (hyperparams) | M | 103 | Formulario con presets |
| 108 | Frontend: Training monitor (real-time charts) | L | 104 | Loss/mAP por epoch |
| 109 | Frontend: Model comparison view | M | 106 | Side-by-side |

### Sprint 2.4 - Inferencia

| # | Tarea | Esfuerzo | Dependencia | Criterio Done |
|---|-------|----------|-------------|---------------|
| 110 | Backend: Single image inference endpoint | M | 094 | Resultado inmediato |
| 111 | Backend: Batch inference (async) | L | 094 | Cola con progreso |
| 112 | Backend: Video inference (frame extraction + batch) | L | 111 | Configurable FPS |
| 113 | Backend: Inference → Inventory mapping service | L | 110, 063 | Detección → Stock |
| 114 | Frontend: Inference page (upload, results) | L | 110 | Resultados visuales |
| 115 | Frontend: Batch results gallery | M | 111 | Grid con filtros |
| 116 | Frontend: Video results player | L | 112 | Annotated video playback |

---

## 5. RESUMEN DE ESFUERZO POR FASE

| Fase | Tareas | Esfuerzo Estimado | Equipo Mínimo |
|------|--------|-------------------|---------------|
| Fase 0 | 40 tareas | ~8 semanas | 2 devs |
| Fase 1 | 47 tareas | ~16 semanas | 3 devs |
| Fase 2 | 29 tareas | ~14 semanas | 3 devs + 1 ML |
| **Total listado** | **116 tareas** | **~38 semanas** | - |

*Nota: Fases 3 y 4 se detallarán al completar Fase 2, con ajustes basados en aprendizajes.*

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
