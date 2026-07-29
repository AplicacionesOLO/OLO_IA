# Migration 0005 — `create_common_triggers`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0005_create_common_triggers.sql` |
| **Rollback** | `supabase/rollbacks/0005_create_common_triggers.down.sql` |
| **Estado** | **APLICADA Y VERIFICADA** · **Riesgo: medio** |

## Objetivo

Crear las dos funciones de trigger que usan todas las tablas mutables del modelo, antes de la primera tabla, para que cada migración pueda engancharlas.

## Objetos creados

| Función | Uso |
|---|---|
| `core.set_updated_at()` | `BEFORE UPDATE`. Fija `updated_at := now()`. **No toca `version`** |
| `core.prevent_tenant_change()` | `BEFORE UPDATE`. Impide cambiar `tenant_id`, con `IS DISTINCT FROM` |

Ambas `plpgsql` con `SET search_path = ''` y `COMMENT`.

**`core.soft_delete()` NO se crea**, y no es un olvido. Se verificó empíricamente que como `BEFORE UPDATE` marca `deleted_at` en cualquier actualización —renombrar un almacén lo eliminaba— y que como `BEFORE DELETE` no hace nada mientras el borrado físico se ejecuta en silencio. Ninguna de sus dos formas de uso es salvable. Confirmado en el catálogo: `core.soft_delete()` ausente.

**`IS DISTINCT FROM` en lugar de `!=`:** con `!=`, poner `tenant_id` a NULL atraviesa el trigger sin excepción, porque la comparación devuelve NULL y el `IF` no entra. Era un escape de tenant no detectado.

## Pruebas

Ejecutadas dentro de la propia migración sobre una tabla de sonda que el bloque destruye al terminar.

| # | Prueba | Resultado |
|---|---|---|
| T1 | El cliente envía `updated_at='2000-01-01'`; el trigger impone `now()` y no toca `version` | **OK** |
| T2 | Cambiar `tenant_id` a otro valor | **Excepción** `42501` |
| T3 | Cambiar `tenant_id` a **NULL** | **Excepción** `42501` |
| T4 | UPDATE legítimo que no toca `tenant_id` | **Permitido** |

Verificado tras aplicar: 5 funciones en `core`, 0 objetos residuales, `soft_delete` ausente.

## Problema encontrado y corregido

**La migración falló en el primer intento** con `LegacyDbPushApplyError ... At statement: 4`, sin indicar la causa. Reproduciendo el bloque directamente contra la base apareció el motivo:

```
DIAG: before=2026-07-28 22:12:46.533273+00 after=2026-07-28 22:12:46.533273+00 avanzo=f
```

**`now()` devuelve la hora de inicio de la transacción**, así que es constante dentro de ella y `pg_sleep` no la avanza. Mi aserción original comparaba `updated_at` antes y después de un UPDATE en la misma transacción, lo que da siempre el mismo valor y no prueba nada.

Era un **defecto de la prueba, no de la función**. `set_updated_at()` funciona correctamente. Se reescribió T1 para verificar el contrato real: que el trigger **sobrescribe el valor que envíe el cliente**.

Se mantiene `now()` y no `clock_timestamp()`: todas las filas tocadas en una transacción comparten `updated_at`, que es el comportamiento deseable.

La migración falló de forma atómica: solo quedaron las 3 funciones de 0004, ninguna a medias.

## Rollback

`DROP FUNCTION` de ambas más un `DROP TABLE IF EXISTS` de la sonda como red por si la migración se hubiera interrumpido. **Sin `CASCADE`**: si una tabla posterior tuviera un trigger enganchado, el `DROP` falla a propósito — con `CASCADE` se eliminarían esos triggers y las tablas quedarían sin la protección de inmutabilidad de `tenant_id`.

Verificado: quedan solo las 3 funciones de 0004.

## Resultado

Reaplicación determinista: 5 funciones. `db lint` limpio.

Tiempos: 11,18 s · 1,01 s · 8,60 s.

## Riesgos

| # | Riesgo | Severidad |
|---|---|---|
| 1 | `prevent_tenant_change()` no puede engancharse a tablas sin columna `tenant_id`, como `core.tenants`. Hacerlo daría error en tiempo de ejecución | Baja — documentado en cada migración que lo aplique |
| 2 | La CLI oculta el mensaje de error real de PostgreSQL cuando falla un `DO` en una migración. Diagnosticar exige reproducir el bloque a mano | Media — sin mitigación disponible mientras no haya Docker para `db reset` |
