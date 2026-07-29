# Migration 0004 — `create_context_functions`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0004_create_context_functions.sql` |
| **Rollback** | `supabase/rollbacks/0004_create_context_functions.down.sql` |
| **Estado** | **APLICADA Y VERIFICADA** · **Riesgo: ALTO** |

## Objetivo

Crear las tres primeras funciones de contexto, base de toda política RLS del sistema. Ninguna política consulta `current_setting()` directamente: todas pasan por estas funciones.

## Objetos creados

| Función | Retorno | Volatilidad | `search_path` | `SECURITY DEFINER` |
|---|---|---|---|---|
| `core.current_auth_id()` | `uuid` | STABLE | `''` | No |
| `core.current_tenant_id()` | `uuid` | STABLE | `''` | No |
| `core.has_tenant_wide_access()` | `boolean` | STABLE | `''` | No |

Las tres con `COMMENT`. Ninguna es `SECURITY DEFINER` porque solo leen ajustes de sesión.

**Decisiones de implementación:**

- `current_auth_id()` delega en `auth.uid()` con fallback al GUC. Se prefirió delegar antes que leer el claim `sub` a mano: si Supabase cambia cómo expone los claims, la función sigue siendo correcta sin mantenimiento por nuestra parte.
- `current_tenant_id()` lee `request.jwt.claims` **directamente**, no vía `auth.jwt()`. Comportamiento idéntico en Supabase, y así la función es portable a un PostgreSQL sin schema `auth`, lo que permite ejecutar la suite de aislamiento sin el stack completo.
- `has_tenant_wide_access()` es un booleano **explícito con default `false`**. Nunca se infiere de «la lista de almacenes está vacía»: esa inferencia convertía a un usuario recién creado sin asignaciones en un usuario con acceso a todo el tenant.

La migración incluye una **verificación fail-secure**: se ejecuta sin JWT y sin GUCs, y aborta si alguna función no devuelve el valor «sin contexto».

## Pruebas

| # | Prueba | Resultado |
|---|---|---|
| F1 | Sin contexto | `tenant=NULL`, `auth=NULL`, `wide=false` |
| F2 | Canal B (GUC) | `tenant_ok=true`, `auth_ok=true`, `wide=true` |
| F3 | Canal A (claims del JWT) | `tenant_ok=true`, `wide=true` |
| F4 | Precedencia con ambos presentes | **gana el JWT** |
| F5 | Claims sin `app_metadata` | cae al GUC correctamente |
| F6 | `wide` sin ningún origen | `false` |

Estructura verificada en catálogo: las tres `STABLE`, las tres con `search_path=""`, ninguna `SECURITY DEFINER`.

## Rollback

`DROP FUNCTION` de las tres, en orden inverso, **sin `CASCADE`**. Si una política RLS posterior dependiera de ellas, el `DROP` falla a propósito: con `CASCADE` se eliminarían esas políticas y las tablas quedarían sin aislamiento, que es peor que no poder revertir.

Verificado: 0 funciones en `core` tras el rollback.

## Resultado

Reaplicación determinista: 3 funciones con los mismos atributos. `db lint` limpio (sin `function_search_path_mutable`).

Tiempos: 9,53 s · 0,87 s · 8,82 s.

## Riesgos

| # | Riesgo | Severidad |
|---|---|---|
| 1 | Si `request.jwt.claims` contuviera JSON malformado, el cast `::jsonb` lanzaría error en cada consulta. En la práctica lo puebla Supabase y siempre es válido; el caso «no fijado» está cubierto y devuelve NULL | Baja |
| 2 | `EXECUTE` sobre las tres queda concedido a `PUBLIC` por defecto de PostgreSQL. Son de solo lectura, sin `SECURITY DEFINER` y con `search_path` fijado, así que no exponen nada | Baja |
