# OLO_IA — BACKLOG DE EJECUCIÓN DE FASE 0

> **Autor:** Claude Code. **Fecha:** 2026-07-28
> **Versión 2.0** — actualizada tras la resolución de las 13 decisiones y la verificación empírica de `TECHNICAL_ASSUMPTION_VERIFICATION.md`.
> **Rol según DEC-08:** `TASKS.md` sigue siendo el **backlog maestro** del proyecto. Este documento es el **backlog operativo de Fase 0** y es el que se ejecuta. Ante discrepancia entre ambos para Fase 0, manda este; `TASKS.md` conserva la trazabilidad de Fases 1-4.
> **Prefijo `F0-`:** resuelve la colisión de IDs entre `TASKS.md` y `PHASE_0_PLAN.md` (CONF-40), donde la tarea 011 significaba dos cosas distintas.
> **Estado:** propuesta. **No ejecutar F0-1xx sin cerrar el Sprint 0.0.**

---

## 1. CONVENCIONES

**Estimación:** `XS` <2h · `S` 2-4h · `M` 4-8h (1 día) · `L` 2-3 días · `XL` 4-5 días

**Riesgo:** `bajo` (mecánico, reversible) · `medio` (requiere verificación) · `alto` (puede invalidar trabajo posterior)

**Agente sugerido:**

| Agente | Cuándo |
|---|---|
| **Humano** | Decisiones de negocio, credenciales, aprobaciones, arbitraje final |
| **ChatGPT** | Arbitraje arquitectónico, validación de diseño, revisión de trade-offs |
| **Claude** | Migraciones, SQL, RLS, pruebas, CLI, CI/CD, infraestructura de backend |
| **Kiro** | Sincronización de documentos, especificaciones, ADRs, scaffolding de frontend, design system |

**Regla de rollback:** toda tarea que toque la base de datos debe tener rollback verificado **antes** de aplicarse. Una migración sin rollback probado no se aplica.

---

## 2. SPRINT 0.0 — DESBLOQUEO

> **Estado: 9 de 13 tareas CERRADAS.** Las decisiones DEC-01 a DEC-13 quedaron resueltas y los cinco supuestos críticos verificados empíricamente. Lo que queda son cuatro condiciones que ya no son decisiones sino trabajo, más una decisión nueva que emergió de DEC-04.

### 2.0 Tareas cerradas

| Tarea original | Decisión | Cerrada por |
|---|---|---|
| F0-001 herramienta de migraciones | **DEC-01** Supabase CLI, fuente única | Aprobación |
| F0-002 propagación de claims | **DEC-02** dos canales + 4 GUCs propios | Aprobación + **verificado** (V4) |
| F0-003 imagen de Postgres | **DEC-03** Supabase CLI con Docker Desktop | Aprobación + **verificado** (V3) |
| F0-004 FK compuestas | **DEC-05** aprobadas | Aprobación + **verificado** (V5) |
| F0-005 PK de auditoría | **DEC-06** sin particionar, UUID simple | Aprobación + **verificado** (V1) |
| F0-006 ledger de stock | **DEC-07** ledger inmutable + proyección con optimistic locking | Aprobación |
| F0-007 decisiones menores | **DEC-04, 08, 10, 11, 12** | Aprobación |
| F0-008 discrepancia de evaluación | **DEC-13** tres niveles de readiness | Aprobación |
| — defecto de soft delete | Sin trigger; eliminación explícita o RPC auditada | Aprobación + **verificado** (V2) |

### 2.1 Tareas abiertas

**F0-010 · Instalar Docker Desktop** — `Humano` · `S` · riesgo **alto**
- **Objetivo:** habilitar `supabase start`, que DEC-03 fija como entorno oficial de integración.
- **Depende de:** —
- **Aceptación:** `docker --version` responde; `supabase start` levanta Postgres, GoTrue, PostgREST, Storage, Realtime y Studio.
- **Pruebas:** `SELECT to_regprocedure('auth.jwt()') IS NOT NULL` devuelve `true` contra la instancia local.
- **Rollback:** desinstalar Docker Desktop.
- **Nota:** **es hoy la condición nº1 y la única fuera de mi alcance.** Verificado que no hay Docker instalado: sin `docker` en PATH, sin `C:\Program Files\Docker`, sin servicio. Sin esto, DEC-03 no es ejecutable y toda migración queda bloqueada.
- **Mitigación si se retrasa:** las funciones de contexto verificadas en V4-4F son portables a PostgreSQL sin schema `auth`, así que la suite de aislamiento entre tenants puede correr sobre un Postgres ligero mientras se difiere solo lo que necesita GoTrue. No sustituye a Docker; evita detener Sprint 0.2.

**F0-011 · Diseñar el modelo de identidad con membresías múltiples** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** materializar DEC-04: `auth.users → core.users` global → `core.tenant_memberships` N:N.
- **Archivos:** `docs/DATABASE_RECONCILIATION_PLAN.md` §12 (ya redactado)
- **Depende de:** —
- **Aceptación:** validado por ChatGPT. Debe cubrir: traslado de la unicidad de email a global; nueva política RLS de `core.users` (que ya no tiene `tenant_id`); FK compuestas de autorización contra la membresía; ausencia de recursión entre la política de `users` y la de `memberships`.
- **Pruebas:** F0-211b.
- **Rollback:** n/a (diseño)
- **Nota:** aporta una garantía que el modelo anterior no tenía — con la FK compuesta contra la membresía, **es imposible asignar un rol o un almacén a quien no es miembro del tenant**.

**F0-012 · Decidir cómo se determina el tenant activo en el JWT (DEC-14)** — `Humano` + `ChatGPT` · `S` · riesgo **alto**
- **Objetivo:** cerrar la consecuencia de DEC-04 que ninguna decisión cubre.
- **Depende de:** F0-011
- **Aceptación:** decisión escrita. El problema: el JWT mínimo lleva **un** `tenant_id`, y con membresías múltiples el Hook tiene que elegir uno sin criterio definido. El canal A (PostgREST, Realtime, Storage) solo dispone del JWT: sin tenant en el token, RLS les deniega todo.
- **Opciones:** (a) `core.users.active_tenant_id` que el Hook lee, más endpoint de cambio que fuerza refresh; (b) tenant por cabecera validada contra la membresía, que rompe el canal A; (c) un token por tenant.
- **Pruebas:** F0-301.
- **Rollback:** n/a
- **Mi recomendación:** (a). Es la única que preserva el canal A sin ampliar el JWT.

**F0-013 · Clasificar los requisitos de auth no nativos de Supabase (DEC-09)** — `Humano` + `Claude` · `S` · riesgo bajo
- **Objetivo:** decidir, uno por uno, si entran en el MVP o se posponen a hardening.
- **Depende de:** —
- **Aceptación:** clasificación escrita para los cuatro:

| Requisito | Prioridad actual | Nativo en Supabase Auth | Recomendación |
|---|---|---|---|
| `RF-AUTH-007` bloqueo por intentos fallidos | **P1, Fase 0** | No | **Hardening.** Supabase Auth ya aplica rate limiting; el contador propio es evadible vía el endpoint público de GoTrue y permite bloquear la cuenta de un tercero |
| `RF-AUTH-012` política de contraseñas por tenant | P2, Fase 1 | No | **Hardening.** Fijar una política única de proyecto en Fase 0 |
| `RF-AUTH-013` timeout de sesión configurable | P1, Fase 0 | Parcialmente (TTL de token) | **MVP con el TTL del proyecto**; configurable por tenant a hardening |
| `RF-AUTH-014` ver y cerrar sesiones activas | P2, Fase 1 | No | **Hardening.** Requiere `core.sessions` y no es MVP |

- **Rollback:** n/a
- **Nota:** con esta clasificación, `core.sessions` sale de Fase 0 y la tarea de bloqueo de cuenta deja de ser P1 en la fase de fundación, que es donde estaba mal colocada.

**F0-014 · Aprobar los escenarios de escala recalculados (DEC-11)** — `Humano` · `XS` · riesgo bajo
- **Objetivo:** validar los tres escenarios con la separación catálogo/stock.
- **Archivos:** `docs/DATABASE_RECONCILIATION_PLAN.md` §11 y §11.3-bis
- **Depende de:** —
- **Aceptación:** aprobados, y corregidos en `REQUIREMENTS.md` los cuatro targets `RNF-SCAL` inconsistentes — en particular `RNF-SCAL-004`, que debe decir «por tenant» y no «por almacén».
- **Rollback:** n/a

**F0-015 · Reescribir `RLS_STRATEGY.md` a v3.0** — `Claude` (redacción) + `ChatGPT` (revisión) · `L` · riesgo **alto**
- **Objetivo:** incorporar DEC-02 (dos canales, GUCs `app.auth_user_id`/`app.tenant_id`/`app.request_id`/`app.correlation_id`), DEC-04 (membresías), CONF-06 (`current_user_id()` vía `auth_id`) y los resultados verificados.
- **Depende de:** F0-011, F0-012
- **Aceptación:** las funciones de contexto de §12.5 del plan de reconciliación; política de `core.users` sin `tenant_id`; `has_active_membership()` como puerta de fail-secure; precedencia JWT sobre GUC documentada.
- **Pruebas:** la suite F0-221 se escribe contra este documento.
- **Rollback:** conservar v2.0.
- **Nota:** **el documento es de mi autoría, así que no puedo revisarlo con independencia.** Debe pasar por ChatGPT antes de convertirse en la base de las migraciones. Es la limitación nº3 del gate.

**F0-009 · Sincronizar documentos originales** — `Kiro` · `L` · riesgo medio
- Sin cambios respecto a la v1.0, salvo que ahora depende de F0-011..F0-015 y no del arbitraje, que ya está hecho.
- **Aceptación añadida:** `TASKS.md` conserva su rol de backlog maestro (DEC-08) y recibe una nota que remite a este documento para Fase 0.

---

### 2.2 Sprint 0.0 (v1.0) — histórico

> Las nueve tareas de arbitraje originales (F0-001 a F0-009) se conservan abajo por trazabilidad. **F0-001 a F0-008 están cerradas** por las decisiones de §2.0.

**F0-001 · Arbitrar herramienta de migraciones (DEC-01)** — `Humano` + `ChatGPT` · `S` · riesgo **alto**
- **Objetivo:** decidir Alembic (DR-006) o Supabase CLI. Sin esto no existe la primera migración.
- **Archivos:** `docs/DECISION_REGISTER.md` (DR-006)
- **Depende de:** —
- **Aceptación:** DR-006 actualizada con la decisión, su justificación y las consecuencias sobre RLS, funciones, Storage y drift.
- **Pruebas:** n/a
- **Rollback:** revertir DR-006. Coste real: reescribir las migraciones ya hechas — de ahí que sea la primera tarea del proyecto.
- **Nota:** mi recomendación es Supabase CLI (`CLAUDE_TECHNICAL_AUDIT.md` CRIT-02).

**F0-002 · Arbitrar propagación de claims backend→RLS (DEC-02)** — `Humano` + `ChatGPT` · `S` · riesgo **alto**
- **Objetivo:** decidir entre emular PostgREST (`SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)`) o usar `olo_app` + GUC propio para todo tráfico de backend.
- **Archivos:** `docs/DECISION_REGISTER.md` (DR-002 §A), `docs/PHASE_0_PLAN.md:136`
- **Depende de:** —
- **Aceptación:** DR-002 §A documenta el mecanismo exacto por el que los claims llegan a la sesión de Postgres, no solo el rol.
- **Pruebas:** validado empíricamente en F0-206.
- **Rollback:** n/a (decisión documental)
- **Nota:** la tarea 043 de `PHASE_0_PLAN.md` es técnicamente incorrecta tal como está escrita (CRIT-03).

**F0-003 · Arbitrar imagen de Postgres en CI y stack local (DEC-03)** — `Humano` + `Claude` · `XS` · riesgo **alto**
- **Objetivo:** decidir `supabase start` / `supabase/postgres` frente a `postgres:15` con stub del schema `auth`.
- **Archivos:** `docs/DEPLOYMENT.md` §3.4, §4.1
- **Depende de:** F0-001
- **Aceptación:** decisión escrita. Si se elige stub, debe especificarse qué funciones de `auth` se emulan y quién las mantiene.
- **Pruebas:** verificado en F0-108 y F0-110.
- **Rollback:** n/a
- **Nota:** sin esto los tests de aislamiento multi-tenant no existen (CRIT-04).

**F0-004 · Arbitrar FK compuestas para la jerarquía (DEC-05)** — `ChatGPT` · `XS` · riesgo medio
- **Objetivo:** aprobar el mecanismo de integridad de la desnormalización de la decisión 4.1.
- **Archivos:** `docs/DATABASE_RECONCILIATION_PLAN.md` §7
- **Depende de:** —
- **Aceptación:** aprobado el patrón de UNIQUE redundante + FK compuesta, o alternativa razonada.
- **Pruebas:** F0-213.
- **Rollback:** n/a

**F0-005 · Arbitrar PK y particionamiento de `audit.events` (DEC-06)** — `ChatGPT` · `XS` · riesgo medio
- **Objetivo:** confirmar auditoría sin particionar en Fase 0, y decidir si su PK es `(event_id)` simple o `(event_id, occurred_at)` preventiva.
- **Archivos:** `docs/DATABASE_RECONCILIATION_PLAN.md` §8.1, §10.3
- **Depende de:** —
- **Aceptación:** decisión escrita con el umbral de activación del particionamiento.
- **Pruebas:** F0-209.
- **Rollback:** n/a
- **Nota:** la PK compuesta cuesta cero ahora y es una recreación de tabla después.

**F0-006 · Arbitrar ledger de movimientos de stock (DEC-07)** — `Humano` + `ChatGPT` · `S` · riesgo **alto**
- **Objetivo:** decidir si los ajustes son deltas sobre `stock_movements` o sobrescrituras absolutas.
- **Archivos:** `docs/DATABASE_RECONCILIATION_PLAN.md` §6.5, `docs/DOMAIN_MODEL.md` §5
- **Depende de:** —
- **Aceptación:** decisión escrita. Es Fase 1, pero condiciona el modelo de dominio completo de inventario.
- **Pruebas:** n/a en Fase 0
- **Rollback:** n/a
- **Nota:** sin ledger, la carrera conteo↔movimiento no tiene solución (CRIT-08).

**F0-007 · Decidir membresía multi-tenant, escenarios de escala, nomenclatura de correlación y vigencia de `TASKS.md`** — `Humano` · `S` · riesgo bajo
- **Objetivo:** cerrar DEC-04, DEC-08, DEC-10, DEC-11 y DEC-12 en un solo bloque (son independientes entre sí y de bajo impacto individual).
- **Archivos:** `docs/DECISION_REGISTER.md`, `docs/TERMINOLOGY.md`, `docs/REQUIREMENTS.md`
- **Depende de:** —
- **Aceptación:** cinco entradas nuevas en `DECISION_REGISTER.md`.
- **Pruebas:** n/a
- **Rollback:** n/a

**F0-008 · Arbitrar la discrepancia de evaluación de preparación (DEC-13)** — `ChatGPT` · `XS` · riesgo bajo
- **Objetivo:** conciliar `IMPLEMENTATION_READINESS.md` (2 críticos, 0 bloqueantes) con `CLAUDE_TECHNICAL_AUDIT.md` (12 críticos, 3 bloqueantes).
- **Archivos:** `docs/IMPLEMENTATION_READINESS.md`
- **Depende de:** F0-001..F0-007
- **Aceptación:** una sola evaluación vigente y un solo veredicto de gate.
- **Pruebas:** n/a
- **Rollback:** n/a

**F0-009 · Sincronizar documentos originales según la matriz** — `Kiro` · `L` · riesgo medio
- **Objetivo:** aplicar los 28 conflictos que ya tienen resolución aprobada, más los que cierren F0-001..F0-008.
- **Archivos:** los 12 del orden de `DOCUMENT_CONFLICT_MATRIX.md` §4
- **Depende de:** F0-001..F0-008 (**estricto**: sincronizar antes del arbitraje propaga el conflicto)
- **Aceptación:** los 45 conflictos de la matriz cerrados o explícitamente diferidos con fecha.
- **Pruebas:** relectura cruzada por Claude de `DATABASE_DESIGN.md` y `SECURITY.md`.
- **Rollback:** git revert del commit de sincronización.

---

## 3. SPRINT 0.1 — REPOSITORIO, TOOLING Y ENTORNO

**F0-101 · Inicializar repositorio git y remoto en GitHub** — `Claude` · `S` · riesgo bajo
- **Objetivo:** repo con `.gitignore` verificado, rama `main` protegida, primer commit sin secretos.
- **Archivos:** `.gitignore` (ya creado), `README.md`, `LICENSE`
- **Depende de:** autorización humana explícita para crear el remoto
- **Aceptación:** `git log` con un commit; `git check-ignore -v .env.local` confirma exclusión; `gh repo view` responde.
- **Pruebas:** `trufflehog filesystem .` sin hallazgos antes del primer push.
- **Rollback:** `gh repo delete` (destructivo — requiere confirmación humana).

**F0-102 · Estructura monorepo** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** `backend/`, `frontend/`, `supabase/`, `docker/`, `docs/`, `infra/`, `.github/`.
- **Archivos:** árbol de directorios, `README.md` por carpeta
- **Depende de:** F0-101
- **Aceptación:** coincide con `FOLDER_STRUCTURE.md` (**pendiente de auditar** — ver limitación de alcance).
- **Pruebas:** n/a
- **Rollback:** trivial.

**F0-103 · `backend/pyproject.toml`** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** Python 3.12, Ruff, mypy strict, pytest, pytest-asyncio, pytest-cov.
- **Depende de:** F0-102
- **Aceptación:** `ruff check .` y `mypy . --strict` en verde sobre un módulo vacío.
- **Pruebas:** el propio comando.
- **Rollback:** trivial.

**F0-104 · `frontend/package.json`** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** React 18, Vite, TS strict, ESLint, Prettier, Vitest.
- **Depende de:** F0-102
- **Aceptación:** `npm run lint && npx tsc --noEmit` en verde.
- **Rollback:** trivial.

**F0-105 · Instalar y fijar Supabase CLI en el proyecto** — `Claude` · `XS` · riesgo bajo
- **Objetivo:** CLI disponible (ya instalada en `C:\Users\arojast\AppData\Local\Programs\supabase\supabase.exe`, v2.110.0) y su versión fijada en el repo para reproducibilidad.
- **Archivos:** `supabase/.gitignore`, `Makefile`, nota de versión en `README.md`
- **Depende de:** F0-001 (si gana Alembic, esta tarea cambia de alcance)
- **Aceptación:** `supabase --version` = versión fijada; `supabase init` ha creado `supabase/config.toml`.
- **Pruebas:** `supabase --version` en CI coincide con la fijada.
- **Rollback:** eliminar `supabase/`.

**F0-106 · Crear proyecto Supabase (dev)** — `Humano` + `Claude` · `S` · riesgo medio
- **Objetivo:** proyecto cloud de desarrollo y `supabase link`.
- **Archivos:** `.env.local` (**no versionado**), `supabase/config.toml`
- **Depende de:** F0-105, credenciales en `.env.local`, **autorización humana explícita**
- **Aceptación:** `supabase projects list` muestra el proyecto; `supabase link --project-ref <ref>` correcto; `supabase db lint` responde.
- **Pruebas:** conexión verificada sin exponer credenciales en logs.
- **Rollback:** `supabase unlink`. **No borrar el proyecto sin autorización.**

**F0-107 · Configurar exposición de schemas a PostgREST** — `Claude` · `XS` · riesgo medio
- **Objetivo:** `config.toml` con los schemas expuestos; `internal` y `platform` **excluidos**.
- **Archivos:** `supabase/config.toml`
- **Depende de:** F0-105
- **Aceptación:** `public`, `core`, `audit` expuestos; `internal` y `platform` no. Verificado con petición a `/rest/v1/`.
- **Pruebas:** una petición a un recurso de `platform` devuelve 404.
- **Rollback:** revertir `config.toml`.
- **Nota:** cierra RLS-06. Sin esto el frontend recibe 404 en todo.

**F0-108 · Stack local completo con Supabase** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** `supabase start` levanta Postgres, GoTrue, PostgREST, Storage, Realtime y Studio. Sustituye al `postgres` suelto de `DEPLOYMENT.md:122`.
- **Archivos:** `docker/docker-compose.dev.yml`, `supabase/config.toml`, `Makefile`
- **Depende de:** F0-003, F0-105
- **Aceptación:** `make dev` deja disponible GoTrue y el schema `auth` existe. **`redis` y `ai-service` fuera del compose de Fase 0** (CONF-30, CONF-31).
- **Pruebas:** `SELECT to_regprocedure('auth.jwt()') IS NOT NULL;` devuelve `true`.
- **Rollback:** `supabase stop --no-backup`.
- **Nota:** cierra CRIT-05. Habilita el PoC del Hook.

**F0-109 · Backend: app factory FastAPI, health y logging estructurado** — `Kiro` · `M` · riesgo bajo
- **Objetivo:** `/health`, `/ready` sin auth; logs JSON con `request_id` en cada línea.
- **Depende de:** F0-103
- **Aceptación:** ambos endpoints 200; todo log lleva `request_id`.
- **Pruebas:** test de integración con httpx sobre ambos endpoints.
- **Rollback:** trivial.
- **Nota:** el nombre del campo lo fija DEC-10 (CONF-32).

**F0-110 · CI: lint, tipos, tests con Supabase, escaneo de secretos** — `Claude` · `L` · riesteo **alto**
- **Objetivo:** pipeline de GitHub Actions que ejecute los tests **contra un Postgres con schema `auth`**.
- **Archivos:** `.github/workflows/ci.yml`
- **Depende de:** F0-003, F0-103, F0-104, F0-108
- **Aceptación:** un PR de prueba pasa lint, tipos, tests y `trufflehog`. **El job de tests NO usa `postgres:15` plano.**
- **Pruebas:** PR de prueba con un test de RLS deliberadamente roto ⇒ CI **rojo**. Es la verificación que importa: un CI que no puede fallar no verifica nada.
- **Rollback:** deshabilitar el workflow.
- **Nota:** cierra CRIT-04.

**F0-111 · Pre-commit hooks** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** ruff, mypy, trufflehog, y bloqueo de archivos `.env*` distintos de `.env.example`.
- **Archivos:** `.pre-commit-config.yaml`
- **Depende de:** F0-103
- **Aceptación:** un commit que incluya un secreto o un `.env.local` es rechazado.
- **Pruebas:** intento de commit con un token falso ⇒ rechazado.
- **Rollback:** `pre-commit uninstall`.

**F0-112 · `Makefile`** — `Claude` · `S` · riesgo bajo
- **Objetivo:** `setup`, `dev`, `test`, `lint`, `migrate`, `seed`, `check-rls`, `db-lint`, `db-diff`.
- **Depende de:** F0-105, F0-108
- **Aceptación:** `make setup && make dev` productivo en <30 min en una máquina limpia.
- **Pruebas:** cronometrado por una persona ajena al proyecto.
- **Rollback:** trivial.

**F0-113 · ADRs iniciales** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** ADR-001 monolito, 002 Supabase, 003 RLS v2.0, 004 JWT mínimo, 005 modelo de roles, **006 herramienta de migraciones**, **007 propagación de claims**.
- **Depende de:** F0-001, F0-002
- **Aceptación:** 7 ADRs en `docs/adr/`.
- **Rollback:** trivial.

**F0-114 · Interfaz `JobDispatcher`** — `Kiro` · `S` · riesgo bajo
- **Objetivo:** protocolo abstracto con implementación `BackgroundTasks` y una `noop` para tests. Sin Redis (DR-009).
- **Depende de:** F0-109
- **Aceptación:** protocolo definido; un caso de uso trivial lo consume sin conocer la implementación.
- **Pruebas:** test unitario con la implementación noop.
- **Rollback:** trivial.
- **Nota:** el primer caso real que exige cola persistente es **F1: sync de conector WMS** (reintentos con backoff, `RF-INT-007`). Antes de eso, `BackgroundTasks` es suficiente. No instalar Redis hasta esa tarea.

---

## 4. SPRINT 0.2 — BASE DE DATOS, RLS Y AUDITORÍA

> El sprint de mayor riesgo del proyecto. Ninguna tarea aquí arranca sin F0-001, F0-003, F0-004, F0-005 y F0-009 cerradas.

**F0-201 · Migración 0001: schemas y extensiones** — `Claude` · `S` · riesgo bajo
- **Objetivo:** `public`, `core`, `audit`, `platform`, `internal`. **No** crear `inventory`, `ai`, `devices`, `integrations`, `spatial` todavía (OVER-01).
- **Archivos:** `supabase/migrations/0001_schemas.sql`
- **Depende de:** F0-107, F0-108
- **Aceptación:** los 5 schemas existen; `internal` y `platform` con `REVOKE ALL` para `anon`/`authenticated`.
- **Pruebas:** consulta a `pg_namespace`; verificación de privilegios en `information_schema.usage_privileges`.
- **Rollback:** `DROP SCHEMA ... CASCADE` (seguro: schemas vacíos).

**F0-202 · Migración 0002: rol `olo_app`** — `Claude` · `S` · riesgo medio
- **Objetivo:** `CREATE ROLE olo_app LOGIN NOBYPASSRLS NOINHERIT` con GRANTs por schema y `ALTER DEFAULT PRIVILEGES`.
- **Depende de:** F0-002, F0-201
- **Aceptación:** el rol existe; `SELECT rolbypassrls FROM pg_roles WHERE rolname='olo_app'` = `false`; **no es propietario de ninguna tabla**.
- **Pruebas:** test que verifica `rolbypassrls = false` y que el rol no aparece en `pg_class.relowner`. Este test corre en CI para siempre: si alguien concede BYPASSRLS a `olo_app`, todo el aislamiento desaparece en silencio.
- **Rollback:** `REASSIGN OWNED`/`DROP OWNED` + `DROP ROLE olo_app`.
- **Nota:** el alcance exacto depende de DEC-02. Si gana emular PostgREST, `olo_app` queda solo para workers.

**F0-203 · Migración 0003: catálogos globales** — `Claude` · `M` · riesgo bajo
- **Objetivo:** `public.currencies` (ISO 4217) y `public.countries` (ISO 3166) con RLS de solo lectura y `REVOKE` de escritura. Seed de ~180 monedas y ~250 países.
- **Depende de:** F0-201, F0-009 (CONF-09)
- **Aceptación:** ambas con `ENABLE ROW LEVEL SECURITY` y política `FOR SELECT USING (true) TO authenticated, olo_app`. `INSERT` desde `authenticated` denegado.
- **Pruebas:** test de lectura permitida y escritura denegada. `supabase db lint` sin `rls_disabled_in_public`.
- **Rollback:** `DROP TABLE public.countries, public.currencies;`
- **Nota:** cierra RLS-05. Zonas horarias **sin tabla**: `pg_timezone_names` ya existe.

**F0-204 · Migración 0004: funciones de contexto** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** `core.current_tenant_id()`, `core.current_auth_id()`, `core.current_user_id()`, `core.has_tenant_wide_access()` según `RLS_STRATEGY.md` §2.2 y el mecanismo que fije DEC-02.
- **Depende de:** F0-002, F0-201, F0-108 (necesita el schema `auth`)
- **Aceptación:** las cuatro son `LANGUAGE sql STABLE SET search_path = ''` y **ninguna es `SECURITY DEFINER`**. Sin contexto devuelven NULL/`false`.
- **Pruebas:** tabla de verdad completa — con JWT, con GUC, con ambos (gana JWT), con ninguno (NULL). El caso «con ninguno» es el que importa: debe fallar cerrado.
- **Rollback:** `DROP FUNCTION`.
- **Nota:** `core.current_user_id()` devuelve `core.users.id`, **no** `auth.uid()`. Confundirlos hace que toda política de propiedad falle en silencio.

**F0-205 · Migración 0005: triggers comunes** — `Claude` · `S` · riesgo medio
- **Objetivo:** `core.set_updated_at()` y `core.prevent_tenant_change()` con `IS DISTINCT FROM` y `SET search_path = ''`. **`core.soft_delete()` NO se crea** (CRIT-06).
- **Depende de:** F0-201
- **Aceptación:** ambas con `search_path` fijado; `prevent_tenant_change` lanza excepción también cuando uno de los lados es NULL.
- **Pruebas:** test que intenta cambiar `tenant_id` y otro que lo cambia a NULL. Con `!=` el segundo pasaría sin error — es exactamente el bug que se está corrigiendo.
- **Rollback:** `DROP FUNCTION`.
- **Nota:** `set_updated_at` **no** incrementa `version` (§9.3 del plan de reconciliación).

**F0-206 · PoC: propagación de contexto desde el backend** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** demostrar empíricamente que el mecanismo elegido en DEC-02 funciona, antes de construir 20 tablas encima.
- **Archivos:** `backend/tests/integration/test_rls_context.py`
- **Depende de:** F0-002, F0-204
- **Aceptación:** una tabla desechable con RLS devuelve filas por el camino elegido y **cero** filas sin contexto.
- **Pruebas:** el propio PoC. Debe cubrir los dos caminos: usuario con JWT y worker con GUC.
- **Rollback:** eliminar la tabla desechable.
- **Nota:** **esta es la tarea que evita CRIT-03.** Si falla, se detiene el sprint y se vuelve a DEC-02. Ponerla antes de las tablas es deliberado: descubrir aquí que el modelo no funciona cuesta un día; descubrirlo en F0-215 cuesta el sprint.

**F0-207 · Migración 0006: `core.tenants`** — `Claude` · `S` · riesgo bajo
- **Objetivo:** tabla + RLS Plantilla A + `FORCE RLS` + triggers.
- **Depende de:** F0-204, F0-205, F0-206
- **Aceptación:** `relrowsecurity` y `relforcerowsecurity` ambos `true`; política `tenant_isolation` `AS RESTRICTIVE`.
- **Pruebas:** aislamiento entre dos tenants; acceso legítimo positivo.
- **Rollback:** `DROP TABLE`.

**F0-208 · Migración 0007: `core.tenant_countries` y `core.companies`** — `Claude` · `M` · riesgo medio
- **Objetivo:** modelo híbrido de países (decisión 4.7) y companies colgando de `tenant_countries` con FK compuesta.
- **Depende de:** F0-004, F0-203, F0-207
- **Aceptación:** `UNIQUE (tenant_id, id)` en ambas; FK compuesta `companies (tenant_id, tenant_country_id) → tenant_countries (tenant_id, id)`.
- **Pruebas:** intentar crear una company apuntando al `tenant_country` de otro tenant ⇒ **violación de FK**, no filtrado por RLS. La diferencia importa: la FK lo hace imposible, RLS solo lo oculta.
- **Rollback:** `DROP TABLE` en orden inverso.
- **Nota:** cierra CRIT-07, CONF-09.

**F0-209 · Migración 0008: `audit.events`** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** modelo alineado con la decisión 4.9. **Sin particionar** (DEC-06). Append-only.
- **Depende de:** F0-005, F0-207
- **Aceptación:** columnas exactas de la decisión 4.9 incluidas `request_id`, `source`, `old_values`, `new_values`, `occurred_at`, más `previous_hash`/`event_hash` nulas. Sin políticas de UPDATE/DELETE. `REVOKE UPDATE, DELETE`.
- **Pruebas:** INSERT permitido; UPDATE y DELETE denegados desde `authenticated` y `olo_app`; aislamiento entre tenants.
- **Rollback:** `DROP TABLE audit.events;`
- **Nota:** cierra CRIT-01 y ALTO-03. **El DDL actual de `DATABASE_DESIGN.md:757` no ejecuta** — verificar que la migración sí lo hace antes de continuar.

**F0-210 · Migración 0009: `platform.privileged_operation_log`** — `Claude` · `S` · riesgo bajo
- **Objetivo:** log de toda invocación de `service_role`, requerido por la decisión 4.9 y DR-002 §C.
- **Depende de:** F0-201
- **Aceptación:** tabla en `platform` (no expuesto a PostgREST); `justification NOT NULL`.
- **Pruebas:** verificar que `authenticated` no puede leerla ni por REST ni por SQL.
- **Rollback:** `DROP TABLE`.
- **Nota:** cierra ALTO-02. Es la única compensación real frente a `BYPASSRLS`.

**F0-211 · Migración 0010: `core.users` GLOBAL** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** identidad global de plataforma **sin `tenant_id`** (DEC-04).
- **Depende de:** F0-011, F0-207
- **Aceptación:** `UNIQUE (email) WHERE deleted_at IS NULL` **global**, no por tenant; `auth_id UUID NOT NULL UNIQUE`; índice por `auth_id` (lo consumen el Hook y `current_user_id()`). **No lleva `tenant_id`.**
- **Pruebas:** dos personas no pueden compartir email; la misma persona con dos membresías es **una sola fila**.
- **Rollback:** `DROP TABLE`.
- **Nota:** cambio de clase — `core.users` pasa de tenant-scoped a plataforma global, así que **no le aplica la Plantilla A**. Su política se define en F0-211c.

**F0-211b · Migración 0011: `core.tenant_memberships`** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** eslabón N:N entre identidad y tenant (DEC-04).
- **Depende de:** F0-211
- **Aceptación:** `UNIQUE (tenant_id, user_id)` **total, no parcial** — PostgreSQL no admite índices parciales como destino de FK y esta tabla lo es. `UNIQUE (tenant_id, id)` como segundo destino. `revoked_at` para baja; único parcial de `is_default` por usuario. RLS Plantilla A.
- **Pruebas:** revocar y reincorporar reutiliza la misma fila; dos membresías por defecto para el mismo usuario ⇒ violación; una persona en tres tenants ⇒ tres filas, un solo `core.users`.
- **Rollback:** `DROP TABLE`.

**F0-211c · Política RLS de `core.users`** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** definir el acceso a una tabla que ya no tiene `tenant_id`.
- **Depende de:** F0-211b, F0-015
- **Aceptación:** veo mi propia fila y las de quienes comparten membresía activa conmigo en el tenant actual. `has_active_membership()` como puerta de fail-secure.
- **Pruebas:** un usuario del tenant A **no** ve a los usuarios exclusivos del tenant B; **sí** ve a quien comparte ambos tenants; sin membresía activa no ve a nadie salvo a sí mismo. **Test anti-recursión:** la política de `users` consulta `memberships` y la de `memberships` no debe volver a `users`.
- **Rollback:** `DROP POLICY`.
- **Nota:** es la política más delicada del schema `core`, porque es la única que no puede apoyarse en `tenant_id` de la propia fila.

**F0-212 · Migración 0011: `core.permissions`, `core.roles`, `core.user_role_assignments`** — `Claude` · `L` · riesgo medio
- **Objetivo:** catálogo de permisos (nuevo, OVER-02), roles con `deleted_at` y prevención de ciclos, asignaciones con CHECK de coherencia de scope.
- **Depende de:** F0-211
- **Aceptación:** `core.prevent_role_cycle()` activo; `chk_ura_scope_coherent` presente; `roles` con `deleted_at`; RLS especial de roles de sistema (`tenant_id IS NULL` visible para todos).
- **Pruebas:** crear un ciclo A→B→A ⇒ excepción. Insertar `scope_type='global'` con `scope_warehouse_id` relleno ⇒ violación de CHECK. Un tenant ve los roles de sistema y no los roles custom de otro tenant.
- **Rollback:** `DROP TABLE` en orden inverso.
- **Nota:** cierra ALTO-13, ALTO-14, INT-09.

**F0-213 · Migración 0012: `core.warehouses`, `core.areas`, `core.locations`** — `Claude` · `L` · riesgo **alto**
- **Objetivo:** jerarquía completa con RLS Plantilla B y **la cadena de FK compuestas** de la decisión 4.1.
- **Depende de:** F0-004, F0-208, F0-215 (`can_access_warehouse` debe existir antes de la política)
- **Aceptación:** las 3 FK compuestas de `DATABASE_RECONCILIATION_PLAN.md` §7.3 activas; `UNIQUE (tenant_id, warehouse_id, id)` en `areas`.
- **Pruebas:** los tres invariantes de la decisión 4.1, cada uno como test que **espera una violación de FK**: (a) location con `area_id` de otro almacén; (b) area con `warehouse_id` de otro tenant; (c) `tenant_id` incoherente con la jerarquía.
- **Rollback:** `DROP TABLE` en orden inverso.
- **Nota:** cierra CRIT-10. Es la tarea que convierte la desnormalización en algo seguro y no en un riesgo.

**F0-214 · Migración 0013: `core.user_warehouse_access`** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** read model con las **9 columnas** de la decisión 4.2, incluidas `revoked_at` y `source_role_assignment_id`.
- **Depende de:** F0-212, F0-213
- **Aceptación:** las 9 columnas; único parcial `(tenant_id, user_id, warehouse_id) WHERE revoked_at IS NULL`; índice `(tenant_id, user_id) WHERE revoked_at IS NULL`; **RLS Plantilla A y nada más** — su política **no** debe invocar `can_access_warehouse()`.
- **Pruebas:** revocar y volver a otorgar el mismo acceso ⇒ permitido (el único total lo impediría). **Test anti-recursión:** una consulta a esta tabla no debe entrar en bucle.
- **Rollback:** `DROP TABLE`.
- **Nota:** cierra ALTO-04 y CONF-17. `accessible_warehouse_ids()` no compila sin `revoked_at`.

**F0-215 · Migración 0014: funciones de scope de almacén** — `Claude` · `M` · riesgo **alto**
- **Objetivo:** `core.accessible_warehouse_ids()` (`SECURITY DEFINER`, `search_path=''`, `COALESCE` a array vacío) y `core.can_access_warehouse()`.
- **Depende de:** F0-214
- **Aceptación:** `accessible_warehouse_ids()` **nunca devuelve NULL**; `can_access_warehouse()` es `false` sin contexto.
- **Pruebas:** usuario **sin ningún almacén asignado** ⇒ acceso a **cero** almacenes. Este test es el que detecta la escalada de privilegios del centinela de array vacío de la v1.0: si algún día vuelve, este test lo caza.
- **Rollback:** `DROP FUNCTION`.

**F0-216 · Servicio de autorización: proyección de `user_warehouse_access`** — `Claude` · `L` · riesgo medio
- **Objetivo:** servicio transaccional que deriva `user_warehouse_access` desde `user_role_assignments`, según la decisión 4.2 («no ocultes toda la lógica en triggers complejos»).
- **Archivos:** `backend/src/application/authorization/`
- **Depende de:** F0-212, F0-214
- **Aceptación:** otorgar o revocar un rol con scope de almacén actualiza la proyección **en la misma transacción**. Trigger solo como red de integridad secundaria.
- **Pruebas:** asignar rol con scope warehouse ⇒ aparece la fila; revocar ⇒ `revoked_at` relleno, fila conservada; reconstrucción completa desde cero coincide con el estado incremental (test de convergencia).
- **Rollback:** revertir el servicio; la proyección se puede reconstruir.

**F0-217 · `make check-rls`: verificación automática** — `Claude` · `M` · riesgo bajo
- **Objetivo:** las 4 consultas de `RLS_STRATEGY.md` §11 sobre los **10 schemas**, no 5 (CONF-38).
- **Archivos:** `scripts/check_rls.sql`, integración en CI
- **Depende de:** F0-110, F0-201
- **Aceptación:** cualquier fila devuelta rompe el build. Cubre: sin RLS, sin FORCE, sin política RESTRICTIVE, `tenant_id` sin índice como primera columna.
- **Pruebas:** crear una tabla sin RLS ⇒ el script **falla**. Un verificador que no puede fallar no verifica nada.
- **Rollback:** deshabilitar el paso.

**F0-218 · `supabase db lint` en CI** — `Claude` · `S` · riesgo bajo
- **Objetivo:** detectar `function_search_path_mutable`, `rls_disabled_in_public`, `security_definer_view`.
- **Depende de:** F0-105, F0-110
- **Aceptación:** salida limpia. Cualquier hallazgo rompe el build.
- **Pruebas:** crear una función sin `search_path` ⇒ el lint la marca.
- **Rollback:** deshabilitar el paso.

**F0-219 · Migración 0015: `core.idempotency_keys`** — `Claude` · `S` · riesgo bajo
- **Objetivo:** soporte de idempotencia (CRIT-12), necesario antes de cualquier endpoint que mute estado.
- **Depende de:** F0-207
- **Aceptación:** único `(tenant_id, idempotency_key)`; `request_hash` para detectar misma clave con cuerpo distinto.
- **Pruebas:** misma clave + mismo cuerpo ⇒ respuesta cacheada; misma clave + cuerpo distinto ⇒ 409.
- **Rollback:** `DROP TABLE`.

**F0-220 · Seed mínimo** — `Claude` · `M` · riesgo bajo
- **Objetivo:** 2 tenants (**dos**, no uno: con uno solo los tests de aislamiento no prueban nada), 1 país operativo cada uno, 1 company, 2 almacenes, 3 áreas, 20 locations, 2 usuarios, 4 roles predefinidos.
- **Archivos:** `supabase/seed.sql`
- **Depende de:** F0-213, F0-214
- **Aceptación:** `make seed` idempotente (re-ejecutable sin error).
- **Pruebas:** ejecutar dos veces seguidas sin fallo.
- **Rollback:** `supabase db reset`.

**F0-221 · Suite de tests de aislamiento** — `Claude` · `XL` · riesgo **alto**
- **Objetivo:** la suite completa de `RLS_STRATEGY.md` §10, **ejecutada como `olo_app`**, más los tres tests que faltan en los planes actuales.
- **Archivos:** `backend/tests/rls/`
- **Depende de:** F0-206, F0-215, F0-220
- **Aceptación:** cubre — aislamiento cross-tenant (SELECT/INSERT/UPDATE/DELETE); sin contexto = 0 filas; scope de almacén restrictivo real; **cero asignaciones ⇒ cero acceso**; `tenant_wide_access` ve todo; auditoría append-only; `prevent_tenant_change`; **fuga horizontal a través del pooler** (CONC-07); **anti-recursión de RLS** (RLS-04). Cada test de denegación con su gemelo de acceso legítimo.
- **Pruebas:** ella misma. Verificación de la verificación: introducir una política permisiva de más ⇒ algún test **debe** ponerse rojo.
- **Rollback:** n/a
- **Nota:** el test del pooler no está en ningún plan actual y su modo de fallo es el peor posible: fuga silenciosa de contexto entre tenants a través de conexiones reutilizadas.

**F0-222 · Benchmark de RLS** — `Claude` · `M` · riesgo medio
- **Objetivo:** medir el sobrecoste real de RLS y verificar uso de índices.
- **Depende de:** F0-221
- **Aceptación:** `EXPLAIN ANALYZE` de las 10 consultas más frecuentes muestra `Index Scan`. Sobrecoste documentado con número, no asumido.
- **Pruebas:** dataset de **al menos 100.000 filas** por tabla. Con 20 filas de seed el planner elige `Seq Scan` legítimamente y el criterio de `PHASE_0_PLAN.md:117` falla por razones equivocadas (TASK-03).
- **Rollback:** n/a
- **Nota:** medir en particular `accessible_warehouse_ids()`, que al ser `SECURITY DEFINER` no se puede inlinear (RLS-03).

---

## 5. SPRINT 0.3 — AUTENTICACIÓN, HOOK Y RBAC

**F0-301 · PoC del Custom Access Token Hook** — `Claude` · `L` · riesgo **alto**
- **Objetivo:** función PL/pgSQL registrada en Supabase Auth que publique `tenant_id` y `tenant_wide_access`.
- **Depende de:** F0-108 (**necesita GoTrue local**), F0-212
- **Aceptación:** un login real produce un JWT con ambos claims. **Con la inicialización defensiva de `app_metadata`** (CRIT-11): si la clave no existe, `jsonb_set` devuelve el objeto sin cambios y **todos los logins quedarían sin `tenant_id`**.
- **Pruebas:** decodificar el JWT emitido y verificar los claims. Caso negativo: usuario `status != 'active'` ⇒ JWT **sin** claims custom ⇒ RLS deniega todo (fail-secure).
- **Rollback:** desregistrar el hook en la configuración de Auth + `DROP FUNCTION`.
- **Nota:** es el riesgo nº1 declarado del proyecto. Va en el día 1 del sprint.

**F0-302 · Permisos y rendimiento del Hook** — `Claude` · `M` · riesgo medio
- **Objetivo:** `GRANT EXECUTE` solo a `supabase_auth_admin`; `REVOKE` de `public`, `anon`, `authenticated`; índice que soporte su consulta.
- **Depende de:** F0-301
- **Aceptación:** `authenticated` no puede ejecutar el hook. Índice `user_role_assignments (user_id, scope_type)` presente — los índices actuales empiezan por `tenant_id`, que el hook **no conoce aún** (ALTO-21).
- **Pruebas:** intento de ejecución desde `authenticated` ⇒ denegado. Latencia medida < 50ms con 2.000 usuarios sembrados.
- **Rollback:** revertir grants.

**F0-303 · Middleware de autenticación y contexto** — `Claude` · `L` · riesgo **alto**
- **Objetivo:** validar JWT contra JWKS de Supabase y establecer el contexto de sesión según DEC-02.
- **Depende de:** F0-002, F0-206, F0-301
- **Aceptación:** 401 sin token o con firma inválida. **Contexto establecido dentro de una transacción explícita, con `set_config` parametrizado** — nunca con interpolación de cadenas (`MULTITENANT.md:212` es el antipatrón exacto a no repetir).
- **Pruebas:** token expirado ⇒ 401; firma alterada ⇒ 401; token válido ⇒ RLS filtra correctamente; dos requests de tenants distintos sobre la misma conexión del pool ⇒ aislados.
- **Rollback:** revertir el middleware.

**F0-304 · Endpoints de autenticación** — `Kiro` · `L` · riesgo medio
- **Objetivo:** login, refresh, logout, me, forgot-password, reset-password.
- **Depende de:** F0-303
- **Aceptación:** flujo completo funcional; `GET /v1/auth/me` devuelve perfil desde `core.users`.
- **Pruebas:** E2E login → request protegido → logout.
- **Rollback:** revertir el router.

**F0-305 · Diseñar el bloqueo de cuenta** — `Humano` + `Claude` · `M` · riesgo medio
- **Objetivo:** especificar cómo se implementa `RF-AUTH-007` (P1, Fase 0) dado que Supabase Auth no lo soporta.
- **Depende de:** F0-007 (DEC-09), F0-304
- **Aceptación:** diseño escrito que resuelva dos problemas: (a) el endpoint público de Supabase Auth **evade** el contador del backend; (b) contar por email permite bloquear la cuenta de un tercero a voluntad.
- **Pruebas:** 5 intentos fallidos ⇒ bloqueo; intento de bloquear la cuenta de otro ⇒ mitigado.
- **Rollback:** desactivar el bloqueo (feature flag).
- **Nota:** cierra CONF-27, CONF-28, API-09. **Puede acabar en «bajar de alcance»**, y eso es una respuesta legítima.

**F0-306 · RBAC: evaluación de permisos** — `Claude` · `L` · riesgo medio
- **Objetivo:** middleware que verifique permiso + scope **consultando la BD, no el JWT** (DR-003, `RF-RBAC-007`).
- **Depende de:** F0-212, F0-303
- **Aceptación:** 403 sin permiso. **Revocar un permiso surte efecto en el request siguiente, sin re-login.**
- **Pruebas:** revocar rol y verificar denegación inmediata. Es la prueba que valida haber sacado los permisos del JWT.
- **Rollback:** revertir el middleware.

**F0-307 · Auditoría de eventos de autenticación** — `Claude` · `M` · riesgo bajo
- **Objetivo:** emitir eventos a `audit.events` desde la capa de aplicación (no triggers) para login, logout, fallo, cambio de contraseña, cambio de permisos.
- **Depende de:** F0-209, F0-304
- **Aceptación:** eventos con `request_id`, `correlation_id`, `ip_address`, `user_agent`, `source`.
- **Pruebas:** cada operación de auth genera exactamente un evento con los campos completos.
- **Rollback:** revertir el emisor.

**F0-308 · Rate limiting, cabeceras de seguridad y CORS** — `Kiro` · `M` · riesgo medio
- **Objetivo:** límites por IP y por usuario; HSTS, X-Frame-Options, CSP; CORS restrictivo por entorno.
- **Depende de:** F0-303
- **Aceptación:** 429 al exceder; cabeceras presentes.
- **Pruebas:** test automatizado de 429 y verificación de cabeceras.
- **Rollback:** revertir el middleware.
- **Nota:** **un limitador en memoria no funciona con más de una réplica** y `DEPLOYMENT.md:292` planifica 2-10 (API-07). En Fase 0 con una réplica es aceptable; documentarlo como deuda explícita con fecha, no dejarlo implícito.

**F0-309 · Migración 0016: `core.invitations`** — `Claude` · `M` · riesgo bajo
- **Objetivo:** tabla de invitaciones con expiración a 72h (`MODULES.md:133`).
- **Depende de:** F0-211
- **Aceptación:** token de un solo uso, hash almacenado (no el token en claro), expiración, RLS Plantilla A.
- **Pruebas:** invitación expirada ⇒ rechazada; reutilización ⇒ rechazada.
- **Rollback:** `DROP TABLE`.
- **Nota:** cierra ALTO-18.

**F0-310 · Tests E2E de aislamiento a nivel de API** — `Claude` · `L` · riesgo medio
- **Objetivo:** verificar que el aislamiento se sostiene a través de HTTP, no solo en SQL.
- **Depende de:** F0-304, F0-306
- **Aceptación:** un usuario del tenant A que pide por ID un recurso del tenant B recibe **404, no 403**. Un 403 confirmaría la existencia del recurso (fuga por canal lateral).
- **Pruebas:** matriz de acceso cruzado sobre todos los endpoints de recurso.
- **Rollback:** n/a

---

## 6. SPRINT 0.4 — FRONTEND FOUNDATION

> `PHASE_0_PLAN.md` §6 (tareas 062-082) cubre este sprint **correctamente** y no tiene riesgo de base de datos ni de RLS. Lo adopto tal cual, renumerado a `F0-401`..`F0-421`, con tres observaciones:

**F0-401..F0-421** — `Kiro` · total ≈ `XL`×2 · riesgo bajo
- Adoptar `PHASE_0_PLAN.md` tareas 062-082 sin cambios de contenido.
- **Observación 1:** la tarea 066 («Modal, Drawer, Dropdown, Toast, Command Palette» en una tarea) es `XXL` por la propia escala de `TASKS.md:13` y debe dividirse en cinco.
- **Observación 2:** usar primitivas de Radix UI, como ya prevé `PHASE_0_PLAN.md:226`. Un design system propio desde cero es la vía más rápida a desviar el sprint.
- **Observación 3:** el selector de almacén (tarea 074) debe invalidar las queries de React Query con `warehouse` en la `queryKey` (DR-017, hoy «Pendiente»). Sin esto se muestran datos del almacén anterior tras cambiar de contexto, que es un bug de aspecto idéntico a una fuga de datos y cuesta un día diagnosticar.

---

## 7. RESUMEN Y SECUENCIA

| Sprint | Tareas | Estimación | Agente principal |
|---|---|---|---|
| **0.0** Desbloqueo | 6 abiertas (9 cerradas) | 1-2 días + instalar Docker | Humano + Claude |
| **0.1** Repositorio y entorno | 14 | 2 semanas | Claude + Kiro |
| **0.2** Base de datos, RLS, auditoría | **25** (+3 de identidad) | **4 semanas** | Claude |
| **0.3** Autenticación, hook, RBAC | **9** (−1: `core.sessions` sale por DEC-09) | 2-3 semanas | Claude + Kiro |
| **0.4** Frontend foundation | 21 | 2-3 semanas | Kiro |
| **Total** | **75** | **11-13 semanas** | |

La estimación total no cambia respecto a la v1.0. El Sprint 0.0 se acorta mucho (las decisiones están tomadas y la verificación hecha), pero el 0.2 crece lo mismo por el modelo de membresías, y el 0.3 se alivia porque DEC-09 saca de Fase 0 lo que no era nativo de Supabase Auth. Sigue siendo el alcance ya aprobado, contado.

`PHASE_0_PLAN.md` estima 8 semanas con 2 devs para 82 tareas. Mi estimación es **11-13 semanas** con el mismo equipo. La diferencia son el Sprint 0.0, los tres tests que faltan (pooler, anti-recursión, máquinas de estado), las tablas nuevas obligatorias por decisiones aprobadas (`platform.privileged_operation_log`, `core.idempotency_keys`, `core.invitations`, los catálogos) y el sprint 0.2 dimensionado a su riesgo real. No es alcance nuevo: es el alcance ya aprobado, contado.

### Camino crítico

```
F0-001 (herramienta) ──┐
F0-002 (claims)      ──┼──► F0-003 (imagen PG) ──► F0-108 (stack local)
F0-004 (FK)          ──┤                                    │
F0-005 (audit PK)    ──┘                                    ▼
                                                     F0-110 (CI con auth)
                                                            │
                                                            ▼
                              F0-204 (funciones) ──► F0-206 (PoC contexto)  ← PUNTO DE NO RETORNO
                                                            │
                                                            ▼
                                        F0-213 (jerarquía + FK compuestas)
                                                            │
                                                            ▼
                                        F0-215 (scope) ──► F0-221 (tests RLS)
                                                            │
                                                            ▼
                                                     F0-301 (PoC Hook)
```

**F0-206 es el punto de no retorno.** Antes de esa tarea, un error en DEC-02 cuesta un día. Después de F0-213, cuesta el sprint entero. Por eso el PoC de contexto va antes de crear una sola tabla de negocio.

### Las 10 primeras tareas, en orden (v2.0)

1. **F0-010** — Instalar Docker Desktop *(condición nº1; única fuera de mi alcance)*
2. **F0-011** — Diseñar el modelo de identidad con membresías (DEC-04)
3. **F0-012** — Decidir el tenant activo en el JWT (**DEC-14**, nueva)
4. **F0-013** — Clasificar los requisitos de auth no nativos (DEC-09)
5. **F0-014** — Aprobar los escenarios de escala recalculados (DEC-11)
6. **F0-015** — Reescribir `RLS_STRATEGY.md` a v3.0 *(revisión de ChatGPT obligatoria)*
7. **F0-009** — Sincronizar documentos originales *(solo después de 2-6)*
8. **F0-101** — Inicializar repositorio y remoto
9. **F0-105** — Fijar Supabase CLI en el proyecto e `init`
10. **F0-108** — Stack local completo con `supabase start` *(requiere F0-010)*

Las tareas 8 y 9 no dependen de Docker y pueden solaparse con 1-7. Todo lo demás espera a F0-010.

**F0-206 sigue siendo el punto de no retorno**, con un matiz: el PoC de contexto ya está verificado contra PostgreSQL 15.8 vanilla (pruebas 4A-4H), así que lo que queda es confirmarlo con `auth.jwt()` real sobre Supabase local. El riesgo de esa tarea ha bajado de alto a medio.

---

*Backlog de ejecución. Propuesta, no ejecutada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
