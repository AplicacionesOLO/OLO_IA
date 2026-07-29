# Migration 0007 — `create_tenants`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0007_create_tenants.sql` |
| **Rollback** | `supabase/rollbacks/0007_create_tenants.down.sql` |
| **Estado** | **APLICADA Y VERIFICADA** · **Riesgo: medio** |

## Objetivo

Crear `core.tenants`, raíz de todo el modelo y unidad de aislamiento de datos. Es la primera tabla de negocio del proyecto.

## Objetos creados

**Tabla `core.tenants`** — 13 columnas: `id`, `name`, `slug`, `status`, `plan`, `settings`, `limits`, `trial_ends_at`, `created_at`, `created_by`, `updated_at`, `updated_by`, `version`.

**8 CHECK:** ciclo de vida de `status` (6 valores), `plan` (4 valores), patrón de `slug`, longitud mínima de `name`, `version >= 1`, coherencia temporal de `trial_ends_at`, y `jsonb_typeof(...) = 'object'` para `settings` y `limits` — sin esto, un `'[]'` o un `'"texto"'` pasarían y romperían la lectura de configuración.

**2 índices:** `uq_tenants_slug` (único) e `idx_tenants_status` (parcial, `WHERE status <> 'deleted'`).

**1 trigger:** `set_updated_at_tenants`.

**2 políticas RLS:** `tenant_isolation` RESTRICTIVE `FOR ALL` y `tenant_self` PERMISSIVE `FOR SELECT`, ambas `TO authenticated, olo_app`. `ENABLE` + `FORCE ROW LEVEL SECURITY`.

## Decisiones de diseño

**No lleva `tenant_id`:** el tenant *es* la fila, así que su política T2 se evalúa sobre `id`. Por lo mismo, **no se le engancha `prevent_tenant_change()`**, que lee `NEW.tenant_id` y fallaría en tiempo de ejecución con «record new has no field tenant_id».

**Sin `deleted_at`:** el ciclo de vida usa `status='deleted'` más el período de retención de 90 días.

**`created_by` / `updated_by` sin clave foránea.** Dos razones, y la segunda es la que decide: en el orden del roadmap `core.users` no existe todavía, y el actor que crea un tenant es un platform admin, que por diseño no tiene fila en `core.users` — se identifica por claim del JWT. Una FK a `core.users` sería semánticamente incorrecta, no solo prematura.

**Sin política de INSERT, UPDATE ni DELETE** para roles de aplicación: el ciclo de vida del tenant es una operación de plataforma, vía RPC con `service_role`, que tiene `BYPASSRLS`.

## Pruebas

Verificación estructural dentro de la migración: RLS habilitado y forzado, exactamente 2 políticas, exactamente 1 política RESTRICTIVE, 1 trigger, 8 CHECK.

Once pruebas funcionales en bloque autolimpiable. Los `GRANT` temporales a `authenticated` se revierten con la excepción final, porque en PostgreSQL `GRANT` es transaccional.

| # | Prueba | Resultado |
|---|---|---|
| T1 | El tenant A solo se ve a sí mismo | Vio 1 de 2 |
| T2 | No ve al otro tenant por id directo | 0 filas |
| T3 | Sin contexto | 0 filas |
| T4 | `authenticated` intenta insertar | **Denegado** |
| T5 | `authenticated` intenta actualizar | **0 filas afectadas** |
| T6 | `status` inválido | **CHECK** |
| T7 | `slug` con mayúsculas y guion final | **CHECK** |
| T8 | `settings` como array | **CHECK** |
| T9 | `trial_ends_at` anterior a `created_at` | **CHECK** |
| T10 | `slug` duplicado | **unique_violation** |
| T11 | Trigger impone `updated_at`, `version` intacta | **OK** |

Verificado tras las pruebas: 0 tenants, `authenticated` sin `USAGE`, 0 grants residuales.

**Confirmación relevante:** `olo_app` recibió `DELETE, INSERT, SELECT, UPDATE` sobre `core.tenants` **sin ningún `GRANT` explícito**, por el `ALTER DEFAULT PRIVILEGES` de 0002. Valida esa decisión: no hará falta un GRANT por tabla en cada migración futura.

### Rendimiento

```
Index Scan using uq_tenants_slug on tenants (actual time=0.020..0.026 rows=0)
  Index Cond: ((slug)::text = 'alfa'::text)
Execution Time: 0.110 ms
```

Sin `Seq Scan`.

## Rollback

`DROP TABLE IF EXISTS core.tenants` — se lleva índices, políticas y triggers en cascada. **Sin `CASCADE`**: cuando 0008 cree `core.tenant_countries` con FK hacia aquí, este `DROP` fallará a propósito, porque revertir 0007 con tablas hijas destruiría datos de tenant.

Verificado: tabla eliminada, 5 funciones intactas.

## Resultado

Reaplicación determinista. `db lint` limpio.

Tiempos: 12,35 s · 0,79 s · 11,56 s.

## Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | Las políticas nombran `authenticated`, que aún no tiene `USAGE` sobre `core`. Es preparación inocua: sin `USAGE` el rol no alcanza la tabla | Baja | Por diseño |
| 2 | La política T2 definitiva del contrato incluye `core.has_active_membership()`, que no existirá hasta que haya `tenant_memberships`. La política actual solo comprueba el tenant | **Media** | **Abierto.** Debe completarse en la migración que cree las membresías |
| 3 | `core.tenants` no admite INSERT por ningún rol de aplicación, así que la semilla de desarrollo necesitará `service_role` o `postgres` | Baja | Por diseño |
