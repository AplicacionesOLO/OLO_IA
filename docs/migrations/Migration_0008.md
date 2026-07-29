# Migration 0008 — `create_tenant_countries`

**Archivo:** `supabase/migrations/0008_create_tenant_countries.sql` · **Rollback:** `supabase/rollbacks/0008_create_tenant_countries.down.sql` · **Estado: APLICADA Y VERIFICADA** · Riesgo: bajo

## Objetivo

Presencia operativa de un tenant en un país, con su configuración regional. Separa el hecho global (ISO, 0003) del dato del tenant. Padre de `core.companies`.

## Objetos creados

Tabla con 16 columnas. **5 CHECK** (status, version, `jsonb_typeof(fiscal_config)`, patrón de locale). **`UNIQUE (tenant_id, id)`** — redundante en unicidad pero imprescindible como destino de la FK compuesta de 0009. Único parcial `(tenant_id, country_id) WHERE deleted_at IS NULL`. 2 índices. **2 triggers** (`set_updated_at`, `prevent_tenant_change`). RLS T2 con `ENABLE` + `FORCE`, 2 políticas.

**Decisión aplicada a todo el modelo:** `created_by`/`updated_by` son columnas de auditoría UUID **sin FK** a `core.users`. El actor puede ser un platform admin (sin fila en `core.users`) o un usuario purgado por derecho al olvido; la trazabilidad real vive en `audit.events`. Evita además dependencias circulares de orden entre migraciones.

**El timezone no se valida con CHECK:** la única fuente fiable es `pg_timezone_names`, que es una vista no inmutable y por tanto inadmisible en un CHECK. Se valida en la aplicación.

## Pruebas

| # | Prueba | Resultado |
|---|---|---|
| T1 | FK a país inexistente | rechazado |
| T2 | FK a moneda inexistente | rechazado |
| T3 | Mismo `(tenant, país)` dos veces | rechazado |
| T4 | El mismo país en **otro** tenant | permitido |
| T5 | Reactivar el país tras soft delete | permitido |
| T6 | `prevent_tenant_change` | excepción `42501` |
| T7 | CHECK de locale (`ESPANOL`) | rechazado |
| T8 | CHECK `fiscal_config` como array | rechazado |
| T9 | RLS: ve 2 de 3 filas | correcto |
| T10 | Sin contexto | 0 filas |

T4 y T5 son los gemelos que distinguen «restringe bien» de «restringe de más».

## Rollback

`DROP TABLE IF EXISTS` sin `CASCADE`. Verificado: tabla eliminada, `core.tenants` intacta. Reaplicación determinista. `db lint` limpio.

Tiempos: 18,40 s · 1,02 s · 14,27 s.

## Riesgos

| # | Riesgo | Severidad |
|---|---|---|
| 1 | El timezone no tiene validación en base. Un valor inválido se acepta y falla al usarse | Media — validación obligatoria en la capa de aplicación |
| 2 | `created_by`/`updated_by` sin FK: pueden apuntar a un UUID que no existe | Baja — consecuencia aceptada de la decisión |
