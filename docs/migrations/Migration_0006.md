# Migration 0006 — `verify_context_propagation`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0006_verify_context_propagation.sql` |
| **Rollback** | `supabase/rollbacks/0006_verify_context_propagation.down.sql` (no-op por diseño) |
| **Estado** | **APLICADA Y VERIFICADA** · **Riesgo: alto por lo que verifica, nulo por lo que deja** |

## Objetivo

Demostrar que el mecanismo de contexto y RLS funciona por **los dos canales** antes de construir 15 tablas encima. Descubrir aquí que el contexto no llega cuesta una migración; descubrirlo en 0012 cuesta el sprint.

Queda en el historial como prueba fechada de que el mecanismo se validó contra la base real.

## Objetos creados

**Ninguno permanente.** La migración crea una tabla de sonda `core.__context_poc` con el patrón RLS real, la prueba y la destruye.

Verificado tras aplicar: 0 objetos en `core`, 0 políticas en `core`, y `authenticated` **sin** `USAGE` sobre `core` — el permiso temporal se revocó.

## Hallazgos de entorno que condicionaron el diseño

Tres hechos verificados en este proyecto que cambian cómo hay que probar RLS:

1. **`postgres` tiene `BYPASSRLS = true`.** No sirve para probar RLS: lo bypasea todo. Las pruebas se ejecutan como `authenticated`.
2. **`postgres` no puede `SET ROLE olo_app`.** La pertenencia existe, pero con `inherit_option = false` y `set_option = false` — así concede PostgreSQL 17 los roles creados por un rol con `CREATEROLE`. La suite de aislamiento de Fase 0 se conectará como `olo_app` con sus propias credenciales, no por `SET ROLE`.
3. **`authenticated` no tiene `USAGE` sobre `core`** y por decisión aprobada no debe tenerlo todavía. Se concede temporalmente dentro de la transacción y se revoca antes de terminar.

## Pruebas

Las seis se ejecutan dentro de la migración. Si alguna falla, la migración entera se aborta y no se aplica.

| # | Prueba | Verifica |
|---|---|---|
| T1 | Canal B (GUC `app.tenant_id`), tenant A | Ve exactamente sus 2 filas y **0 de otro tenant** |
| T2 | Canal A (claims del JWT), tenant B | Ve exactamente su 1 fila y **0 de otro tenant** |
| T3 | Sin contexto | **0 filas.** Fail-secure, nunca «todas» |
| T4 | `INSERT` con el `tenant_id` de otro | **Denegado** por `WITH CHECK` |
| T5 | `UPDATE` cross-tenant | **0 filas afectadas** (no falla, simplemente no alcanza nada) |
| T6 | `UPDATE` legítimo del propio tenant | **Permitido** |

**T6 es el gemelo obligatorio de T3.** Una política mal escrita que denegara todo pasaría T1 a T5 sin problema; T6 es lo que distingue «aísla correctamente» de «no deja trabajar a nadie».

El patrón probado es el definitivo: una política `RESTRICTIVE` como piso duro más una única `PERMISSIVE` como concesión.

## Rollback

No-op por diseño: la migración no deja objetos. El archivo existe por la regla de correspondencia y como red de seguridad — si 0006 se hubiera interrumpido a mitad, restituye la sonda y el `USAGE` temporal.

Verificado tras ejecutarlo: 0 objetos en `core`, `authenticated` sin `USAGE`, 5 funciones intactas.

## Resultado

Reaplicación determinista: T1–T6 pasaron de nuevo. `db lint` limpio.

Tiempos: 10,98 s · 0,89 s · 9,68 s.

## Riesgos

| # | Riesgo | Severidad |
|---|---|---|
| 1 | La prueba se ejecuta como `authenticated`, no como `olo_app`. La política aplica a ambos roles y el mecanismo de contexto es el mismo, pero el camino exacto de `olo_app` solo quedará verificado cuando la suite se conecte con sus credenciales | Baja — `olo_app` con `BYPASSRLS = false` ya está verificado en 0002 |
| 2 | El `GRANT USAGE` temporal a `authenticated` depende de que la migración se aplique en una sola transacción. Confirmado en este entorno | Baja |
