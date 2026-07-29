# Migration 0003 — `create_global_catalogs`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0003_create_global_catalogs.sql` |
| **Rollback** | `supabase/rollbacks/0003_create_global_catalogs.down.sql` |
| **Estado** | **APLICADA Y VERIFICADA** |
| **Riesgo** | Bajo |

## Objetivo

Crear los dos catálogos globales ISO de los que depende `core.tenant_countries` (0008), con la plantilla RLS **T1** y su semilla. Un país y una moneda son hechos del mundo, no datos del tenant: viven en `public` sin `tenant_id`.

Única excepción a la regla R8 del roadmap (ninguna migración crea datos): estos no son datos de negocio, son catálogos ISO.

## Objetos creados

**`public.currencies`** — `code CHAR(3) PK`, `name`, `symbol`, `decimal_places SMALLINT NOT NULL DEFAULT 2`. Dos CHECK: código en mayúsculas con patrón `^[A-Z]{3}$`, y decimales entre 0 y 4.

**`public.countries`** — `id UUID PK`, `iso_code`, `iso_code_3`, `numeric_code`, `name_en`, `name_es`, `phone_code`, `default_currency_code → currencies`, timestamps. Tres CHECK de patrón para los códigos ISO.

**Índices (6):** `currencies_pkey`, `countries_pkey`, `uq_countries_iso2`, `uq_countries_iso3`, `uq_countries_numeric`, `idx_countries_currency`.

Los tres únicos son **totales, no parciales**: este catálogo no tiene soft delete y los códigos ISO no se reutilizan.

**Políticas RLS (2):** `catalog_read` en cada tabla, `PERMISSIVE`, `FOR SELECT`, `TO authenticated, olo_app`, `USING (true)`. Sin políticas de escritura.

**Sin `FORCE ROW LEVEL SECURITY`**, a diferencia de T2 y T3: el propietario debe poder sembrar y mantener el catálogo. Es la distinción deliberada de T1.

**Semilla:** 29 monedas y 37 países.

## Alcance de la semilla

Cubre los mercados operativos —América del Norte, Centroamérica, Caribe, América del Sur— más las principales economías europeas y asiáticas.

Es un **catálogo parcial y deliberado**. Completar el resto de ISO 3166-1 es una migración de datos posterior, no un cambio de modelo. Se prefirió un catálogo parcial con todos los códigos verificados uno a uno a uno completo con códigos numéricos dudosos: un `numeric_code` erróneo en un catálogo de referencia es un defecto silencioso y difícil de detectar después.

La migración incluye una **verificación interna**: aborta si la semilla no alcanza 29 monedas y 37 países.

## Privilegios — el punto crítico de esta migración

En Supabase el schema `public` tiene privilegios por defecto que conceden **DML completo (`arwdDxtm`) a `anon`, `authenticated` y `service_role`** sobre cada tabla nueva. El `REVOKE` no es defensivo aquí, es imprescindible: sin él, cualquier usuario autenticado podría reescribir el catálogo ISO.

Estado verificado tras el `REVOKE` y el `GRANT SELECT`:

| Rol | Privilegios |
|---|---|
| `authenticated` | `SELECT` |
| `olo_app` | `SELECT` |
| `anon` | **ninguno** |
| `PUBLIC` | **ninguno** |

## Pruebas

### Estructura

| # | Verificación | Resultado |
|---|---|---|
| A1 | Semilla | 29 monedas, 37 países |
| A2 | RLS habilitado, `FORCE` desactivado | `rls=t`, `force=f` en ambas |
| A3 | Políticas | `catalog_read`, PERMISSIVE, SELECT, `{authenticated,olo_app}` |
| A4 | Privilegios de tabla | Solo `SELECT`; `anon` y `PUBLIC` sin nada |
| A5 | Índices | Los 6 esperados |
| A6 | Constraints | 5 CHECK, 1 FK, 2 PK |

### Funcionales

Ejecutadas en un bloque `DO` autolimpiable: la excepción final revierte toda la transacción, así que las inserciones de prueba no persisten. Verificado después: 0 filas basura.

| # | Prueba | Resultado |
|---|---|---|
| F1 | `authenticated` puede leer | **OK** |
| F2 | `authenticated` intenta escribir | **DENEGADA** |
| F3 | `anon` intenta leer | **DENEGADA** |
| F4 | Código de moneda en minúsculas | **RECHAZADO** por CHECK |
| F5 | `numeric_code` no numérico | **RECHAZADO** por CHECK |
| F6 | FK a moneda inexistente | **RECHAZADO** |
| F7 | `iso_code` duplicado (`CR`) | **RECHAZADO** por índice único |

### Rendimiento

| Consulta | Plan | Tiempo |
|---|---|---|
| `WHERE iso_code='CR'` | `Index Scan using uq_countries_iso2` | 0,111 ms |
| Join `countries`↔`currencies`, 3 países | `Bitmap Index Scan` + `Index Scan using currencies_pkey` | 0,175 ms |

Sin `Seq Scan`. Con 37 filas el planner podría haber elegido escaneo secuencial legítimamente; que use los índices confirma que son utilizables.

### Lint

`db lint` sobre los cinco schemas: **`No schema errors found`**. En particular, sin `rls_disabled_in_public`, que es el hallazgo que se produciría si estas tablas no tuvieran RLS.

## Rollback

```sql
DROP TABLE IF EXISTS public.countries;
DROP TABLE IF EXISTS public.currencies;
```

`countries` primero, porque tiene la FK hacia `currencies`. Sin `CASCADE`: cuando 0008 cree `core.tenant_countries` con una FK hacia `countries`, este `DROP` **fallará a propósito**, porque revertir 0003 con 0008 aplicada destruiría datos de tenant.

| # | Verificación tras el rollback | Resultado |
|---|---|---|
| R1 | Tablas eliminadas | `(ninguna)` |
| R2 | Políticas e índices eliminados en cascada | 0 y 0 |
| R3 | Objetos de 0001 y 0002 intactos | 4 schemas, `olo_app` presente |

## Resultado

**Reaplicación determinista.** Semilla idéntica (29/37), 2 políticas, 6 índices, privilegios de nuevo solo `SELECT`, 0 países con moneda inválida. Historial con 3 versiones, sin duplicados.

La semilla es idempotente por `ON CONFLICT DO NOTHING`, requisito para que la reaplicación no falle por claves duplicadas.

Muestra verificada con caracteres no ASCII intactos: `CR/CRI/188 Costa Rica +506 CRC ₡ 2`, `ES/ESP/724 España +34 EUR € 2`, `JP/JPN/392 Japón +81 JPY ¥ 0`, `CL/CHL/152 Chile +56 CLP $ 0`.

Tiempos: aplicación 12,23 s · rollback 2,04 s · reaplicación 12,33 s.

## Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | Catálogo ISO incompleto: 37 de 249 países. Un tenant que opere fuera de esos mercados no podrá registrar su país | Media | **Aceptado y documentado.** Se amplía con una migración de datos, sin tocar el modelo |
| 2 | El default ACL de `public` volverá a conceder DML completo a `anon`/`authenticated` en **cada tabla nueva** que se cree en ese schema. Toda migración futura que añada una tabla a `public` debe repetir el `REVOKE` | **Media** | **Abierto.** Mitigación disponible: no crear más tablas en `public`. El modelo ya lo prevé — todo lo demás va a `core`, `audit`, `inventory`, etc. |
| 3 | `decimal_places` no se usa todavía en ninguna lógica. Si el frontend formatea por su cuenta, aparecerán discrepancias con CLP, JPY, KRW y PYG (0 decimales) | Baja | Documentado para el módulo de UI |

## Orden obligatorio

Los nueve pasos cumplidos.
