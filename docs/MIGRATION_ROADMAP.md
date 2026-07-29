# OLO_IA — ROADMAP DE MIGRACIONES

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato. Vinculante.
> **Herramienta:** Supabase CLI, fuente única (DEC-01). Archivos en `supabase/migrations/`.
> **Ninguna migración creada todavía.** Este documento es el orden definitivo, no los archivos.

---

## 1. REGLAS VINCULANTES

| # | Regla |
|---|---|
| R1 | **Una migración = una unidad reversible.** Si el rollback no es limpio, se divide |
| R2 | **Nombre:** `NNNN_verbo_objeto.sql`, numeración secuencial de cuatro dígitos, sin huecos |
| R3 | **Todo archivo empieza con un comentario de cabecera**: qué crea, por qué, dependencias, rollback, riesgo |
| R4 | **Rollback documentado en el propio archivo**, como comentario SQL ejecutable. Supabase CLI no genera `down` automático |
| R5 | **Ninguna migración aplicada sin que su rollback se haya probado** en un entorno desechable |
| R6 | **Idempotencia donde sea posible:** `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE` |
| R7 | **Backwards-compatible** (patrón expand/contract): primero se añade, después se migra el dato, después se retira lo viejo. Nunca en una sola migración |
| R8 | **Ninguna migración crea datos de negocio.** Los catálogos ISO son la excepción (son hechos del mundo). El resto va en `seed.sql` |
| R9 | Tras cada migración, `make check-rls` y `supabase db lint` deben salir limpios |
| R10 | **Nunca editar una migración ya aplicada** en un entorno compartido. Se corrige con una nueva |

### 1.1 Cabecera obligatoria

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- Migración : 0012_create_hierarchy.sql
-- Crea      : core.warehouses, core.areas, core.locations + RLS T3 + FK compuestas
-- Por qué   : jerarquía operativa; frontera de autorización de segundo nivel
-- Depende de: 0004 (funciones de contexto), 0007 (companies), 0011 (scope de almacén)
-- Rollback  : DROP TABLE core.locations, core.areas, core.warehouses CASCADE;
-- Riesgo    : ALTO — las FK compuestas son el mecanismo de aislamiento jerárquico
-- Verificado: FK compuestas probadas contra PostgreSQL 15.8 (V5)
-- ═══════════════════════════════════════════════════════════════════════
```

---

## 2. FASE 0 — MIGRACIONES 0001 A 0021

### 0001 — Schemas y extensiones ✅ APLICADA

> **Corrección aprobada (2026-07-28).** La versión original de esta entrada revocaba privilegios a `olo_app`, rol que se crea en 0002. Verificado contra el proyecto real: `REVOKE ALL ON SCHEMA public FROM olo_app` produce `ERROR: role "olo_app" does not exist`, así que **la migración habría abortado**. No se resolvía intercambiando 0001 y 0002, porque 0002 concede `USAGE` sobre schemas que crea 0001: era una circularidad. Se redistribuye como sigue.

- **Crea:** schemas `core`, `audit`, `platform`, `internal` (`public` ya existe), con `COMMENT` en los cuatro.
- **Extensiones:** ninguna. Se verificó que `gen_random_uuid()` está disponible de serie y `pgcrypto` ya estaba instalado en `extensions`. En su lugar, la migración incluye una guarda `DO` que falla si la función no existe.
- **Privilegios:** `REVOKE ALL` sobre `platform` e `internal` para **`PUBLIC`, `anon` y `authenticated` únicamente**. **No referencia `olo_app`.**
- **Por qué:** contenedor de todo lo demás. Cinco schemas en Fase 0; los de Fase 1-3 se crean con su primera tabla.
- **Depende de:** nada.
- **Rollback:** `supabase/rollbacks/0001_create_schemas.down.sql`. `DROP SCHEMA IF EXISTS` en orden inverso, con **RESTRICT** (no `CASCADE`): falla a propósito si el schema contiene objetos de migraciones posteriores.
- **Riesgo:** bajo.
- **Resultado:** aplicada, revertida y reaplicada con verificación completa. Ver `docs/migrations/Migration_0001.md`.

### 0002 — Rol de aplicación `olo_app` y sus privilegios

> **Absorbe de 0001** toda la gestión de privilegios de `olo_app`, incluida la revocación sobre `platform` e `internal`. El privilegio de un rol se gestiona donde se crea el rol.

- **Crea:** `CREATE ROLE olo_app LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE`.
- **Privilegios:** `GRANT USAGE` sobre los schemas permitidos, `ALTER DEFAULT PRIVILEGES`, y `REVOKE ALL ON SCHEMA platform, internal FROM olo_app`.
- **Por qué:** el backend no puede usar `service_role` — tiene `BYPASSRLS` y anularía todo el aislamiento.
- **Depende de:** 0001.
- **Rollback:** `REASSIGN OWNED BY olo_app TO postgres; DROP OWNED BY olo_app; DROP ROLE IF EXISTS olo_app;`
- **Riesgo:** **medio.** La contraseña se inyecta desde el gestor de secretos, nunca literal en el archivo.
- **Verificación permanente en CI:** `SELECT rolbypassrls FROM pg_roles WHERE rolname='olo_app'` debe ser `false`. Si alguien se lo concede, todo el aislamiento desaparece en silencio.
- **Pendiente de decisión antes de escribirla:** `authenticated` no tiene `USAGE` sobre `core` ni `audit`, y `service_role` no lo tiene sobre `platform`. Ninguna migración del roadmap lo concede. Ver riesgos 1 y 2 de `Migration_0001.md`.

### 0003 — Catálogos globales

- **Crea:** `public.currencies` (~180 filas ISO 4217), `public.countries` (~250 filas ISO 3166) con RLS T1 y `REVOKE` de escritura.
- **Por qué:** `tenant_countries` depende de ambos. Son hechos del mundo, así que su semilla va en la migración (R8).
- **Depende de:** 0001.
- **Rollback:** `DROP TABLE public.countries, public.currencies;`
- **Riesgo:** bajo.

### 0004 — Funciones de contexto (parte 1 de 2)

- **Crea:** `core.current_auth_id()`, `core.current_tenant_id()`, `core.has_tenant_wide_access()`. Las tres `LANGUAGE sql STABLE SET search_path=''`, **sin** `SECURITY DEFINER`.
- **Por qué:** toda política RLS las necesita. Van antes que cualquier tabla con RLS.
- **Depende de:** 0001.
- **Rollback:** `DROP FUNCTION` de las tres.
- **Riesgo:** **alto.** Un error aquí afecta a las 19 tablas.
- **Nota:** `current_tenant_id()` lee `request.jwt.claims` **directamente**, no vía `auth.jwt()`. Así la función es portable a PostgreSQL sin schema `auth` (verificado), lo que permite ejecutar la suite de aislamiento sin el stack completo de Supabase.
- **No incluye** `current_user_id()`, `has_active_membership()` ni `accessible_warehouse_ids()`: dependen de tablas que aún no existen. Van en 0013.

### 0005 — Triggers comunes

- **Crea:** `core.set_updated_at()` y `core.prevent_tenant_change()`. Ambas con `SET search_path=''`.
- **Por qué:** los usan todas las tablas mutables.
- **Depende de:** 0001.
- **Rollback:** `DROP FUNCTION` de ambas.
- **Riesgo:** medio.
- **Contrato verificado:** `prevent_tenant_change` usa **`IS DISTINCT FROM`**, no `!=`. Con `!=`, poner `tenant_id` a NULL atraviesa el trigger sin excepción — medido. Y `set_updated_at` **no toca `version`**: si lo hiciera, cualquier escritura de sistema produciría 409 espurios.
- **`core.soft_delete()` NO se crea.** Verificado que como `BEFORE UPDATE` borra lógicamente toda fila editada, y como `BEFORE DELETE` no hace nada mientras el borrado físico se ejecuta en silencio.

### 0006 — PoC de contexto (desechable)

- **Crea:** una tabla temporal con RLS para validar el mecanismo de propagación **antes** de construir 19 tablas encima.
- **Por qué:** descubrir aquí que el contexto no llega cuesta un día; descubrirlo en 0012 cuesta el sprint.
- **Depende de:** 0004.
- **Rollback:** `DROP TABLE` — la migración termina eliminando su propia tabla.
- **Riesgo:** **alto por lo que verifica, nulo por lo que deja.**
- **Estado:** el mecanismo ya está verificado contra PostgreSQL 15.8 vanilla (8 sub-pruebas). Aquí se confirma con `auth.jwt()` real sobre Supabase local.

### 0007 — `core.tenants`

- **Crea:** la tabla, RLS T2 sobre `id`, `UNIQUE (id)` como destino de FK, triggers.
- **Por qué:** raíz de todo el modelo.
- **Depende de:** 0004, 0005.
- **Rollback:** `DROP TABLE core.tenants CASCADE;`
- **Riesgo:** medio.
- **Sin política de INSERT:** los tenants los crea la RPC de plataforma, no `olo_app`.

### 0008 — `core.tenant_countries`

- **Crea:** la tabla, RLS T2, `UNIQUE (tenant_id, id)`, único parcial `(tenant_id, country_id) WHERE deleted_at IS NULL`.
- **Por qué:** separa el hecho global (ISO) del dato del tenant (configuración regional). Cierra el defecto de `core.countries` con `tenant_id`, que duplicaría 250 países por cada tenant.
- **Depende de:** 0003, 0007.
- **Rollback:** `DROP TABLE core.tenant_countries CASCADE;`
- **Riesgo:** bajo.

### 0009 — `core.companies`

- **Crea:** la tabla, RLS T2, `UNIQUE (tenant_id, id)`, **FK compuesta** `(tenant_id, tenant_country_id) → tenant_countries (tenant_id, id)`.
- **Por qué:** entidad legal; padre de los almacenes.
- **Depende de:** 0008.
- **Rollback:** `DROP TABLE core.companies CASCADE;`
- **Riesgo:** medio.

### 0010 — `core.users` (global)

- **Crea:** la tabla **sin `tenant_id`**, `UNIQUE (auth_id)`, `UNIQUE (email) WHERE deleted_at IS NULL` **global**, índice `idx_users_auth_id`.
- **Por qué:** identidad global de plataforma (DEC-04). El email ya es global de hecho, porque Supabase Auth lo impone sobre `auth.users`.
- **Depende de:** 0005.
- **Rollback:** `DROP TABLE core.users CASCADE;`
- **Riesgo:** **alto.** Cambio de modelo respecto a `DATABASE_DESIGN.md`.
- **Sin política RLS todavía:** la política T4 necesita `tenant_memberships`. Va en 0014.
- **No incluye** `failed_login_attempts` ni `locked_until`: Supabase Auth es dueño de la autenticación y un segundo estado de bloqueo crea dos fuentes de verdad (DEC-09 → hardening).

### 0011 — `core.tenant_memberships`

- **Crea:** la tabla, `UNIQUE (tenant_id, user_id)` **total**, `UNIQUE (tenant_id, id)`, `uq_membership_one_active_per_user`, índice `(user_id) WHERE revoked_at IS NULL`.
- **Por qué:** eslabón que ancla toda la autorización. Y `uq_membership_one_active_per_user` es lo que **disuelve DEC-14**: con una sola membresía activa, «cuál es el tenant activo» no tiene ambigüedad posible.
- **Depende de:** 0007, 0010.
- **Rollback:** `DROP TABLE core.tenant_memberships CASCADE;`
- **Riesgo:** **alto.**
- **Nota de diseño:** el `UNIQUE (tenant_id, user_id)` es **total, no parcial**, porque PostgreSQL no admite índices parciales como destino de FK y esta tabla lo es. Consecuencia: una fila por par, y reincorporar a alguien pone `revoked_at` a NULL en la misma fila.

### 0012 — Jerarquía: `warehouses`, `areas`, `locations`

- **Crea:** las tres tablas, RLS T3, los `UNIQUE` de destino, y **la cadena de FK compuestas**: `areas (tenant_id, warehouse_id) → warehouses`, `locations (tenant_id, warehouse_id, area_id) → areas`.
- **Por qué:** jerarquía operativa y frontera de autorización de segundo nivel.
- **Depende de:** 0009, 0013 (las políticas T3 necesitan `can_access_warehouse()`).
- **Rollback:** `DROP TABLE core.locations, core.areas, core.warehouses CASCADE;`
- **Riesgo:** **alto.** Es el mecanismo que hace imposible la jerarquía cruzada.
- **Verificado (V5):** las tres FK rechazan los tres invariantes de la decisión 4.1 — área de otro almacén, almacén de otro tenant, y `tenant_id` incoherente.
- **Orden real de aplicación:** 0013 antes de las políticas de 0012. Se resuelve creando las tablas en 0012 y sus políticas al final de 0013, o dividiendo. **Decisión: 0012 crea tablas sin políticas; 0013 crea funciones y luego las políticas T3.** Es la única dependencia circular del roadmap y se rompe así.

### 0013 — Funciones de contexto (parte 2) y políticas T3

- **Crea:** `core.current_user_id()`, `core.has_active_membership()`, `core.accessible_warehouse_ids()` (las tres `SECURITY DEFINER`), `core.can_access_warehouse()`. Después, las políticas T3 de `warehouses`, `areas`, `locations`.
- **Por qué:** cierra la dependencia circular de 0012.
- **Depende de:** 0011, 0012, 0016 (`accessible_warehouse_ids` lee `user_warehouse_access`).
- **Rollback:** `DROP POLICY` de las tres tablas y `DROP FUNCTION` de las cuatro.
- **Riesgo:** **alto.**
- **Nota:** `accessible_warehouse_ids()` devuelve `COALESCE(..., ARRAY[]::uuid[])` — **nunca NULL**. Con NULL, `x = ANY(NULL)` es NULL y la política queda indefinida.
- **Reordenación necesaria:** como depende de 0016, el orden correcto es 0012 (tablas) → 0014, 0015, 0016 → 0013 (funciones + políticas T3). **Se renumera: esta migración pasa a ser 0017.** Ver §2.1.

### 0014 — Política T4 de `core.users`

- **Crea:** las políticas de `core.users`, que no puede usar T2 porque no tiene `tenant_id`.
- **Por qué:** «veo mi propia fila y las de quienes comparten membresía activa conmigo».
- **Depende de:** 0011, y de `current_user_id()`.
- **Rollback:** `DROP POLICY`.
- **Riesgo:** **alto.** Es la política más delicada del schema.
- **Riesgo de recursión:** el `EXISTS` sobre `tenant_memberships` obliga a que la política T6 de esa tabla **no consulte `core.users`**. Test obligatorio.

### 0015 — Permisos y roles

- **Crea:** `core.permissions` (catálogo, con semilla), `core.roles` con `deleted_at`, `core.role_permissions`, trigger `core.prevent_role_cycle()`.
- **Por qué:** base del RBAC. `permissions` como catálogo da FK contra lo que hoy es texto libre en JSONB.
- **Depende de:** 0007.
- **Rollback:** `DROP TABLE` en orden inverso, `DROP FUNCTION prevent_role_cycle`.
- **Riesgo:** medio.
- **Verificado (V6-6G):** `prevent_role_cycle` detecta ciclo indirecto y auto-referencia, con profundidad máxima 16.

### 0016 — `core.role_assignments` y `core.user_warehouse_access`

- **Crea:** ambas tablas, RLS T6, **FK compuestas a la membresía**, único parcial de `uwa` con `WHERE revoked_at IS NULL`, e `idx_uwa_lookup`.
- **Por qué:** la FK compuesta `(tenant_id, user_id) → tenant_memberships` hace **imposible asignar un rol o un almacén a quien no es miembro del tenant**.
- **Depende de:** 0011, 0012, 0015.
- **Rollback:** `DROP TABLE core.user_warehouse_access, core.role_assignments;`
- **Riesgo:** **alto.**
- **Contrato:** la política de `user_warehouse_access` **no invoca `can_access_warehouse()`** — sería recursión infinita.

### 0017 — Funciones de scope y políticas T3

*(Era 0013. Renumerada por dependencia, ver §2.1.)*

### 0018 — `core.invitations`

- **Crea:** la tabla con `token_hash` (nunca el token), expiración, RLS T2.
- **Por qué:** el flujo de invitación de `MODULES.md:133` no tiene dónde persistir.
- **Depende de:** 0015.
- **Rollback:** `DROP TABLE core.invitations;`
- **Riesgo:** bajo.

### 0019 — `core.idempotency_keys`

- **Crea:** la tabla, `UNIQUE (tenant_id, idempotency_key)`, RLS T2.
- **Por qué:** sin ella, un reintento de red duplica el efecto de todo POST que mute estado. Se crea en Fase 0 aunque su primer uso sea Fase 1: la infraestructura de API la necesita disponible.
- **Depende de:** 0007.
- **Rollback:** `DROP TABLE core.idempotency_keys;`
- **Riesgo:** bajo.

### 0020 — `audit.events`

- **Crea:** la tabla **sin particionar**, con el modelo de la decisión 4.9 (`event_id`, `request_id`, `source`, `old_values`/`new_values`, `occurred_at`), `previous_hash`/`event_hash` nulas, RLS T5, `REVOKE UPDATE, DELETE`, índice BRIN.
- **Por qué:** auditoría append-only, obligatoria en Fase 0.
- **Depende de:** 0007.
- **Rollback:** `DROP TABLE audit.events;`
- **Riesgo:** **alto.** Cambiar el esquema de auditoría con millones de filas es una de las migraciones más caras que existen: hay que acertar antes de la primera fila.
- **Verificado (V1):** la forma particionada con `id UUID PRIMARY KEY` **no se puede crear** — `ERROR: unique constraint on partitioned table must include all partitioning columns`. Y el fallo alcanza a cualquier constraint única, no solo a la primaria.
- **`previous_hash`/`event_hash` se crean nulas** aunque la cadena criptográfica se posponga: añadirlas después a 40 M de filas es carísimo; crearlas vacías cuesta cero.

### 0021 — `platform.privileged_operation_log`

- **Crea:** la tabla en `platform` (T0, sin RLS porque el schema no está expuesto), con `justification NOT NULL`.
- **Por qué:** es la **única compensación real frente a `BYPASSRLS`**. Requerido por la decisión 4.9 y DR-002 §C.
- **Depende de:** 0001.
- **Rollback:** `DROP TABLE platform.privileged_operation_log;`
- **Riesgo:** bajo.

### 2.1 Orden final de Fase 0, resuelto

La dependencia circular entre la jerarquía y las funciones de scope se rompe separando tablas de políticas:

| # | Migración | Riesgo |
|---|---|---|
| 0001 | Schemas y extensiones | bajo |
| 0002 | Rol `olo_app` | medio |
| 0003 | Catálogos globales ISO | bajo |
| 0004 | Funciones de contexto (parte 1) | **alto** |
| 0005 | Triggers comunes | medio |
| 0006 | PoC de contexto (desechable) | alto/nulo |
| 0007 | `core.tenants` | medio |
| 0008 | `core.tenant_countries` | bajo |
| 0009 | `core.companies` | medio |
| 0010 | `core.users` (global, sin política) | **alto** |
| 0011 | `core.tenant_memberships` | **alto** |
| 0012 | Jerarquía: tablas **sin políticas** | **alto** |
| 0013 | `core.permissions`, `roles`, `role_permissions` | medio |
| 0014 | `role_assignments`, `user_warehouse_access` | **alto** |
| 0015 | Funciones de scope + **políticas T3** de la jerarquía | **alto** |
| 0016 | Política **T4** de `core.users` | **alto** |
| 0017 | `core.invitations` | bajo |
| 0018 | `core.idempotency_keys` | bajo |
| 0019 | `audit.events` | **alto** |
| 0020 | `platform.privileged_operation_log` | bajo |
| 0021 | Custom Access Token Hook | **alto** |

### 0021 — Custom Access Token Hook

- **Crea:** `auth.custom_access_token_hook(event jsonb)`, `REVOKE` de `public`/`anon`/`authenticated`, `GRANT` a `supabase_auth_admin`, e `idx_ra_user_scope (user_id, scope_type)`.
- **Por qué:** publica `tenant_id` y `tenant_wide_access` en el JWT. Sin él, el canal A no tiene contexto.
- **Depende de:** 0011, 0014.
- **Rollback:** desregistrar el hook en la configuración de Auth y `DROP FUNCTION`.
- **Riesgo:** **alto.** Es el riesgo nº1 declarado del proyecto.
- **Contrato crítico:** **inicialización defensiva de `app_metadata`**. `jsonb_set` exige que existan todos los niveles intermedios de la ruta; si `app_metadata` no está, devuelve el objeto **sin cambios y sin error**, y el resultado sería un JWT válido sin `tenant_id` con RLS denegando todo en el 100 % de los logins.
- **Índice necesario:** la consulta filtra por `user_id` **sin `tenant_id`** —aún no lo conoce— así que los índices que empiezan por `tenant_id` no le sirven.

---

## 3. FASE 1 — MIGRACIONES 0022 A 0038

| # | Crea | Depende | Riesgo | Nota |
|---|---|---|---|---|
| 0022 | Schema `inventory` | 0001 | bajo | |
| 0023 | `core.files` | 0007 | medio | `CHECK` de prefijo de ruta **verificado**: bloquea ruta de otro tenant y escape de directorio |
| 0024 | `platform.jobs` | 0007 | bajo | Recurso de trabajo asíncrono visible en API, desacoplado de la cola |
| 0025 | `inventory.products` | 0022 | medio | GIN **sin** `'spanish'` fijo: la plataforma es multi-idioma |
| 0026 | `inventory.product_warehouse_settings` | 0025 | bajo | Umbrales por almacén, `NUMERIC` no `INT` |
| 0027 | `inventory.adjustment_reasons` (catálogo) | 0022 | bajo | Catálogo por atributos y configurable por tenant |
| 0028 | **`inventory.balances`** | 0025 | **alto** | Clave lógica con `COALESCE` **verificada**; `CHECK` de serial |
| 0029 | **`inventory.ledger_entries`** | 0028 | **alto** | PK `(id, occurred_at)` desde el inicio; sin FK entrante |
| 0030 | `inventory.counts`, `count_items`, `count_assignees` | 0028 | medio | `UNIQUE` de línea de conteo |
| 0031 | `inventory.count_observations` | 0030 | medio | Append-only, `sequence_number` |
| 0032 | `inventory.adjustments`, `adjustment_items` | 0027, 0028 | **alto** | Items como **deltas**, no valores absolutos |
| 0033 | `inventory.incidents` | 0028 | bajo | |
| 0034 | Vista `internal.balance_summary` + vista de acceso | 0028 | medio | RLS no aplica a matviews: patrón de schema privado |
| 0035 | Vistas `*_active` de soft delete | 0025, 0028 | bajo | `security_invoker = true` |
| 0036 | Schema `integrations` + `connector_types` | 0001 | bajo | |
| 0037 | `integrations.connectors`, `sync_jobs` | 0036, 0012 | medio | Único parcial de sync concurrente |
| 0038 | `integrations.sync_job_logs` | 0037 | bajo | Candidata a particionar por C5 |
| 0039 | `core.notifications` | 0010 | bajo | |

---

## 4. FASE 2 — MIGRACIONES 0040 A 0048

| # | Crea | Riesgo |
|---|---|---|
| 0040 | Schema `ai` + `ai.engines` (catálogo) | bajo |
| 0041 | `ai.models` con `UNIQUE (tenant_id, engine_code) WHERE status='deployed'` | medio |
| 0042 | `ai.datasets` | bajo |
| 0043 | `ai.dataset_images` | bajo |
| 0044 | `ai.annotations` | medio |
| 0045 | `ai.training_jobs` con único parcial de concurrencia | medio |
| 0046 | `ai.inference_jobs` | medio |
| 0047 | `ai.detections` | **alto** — extrae lo que sería `results JSONB` |
| 0048 | Índices de `detections` para `RF-IA-013` | medio |

---

## 5. FASE 3 — MIGRACIONES 0049 A 0056

| # | Crea | Riesgo |
|---|---|---|
| 0049 | Schema `devices` + `devices.devices` | bajo |
| 0050 | `devices.drone_missions` (**sin** `telemetry JSONB`) | medio |
| 0051 | `devices.telemetry_points` con `BIGSERIAL` y PK `(id, recorded_at)` | **alto** |
| 0052 | `devices.mission_captures` | bajo |
| 0053 | Schema `spatial` + `spatial.floor_plans` | bajo |
| 0054 | `spatial.plan_location_mappings` | medio |
| 0055 | **Particionamiento de `audit.events`** (expand/contract) | **muy alto** |
| 0056 | **Particionamiento de `ledger_entries`** | **muy alto** |

### 5.1 Sobre 0055 y 0056

Son las migraciones más peligrosas del roadmap. Contrato:

1. Se disparan por criterio objetivo, no por calendario: umbral **C1** (>50 M filas) o **C5** (existe retención con borrado masivo). C5 llega antes para auditoría.
2. Patrón expand/contract en **cuatro** migraciones, no una: crear la tabla particionada nueva → copiar por lotes con doble escritura → conmutar lectura → retirar la vieja.
3. `audit.events` requiere además cambiar la PK a `(event_id, occurred_at)`, lo que **obliga a recrear la tabla**. Es la razón por la que `ledger_entries` y `telemetry_points` llevan PK compuesta desde el primer día: para no repetir este coste.
4. Ninguna se aplica sin ensayo previo sobre una copia con volumen de producción.

---

## 6. MATRIZ DE RIESGO

| Riesgo | Migraciones | Qué exigen |
|---|---|---|
| **Muy alto** | 0055, 0056 | Ensayo con volumen real; ventana de mantenimiento; plan de reversión escrito |
| **Alto** | 0004, 0010, 0011, 0012, 0014, 0015, 0016, 0019, 0021, 0028, 0029, 0032, 0047, 0051 | Rollback probado en desechable; tests de aislamiento verdes antes de continuar |
| **Medio** | 0002, 0005, 0007, 0009, 0013, 0023, 0025, 0030, 0031, 0034, 0037, 0041, 0044, 0045, 0046, 0050, 0054 | Rollback documentado; `check-rls` limpio |
| **Bajo** | el resto | Rollback documentado |

---

## 7. VERIFICACIÓN TRAS CADA MIGRACIÓN

Obligatorio, en este orden:

1. `supabase db lint` — limpio de `function_search_path_mutable`, `rls_disabled_in_public`, `security_definer_view`.
2. `make check-rls` — las cuatro consultas de `RLS_IMPLEMENTATION_GUIDE.md` §7.5 sin filas.
3. Tests de aislamiento de las tablas afectadas, **como `olo_app`**.
4. `EXPLAIN ANALYZE` de las consultas nuevas con ≥ 100.000 filas: `Index Scan`, no `Seq Scan`.
5. Rollback ejecutado en desechable y vuelto a aplicar.

**El punto 5 no es opcional para las migraciones de riesgo alto.** Un rollback sin probar es un rollback que no existe.

---

## 8. LO QUE NO ENTRA EN NINGUNA MIGRACIÓN

| Elemento | Dónde va |
|---|---|
| Datos de negocio (tenants, usuarios, productos) | `supabase/seed.sql` |
| Roles de sistema con sus permisos | `seed.sql` |
| Configuración de Supabase Auth (TTL, proveedores) | `supabase/config.toml` |
| Registro del Custom Hook en Auth | `config.toml` |
| Exposición de schemas a PostgREST | `config.toml` |
| Buckets y políticas de Storage | Migración aparte, tras 0023 |
| Contraseña de `olo_app` | Gestor de secretos del proveedor |

---

*Roadmap de migraciones. Ningún archivo de migración creado. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
