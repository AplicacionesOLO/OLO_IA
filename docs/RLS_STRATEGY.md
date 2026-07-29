# OLO_IA - ESTRATEGIA DE ROW LEVEL SECURITY (RLS)

> **Versión 2.0** — Reescritura completa tras auditoría de la v1.0.
> La v1.0 contenía cinco defectos bloqueantes (aislamiento por almacén inerte, escalada
> de privilegios por centinela de array vacío, SQL que no ejecuta, suposición falsa sobre
> `service_role`, y dos fuentes de contexto incompatibles). Ver §12 para el registro de cambios.
> **Todo el SQL de este documento está pensado para ejecutarse tal cual.**

---

## 1. INTRODUCCIÓN

Row Level Security (RLS) es el mecanismo principal de aislamiento de datos entre tenants en OLO_IA. Este documento define la estrategia completa de implementación de RLS en PostgreSQL 15+ vía Supabase.

### 1.1 Por qué RLS

- Enforcement a nivel de motor de base de datos, no solo de aplicación.
- Aplica a todas las queries, incluidas las que ejecutan funciones.
- Nativo en PostgreSQL y Supabase.
- Auditable y testeable.

### 1.2 Los tres límites reales de RLS (leer antes de confiar en él)

RLS es fuerte, pero no es absoluto. Estas tres afirmaciones son ciertas y condicionan todo el diseño:

1. **Un rol con el atributo `BYPASSRLS` ignora todas las políticas.** En Supabase, `service_role` tiene `BYPASSRLS`. Si el backend se conecta con la `service_role key`, ninguna política se evalúa y el aislamiento desaparece por completo. Por eso §2.1 define un rol de aplicación dedicado.
2. **El propietario de la tabla ignora las políticas** salvo que la tabla tenga `FORCE ROW LEVEL SECURITY`. Por eso toda tabla de negocio lleva `FORCE` (§4.1).
3. **RLS filtra filas, no protege contra un contexto de sesión mal establecido.** Si la aplicación fija el tenant equivocado, RLS obedece. La corrección del contexto es responsabilidad del middleware, y se verifica con los tests de §9.

---

## 2. CONTEXTO DE EJECUCIÓN

### 2.1 Roles de Postgres

| Rol | `BYPASSRLS` | Uso en OLO_IA |
|-----|-------------|---------------|
| `postgres` | Sí | Solo migraciones. Nunca desde la aplicación. |
| `service_role` | **Sí** | Solo tareas de plataforma cross-tenant explícitas (§7). **Nunca** para queries con scope de tenant. |
| `authenticated` | No | Acceso directo del frontend vía PostgREST / Realtime / Storage. |
| `anon` | No | Pre-login. Sin acceso a datos de negocio. |
| `olo_app` | No | **Rol del backend FastAPI.** Creado por nosotros. Es el camino por defecto. |

```sql
-- ═══════════════════════════════════════════════════════════
-- Rol de aplicación: RLS SIEMPRE aplica.
-- No es propietario de ninguna tabla y no tiene BYPASSRLS.
-- La password se inyecta desde el gestor de secretos, nunca literal.
-- ═══════════════════════════════════════════════════════════
CREATE ROLE olo_app LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA core, inventory, ai, devices, integrations, spatial, audit TO olo_app;

-- Privilegios de tabla: se conceden por schema en la migración correspondiente.
-- audit.events es la excepción (append-only, ver §5.4).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
    core, inventory, ai, devices, integrations, spatial TO olo_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA core, inventory, ai, devices, integrations, spatial
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;
```

### 2.2 Fuente del contexto de tenant: híbrido JWT + GUC

**Decisión arquitectónica.** El `tenant_id` se resuelve desde dos fuentes, en este orden:

1. **Claims del JWT** (`request.jwt.claims` → `app_metadata.tenant_id`). Es el camino que usan PostgREST, Realtime y las políticas de Storage. Nadie ejecuta `SET LOCAL` en esos caminos, así que sin esta fuente quedarían denegando todo.
2. **GUC de sesión** (`app.current_tenant`). Es el camino del backend FastAPI y de la suite de tests, donde no siempre hay un JWG de usuario disponible.

Cualquiera de los dos que resuelva primero gana. Si ninguno resuelve, el contexto es `NULL` y **todas las políticas deniegan** (fail secure).

```sql
-- ═══════════════════════════════════════════════════════════
-- Helpers de contexto
--
-- Notas de implementación deliberadas:
--  • LANGUAGE sql (no plpgsql): más rápido, inlineable por el planner.
--  • STABLE: se evalúa una vez por statement, no una vez por fila.
--  • SET search_path = '': obligatorio. Sin esto son un vector de
--    escalada de privilegios y el linter de Supabase las marca.
--  • SIN SECURITY DEFINER: solo leen ajustes de sesión, no lo necesitan.
--    La única excepción justificada es accessible_warehouse_ids().
-- ═══════════════════════════════════════════════════════════

-- Tenant activo. NULL ⇒ sin contexto ⇒ acceso denegado.
CREATE OR REPLACE FUNCTION core.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    -- Camino 1: PostgREST / Realtime / Storage
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid,
    -- Camino 2: backend FastAPI / tests
    NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
$$;

-- Identidad de Supabase Auth (el claim `sub`).
CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.current_auth_id', true), '')::uuid
  )
$$;

-- Identidad de negocio: core.users.id.
--
-- ⚠ core.users.id ≠ auth.uid(). El provisioning crea el usuario en Supabase Auth
-- y guarda ese id en core.users.auth_id como columna aparte. Confundirlos hace que
-- toda política de ownership compare UUIDs de espacios distintos y falle en silencio.
-- Por eso el Custom Access Token Hook (§3) debe publicar `user_id` en app_metadata:
-- así se evita un lookup por query.
CREATE OR REPLACE FUNCTION core.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_id', '')::uuid,
    NULLIF(current_setting('app.current_user', true), '')::uuid
  )
$$;
```

### 2.3 Scope de almacén: booleano explícito, nunca un centinela

La v1.0 usaba «lista de almacenes vacía» como señal de «este usuario ve todo el tenant». Eso confunde *soy administrador* con *todavía no tengo almacenes asignados*: un usuario recién creado obtenía acceso total. El acceso amplio ahora se declara **explícitamente** y su default es `false`.

```sql
-- ¿El sujeto ve todos los almacenes del tenant?
-- Default false: fail secure. Nunca se infiere de una lista vacía.
CREATE OR REPLACE FUNCTION core.has_tenant_wide_access()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_wide_access')::boolean,
    NULLIF(current_setting('app.tenant_wide_access', true), '')::boolean,
    false
  )
$$;

-- Almacenes accesibles, leídos de la BD (no del JWT).
--
-- Por qué de la BD y no del token:
--  • Revocación inmediata. En el JWT habría que esperar el refresh.
--  • Sin bloat: un usuario con acceso a 200 almacenes no infla el token.
--
-- SECURITY DEFINER aquí SÍ está justificado: la función debe leer
-- core.user_warehouse_access sin disparar la política RLS de esa misma tabla,
-- que llamaría de vuelta a esta función (recursión infinita).
-- El filtro por tenant_id es lo que mantiene la función segura.
-- COALESCE garantiza array vacío y nunca NULL, para que `= ANY(...)` sea
-- siempre un booleano definido.
CREATE OR REPLACE FUNCTION core.accessible_warehouse_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(uwa.warehouse_id), ARRAY[]::uuid[])
  FROM core.user_warehouse_access uwa
  WHERE uwa.tenant_id = core.current_tenant_id()
    AND uwa.user_id   = core.current_user_id()
    AND uwa.revoked_at IS NULL
$$;

-- Predicado único que usan todas las políticas con scope de almacén.
-- Tener la lógica en un solo sitio es lo que evita que las 6 tablas
-- que la usan divergan con el tiempo.
CREATE OR REPLACE FUNCTION core.can_access_warehouse(p_warehouse_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT core.current_tenant_id() IS NOT NULL
     AND (
          core.has_tenant_wide_access()
       OR p_warehouse_id = ANY (core.accessible_warehouse_ids())
     )
$$;

-- Índice que sostiene accessible_warehouse_ids()
CREATE INDEX idx_user_warehouse_access_tenant_user
    ON core.user_warehouse_access (tenant_id, user_id)
    WHERE revoked_at IS NULL;
```

---

## 3. REQUISITOS SOBRE EL JWT

Las políticas dependen de que estos campos existan en `app_metadata`. Se publican con un **Custom Access Token Hook** de Supabase Auth, no escribiendo `app_metadata` a mano.

| Campo | Tipo | Obligatorio | Nota |
|-------|------|-------------|------|
| `tenant_id` | uuid | Sí | Sin él no hay acceso a nada. |
| `user_id` | uuid | Sí | `core.users.id`, **no** el `sub`. |
| `tenant_wide_access` | boolean | Sí | Explícito. Default `false`. |

**Lo que NO va en el JWT:** `warehouse_ids` y `permissions`. Ambos estaban en `SECURITY.md:83-84` y deben salir de ahí. Motivo: el token solo se refresca cada 15 minutos, así que quitarle un permiso a alguien no surtiría efecto inmediato; y las listas largas inflan el token más allá de los límites prácticos de cabecera HTTP. El scope de almacén se lee de la BD (§2.3) y los permisos se resuelven en la capa de aplicación.

---

## 4. PATRÓN DE POLÍTICAS

### 4.1 El fallo estructural de la v1.0 y su corrección

**PostgreSQL combina las políticas permisivas con `OR`, no con `AND`.** La v1.0 ponía dos políticas permisivas sobre `core.warehouses`: una que comprobaba el tenant y otra que comprobaba el almacén. Al unirse con `OR`, bastaba con que el tenant coincidiera para ver **todos** los almacenes: la restricción por almacén nunca se aplicaba. El mismo error estaba en `stock_records`, `counts`, `adjustments` e `incidents`, e invalidaba el «Nivel 3: Warehouse Isolation» de `MULTITENANT.md`.

La corrección no es parchear las condiciones, es cambiar la estructura:

```
Una fila es visible si y solo si:

    ( alguna política PERMISSIVE la permite )   ← OR entre ellas
  AND
    ( TODAS las políticas RESTRICTIVE la permiten )   ← AND entre ellas
```

De ahí el patrón obligatorio, dos políticas por tabla:

- **`tenant_isolation`, `AS RESTRICTIVE`** — el piso duro. Al ser restrictiva se evalúa con `AND`, así que **ninguna política que se añada en el futuro puede ampliarla**. Esta es la propiedad que hacía falta.
- **`<scope>`, `AS PERMISSIVE`** — la concesión: el acceso concreto que se otorga.

Una tabla con solo políticas restrictivas no devuelve nada: hace falta al menos una permisiva.

### 4.2 Plantilla A — tabla con scope de tenant

```sql
ALTER TABLE inventory.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.products FORCE  ROW LEVEL SECURITY;  -- ni el owner se salta RLS

-- Piso duro (AND contra todo lo demás)
CREATE POLICY tenant_isolation ON inventory.products
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Concesión. La condición se repite a propósito: redundante frente a la
-- restrictiva, pero deja la política legible por sí sola.
CREATE POLICY tenant_members ON inventory.products
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
```

### 4.3 Plantilla B — tabla con scope de tenant + almacén

```sql
ALTER TABLE inventory.stock_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_records FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inventory.stock_records
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Ahora sí restringe de verdad: al ser la ÚNICA permisiva, su condición
-- no puede ser eludida por OR, y la restrictiva le pone el piso de tenant.
CREATE POLICY warehouse_scope ON inventory.stock_records
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));
```

Aplican la plantilla B: `core.warehouses` (sobre `id`), `inventory.stock_records`, `inventory.counts`, `inventory.adjustments`, `inventory.incidents`, y toda tabla de `devices` y `spatial` con columna `warehouse_id`.

### 4.4 El soft-delete sale de RLS

La v1.0 tenía una política `active_only` permisiva para ocultar filas con `deleted_at IS NOT NULL`. Además de sufrir el bug de `OR` (los registros borrados seguían visibles), es un error de diseño: RLS es un mecanismo de *seguridad*, y el soft-delete es un filtro de *negocio*. Mezclarlos hace imposible leer un registro borrado para auditarlo o para restaurarlo.

El soft-delete se resuelve fuera de RLS:

```sql
-- Vista de conveniencia para el camino de lectura habitual
CREATE VIEW inventory.products_active
WITH (security_invoker = true) AS      -- hereda las políticas del que consulta
SELECT * FROM inventory.products WHERE deleted_at IS NULL;

-- Índice parcial que la sostiene
CREATE INDEX idx_products_tenant_active
    ON inventory.products (tenant_id, sku) WHERE deleted_at IS NULL;
```

`security_invoker = true` es lo correcto aquí: la vista no debe otorgar más de lo que ya tiene quien la consulta.

---

## 5. POLÍTICAS POR SCHEMA

### 5.1 Schema `core`

```sql
-- ── core.tenants ────────────────────────────────────────────
-- El propio registro del tenant: se ve a sí mismo y solo a sí mismo.
ALTER TABLE core.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenants FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.tenants
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (id = core.current_tenant_id())
    WITH CHECK (id = core.current_tenant_id());

CREATE POLICY tenant_self ON core.tenants
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (id = core.current_tenant_id());

-- INSERT de tenants: solo el flujo de provisioning (§7). No hay política:
-- el rol de aplicación no puede crear tenants.

-- ── core.companies ──────────────────────────────────────────
-- Plantilla A sobre tenant_id.

-- ── core.warehouses ─────────────────────────────────────────
-- Plantilla B, con can_access_warehouse(id) — el almacén ES la fila.
ALTER TABLE core.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.warehouses FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.warehouses
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON core.warehouses
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(id))
    WITH CHECK (core.can_access_warehouse(id));

-- ── core.users ──────────────────────────────────────────────
-- Plantilla A. La restricción de "solo puedo editar mi propio perfil"
-- es autorización de aplicación, no RLS.

-- ── core.user_warehouse_access ──────────────────────────────
-- ⚠ Plantilla A y NADA MÁS. Su política NO debe llamar a
-- can_access_warehouse() ni a accessible_warehouse_ids(): sería recursión.
-- Quién puede conceder accesos se decide en la capa de aplicación.
ALTER TABLE core.user_warehouse_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.user_warehouse_access FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.user_warehouse_access
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.user_warehouse_access
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- ── core.roles ──────────────────────────────────────────────
-- Caso especial: los roles de sistema tienen tenant_id NULL y son
-- visibles para todos, así que la restrictiva debe admitir ese NULL.
ALTER TABLE core.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.roles FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.roles
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id IS NULL OR tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());  -- no se crean roles de sistema

CREATE POLICY roles_read ON core.roles
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id IS NULL OR tenant_id = core.current_tenant_id());

CREATE POLICY roles_write ON core.roles
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
```

### 5.2 Schemas `inventory`, `ai`, `devices`, `integrations`, `spatial`

| Tabla | Plantilla |
|-------|-----------|
| `inventory.products` | A |
| `inventory.stock_records` | B (`warehouse_id`) |
| `inventory.counts` | B (`warehouse_id`) |
| `inventory.adjustments` | B (`warehouse_id`) |
| `inventory.incidents` | B (`warehouse_id`) |
| `ai.models`, `ai.datasets`, `ai.training_jobs` | A |
| `ai.inferences` | B si lleva `warehouse_id`, A si no |
| `devices.*` | B (todas llevan `warehouse_id`) |
| `integrations.connectors`, `integrations.sync_jobs`, `integrations.mappings` | A |
| `spatial.floor_plans`, `spatial.plan_locations` | B (`warehouse_id`) |

> **Nomenclatura:** `ARCHITECTURE.md:762` dice `sync_logs` y la v1.0 de este documento decía `sync_jobs`. Se fija **`integrations.sync_jobs`** como nombre canónico; `ARCHITECTURE.md` debe corregirse.

### 5.3 Tablas globales en `public`

`MULTITENANT.md:320-330` las declara «exentas de multi-tenancy». Exentas de *tenancy* sí, exentas de *RLS* no: una tabla en `public` sin RLS queda expuesta a escritura vía PostgREST y la marca el security advisor de Supabase.

```sql
-- Patrón para public.countries, public.currencies, public.timezones,
-- public.announcements
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_read ON public.countries
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

-- Sin políticas de escritura + revocación de privilegios: doble cierre.
REVOKE INSERT, UPDATE, DELETE ON public.countries FROM authenticated, anon, olo_app;
```

`public.system_config` no lleva política de lectura: es solo para el rol de plataforma.

### 5.4 Schema `audit` — append-only

```sql
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON audit.events
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY audit_read ON audit.events
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());

-- Solo el backend escribe auditoría; el frontend nunca.
CREATE POLICY audit_append ON audit.events
    AS PERMISSIVE FOR INSERT TO olo_app
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Sin políticas UPDATE/DELETE, más revocación de privilegios de tabla.
REVOKE UPDATE, DELETE ON audit.events FROM authenticated, olo_app;
```

**Alcance honesto de esta inmutabilidad:** protege contra `authenticated` y `olo_app`, que son los roles de la aplicación. No protege contra `postgres` ni `service_role`, que tienen `BYPASSRLS`. La inmutabilidad real frente a esos roles exige que sus claves no estén al alcance del código de aplicación, más archivado externo con verificación de integridad. Documentarlo como «imposible de modificar» sin esta salvedad sería falso.

> `SECURITY.md:483-488` hace `REVOKE`/`GRANT` sobre `api_user`, `service_user`, `audit_reader` y `audit_writer`. Esos roles no existen en Supabase ni se crean en ningún documento. Hay que reemplazarlos por los roles reales de §2.1.

---

## 6. VISTAS Y AGREGADOS

### 6.1 Las vistas materializadas no admiten RLS

`ALTER MATERIALIZED VIEW ... ENABLE ROW LEVEL SECURITY` **no existe en PostgreSQL**, y `CREATE POLICY` exige una tabla. El bloque correspondiente de la v1.0 fallaba al ejecutarse. El patrón correcto es dejar la matview fuera del alcance de la API y exponerla filtrada:

```sql
-- 1. Schema privado, nunca expuesto a PostgREST
CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM authenticated, anon, olo_app;

-- 2. La matview vive ahí
CREATE MATERIALIZED VIEW internal.stock_summary AS
SELECT tenant_id, warehouse_id, product_id,
       SUM(quantity)   AS total_quantity,
       COUNT(*)        AS location_count,
       MAX(updated_at) AS last_updated
FROM inventory.stock_records
WHERE deleted_at IS NULL
GROUP BY tenant_id, warehouse_id, product_id;

-- Índice único: requisito de REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX idx_stock_summary_key
    ON internal.stock_summary (tenant_id, warehouse_id, product_id);

-- 3. Acceso a través de una vista que lleva el filtro dentro
--
-- Aquí security_invoker se deja en FALSE a propósito (el default).
-- Con security_invoker = true el consultante necesitaría SELECT sobre
-- internal.stock_summary, que acabamos de revocar, y la vista fallaría.
-- Lo que protege los datos es la cláusula WHERE: current_tenant_id() lee
-- ajustes de sesión, así que resuelve al tenant de QUIEN CONSULTA,
-- no al del propietario de la vista.
CREATE VIEW inventory.stock_summary AS
SELECT * FROM internal.stock_summary
WHERE tenant_id = core.current_tenant_id()
  AND core.can_access_warehouse(warehouse_id);

GRANT SELECT ON inventory.stock_summary TO authenticated, olo_app;
```

El refresco es una tarea programada que corre como `postgres`:
`REFRESH MATERIALIZED VIEW CONCURRENTLY internal.stock_summary;`

### 6.2 Exposición de schemas a PostgREST

Los schemas propios **no** son accesibles por la API de Supabase por defecto. Sin este paso, el frontend recibe 404 en todo. Se declara en `supabase/config.toml`:

```toml
[api]
schemas = ["public", "core", "inventory", "ai", "devices", "integrations", "spatial", "audit"]
extra_search_path = ["public", "extensions"]
```

`internal` y `platform` quedan fuera deliberadamente.

---

## 7. OPERACIONES CROSS-TENANT

Las funciones de plataforma son el único punto donde se cruza la frontera de tenant. Cada una es `SECURITY DEFINER`, con `search_path` fijado, revocada de `PUBLIC`, y **la autorización se comprueba dentro de la función**, no en la capa que la llama.

```sql
CREATE OR REPLACE FUNCTION platform.get_metrics()
RETURNS TABLE (total_tenants int, total_users int, total_warehouses int, inferences_today int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- La verificación va AQUÍ. Confiar en que el llamante ya validó
    -- es exactamente el fallo que convierte esto en una fuga cross-tenant.
    IF COALESCE(
         (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
         false
       ) IS NOT TRUE THEN
        RAISE EXCEPTION 'forbidden: platform admin required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT (SELECT COUNT(*)::int FROM core.tenants    WHERE status = 'active'),
           (SELECT COUNT(*)::int FROM core.users      WHERE status = 'active'),
           (SELECT COUNT(*)::int FROM core.warehouses WHERE status = 'active'),
           (SELECT COUNT(*)::int FROM ai.inferences   WHERE created_at >= CURRENT_DATE);
END;
$$;

REVOKE EXECUTE ON FUNCTION platform.get_metrics() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION platform.get_metrics() TO authenticated;
```

El **provisioning de tenants** (`MULTITENANT.md:410-465`) y la **impersonación de soporte** (`MULTITENANT.md:569-593`) siguen el mismo patrón. La impersonación se implementa emitiendo un token con `tenant_id` del objetivo y `is_impersonated: true`: no requiere ningún bypass de RLS, y por eso es auditable.

---

## 8. INTEGRIDAD DEL `tenant_id`

```sql
-- IS DISTINCT FROM, no !=.
-- Con `!=`, si alguno de los dos lados fuese NULL la comparación da NULL,
-- el IF no entra y el cambio de tenant pasaría sin excepción.
CREATE OR REPLACE FUNCTION core.prevent_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'cannot change tenant_id of existing record (% -> %)',
            OLD.tenant_id, NEW.tenant_id
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
```

---

## 9. CONTEXTO DESDE LA APLICACIÓN

### 9.1 Cómo NO hacerlo

`MULTITENANT.md:212-218` tiene tres defectos en cuatro líneas:

```python
# ❌ MAL — no usar
await session.execute(
    text(f"SET LOCAL app.current_tenant = '{context.tenant_id.value}'")
)
```

1. **Interpolación de f-string en SQL crudo.** Inyección si `tenant_id` no está validado como UUID.
2. **`SET LOCAL` fuera de una transacción es un no-op silencioso.** Emite un warning y no falla: el resultado es RLS con contexto `NULL`, que deniega todo y produce un bug intermitente muy difícil de diagnosticar.
3. **Devuelve la sesión sin garantizar que la transacción siga abierta**, de modo que el ajuste puede haberse perdido antes de la primera query real.

### 9.2 Cómo hacerlo

```python
from sqlalchemy import text

CONTEXT_SQL = text("""
    SELECT set_config('app.current_tenant',      :tenant_id,   true),
           set_config('app.current_user',        :user_id,     true),
           set_config('app.current_auth_id',     :auth_id,     true),
           set_config('app.tenant_wide_access',  :tenant_wide, true)
""")


async def get_tenant_session(
    context: TenantContext = Depends(get_tenant_context),
    session: AsyncSession   = Depends(get_raw_session),
):
    # Transacción explícita: sin ella el contexto no persiste.
    async with session.begin():
        # set_config con parámetros ligados: sin interpolación de strings.
        # El tercer argumento true ⇒ is_local ⇒ el ajuste muere con la
        # transacción, así que no se filtra a la siguiente request que
        # reutilice la conexión del pool.
        await session.execute(CONTEXT_SQL, {
            "tenant_id":   str(context.tenant_id),
            "user_id":     str(context.user_id),
            "auth_id":     str(context.auth_id),
            "tenant_wide": "true" if context.tenant_wide_access else "false",
        })
        yield session
```

**Compatibilidad con el pooler.** `is_local = true` hace que el ajuste tenga alcance de transacción, no de sesión, así que este patrón es seguro con el pooler de Supabase en modo *transaction* (puerto 6543). La condición es que **toda** query del request corra dentro de esa misma transacción. Un `SET` a nivel de sesión sí sería inseguro ahí: se filtraría entre tenants a través de conexiones reutilizadas del pool.

---

## 10. TESTING DE AISLAMIENTO

### 10.1 Precondiciones que invalidan la suite si se ignoran

Los tests de la v1.0 habrían pasado sin detectar ninguno de los cinco fallos críticos. Dos causas:

1. **Conectarse como `postgres` o `service_role`.** Ambos tienen `BYPASSRLS`: los tests pasan porque no hay RLS, no porque funcione. La suite **debe** conectarse como `olo_app`.
2. **No comprobar el caso positivo.** «Tenant B no ve nada» pasa también cuando la política deniega todo por estar mal escrita. Cada test de aislamiento necesita su aserción gemela de que el acceso legítimo **sí** funciona.

```python
import pytest
from sqlalchemy import text

# La suite corre sobre esta conexión, no sobre la de migraciones.
pytestmark = pytest.mark.usefixtures("olo_app_session")


async def set_context(session, *, tenant_id, user_id=None, tenant_wide=False):
    await session.execute(
        text("""SELECT set_config('app.current_tenant',     :t, true),
                       set_config('app.current_user',       :u, true),
                       set_config('app.tenant_wide_access', :w, true)"""),
        {"t": str(tenant_id) if tenant_id else "",
         "u": str(user_id) if user_id else "",
         "w": "true" if tenant_wide else "false"},
    )


class TestTenantIsolation:

    async def test_cross_tenant_select_blocked(self, session, two_tenants):
        """Tenant A no ve productos de Tenant B — y sí ve los propios."""
        a, b = two_tenants
        async with session.begin():
            await set_context(session, tenant_id=a.id)
            rows = (await session.execute(
                text("SELECT tenant_id FROM inventory.products"))).fetchall()

            assert len(rows) > 0, "el acceso legítimo también debe funcionar"
            assert all(r.tenant_id == a.id for r in rows)

    async def test_insert_foreign_tenant_blocked(self, session, two_tenants):
        a, b = two_tenants
        async with session.begin():
            await set_context(session, tenant_id=a.id)
            with pytest.raises(Exception):  # 42501 violación de WITH CHECK
                await session.execute(
                    text("""INSERT INTO inventory.products (tenant_id, sku, name)
                            VALUES (:t, 'HACK', 'x')"""), {"t": str(b.id)})

    async def test_update_cross_tenant_affects_zero_rows(self, session, two_tenants):
        a, b = two_tenants
        async with session.begin():
            await set_context(session, tenant_id=a.id)
            res = await session.execute(
                text("UPDATE inventory.products SET name='HACKED' WHERE tenant_id=:t"),
                {"t": str(b.id)})
            assert res.rowcount == 0

    async def test_no_context_denies_everything(self, session):
        """Contexto vacío ⇒ cero filas. Fail secure."""
        async with session.begin():
            await set_context(session, tenant_id=None)
            rows = (await session.execute(
                text("SELECT 1 FROM inventory.products"))).fetchall()
            assert rows == []


class TestWarehouseScope:
    """El bug que la v1.0 no detectaba: estos tests fallan contra la v1.0."""

    async def test_warehouse_scope_actually_restricts(self, session, tenant_with_two_warehouses):
        t, wh1, wh2, user = tenant_with_two_warehouses   # user solo tiene wh1
        async with session.begin():
            await set_context(session, tenant_id=t.id, user_id=user.id, tenant_wide=False)
            rows = (await session.execute(
                text("SELECT warehouse_id FROM inventory.stock_records"))).fetchall()

            assert len(rows) > 0,                       "debe ver el stock de wh1"
            assert all(r.warehouse_id == wh1.id for r in rows), "no debe ver wh2"

    async def test_zero_assignments_grants_nothing(self, session, tenant_with_two_warehouses):
        """Sin almacenes asignados ⇒ nada. NUNCA acceso total (escalada v1.0)."""
        t, wh1, wh2, _ = tenant_with_two_warehouses
        orphan = await create_user_without_warehouses(session, t.id)
        async with session.begin():
            await set_context(session, tenant_id=t.id, user_id=orphan.id, tenant_wide=False)
            rows = (await session.execute(
                text("SELECT 1 FROM inventory.stock_records"))).fetchall()
            assert rows == []

    async def test_tenant_wide_access_sees_all(self, session, tenant_with_two_warehouses):
        t, wh1, wh2, user = tenant_with_two_warehouses
        async with session.begin():
            await set_context(session, tenant_id=t.id, user_id=user.id, tenant_wide=True)
            seen = {r.warehouse_id for r in (await session.execute(
                text("SELECT warehouse_id FROM inventory.stock_records"))).fetchall()}
            assert seen == {wh1.id, wh2.id}


class TestSoftDeleteIsNotSecurity:
    async def test_deleted_rows_readable_for_audit(self, session, tenant_with_deleted_product):
        """Un registro borrado sigue siendo legible en la tabla base."""
        t, deleted_id = tenant_with_deleted_product
        async with session.begin():
            await set_context(session, tenant_id=t.id, tenant_wide=True)
            row = (await session.execute(
                text("SELECT deleted_at FROM inventory.products WHERE id=:i"),
                {"i": str(deleted_id)})).fetchone()
            assert row is not None and row.deleted_at is not None

    async def test_active_view_hides_deleted(self, session, tenant_with_deleted_product):
        t, deleted_id = tenant_with_deleted_product
        async with session.begin():
            await set_context(session, tenant_id=t.id, tenant_wide=True)
            row = (await session.execute(
                text("SELECT 1 FROM inventory.products_active WHERE id=:i"),
                {"i": str(deleted_id)})).fetchone()
            assert row is None
```

### 10.2 Checklist por tabla nueva

- [ ] `ENABLE ROW LEVEL SECURITY`
- [ ] `FORCE ROW LEVEL SECURITY`
- [ ] Política `tenant_isolation` **`AS RESTRICTIVE`** con `USING` y `WITH CHECK`
- [ ] Exactamente una política permisiva de scope (plantilla A o B)
- [ ] Cláusula `TO` explícita (`authenticated, olo_app`) — nunca sin ella
- [ ] Trigger `prevent_tenant_change`
- [ ] Trigger `set_updated_at`
- [ ] Índice con `tenant_id` como primera columna
- [ ] Test de aislamiento **y** su gemelo de acceso legítimo
- [ ] `EXPLAIN ANALYZE` verificado: Index Scan, no Seq Scan
- [ ] La suite corre como `olo_app`, no como `postgres`

---

## 11. VERIFICACIÓN AUTOMÁTICA

Estas cuatro consultas corren en CI tras cada migración. **Cualquier fila devuelta hace fallar el build.** La v1.0 solo revisaba 5 de los 9 schemas, así que no habría visto nada de `devices`, `spatial`, `platform` ni `public`.

```sql
-- A. Tablas sin RLS habilitado
SELECT n.nspname, c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations',
                    'spatial','audit','platform','public')
  AND NOT c.relrowsecurity;

-- B. Tablas con RLS pero sin FORCE (el owner las bypasearía)
SELECT n.nspname, c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND c.relrowsecurity AND NOT c.relforcerowsecurity;

-- C. Tablas con tenant_id sin política RESTRICTIVE
--    (el piso duro de §4.1 falta ⇒ el aislamiento es ampliable con OR)
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                   AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind = 'r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polpermissive IS FALSE);

-- D. tenant_id sin índice que lo tenga como primera columna
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                   AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind = 'r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum);
```

A esto se suma el **security advisor de Supabase** (`supabase db lint`), que detecta `function_search_path_mutable`, `rls_disabled_in_public` y `security_definer_view`. Debe salir limpio.

---

## 12. REGISTRO DE CAMBIOS v1.0 → v2.0

| # | Sev. | Defecto en la v1.0 | Corrección |
|---|------|--------------------|------------|
| 1 | Crítico | «`service_role` → RLS aplica». Falso: tiene `BYPASSRLS`, el backend anulaba todo el aislamiento. | Rol `olo_app` sin `BYPASSRLS` (§2.1) + `FORCE RLS` en toda tabla. |
| 2 | Crítico | Dos políticas permisivas por tabla, combinadas con `OR` ⇒ el scope de almacén nunca aplicaba en 5 tablas. | `tenant_isolation` pasa a `AS RESTRICTIVE`; una sola permisiva de scope (§4.1). |
| 3 | Crítico | Contexto solo por GUC ⇒ PostgREST, Realtime y Storage denegaban todo. | Resolución híbrida JWT + GUC (§2.2). |
| 4 | Crítico | Array vacío como centinela de «ve todo» ⇒ usuario sin asignaciones obtenía el tenant completo. Y `current_warehouse_ids()` devolvía `NULL`, no array vacío, así que el centinela nunca coincidía. | `has_tenant_wide_access()` booleano explícito, default `false`; `accessible_warehouse_ids()` con `COALESCE` a array vacío (§2.3). |
| 5 | Crítico | RLS sobre vista materializada: PostgreSQL no lo soporta, el SQL fallaba. | Matview en schema `internal` + vista con filtro (§6.1). |
| 6 | Alto | `SET LOCAL` con f-string, sin transacción, sin considerar el pooler. | `set_config` con parámetros ligados dentro de transacción explícita (§9.2). |
| 7 | Alto | Helpers `SECURITY DEFINER` sin `search_path` fijado. | `LANGUAGE sql STABLE SET search_path = ''` sin `SECURITY DEFINER`, salvo la excepción justificada (§2.2). |
| 8 | Alto | `warehouse_ids` y `permissions` en el JWT: revocación diferida y bloat. | Fuera del token; el scope se lee de la BD (§3). |
| 9 | Medio | Soft-delete implementado como política RLS: no funcionaba y bloqueaba la auditoría. | Fuera de RLS, vía vista `*_active` con `security_invoker` (§4.4). |
| 10 | Medio | Sin cláusula `TO` ⇒ políticas aplicadas a roles no previstos. | `TO authenticated, olo_app` en todas. |
| 11 | Medio | `prevent_tenant_change` con `!=`: con `NULL` no lanzaba excepción. | `IS DISTINCT FROM` (§8). |
| 12 | Medio | Query de verificación limitada a 5 schemas. | Cuatro consultas sobre los 9 schemas (§11). |
| 13 | Medio | Tablas de `public` declaradas exentas de RLS. | RLS con política de solo lectura (§5.3). |
| 14 | Medio | Schemas propios no expuestos a PostgREST: el frontend habría recibido 404 en todo. | `config.toml` con la lista explícita (§6.2). |
| 15 | Medio | Tests que pasaban contra una base sin aislamiento real. | Suite como `olo_app`, con aserción gemela de acceso legítimo (§10.1). |
| 16 | Bajo | `core.users.id` confundido con `auth.uid()`. | `current_auth_id()` y `current_user_id()` separadas (§2.2). |
| 17 | Bajo | `sync_logs` vs `sync_jobs` sin resolver. | Canónico `integrations.sync_jobs` (§5.2). |

### Cambios pendientes en otros documentos

- `ARCHITECTURE.md:367` (`service_role`), `:762` (`sync_logs`), `:788` (Alembic → Supabase CLI), `:736` (5 schemas → 8 + `internal`).
- `SECURITY.md:83-84` (sacar `warehouse_ids` y `permissions` del JWT), `:94-107` (la política de contraseñas no la soporta Supabase Auth), `:483-488` (roles de Postgres inexistentes).
- `MULTITENANT.md:212-218` (el patrón de `SET LOCAL`), `:278` (el Nivel 3 ahora sí se cumple), `:317` (usar el helper, no `current_setting` directo), `:320-330` (las tablas de `public` no están exentas de RLS).

---

*Auditado y reescrito por Claude Code sobre la v1.0 generada por Kiro.*
*Versión: 2.0 — 2026-07-28*
