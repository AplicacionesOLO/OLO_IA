# OLO_IA — GUÍA DE IMPLEMENTACIÓN DE RLS

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato. Vinculante.
> **Sustituye a** `RLS_STRATEGY.md` v2.0 como referencia de implementación. `RLS_STRATEGY.md` queda como documentación arquitectónica.
> **Contiene contratos, no código definitivo.** Los ejemplos son plantillas para las migraciones.

---

## 1. LOS TRES LÍMITES DE RLS

Antes de cualquier plantilla, porque condicionan el diseño entero:

1. **`BYPASSRLS` ignora todas las políticas.** `service_role` lo tiene. Contra esto no hay defensa técnica: la compensación es no poner esa credencial al alcance del código de aplicación y auditar cada uso en `platform.privileged_operation_log`.
2. **El propietario de la tabla ignora las políticas** salvo `FORCE ROW LEVEL SECURITY`. Por eso toda tabla de negocio lo lleva, y `olo_app` no es propietario de ninguna.
3. **RLS filtra filas; no valida el contexto.** Si la aplicación fija el tenant equivocado, RLS obedece. La corrección del contexto la garantizan el middleware (§3.5 de `IDENTITY_AND_AUTH_FLOW.md`) y los tests de §7.

---

## 2. LA REGLA ESTRUCTURAL

**PostgreSQL combina las políticas permisivas con `OR`, y las restrictivas con `AND`.**

```
Una fila es visible si y solo si:
    ( alguna política PERMISSIVE la permite )     ← OR entre ellas
  AND
    ( TODAS las políticas RESTRICTIVE la permiten ) ← AND entre ellas
```

De ahí el patrón obligatorio de **dos políticas por tabla**:

- **`tenant_isolation`, `AS RESTRICTIVE`** — el piso duro. Al evaluarse con `AND`, **ninguna política que se añada en el futuro puede ampliarla**. Esta es la propiedad que se busca.
- **`<scope>`, `AS PERMISSIVE`** — la concesión concreta.

Una tabla con solo políticas restrictivas no devuelve nada: hace falta al menos una permisiva.

> **El defecto que esto corrige.** Poner dos políticas *permisivas* —una de tenant y otra de almacén— hace que basta con que el tenant coincida para ver **todos** los almacenes: la restricción de almacén nunca aplica. Era el defecto de `RLS_STRATEGY.md` v1.0 en cinco tablas, e invalidaba el «Nivel 3: Warehouse Isolation» de `MULTITENANT.md`.

---

## 3. FUNCIONES DE CONTEXTO — CONTRATO

Siete funciones. **Toda política se escribe únicamente con estas.** Ninguna política consulta `current_setting` directamente.

```sql
-- ═══════════════════════════════════════════════════════════════
-- Reglas obligatorias para las siete:
--   • SET search_path = ''   SIEMPRE. Sin excepción.
--   • STABLE                 (una evaluación por sentencia, no por fila)
--   • LANGUAGE sql           (inlineable; plpgsql solo si hay control de flujo)
--   • SECURITY DEFINER       SOLO en las tres marcadas, y con motivo
-- ═══════════════════════════════════════════════════════════════

-- (1) Identidad externa. Canal A: auth.uid(). Canal B: GUC.
CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.auth_user_id', true), '')::uuid
  )
$$;

-- (2) Identidad de negocio. SECURITY DEFINER justificado: debe leer
--     core.users sin que la política T4 de core.users —que consulta
--     membresías— entre en recursión.
CREATE OR REPLACE FUNCTION core.current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM core.users u
  WHERE u.auth_id = core.current_auth_id() AND u.deleted_at IS NULL
$$;

-- (3) Tenant activo. Lee request.jwt.claims DIRECTAMENTE, no via auth.jwt():
--     comportamiento idéntico en Supabase y portable a PostgreSQL sin
--     schema auth, lo que permite ejecutar la suite sin el stack completo.
--     Precedencia verificada: JWT gana al GUC.
CREATE OR REPLACE FUNCTION core.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
           -> 'app_metadata' ->> 'tenant_id', ''),
    NULLIF(current_setting('app.tenant_id', true), '')
  )::uuid
$$;

-- (4) Puerta de fail-secure. SECURITY DEFINER: lee memberships, cuya
--     política T6 no debe depender de esta función.
CREATE OR REPLACE FUNCTION core.has_active_membership()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.tenant_memberships m
    WHERE m.tenant_id  = core.current_tenant_id()
      AND m.user_id    = core.current_user_id()
      AND m.revoked_at IS NULL
      AND m.status     = 'active'
  )
$$;

-- (5) Acceso amplio, EXPLÍCITO. Default false: fail-secure.
--     Nunca se infiere de una lista vacía de almacenes.
CREATE OR REPLACE FUNCTION core.has_tenant_wide_access()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
     -> 'app_metadata' ->> 'tenant_wide_access')::boolean,
    NULLIF(current_setting('app.tenant_wide_access', true), '')::boolean,
    false
  )
$$;

-- (6) Almacenes accesibles, leídos de la BD y no del JWT:
--     revocación inmediata y sin bloat de token.
--     COALESCE garantiza array vacío y NUNCA NULL: con NULL,
--     `x = ANY(NULL)` es NULL y la política queda indefinida.
CREATE OR REPLACE FUNCTION core.accessible_warehouse_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(uwa.warehouse_id), ARRAY[]::uuid[])
  FROM core.user_warehouse_access uwa
  WHERE uwa.tenant_id  = core.current_tenant_id()
    AND uwa.user_id    = core.current_user_id()
    AND uwa.revoked_at IS NULL
$$;

-- (7) Predicado único de scope de almacén. Tener la lógica en un solo
--     sitio es lo que evita que 16 tablas divergan con el tiempo.
CREATE OR REPLACE FUNCTION core.can_access_warehouse(p_warehouse_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT core.current_tenant_id() IS NOT NULL
     AND core.has_active_membership()
     AND (
          core.has_tenant_wide_access()
       OR p_warehouse_id = ANY (core.accessible_warehouse_ids())
     )
$$;
```

**Índice obligatorio que sostiene (6):**
```sql
CREATE INDEX idx_uwa_lookup ON core.user_warehouse_access (tenant_id, user_id)
    WHERE revoked_at IS NULL;
```

---

## 4. LAS SIETE PLANTILLAS

### T0 — Sin RLS, schema no expuesto

Para `platform.*` e `internal.*`. La protección es que PostgREST no expone el schema y solo `service_role` lo alcanza.

```sql
CREATE SCHEMA platform;
REVOKE ALL ON SCHEMA platform FROM anon, authenticated, olo_app;
-- Sin ENABLE ROW LEVEL SECURITY: no hay rol de aplicación que llegue.
```

**Verificación:** una petición REST a un recurso de `platform` devuelve 404.

---

### T1 — Catálogo global de solo lectura

Para `public.countries`, `public.currencies`, `core.permissions`, `ai.engines`, `integrations.connector_types`.

Sin `tenant_id`, pero **con RLS**: una tabla en `public` sin RLS queda expuesta a escritura vía PostgREST y la marca el linter (`rls_disabled_in_public`).

```sql
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_read ON public.countries
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

-- Doble cierre: sin políticas de escritura Y sin privilegio de escritura.
REVOKE INSERT, UPDATE, DELETE ON public.countries FROM authenticated, anon, olo_app;
```

No lleva `FORCE`: no hay nada que aislar y el propietario debe poder sembrarlo.

---

### T2 — Tenant-scoped

La plantilla por defecto. Para toda tabla de negocio con `tenant_id` y sin `warehouse_id`.

```sql
ALTER TABLE inventory.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.products FORCE  ROW LEVEL SECURITY;

-- Piso duro. Se evalúa con AND contra todo lo demás.
CREATE POLICY tenant_isolation ON inventory.products
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Concesión. La condición se repite a propósito: redundante frente a la
-- restrictiva, pero deja la política legible por sí sola. Y añade la
-- puerta de membresía, que la restrictiva no cubre.
CREATE POLICY tenant_members ON inventory.products
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id() AND core.has_active_membership())
    WITH CHECK (tenant_id = core.current_tenant_id() AND core.has_active_membership());
```

**Nunca omitir la cláusula `TO`.** Sin ella la política aplica a roles no previstos.

---

### T3 — Warehouse-scoped

Para toda tabla con `warehouse_id`. Aquí la restricción de almacén **sí restringe**, porque `warehouse_scope` es la única permisiva y la restrictiva le pone el piso de tenant.

```sql
ALTER TABLE inventory.balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.balances FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inventory.balances
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON inventory.balances
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));
```

Aplican T3: `core.warehouses` (sobre `id`), `core.areas`, `core.locations`, `balances`, `ledger_entries`, `product_warehouse_settings`, `counts`, `count_items`, `count_observations`, `adjustments`, `adjustment_items`, `incidents`, `connectors`, `devices`, `drone_missions`, `telemetry_points`, `mission_captures`, `floor_plans`, `plan_location_mappings`, `ai.detections`.

---

### T4 — Identidad global (`core.users`)

**La única plantilla a medida.** `core.users` no tiene `tenant_id`, así que no hay piso de tenant posible.

```sql
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users FORCE  ROW LEVEL SECURITY;

-- Piso duro: solo se ve una identidad si es la propia, o si comparte
-- membresía activa conmigo EN EL TENANT ACTUAL.
CREATE POLICY user_visibility ON core.users
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (
        id = core.current_user_id()
        OR EXISTS (
            SELECT 1 FROM core.tenant_memberships m
            WHERE m.user_id    = core.users.id
              AND m.tenant_id  = core.current_tenant_id()
              AND m.revoked_at IS NULL
        )
    )
    WITH CHECK (id = core.current_user_id());   -- solo edito mi propia fila

CREATE POLICY user_read ON core.users
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (core.current_user_id() IS NOT NULL);

CREATE POLICY user_self_update ON core.users
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app
    USING      (id = core.current_user_id())
    WITH CHECK (id = core.current_user_id());
```

**Sin política de INSERT ni DELETE.** Crear y eliminar identidades es operación de plataforma: pasa por RPC con `service_role` y queda en `privileged_operation_log`.

> **⚠ Riesgo de recursión.** El `EXISTS` sobre `tenant_memberships` obliga a que la política de esa tabla (T6) **no consulte `core.users`**. Si lo hiciera, cada evaluación se llamaría en bucle. Es un test obligatorio (§7.4), no una advertencia.

---

### T5 — Append-only auditado (`audit.events`)

```sql
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON audit.events
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY audit_read ON audit.events
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id() AND core.has_active_membership());

-- Solo el backend escribe auditoría; el frontend nunca.
CREATE POLICY audit_append ON audit.events
    AS PERMISSIVE FOR INSERT TO olo_app
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Sin políticas de UPDATE ni DELETE, MÁS revocación de privilegio.
REVOKE UPDATE, DELETE ON audit.events FROM authenticated, olo_app;
```

**Alcance honesto:** protege de `authenticated` y `olo_app`. No de `BYPASSRLS`. Documentarlo como «imposible de modificar» sin esta salvedad sería falso en un documento de compliance.

Mismo patrón para `inventory.ledger_entries`, `inventory.count_observations` y `devices.telemetry_points`, combinado con el piso de almacén de T3.

---

### T6 — Read-model de autorización

Para `core.tenant_memberships`, `core.role_assignments`, `core.user_warehouse_access`.

**Restricción crítica: estas políticas NO invocan `can_access_warehouse()` ni `accessible_warehouse_ids()`.** Esas funciones leen `user_warehouse_access`, así que la política se llamaría a sí misma.

```sql
ALTER TABLE core.user_warehouse_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.user_warehouse_access FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.user_warehouse_access
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Solo tenant_id y user_id. NADA de can_access_warehouse().
CREATE POLICY authz_read ON core.user_warehouse_access
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (
        tenant_id = core.current_tenant_id()
        AND (user_id = core.current_user_id() OR core.has_tenant_wide_access())
    );
```

La escritura la hace el servicio de autorización dentro de la transacción de la asignación de rol; no hay política de escritura para `authenticated`.

---

## 5. SOFT DELETE — FUERA DE RLS

RLS es seguridad; el soft delete es negocio. Mezclarlos hace imposible leer un registro borrado para auditarlo o restaurarlo.

```sql
-- Vista de conveniencia para el camino de lectura habitual.
-- security_invoker = true: la vista NO concede más de lo que ya tiene
-- quien la consulta. Es lo correcto aquí.
CREATE VIEW inventory.products_active
WITH (security_invoker = true) AS
SELECT * FROM inventory.products WHERE deleted_at IS NULL;

CREATE INDEX idx_products_active ON inventory.products (tenant_id, sku)
    WHERE deleted_at IS NULL;
```

---

## 6. VISTAS MATERIALIZADAS

**PostgreSQL no admite RLS sobre vistas materializadas.** `ALTER MATERIALIZED VIEW ... ENABLE ROW LEVEL SECURITY` no existe y `CREATE POLICY` exige una tabla.

```sql
-- 1. La matview vive en un schema no expuesto
CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM authenticated, anon, olo_app;

CREATE MATERIALIZED VIEW internal.balance_summary AS
SELECT tenant_id, warehouse_id, product_id,
       SUM(quantity) AS total_quantity, COUNT(*) AS location_count,
       MAX(updated_at) AS last_updated
FROM inventory.balances WHERE deleted_at IS NULL
GROUP BY tenant_id, warehouse_id, product_id;

-- Índice único: requisito de REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX idx_bal_summary_key
    ON internal.balance_summary (tenant_id, warehouse_id, product_id);

-- 2. Se accede por una vista con el filtro DENTRO.
--    security_invoker se deja en FALSE (el default) A PROPÓSITO: con true,
--    el consultante necesitaría SELECT sobre internal.balance_summary,
--    que acabamos de revocar. Lo que protege los datos es el WHERE:
--    current_tenant_id() lee ajustes de sesión, así que resuelve al tenant
--    de QUIEN CONSULTA, no al del propietario de la vista.
CREATE VIEW inventory.balance_summary AS
SELECT * FROM internal.balance_summary
WHERE tenant_id = core.current_tenant_id()
  AND core.can_access_warehouse(warehouse_id);

GRANT SELECT ON inventory.balance_summary TO authenticated, olo_app;
```

Refresco: tarea programada como `postgres`, **siempre `CONCURRENTLY`** — sin él toma `ACCESS EXCLUSIVE` y bloquea todas las lecturas del dashboard.

---

## 7. CONTRATO DE PRUEBAS

### 7.1 Dos precondiciones que invalidan la suite

1. **Conectarse como `postgres` o `service_role`.** Ambos tienen `BYPASSRLS`: los tests pasarían porque no hay RLS, no porque funcione. **La suite se conecta como `olo_app`**, y un test permanente verifica `rolbypassrls = false`.
2. **No comprobar el caso positivo.** «Tenant B no ve nada» pasa también cuando la política está mal y deniega todo. **Cada test de denegación necesita su gemelo de acceso legítimo.**

### 7.2 Tests de aislamiento de tenant

| ID | Verifica | Resultado esperado |
|---|---|---|
| RLS-T01 | SELECT cross-tenant | Solo filas propias, **y > 0 filas propias** |
| RLS-T02 | INSERT con `tenant_id` ajeno | `InsufficientPrivilegeError` (verificado) |
| RLS-T03 | UPDATE cross-tenant | `rowcount = 0` |
| RLS-T04 | DELETE cross-tenant | `rowcount = 0` |
| RLS-T05 | Sin contexto | **0 filas** (verificado) |
| RLS-T06 | `tenant_id` inventado | 0 filas |

### 7.3 Tests de scope de almacén

| ID | Verifica | Resultado esperado |
|---|---|---|
| RLS-W01 | Usuario con acceso a WH1 consulta balances | Solo WH1, **y > 0 filas** |
| RLS-W02 | **Usuario con CERO almacenes asignados** | **0 filas.** Nunca acceso total — es la escalada del centinela de array vacío |
| RLS-W03 | `tenant_wide_access = true` | Todos los almacenes del tenant |
| RLS-W04 | `X-Warehouse-Id` de un almacén sin acceso | 403 en el middleware, antes de llegar a la BD |

### 7.4 Tests estructurales — los que faltan en los planes actuales

| ID | Verifica | Por qué |
|---|---|---|
| RLS-S01 | **Anti-recursión:** consultar `core.users` y `tenant_memberships` no entra en bucle | La política T4 consulta memberships. Un cambio futuro que haga lo inverso cuelga el sistema |
| RLS-S02 | **Fuga por pooler:** dos requests de tenants distintos sobre la misma conexión | Verificado que no hay fuga con `is_local=true`. El test lo blinda ante regresiones |
| RLS-S03 | `SET LOCAL` fuera de transacción | Debe resultar en 0 filas, no en acceso |
| RLS-S04 | Añadir una política permisiva de más | **Algún test debe ponerse rojo.** Verifica que la suite puede fallar |
| RLS-S05 | Auditoría: UPDATE y DELETE denegados | Excepción para `authenticated` y `olo_app` |
| RLS-S06 | `prevent_tenant_change` con NULL | Excepción. Con `!=` esto pasa sin error (verificado) |
| RLS-S07 | Soft delete legible en tabla base, oculto en vista `_active` | Confirma la separación de §5 |

### 7.5 Verificación automática en CI

Cuatro consultas. **Cualquier fila devuelta rompe el build.**

```sql
-- A. Tablas sin RLS
SELECT n.nspname, c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations',
                    'spatial','audit','public')
  AND NOT c.relrowsecurity;

-- B. Con RLS pero sin FORCE (el propietario las bypasearía)
SELECT n.nspname, c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind='r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND c.relrowsecurity AND NOT c.relforcerowsecurity;

-- C. Con tenant_id pero SIN política RESTRICTIVE
--    (el piso duro falta ⇒ el aislamiento es ampliable con OR)
SELECT n.nspname, c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id'
                   AND a.attnum>0 AND NOT a.attisdropped
WHERE c.relkind='r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid=c.oid AND p.polpermissive IS FALSE);

-- D. tenant_id sin índice que lo tenga como PRIMERA columna
SELECT n.nspname, c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id'
                   AND a.attnum>0 AND NOT a.attisdropped
WHERE c.relkind='r'
  AND n.nspname IN ('core','inventory','ai','devices','integrations','spatial','audit')
  AND NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid=c.oid AND i.indkey[0]=a.attnum);
```

Más `supabase db lint`, que debe salir limpio de `function_search_path_mutable`, `rls_disabled_in_public` y `security_definer_view`.

---

## 8. CHECKLIST POR TABLA NUEVA

- [ ] `ENABLE ROW LEVEL SECURITY`
- [ ] `FORCE ROW LEVEL SECURITY`
- [ ] Política `tenant_isolation` **`AS RESTRICTIVE`** con `USING` y `WITH CHECK`
- [ ] Exactamente **una** política permisiva de scope (T2 o T3)
- [ ] Cláusula `TO authenticated, olo_app` explícita
- [ ] Trigger `prevent_tenant_change` (`IS DISTINCT FROM`)
- [ ] Trigger `set_updated_at` (que **no** toca `version`)
- [ ] Índice con `tenant_id` como primera columna
- [ ] Si tiene `warehouse_id`: FK compuesta a `warehouses (tenant_id, id)`
- [ ] Clave lógica como índice único **parcial** con `COALESCE` en columnas nulables
- [ ] Test de aislamiento **y su gemelo de acceso legítimo**
- [ ] `EXPLAIN ANALYZE` con ≥ 100.000 filas: `Index Scan`, no `Seq Scan`

> El último punto importa: con 20 filas de semilla el planner elige `Seq Scan` legítimamente, y el criterio falla por razones equivocadas.

---

## 9. RENDIMIENTO

| Aspecto | Estado |
|---|---|
| Funciones `STABLE` | Una evaluación por sentencia, no por fila. Reduce el coste de `accessible_warehouse_ids()` a uno |
| `SECURITY DEFINER` | **Impide el inlining** por el planner. Es el coste real de las tres funciones que lo llevan, y la razón de limitarlas a tres |
| Índice de `accessible_warehouse_ids()` | `(tenant_id, user_id) WHERE revoked_at IS NULL`. Obligatorio |
| `tenant_id` primero | En todo índice de tabla tenant-scoped. Verificado en CI por la consulta D |
| Presupuesto | **Sin medir.** El KPI «< 5 ms de sobrecoste» exige el benchmark de ≥ 100.000 filas. No asumirlo |

---

*Guía de implementación de RLS. Contratos, no migraciones. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
