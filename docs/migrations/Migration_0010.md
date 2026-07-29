# Migration 0010 — `create_users`

**Archivo:** `supabase/migrations/0010_create_users.sql` · **Rollback:** `supabase/rollbacks/0010_create_users.down.sql` · **Estado: APLICADA Y VERIFICADA** · **Riesgo: ALTO**

## Objetivo

Identidad **global** de plataforma (DEC-04). Una persona = una fila, sin importar en cuántos tenants opere. **Esta tabla no lleva `tenant_id`**, y es el cambio de modelo respecto a `DATABASE_DESIGN.md`.

## El motivo técnico que decide el modelo

Supabase Auth impone unicidad **global** de email sobre `auth.users`. Como cada fila de `core.users` se corresponde 1:1 con una de `auth.users` vía `auth_id`, dos filas con el mismo email exigirían dos `auth.users` con el mismo email, que Supabase rechaza.

Es decir: **el email ya era global de hecho.** Un `UNIQUE (tenant_id, email)` habría permitido en la base algo que la capa de autenticación prohíbe, y el fallo aparecería en el registro de GoTrue en lugar de aquí — el peor tipo de constraint.

## Objetos creados

Tabla con 15 columnas. **6 CHECK** (status, version, email en minúsculas con forma mínima, longitud de nombres, patrón de locale, `jsonb_typeof(settings)`). `UNIQUE (auth_id)`. **`uq_users_email (email) WHERE deleted_at IS NULL` — global, no por tenant.** `idx_users_auth_id`, que consumirán el Custom Access Token Hook y `core.current_user_id()`: ambos resuelven por `auth_id` sin conocer el tenant, así que un índice que empiece por `tenant_id` no les serviría.

1 trigger (`set_updated_at`; **no** `prevent_tenant_change`, la tabla no tiene esa columna).

**RLS habilitado y forzado, sin políticas.** No es un hueco: sin políticas, ningún rol de aplicación alcanza la tabla — es fail-secure. La plantilla T4 necesita `core.tenant_memberships` y llega después. `postgres` la alcanza por `BYPASSRLS`, que es lo que permite sembrarla.

**Sin `failed_login_attempts` ni `locked_until`:** Supabase Auth es el dueño de la autenticación y mantener un segundo estado de bloqueo crearía dos fuentes de verdad. Reclasificado a hardening por DEC-09.

La migración verifica explícitamente que **no existe** columna `tenant_id`.

## Pruebas

| # | Prueba | Resultado |
|---|---|---|
| T1 | Email duplicado (global, no por tenant) | rechazado |
| T2 | `auth_id` duplicado | rechazado |
| T3 | CHECK email en mayúsculas | rechazado |
| T4 | Tras soft delete el email se libera | permitido |
| T5 | `authenticated` con `USAGE` y `SELECT` concedidos | **0 filas** — RLS sin políticas deniega |

T5 es la que confirma que el estado intermedio es seguro.

## Rollback

Verificado en dos pasos. Con `tenant_memberships` aplicada, el rollback falla como debe:

```
ERROR 2BP01: cannot drop table core.users because other objects depend on it
DETAIL: constraint tenant_memberships_user_id_fkey depends on it
```

Tras revertir 0011, el rollback de 0010 funciona. `core.companies` quedó intacta. Reaplicación determinista, `db lint` limpio.

Tiempos: 18,45 s · 1,09 s · reaplicación conjunta con 0011 en 19,06 s.

## Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | Mientras no exista la política T4, ningún rol de aplicación puede leer `core.users`. El endpoint `/v1/auth/me` no funcionará hasta entonces | **Media** | Planificado: T4 llega con la migración de políticas |
| 2 | El CHECK de email es una forma mínima (`%_@_%.__%`), no RFC 5322. Valida estructura básica, no direcciones exóticas | Baja | Deliberado: la validación estricta va en Pydantic |
| 3 | `avatar_file_id` sin FK hasta `core.files` (0023) | Baja | Planificado |
