# OLO_IA — MODELO DE DATOS DEFINITIVO

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato. Vinculante para todas las migraciones.
> **Motor:** PostgreSQL 15+ vía Supabase. **Herramienta:** Supabase CLI (DEC-01).

---

## 1. CONVENCIONES VINCULANTES

| Regla | Valor |
|---|---|
| Nombres | `snake_case`, tablas en plural |
| PK | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — excepto series temporales, que usan `BIGSERIAL` |
| Timestamps | `TIMESTAMPTZ` **siempre**. Nunca `TIMESTAMP` ni `DATE` para instantes |
| Soft delete | `deleted_at TIMESTAMPTZ NULL`. **Sin trigger** (verificado: el trigger convierte todo UPDATE en borrado) |
| Claves comerciales | Índice único **parcial** `WHERE deleted_at IS NULL`, con `COALESCE` en columnas nulables |
| Optimistic locking | `version INT NOT NULL DEFAULT 1`. Lo incrementa la sentencia de la aplicación, **nunca el trigger de `updated_at`** |
| Tenant | `tenant_id UUID NOT NULL` en toda tabla de negocio |
| Jerarquía | FK **compuestas** (verificado). Requiere `UNIQUE (tenant_id, id)` en la tabla padre |
| Enum | `CHECK` para invariantes estructurales; tabla catálogo solo si el valor tiene atributos o varía por tenant (§7) |
| RLS | `ENABLE` + `FORCE ROW LEVEL SECURITY` en toda tabla de negocio |
| Índices | `tenant_id` como primera columna en todo índice de tabla tenant-scoped |
| Nombres de constraint | `pk_`, `fk_`, `uq_`, `chk_`, `idx_` + tabla + columnas |

### 1.1 Columnas estándar

```sql
-- Bloque de auditoría técnica: en toda tabla mutable
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
created_by UUID REFERENCES core.users(id),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_by UUID REFERENCES core.users(id),
version    INT NOT NULL DEFAULT 1,
deleted_at TIMESTAMPTZ            -- solo si la entidad admite soft delete
```

Las tablas **append-only** (`audit.events`, `inventory.ledger_entries`, `devices.telemetry_points`, `inventory.count_observations`, `platform.privileged_operation_log`) llevan solo `created_at` y, cuando aplica, `created_by`. **No llevan `updated_at`, `version` ni `deleted_at`**: un error se corrige con una entrada compensatoria, no editando la historia.

---

## 2. SCHEMAS

| Schema | Contenido | Fase | PostgREST |
|---|---|---|---|
| `public` | Catálogos globales ISO | 0 | Sí, solo lectura |
| `core` | Tenancy, jerarquía, identidad, autorización | 0 | Sí |
| `audit` | Eventos append-only | 0 | Sí, solo SELECT |
| `platform` | Operaciones cross-tenant, jobs, log de privilegios | 0 | **No** |
| `internal` | Vistas materializadas | 0 | **No** |
| `inventory` | Catálogo, ledger, balances, conteos, ajustes | 1 | Sí |
| `integrations` | Conectores, sync | 1 | Sí |
| `ai` | Motores, modelos, datasets, inferencia | 2 | Sí |
| `devices` | Dispositivos, misiones, telemetría | 3 | Sí |
| `spatial` | Planos, mapeo | 3 | Sí |

Cada schema se crea con su primera tabla. Fase 0 crea cinco.

---

## 3. PLANTILLAS RLS

Referenciadas por cada entidad. Definición completa en `RLS_IMPLEMENTATION_GUIDE.md`.

| ID | Plantilla | Aplica a |
|---|---|---|
| **T0** | Sin RLS, schema no expuesto | `platform.*`, `internal.*` |
| **T1** | Catálogo global de solo lectura | `public.*` |
| **T2** | Tenant-scoped | Mayoría de tablas de negocio |
| **T3** | Warehouse-scoped | Tablas con `warehouse_id` |
| **T4** | Identidad global | `core.users` — única a medida |
| **T5** | Append-only auditado | `audit.events` |
| **T6** | Read-model de autorización | `core.tenant_memberships`, `core.user_warehouse_access` — **no invocan `can_access_warehouse()`** (recursión) |

---

## 4. CATÁLOGO DE ENTIDADES

Formato: **Responsabilidad · Owner · Aggregate · Lifecycle · Soft delete · Optimistic locking · Auditoría · RLS · Relaciones · Índices**

---

### 4.1 `public.currencies` — Fase 0

- **Responsabilidad:** catálogo ISO 4217. Fija código, símbolo y decimales para formateo monetario.
- **Owner:** Plataforma. **Aggregate:** ninguno (catálogo). **Lifecycle:** inmutable en la práctica.
- **Soft delete:** no. **Optimistic locking:** no. **Auditoría:** no. **RLS:** T1.
- **Columnas:** `code CHAR(3) PK`, `name`, `symbol`, `decimal_places SMALLINT NOT NULL DEFAULT 2`.
- **Relaciones:** referenciada por `tenant_countries`, `warehouses`.
- **Índices:** PK.

### 4.2 `public.countries` — Fase 0

- **Responsabilidad:** catálogo ISO 3166-1. Un país es un hecho del mundo, no un dato del tenant.
- **Owner:** Plataforma. **Aggregate:** ninguno. **Lifecycle:** inmutable.
- **Soft delete:** no. **Locking:** no. **Auditoría:** no. **RLS:** T1.
- **Columnas:** `id UUID PK`, `iso_code CHAR(2) UNIQUE`, `iso_code_3 CHAR(3) UNIQUE`, `numeric_code CHAR(3)`, `name_en`, `name_es`, `phone_code`, `default_currency_code → currencies`.
- **Índices:** PK, `uq_countries_iso`, `uq_countries_iso3`.
- **Seed:** ~250 filas.

### 4.3 Platform — **no es una tabla**

`Platform` es el nivel conceptual que hospeda todos los tenants. No se materializa: no tiene estado propio que persistir. Su comportamiento se reparte en:

| Necesidad de plataforma | Dónde vive |
|---|---|
| Operaciones cross-tenant | RPC de `platform` (§3.7 de `IDENTITY_AND_AUTH_FLOW.md`) |
| Auditoría de privilegios | `platform.privileged_operation_log` |
| Métricas agregadas | Matview en `internal` |
| Configuración | Variables de entorno del proveedor de despliegue |
| Administradores | Claim `is_platform_admin` en el JWT, sin tabla |

**Decisión de simplificación:** se descarta `public.system_config`. Una tabla de una fila con RLS para lo que ya resuelven variables de entorno es complejidad sin beneficio.

### 4.4 `core.tenants` — Fase 0

- **Responsabilidad:** organización cliente. **Unidad de aislamiento de datos.**
- **Owner:** Plataforma (solo `service_role` los crea). **Aggregate:** raíz `Tenant`.
- **Lifecycle:** `trial → active → suspended → cancelled → deleted`, más `trial → expired → cancelled`. Transiciones en aplicación.
- **Soft delete:** no. Usa `status='deleted'` + retención de 90 días. **Locking:** sí. **Auditoría:** sí, todo cambio.
- **RLS:** T2 sobre `id` (el tenant se ve a sí mismo). Sin política de INSERT: `olo_app` no crea tenants.
- **Columnas:** `id`, `name`, `slug UNIQUE`, `status CHECK`, `plan CHECK`, `settings JSONB`, `limits JSONB`, `trial_ends_at`, estándar.
- **Relaciones:** raíz de todo. **Índices:** PK, `uq_tenants_slug`, `uq_tenants_self (id)` para FK compuestas.

### 4.5 `core.tenant_countries` — Fase 0

- **Responsabilidad:** presencia operativa de un tenant en un país, con su configuración regional. Separa el hecho global (§4.2) del dato del tenant.
- **Owner:** Tenant admin. **Aggregate:** raíz `TenantCountry`. **Lifecycle:** `active ↔ inactive`.
- **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `country_id → public.countries`, `status CHECK`, `default_currency_code`, `default_locale`, `default_timezone`, `fiscal_config JSONB`, `number_format`, `date_format`, estándar.
- **Relaciones:** padre de `companies`. **`UNIQUE (tenant_id, id)`** como destino de FK compuesta.
- **Índices:** PK, `uq_tc_tenant_id`, `uq_tc_active (tenant_id, country_id) WHERE deleted_at IS NULL`, `idx_tc_tenant`.

### 4.6 `core.companies` — Fase 0

- **Responsabilidad:** entidad legal dentro de un tenant. Portadora de datos fiscales.
- **Owner:** Tenant admin. **Aggregate:** raíz `Company`. **Lifecycle:** `active ↔ inactive`.
- **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `tenant_country_id`, `name`, `legal_name`, `tax_id`, `logo_file_id`, `address JSONB`, `settings JSONB`, `status CHECK`, estándar.
- **Relaciones:** `FK (tenant_id, tenant_country_id) → tenant_countries (tenant_id, id)`. **`UNIQUE (tenant_id, id)`**.
- **Índices:** PK, `uq_comp_tenant_id`, `uq_comp_tax (tenant_id, tenant_country_id, tax_id) WHERE tax_id IS NOT NULL AND deleted_at IS NULL`, `idx_comp_tenant`.

### 4.7 `core.warehouses` — Fase 0

- **Responsabilidad:** unidad operativa física. **Frontera de autorización de segundo nivel.**
- **Owner:** Company manager. **Aggregate:** raíz `Warehouse`. **Lifecycle:** `active ↔ inactive ↔ maintenance`.
- **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** **T3** sobre `id` — el almacén *es* la fila.
- **Columnas:** `id`, `tenant_id`, `company_id`, `name`, `code`, `address JSONB`, `latitude`, `longitude`, `timezone NOT NULL`, `locale`, `currency_code`, `settings JSONB`, `status CHECK`, estándar.
- **Relaciones:** `FK (tenant_id, company_id) → companies (tenant_id, id)`. **`UNIQUE (tenant_id, id)`**.
- **Índices:** PK, `uq_wh_tenant_id`, `uq_wh_code (tenant_id, company_id, code) WHERE deleted_at IS NULL`, `idx_wh_tenant`.

### 4.8 `core.areas` — Fase 0

- **Responsabilidad:** zona funcional del almacén.
- **Owner:** Warehouse manager. **Aggregate:** parte de `Warehouse`; raíz propia para persistencia (§4.9 nota).
- **Lifecycle:** `active ↔ inactive`. **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** T3.
- **Columnas:** `id`, `tenant_id`, `warehouse_id`, `name`, `code`, `type CHECK (receiving|storage|picking|shipping|staging|quarantine|returns)`, `max_locations`, `status CHECK`, `metadata JSONB`, estándar.
- **Relaciones:** `FK (tenant_id, warehouse_id) → warehouses (tenant_id, id)`. **`UNIQUE (tenant_id, warehouse_id, id)`** — destino de la FK triple de `locations`.
- **Índices:** PK, los dos UNIQUE, `uq_area_code (tenant_id, warehouse_id, code) WHERE deleted_at IS NULL`.

### 4.9 `core.locations` — Fase 0

- **Responsabilidad:** posición física concreta. **La tabla más referenciada del sistema.**
- **Owner:** Warehouse manager. **Aggregate:** raíz propia.
- **Lifecycle:** `available ↔ occupied ↔ reserved ↔ blocked ↔ maintenance`. **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** T3.
- **Columnas:** `id`, `tenant_id`, `warehouse_id`, `area_id`, `code`, `type CHECK (rack|shelf|bin|floor|dock|pallet|bulk)`, `level`, `max_weight_kg`, `max_volume_m3`, `max_units`, `status CHECK`, `metadata JSONB`, estándar.
- **Relaciones:** **`FK (tenant_id, warehouse_id, area_id) → areas (tenant_id, warehouse_id, id)`** — la FK que hace imposible la jerarquía cruzada (verificado). **`UNIQUE (tenant_id, warehouse_id, id)`**.
- **Índices:** PK, los dos UNIQUE, `uq_loc_code (tenant_id, area_id, code) WHERE deleted_at IS NULL`, `idx_loc_wh (tenant_id, warehouse_id)`.
- **Nota:** `plan_coordinates` **no vive aquí** (los planos están versionados). Va en `spatial.plan_location_mappings`, Fase 3.

> **Aggregates de la jerarquía.** `Warehouse`, `Area` y `Location` se modelan como aggregates independientes, no como una composición cargada en memoria. Un almacén con 600.000 ubicaciones no se instancia. La coherencia entre ellos la garantizan las FK compuestas, no la carga conjunta.

### 4.10 `core.users` — Fase 0

- **Responsabilidad:** **identidad global de plataforma.** Una persona = una fila. **No tiene `tenant_id`.**
- **Owner:** la propia persona (perfil) y Platform admin (ciclo de vida). **Aggregate:** raíz `User`.
- **Lifecycle:** `pending → active ↔ inactive ↔ suspended`. **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** **T4** — la única a medida.
- **Columnas:** `id`, `auth_id UUID NOT NULL UNIQUE`, `email`, `first_name`, `last_name`, `avatar_file_id`, `locale`, `timezone`, `status CHECK`, `settings JSONB`, estándar.
- **Relaciones:** 1:1 con `auth.users` vía `auth_id`; 1:N con `tenant_memberships`.
- **Índices:** PK, `uq_users_auth_id`, **`uq_users_email (email) WHERE deleted_at IS NULL` — global**, `idx_users_auth_id` (lo consume el Hook y `current_user_id()`).
- **Descartado:** `failed_login_attempts` y `locked_until`. Supabase Auth es el dueño de la autenticación y mantener un segundo estado de bloqueo crea dos fuentes de verdad. Clasificado a hardening por DEC-09.
- **[E2]:** `active_tenant_id UUID` se añade en la etapa 2, no antes.

### 4.11 `core.tenant_memberships` — Fase 0

- **Responsabilidad:** pertenencia de una identidad a un tenant. **Eslabón que ancla toda la autorización.**
- **Owner:** Tenant admin. **Aggregate:** raíz `TenantMembership`.
- **Lifecycle:** `invited → active ↔ suspended`, y `revoked_at` como baja. **Soft delete:** no, usa `revoked_at`. **Locking:** sí. **Auditoría:** sí, obligatoria. **RLS:** **T6**.
- **Columnas:** `id`, `tenant_id`, `user_id`, `status CHECK (invited|active|suspended)`, `invited_by`, `joined_at`, `revoked_at`, estándar sin `deleted_at`.
- **Constraints:**
  - **`UNIQUE (tenant_id, user_id)` — total, no parcial.** PostgreSQL no admite índices parciales como destino de FK, y esta tabla lo es. Consecuencia deliberada: una fila por par, y reincorporar a alguien pone `revoked_at` a NULL en la misma fila. El historial vive en `audit.events`.
  - `UNIQUE (tenant_id, id)` — segundo destino de FK compuesta.
  - `CHECK (revoked_at IS NULL OR joined_at IS NULL OR revoked_at >= joined_at)`.
  - **`uq_membership_one_active_per_user (user_id) WHERE revoked_at IS NULL AND status='active'`** — **restricción de la etapa 1.** Es lo que disuelve DEC-14. Se elimina en la etapa 2.
- **Índices:** PK, los UNIQUE, `idx_memb_user (user_id) WHERE revoked_at IS NULL` (lo consume el Hook, que filtra por `user_id` sin conocer aún el tenant).

### 4.12 `core.permissions` — Fase 0

- **Responsabilidad:** catálogo de permisos `module:action`. Da integridad referencial a lo que hoy sería texto libre.
- **Owner:** Plataforma (se versiona con el código). **Aggregate:** ninguno. **Lifecycle:** inmutable entre releases.
- **Soft delete:** no. **Locking:** no. **Auditoría:** no. **RLS:** T1 (lectura para todos los autenticados).
- **Columnas:** `code VARCHAR(64) PK` (p. ej. `inventory:approve`), `module`, `action`, `description`, `is_privileged BOOLEAN`.
- **Índices:** PK, `idx_perm_module`.
- **Justificación frente a JSONB:** un permiso mal escrito en JSONB no falla nunca; con FK falla al escribir. Y la matriz de permisos de la UI (`MODULES.md:149`) es una consulta relacional, no un escaneo de JSONB.

### 4.13 `core.roles` — Fase 0

- **Responsabilidad:** conjunto nombrado de permisos. `tenant_id NULL` = rol de sistema, visible para todos.
- **Owner:** Tenant admin (roles custom); Plataforma (roles de sistema). **Aggregate:** raíz `Role`.
- **Lifecycle:** activo ↔ borrado lógico. **Soft delete:** **sí** — cierra ALTO-14, porque hoy no lo tiene y el endpoint DELETE existe. **Locking:** sí. **Auditoría:** sí. **RLS:** T2 con excepción de `tenant_id IS NULL`.
- **Columnas:** `id`, `tenant_id NULL`, `name`, `description`, `is_system BOOLEAN`, `parent_role_id → roles(id)`, estándar con `deleted_at`.
- **Constraints:** trigger `core.prevent_role_cycle()` — detecta ciclo indirecto y auto-referencia, profundidad máxima 16 (verificado). `CHECK (NOT is_system OR tenant_id IS NULL)`.
- **Índices:** PK, `uq_roles_name (tenant_id, name) WHERE tenant_id IS NOT NULL AND deleted_at IS NULL`, `idx_roles_tenant`, `idx_roles_parent`.

### 4.14 `core.role_permissions` — Fase 0

- **Responsabilidad:** N:N entre rol y permiso. Sustituye a `roles.permissions JSONB`.
- **Owner:** quien posea el rol. **Aggregate:** parte de `Role`. **Lifecycle:** se crea y se borra físicamente.
- **Soft delete:** no. **Locking:** no. **Auditoría:** sí — cambiar permisos es un evento sensible. **RLS:** T2 vía el rol.
- **Columnas:** `role_id`, `permission_code`, `created_at`, `created_by`. PK compuesta `(role_id, permission_code)`.
- **Índices:** PK, `idx_rp_permission (permission_code)` para «qué roles conceden X».

### 4.15 `core.role_assignments` — Fase 0

- **Responsabilidad:** asignación de un rol a un usuario **dentro de un tenant y con un scope**.
- **Owner:** Tenant admin. **Aggregate:** parte de `TenantMembership`.
- **Lifecycle:** se concede y se revoca. **Soft delete:** no, borrado físico con evento de auditoría. **Locking:** no. **Auditoría:** sí, obligatoria. **RLS:** T6.
- **Columnas:** `id`, `tenant_id`, `user_id`, `role_id`, `scope_type CHECK (global|company|warehouse)`, `scope_company_id`, `scope_warehouse_id`, `assigned_by`, `assigned_at`.
- **Constraints:**
  - **`FK (tenant_id, user_id) → tenant_memberships (tenant_id, user_id)`** — hace **imposible asignar un rol a quien no es miembro del tenant**. Garantía que el modelo anterior no tenía.
  - `CHECK` de coherencia de scope: `global` exige ambos `scope_*` NULL; `company` exige `scope_company_id` y `scope_warehouse_id` NULL; `warehouse` exige `scope_warehouse_id`.
  - FK compuestas de los scopes a `companies` y `warehouses`.
  - `UNIQUE (tenant_id, user_id, role_id, scope_type, COALESCE(scope_company_id,'00000000-...'), COALESCE(scope_warehouse_id,'00000000-...'))`.
- **Índices:** PK, el UNIQUE, `idx_ra_user (tenant_id, user_id)`, `idx_ra_user_scope (user_id, scope_type)` para el Hook.

### 4.16 `core.user_warehouse_access` — Fase 0

- **Responsabilidad:** **read model** de acceso a almacenes, derivado de `role_assignments`. Existe para que RLS resuelva el scope con un lookup indexado en vez de un JOIN sobre roles.
- **Owner:** el servicio de autorización lo mantiene **en la misma transacción** que la asignación de rol (no un trigger opaco). El trigger queda como red secundaria.
- **Aggregate:** proyección, no aggregate. **Lifecycle:** derivado.
- **Soft delete:** no, usa `revoked_at`. **Locking:** no (es derivado). **Auditoría:** no directa — se audita el `role_assignment` que lo origina. **RLS:** **T6**, y su política **no debe invocar `can_access_warehouse()`**: sería recursión infinita.
- **Columnas:** `id`, `tenant_id`, `user_id`, `warehouse_id`, `granted_at`, `granted_by`, `revoked_at`, `source_role_assignment_id`, `created_at`, `updated_at`.
- **Constraints:** `FK (tenant_id, user_id) → tenant_memberships (tenant_id, user_id)`; `FK (tenant_id, warehouse_id) → warehouses (tenant_id, id)`.
- **Índices:** PK, `uq_uwa (tenant_id, user_id, warehouse_id) WHERE revoked_at IS NULL` — **parcial**, para permitir re-otorgar; **`idx_uwa_lookup (tenant_id, user_id) WHERE revoked_at IS NULL`** — el que sostiene `accessible_warehouse_ids()`.
- **Invariante de reconstrucción:** la proyección debe poder regenerarse desde cero y coincidir con el estado incremental. Es un test obligatorio.

### 4.17 `core.invitations` — Fase 0

- **Responsabilidad:** invitación a unirse a un tenant, con expiración.
- **Owner:** Tenant admin. **Aggregate:** raíz. **Lifecycle:** `pending → accepted | expired | revoked`.
- **Soft delete:** no. **Locking:** no. **Auditoría:** sí. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `email`, `token_hash CHAR(64) NOT NULL`, `role_id`, `scope_type`, `scope_company_id`, `scope_warehouse_id`, `status CHECK`, `invited_by`, `expires_at NOT NULL`, `accepted_at`, `accepted_user_id`, `created_at`.
- **Constraints:** `CHECK (expires_at > created_at)`. Único parcial `(tenant_id, email) WHERE status='pending'`.
- **Índices:** PK, `uq_inv_pending`, `idx_inv_token_hash`, `idx_inv_expires WHERE status='pending'`.
- **Seguridad:** se guarda **solo el hash** del token, nunca el token. Un solo uso. Expiración 72 h (`MODULES.md:133`).

### 4.18 `core.idempotency_keys` — Fase 0

- **Responsabilidad:** garantizar que un POST repetido no duplica su efecto.
- **Owner:** infraestructura de API. **Aggregate:** ninguno. **Lifecycle:** `in_progress → completed | failed`, expira a 24 h.
- **Soft delete:** no. **Locking:** no (el UNIQUE es el candado). **Auditoría:** no. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `idempotency_key VARCHAR(255)`, `endpoint`, `request_hash CHAR(64)`, `status CHECK`, `response_status_code`, `response_body JSONB`, `created_at`, `completed_at`, `expires_at DEFAULT now()+'24h'`.
- **Índices:** PK, **`uq_idem (tenant_id, idempotency_key)`**, `idx_idem_expires`.
- **Contrato:** misma clave + mismo `request_hash` ⇒ se devuelve la respuesta guardada. Misma clave + hash distinto ⇒ **409**. El `request_hash` es lo que distingue un reintento legítimo de una colisión de claves.

### 4.19 `audit.events` — Fase 0

- **Responsabilidad:** registro inmutable de toda acción. **Sin particionar en Fase 0** (DEC-06; verificado que la forma particionada con PK simple no se puede crear).
- **Owner:** Plataforma. **Aggregate:** raíz inmutable. **Lifecycle:** solo INSERT.
- **Soft delete:** no. **Locking:** no. **Auditoría:** es la auditoría. **RLS:** **T5**.
- **Columnas:** `event_id UUID PK`, `tenant_id UUID NOT NULL` (**sin FK**, deliberado: no bloquear la inserción de auditoría), `actor_id`, `actor_type CHECK`, `actor_email`, `action VARCHAR(100)`, `entity_type`, `entity_id`, `old_values JSONB`, `new_values JSONB`, `request_id`, `correlation_id`, `ip_address INET`, `user_agent`, `source CHECK (api|worker|integration|migration|platform)`, `is_impersonated BOOLEAN`, `occurred_at`, `previous_hash CHAR(64)`, `event_hash CHAR(64)`.
- **Índices:** PK, `idx_audit_tenant_time (tenant_id, occurred_at DESC)`, `idx_audit_actor`, `idx_audit_entity (tenant_id, entity_type, entity_id, occurred_at DESC)`, `idx_audit_request (request_id)`, `idx_audit_brin USING BRIN (occurred_at)`.
- **`previous_hash`/`event_hash` se crean nulas desde el inicio** aunque la cadena criptográfica se posponga a hardening: añadir columnas a una tabla de auditoría con 40 M de filas es una de las migraciones más caras que existen; crearlas vacías cuesta cero.
- **Emisión:** desde la capa de aplicación, **no por triggers**. Un trigger no conoce `request_id`, `user_agent` ni la intención de negocio.
- **Alcance real de la inmutabilidad:** protege de `authenticated` y `olo_app`. No de `BYPASSRLS`. La compensación es §4.20.

### 4.20 `platform.privileged_operation_log` — Fase 0

- **Responsabilidad:** auditar **cada** invocación de `service_role`. Requerido por decisión 4.9 y DR-002 §C.
- **Owner:** Plataforma. **Aggregate:** raíz inmutable. **Lifecycle:** solo INSERT.
- **Soft delete/Locking:** no. **RLS:** **T0** — schema no expuesto, solo `service_role` llega.
- **Columnas:** `id`, `operation`, `actor_id`, `actor_email` (copia inmutable), `target_tenant_id`, **`justification TEXT NOT NULL`**, `parameters JSONB`, `result CHECK (success|failure)`, `error_message`, `request_id`, `ip_address`, `occurred_at`.
- **Índices:** PK, `idx_priv_occurred`, `idx_priv_actor`, `idx_priv_target WHERE target_tenant_id IS NOT NULL`.
- **`justification NOT NULL` es deliberado:** obliga a que toda operación privilegiada tenga un motivo escrito.

### 4.21 `platform.jobs` — Fase 1

- **Responsabilidad:** **recurso de trabajo asíncrono visible en la API**, desacoplado de la tecnología de cola. Da contenido a `GET /v1/jobs/{id}` sin atar el contrato a BackgroundTasks ni a ARQ.
- **Owner:** el `JobDispatcher`. **Aggregate:** raíz `Job`. **Lifecycle:** `queued → running → completed | failed | cancelled`.
- **Soft delete:** no. **Locking:** sí (para reclamar el trabajo). **Auditoría:** eventos de inicio y fin. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `job_type`, `payload JSONB`, `status CHECK`, `progress_percent CHECK BETWEEN 0 AND 100`, `result JSONB`, `error_message`, `attempts INT`, `max_attempts INT DEFAULT 3`, `scheduled_for`, `started_at`, `completed_at`, `requested_by`, `idempotency_key`, estándar.
- **Índices:** PK, `idx_jobs_status (tenant_id, status)`, `idx_jobs_pending (scheduled_for) WHERE status='queued'`, `idx_jobs_type (tenant_id, job_type, created_at DESC)`.
- **Nota:** `tenant_id` es **obligatorio**. Un worker nunca infiere el tenant: lo lee de aquí.

### 4.22 `core.files` — Fase 1

- **Responsabilidad:** registro de todo objeto en Supabase Storage. Sin ella no hay forma de forzar rutas por tenant, limpiar huérfanos ni aplicar cuotas.
- **Owner:** quien sube. **Aggregate:** raíz `File`. **Lifecycle:** `pending → confirmed → deleted`, más `quarantined`.
- **Soft delete:** sí. **Locking:** no. **Auditoría:** sí. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `bucket`, `storage_path`, `original_name`, `content_type`, `size_bytes`, `checksum_sha256`, `status CHECK`, `resource_type`, `resource_id`, `uploaded_by`, `created_at`, `confirmed_at`, `deleted_at`.
- **Constraint clave (verificada):** `CHECK (storage_path LIKE 'tenants/' || tenant_id::text || '/%')` — hace **imposible a nivel de motor** registrar un archivo fuera del prefijo del tenant, y bloquea también el escape de directorio.
- **Índices:** PK, `uq_files_path (bucket, storage_path) WHERE deleted_at IS NULL`, `idx_files_resource`, `idx_files_pending (created_at) WHERE status='pending'` (para el job de limpieza).
- **Sustituye a:** todas las columnas `*_url TEXT` y `evidence_urls JSONB`, que pasan a `*_file_id UUID`.

### 4.23 `core.notifications` — Fase 1

- **Responsabilidad:** centro de notificaciones in-app (`RF-NOTIF-005`).
- **Owner:** destinatario. **Aggregate:** raíz. **Lifecycle:** `unread → read → archived`.
- **Soft delete:** no, `archived_at`. **Locking:** no. **Auditoría:** no. **RLS:** T2 + filtro por `user_id = current_user_id()`.
- **Columnas:** `id`, `tenant_id`, `user_id`, `type`, `title`, `body`, `severity CHECK`, `entity_type`, `entity_id`, `read_at`, `archived_at`, `created_at`.
- **Índices:** PK, `idx_notif_user (tenant_id, user_id, created_at DESC)`, `idx_notif_unread (tenant_id, user_id) WHERE read_at IS NULL`.

### 4.24 `inventory.products` — Fase 1 *(la entidad «Inventory» del catálogo pedido)*

- **Responsabilidad:** catálogo de SKU. **Scope tenant, no almacén** (DR-010).
- **Owner:** Tenant admin. **Aggregate:** raíz `Product`. **Lifecycle:** `active ↔ discontinued`, `pending`.
- **Soft delete:** sí. **Locking:** sí. **Auditoría:** sí. **RLS:** T2.
- **Columnas:** `id`, `tenant_id`, `sku`, `name`, `description`, `category`, `subcategory`, `unit_of_measure`, `weight_kg`, `volume_m3`, `barcode`, `barcode_type`, `attributes JSONB`, `status CHECK`, estándar.
- **Índices:** PK, `uq_prod_sku (tenant_id, sku) WHERE deleted_at IS NULL`, `uq_prod_barcode (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`, `idx_prod_category`, GIN de búsqueda.
- **Movido fuera:** `min_stock`, `max_stock`, `reorder_point` van a §4.25 — son por almacén, no por tenant, y deben ser `NUMERIC`, no `INT`.
- **GIN:** el índice de búsqueda **no fija `'spanish'`**. La plataforma es multi-idioma; se indexa con `'simple'` o una columna `tsvector` generada por idioma del tenant.

### 4.25 `inventory.product_warehouse_settings` — Fase 1

- **Responsabilidad:** umbrales de stock por producto **y almacén** (`RF-INV-008`).
- **Owner:** Warehouse manager. **Aggregate:** parte de `Product`. **RLS:** T3.
- **Soft delete:** no. **Locking:** sí. **Auditoría:** sí.
- **Columnas:** `id`, `tenant_id`, `warehouse_id`, `product_id`, `min_stock NUMERIC(15,4)`, `max_stock NUMERIC(15,4)`, `reorder_point NUMERIC(15,4)`, estándar.
- **Índices:** PK, `uq_pws (tenant_id, warehouse_id, product_id)`.

### 4.26 `inventory.ledger_entries` — Fase 1 *(InventoryLedger)*

- **Responsabilidad:** **la verdad del inventario.** Registro inmutable y append-only de todo movimiento, en deltas firmados.
- **Owner:** el motor de inventario. **Aggregate:** raíz inmutable. **Lifecycle:** solo INSERT.
- **Soft delete:** **no**. **Locking:** **no**. **Auditoría:** es el ledger. **RLS:** T3.
- Detalle completo, constraints y algoritmos en **`INVENTORY_ENGINE_SPEC.md`**.
- **Índices:** `(tenant_id, balance_id, occurred_at DESC)`, `(tenant_id, warehouse_id, product_id, occurred_at DESC)`, `(tenant_id, location_id, occurred_at DESC)`, `(tenant_id, source_type, source_id)`, BRIN sobre `occurred_at`.
- **PK `(id, occurred_at)`** desde el inicio: es candidata a particionamiento por C1 y C5, y la PK compuesta cuesta cero ahora frente a recrear la tabla después.

### 4.27 `inventory.balances` — Fase 1 *(InventoryBalance)*

- **Responsabilidad:** **proyección** del saldo actual. Derivable del ledger; existe por rendimiento.
- **Owner:** el motor de inventario. **Aggregate:** raíz `Balance`. **Lifecycle:** nace con el primer movimiento; nunca se borra, llega a cero.
- **Soft delete:** sí (para retirar combinaciones obsoletas). **Locking:** **sí, obligatorio**. **Auditoría:** vía ledger. **RLS:** T3.
- **Clave lógica (verificada):** `UNIQUE (tenant_id, warehouse_id, location_id, product_id, COALESCE(lot_number,''), COALESCE(serial_number,''), status) WHERE deleted_at IS NULL`. **El `COALESCE` es obligatorio**: sin él, dos filas con lote NULL no colisionan y la cantidad se parte en dos — medido.
- **CHECK:** `quantity >= 0`; `reserved_quantity >= 0`; `reserved_quantity <= quantity`; **`serial_number IS NULL OR quantity = 1`** (verificado).
- Detalle en `INVENTORY_ENGINE_SPEC.md`.

### 4.28 `inventory.counts` / `count_items` / `count_observations` / `count_assignees` — Fase 1

- **Responsabilidad:** proceso de conteo físico, con **múltiples observaciones por línea** (decisión 4.10) para soportar reconteo.
- **Owner:** Warehouse manager. **Aggregates:** `Count` raíz; `CountItem` raíz propia (un conteo completo son ~120.000 líneas: no se cargan en memoria); `CountObservation` append-only.
- **Lifecycle del conteo:** `planned → in_progress → completed | cancelled`.
- **Soft delete:** no. **Locking:** sí en `counts` y `count_items`; no en `observations`. **Auditoría:** sí. **RLS:** T3.
- `count_items` lleva `UNIQUE (tenant_id, count_id, location_id, product_id)` — cierra ALTO-22, que hoy permite líneas duplicadas.
- `count_assignees` sustituye a `counts.assigned_users JSONB`: sin tabla, «mis conteos asignados» es un escaneo de JSONB.
- Detalle en `INVENTORY_ENGINE_SPEC.md`.

### 4.29 `inventory.adjustments` / `adjustment_items` / `adjustment_reasons` — Fase 1

- **Responsabilidad:** corrección de inventario con workflow de aprobación. **Los items son deltas, no valores absolutos.**
- **Owner:** Warehouse manager; aprobación por rol con `inventory:approve`.
- **Lifecycle:** `pending → approved | rejected → applied | cancelled`.
- **Soft delete:** no. **Locking:** sí. **Auditoría:** sí, obligatoria. **RLS:** T3.
- `adjustment_reasons` **es catálogo** y no CHECK: tiene atributos (`requires_evidence`, `requires_approval`) y es configurable por tenant. Es el criterio de §7.
- Detalle en `INVENTORY_ENGINE_SPEC.md`.

### 4.30 `inventory.incidents` — Fase 1

- **Responsabilidad:** discrepancia o anomalía que requiere investigación.
- **Owner:** asignado. **Aggregate:** raíz. **Lifecycle:** `open → investigating → resolved → closed`, con `reopen`.
- **Soft delete:** no. **Locking:** sí. **Auditoría:** sí. **RLS:** T3.
- **Columnas:** `id`, `tenant_id`, `warehouse_id`, `location_id`, `product_id`, `type CHECK`, `severity CHECK`, `status CHECK`, `title`, `description`, `detected_source CHECK`, `source_reference_id`, `assigned_to`, `resolution`, `resolved_at`, `closed_at`, estándar.
- **CHECK:** `status <> 'resolved' OR resolution IS NOT NULL`; `resolved_at IS NULL OR resolved_at >= created_at`.
- **Índices:** PK, `(tenant_id, warehouse_id)`, `(tenant_id, status)`, `(tenant_id, severity) WHERE status IN ('open','investigating')`.

### 4.31 `integrations.*` — Fase 1

| Tabla | Responsabilidad | RLS | Notas |
|---|---|---|---|
| `connector_types` | **Catálogo.** `RF-INT-011` promete 4 tipos más | T1 | Catálogo, no CHECK: el conjunto crece |
| `connectors` | Conexión de un almacén con un WMS | T3 | `connection_config JSONB` **cifrado en aplicación**. Único parcial: un conector activo por almacén y tipo |
| `sync_jobs` | Ejecución de sincronización | T2 | Único parcial `(tenant_id, connector_id) WHERE status IN ('queued','running')` — cierra la carrera de ALTO-08 |
| `sync_job_logs` | Traza por registro procesado (`RF-INT-006`) | T2 | Append-only. Alto volumen: candidata a particionar por C5 |

**Descartado:** `field_mappings` como tabla. El mapeo lo consume el conector en bloque, no se consulta por campo. `mapping_config JSONB` es la representación correcta.

### 4.32 `ai.*` — Fase 2

| Tabla | Responsabilidad | RLS | Notas |
|---|---|---|---|
| `engines` | **Catálogo** de motores | T1 | Catálogo: `RF-IA-015` promete 5 más. Con CHECK, cada motor sería una migración |
| `models` | Instancia entrenada con pesos | T2 | **`UNIQUE (tenant_id, engine_code) WHERE status='deployed'`** — implementa la invariante «un solo modelo desplegado por motor», que hoy solo se valida en aplicación (carrera) |
| `datasets` | Conjunto anotado | T2 | |
| `dataset_images` | Imagen del dataset | T2 | Referencia `core.files` |
| `annotations` | Bounding box | T2 | Volumen alto |
| `inference_jobs` | Ejecución de inferencia | T2 | Único parcial de training concurrente por tenant |
| `detections` | **Resultado unitario consultable** | T3 | Extrae lo que hoy es `results JSONB`. `RF-IA-013` exige asociar detecciones a ubicaciones; en JSONB eso es un escaneo secuencial |
| `training_jobs` | Entrenamiento | T2 | `UNIQUE (tenant_id) WHERE status IN ('queued','training')` |

### 4.33 `devices.*` y `spatial.*` — Fase 3

| Tabla | Responsabilidad | RLS | Notas |
|---|---|---|---|
| `devices` | Hardware registrado | T3 | `UNIQUE (tenant_id, serial_number)` |
| `drone_missions` | Plan de vuelo. **`telemetry` JSONB desaparece** | T3 | `route JSONB` sí se queda: se consume en bloque |
| `telemetry_points` | **Serie temporal independiente** (decisión 4.5) | T3 | **`BIGSERIAL`, no UUID**: 8 bytes frente a 16 e inserción secuencial en el índice. **PK `(id, recorded_at)`** desde el inicio. Ingesta **por lotes**, no punto a punto |
| `mission_captures` | Imagen capturada en un waypoint | T3 | Referencia `core.files` |
| `floor_plans` | Plano versionado | T3 | |
| `plan_location_mappings` | Coordenadas de una ubicación **en una versión de plano** | T3 | Resuelve INT-12: con las coordenadas en `locations` no hay sitio para dos versiones |

---

## 5. FK COMPUESTAS — INVENTARIO COMPLETO

Mecanismo verificado. Requiere `UNIQUE` redundante en la tabla padre como destino.

### 5.1 Destinos

```
core.tenants             UNIQUE (id)                              -- ya es PK
core.tenant_countries    UNIQUE (tenant_id, id)
core.companies           UNIQUE (tenant_id, id)
core.warehouses          UNIQUE (tenant_id, id)
core.areas               UNIQUE (tenant_id, warehouse_id, id)
core.locations           UNIQUE (tenant_id, warehouse_id, id)
core.tenant_memberships  UNIQUE (tenant_id, user_id)  +  UNIQUE (tenant_id, id)
```

### 5.2 Cadena de jerarquía

| Hija | FK compuesta | Impide |
|---|---|---|
| `companies` | `(tenant_id, tenant_country_id)` → `tenant_countries` | Company colgando del país de otro tenant |
| `warehouses` | `(tenant_id, company_id)` → `companies` | Almacén en la company de otro tenant |
| `areas` | `(tenant_id, warehouse_id)` → `warehouses` | Área en el almacén de otro tenant |
| **`locations`** | **`(tenant_id, warehouse_id, area_id)`** → `areas` | **Ubicación cuyo área está en otro almacén** |

### 5.3 Cadena de autorización

| Hija | FK compuesta | Impide |
|---|---|---|
| `role_assignments` | `(tenant_id, user_id)` → `tenant_memberships` | Asignar rol a un no-miembro |
| `user_warehouse_access` | `(tenant_id, user_id)` → `tenant_memberships` | Dar acceso a almacén a un no-miembro |
| `user_warehouse_access` | `(tenant_id, warehouse_id)` → `warehouses` | Acceso a almacén de otro tenant |

### 5.4 Tablas warehouse-scoped

Todas reciben `(tenant_id, warehouse_id) → warehouses (tenant_id, id)`; las que llevan `location_id`, la tripleta `(tenant_id, warehouse_id, location_id) → locations`:

`balances`, `ledger_entries`, `product_warehouse_settings`, `counts`, `count_items`, `adjustments`, `adjustment_items`, `incidents`, `connectors`, `devices`, `drone_missions`, `telemetry_points`, `mission_captures`, `floor_plans`, `plan_location_mappings`, `ai.detections`.

> **Nota de implementación:** `count_items` y `balances` **necesitan `warehouse_id` explícito**, que `DATABASE_DESIGN.md` no les da. Es requisito de la plantilla T3 y de esta FK.

---

## 6. FUNCIONES Y TRIGGERS

### 6.1 Funciones de contexto — siete, ninguna más

Contrato en `IDENTITY_AND_AUTH_FLOW.md` §3.3. Reglas: `SET search_path=''` siempre; `STABLE` siempre; `SECURITY DEFINER` solo en `current_user_id`, `has_active_membership`, `accessible_warehouse_ids`.

### 6.2 Triggers comunes

| Función | Cuándo | Nota |
|---|---|---|
| `core.set_updated_at()` | BEFORE UPDATE, todas las mutables | **No toca `version`**: si lo hiciera, cualquier escritura de sistema produciría 409 espurios |
| `core.prevent_tenant_change()` | BEFORE UPDATE, todas con `tenant_id` | **`IS DISTINCT FROM`, no `!=`** (verificado: con `!=`, poner `tenant_id` a NULL atraviesa el trigger sin error) |
| `core.prevent_role_cycle()` | BEFORE INSERT/UPDATE en `roles` | Ciclo indirecto y auto-referencia, profundidad máx. 16 (verificado) |

### 6.3 Función eliminada

**`core.soft_delete()` no se crea.** Verificado que como `BEFORE UPDATE` marca `deleted_at` en toda actualización —renombrar un almacén lo elimina— y como `BEFORE DELETE` no hace nada y el borrado físico se ejecuta en silencio. Ninguna de sus dos formas de uso es salvable. El soft delete es `UPDATE ... SET deleted_at = now()` en el repositorio, o una RPC autorizada y auditada.

---

## 7. CATÁLOGO FRENTE A CHECK — CRITERIO APLICADO

DEC-12 dice «CHECK para invariantes estructurales estables; tablas catálogo para estados y valores evolutivos». Aplicarlo literalmente a las ~20 columnas `status` del modelo produce nueve tablas catálogo y un JOIN en cada lectura, para valores que no cambian nunca.

**Criterio operativo:** una tabla catálogo se justifica cuando el valor **tiene atributos propios** o **varía por tenant**. Si es un ciclo de vida cerrado cuyo cambio exige tocar código igualmente, es un `CHECK`.

### 7.1 Catálogo — cuatro tablas

| Tabla | Por qué |
|---|---|
| `core.permissions` | Tiene atributos (`module`, `action`, `is_privileged`) y da FK contra el texto libre |
| `ai.engines` | `RF-IA-015` promete 5 motores más. Con CHECK, cada uno es una migración |
| `integrations.connector_types` | `RF-INT-011` promete 4 tipos más |
| `inventory.adjustment_reasons` | Tiene atributos (`requires_evidence`, `requires_approval`) y es **configurable por tenant** |

### 7.2 CHECK — todo lo demás

`status` de todas las entidades, `movement_type`, `area_type`, `location_type`, `device_type`, `incident_type`, `severity`, `scope_type`, `actor_type`, `source`, `count_type`, `adjustment_type`.

Más los invariantes estructurales: `quantity >= 0`, `reserved_quantity <= quantity`, `serial_number IS NULL OR quantity = 1`, prefijo de `storage_path`, coherencia de scope, coherencia temporal.

### 7.3 Simplificación conseguida

**De 9 tablas catálogo propuestas a 4.** Se eliminan `user_statuses`, `membership_statuses`, `count_statuses`, `location_types`, `area_types`, `device_types`, `incident_types` y `movement_types`: son ciclos de vida cerrados, y añadirles un valor obliga a tocar la lógica de negocio de todos modos.

---

## 8. RECUENTO FINAL

| Fase | Tablas | Acumulado |
|---|---|---|
| **0** | 19 | 19 |
| **1** | 22 | 41 |
| **2** | 8 | 49 |
| **3** | 6 | 55 |

### 8.1 Las 19 tablas de Fase 0

`public.currencies`, `public.countries`, `core.tenants`, `core.tenant_countries`, `core.companies`, `core.warehouses`, `core.areas`, `core.locations`, `core.users`, `core.tenant_memberships`, `core.permissions`, `core.roles`, `core.role_permissions`, `core.role_assignments`, `core.user_warehouse_access`, `core.invitations`, `core.idempotency_keys`, `audit.events`, `platform.privileged_operation_log`.

### 8.2 Entidades del catálogo pedido que no son tablas

| Entidad | Resolución |
|---|---|
| **Platform** | Nivel conceptual. Se reparte en RPC, log de privilegios, matview y env vars (§4.3) |
| **Inventory** | Es `inventory.products`, el catálogo de SKU (§4.24) |
| **AI Models** | `ai.models` + catálogo `ai.engines` (§4.32) |
| **Integrations** | Cuatro tablas en `integrations` (§4.31) |
| **Jobs** | `platform.jobs` (§4.21) |
| **Idempotency** | `core.idempotency_keys` (§4.18) |
| **Files** | `core.files` (§4.22) |

---

*Modelo de datos definitivo. Ninguna migración creada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
