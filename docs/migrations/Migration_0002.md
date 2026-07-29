# Migration 0002 — `create_olo_app_role`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0002_create_olo_app_role.sql` |
| **Rollback** | `supabase/rollbacks/0002_create_olo_app_role.down.sql` |
| **Estado** | **APLICADA Y VERIFICADA** |
| **Riesgo** | Medio |

## Objetivo

Crear el rol de aplicación `olo_app` con **todos** sus privilegios, y solo los suyos. Es el rol del canal B: el backend no puede conectarse con `service_role`, que tiene `BYPASSRLS` y anularía el aislamiento multi-tenant.

Por decisión aprobada, esta migración **no** concede nada a `authenticated` ni a `service_role`.

## Objetos creados

**Rol `olo_app`:** `LOGIN`, `NOBYPASSRLS`, `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE`, `NOSUPERUSER`, `NOREPLICATION`, con `COMMENT`.

**Sin contraseña.** Un rol con `LOGIN` y sin contraseña no puede autenticarse con `scram-sha-256`, así que el estado por defecto es fail-secure. La contraseña se fijará como operación de credenciales —no de esquema— cuando el backend necesite conectarse. No se versiona ninguna contraseña.

**Privilegios de schema:** `USAGE` en `core` y `audit`. `REVOKE ALL` en `platform` e `internal`.

**Privilegios por defecto sobre objetos futuros** (las migraciones corren como `postgres`, así que cada tabla nueva concede automáticamente):

| Schema | Tablas | Secuencias |
|---|---|---|
| `core` | `SELECT, INSERT, UPDATE, DELETE` → `arwd` | `USAGE, SELECT` → `rU` |
| `audit` | `SELECT, INSERT` → `ar` | `USAGE, SELECT` → `rU` |

La ausencia de `UPDATE` y `DELETE` en `audit` es deliberada: es lo que sostiene la inmutabilidad append-only de la plantilla T5, además de las políticas RLS.

**Dos guardas de seguridad** en la propia migración: aborta si `olo_app` tuviera `BYPASSRLS` o `SUPERUSER`.

## Pruebas

| # | Verificación | Resultado |
|---|---|---|
| A1 | Atributos del rol | `rolcanlogin=t`, `rolbypassrls=f`, `rolinherit=f`, `rolsuper=f`, `rolcreatedb=f`, `rolcreaterole=f`, `rolreplication=f` |
| A2 | Sin contraseña real | `pg_authid.rolpassword IS NULL` → **true** |
| A3 | `USAGE` por schema | `core`=t, `audit`=t, `platform`=f, `internal`=f |
| A4 | `CREATE` por schema | f en los cuatro |
| A5 | Default ACL | `core/r`=`olo_app=arwd/postgres`, `core/S`=`rU`, `audit/r`=`olo_app=ar/postgres`, `audit/S`=`rU` |
| A6 | Comentario del rol | Presente |
| A7 | Objetos propios | 0 tablas, 0 schemas, 0 funciones |
| A8 | Historial | `0001`, `0002` sin duplicados |

**Sobre A2:** la primera comprobación usó `pg_roles.rolpassword`, que PostgreSQL devuelve siempre enmascarado (`********`), dando un falso positivo. Se repitió contra `pg_authid.rolpassword`, que es el valor real. Contraste: `authenticator` (rol propio de Supabase) sí tiene contraseña; `olo_app` no.

Índices, constraints, políticas RLS y rendimiento: no aplican. Esta migración no crea objetos de esquema.

## Rollback

**Falló en el primer intento** y se corrigió.

```
ERROR 42501: permission denied to reassign objects
DETAIL: Only roles with privileges of role "olo_app" may reassign objects owned by it.
CONTEXT: SQL statement "REASSIGN OWNED BY olo_app TO postgres"
```

Causa (**corregida tras investigarla en 0006**): en Supabase el rol `postgres` no es superusuario, y aunque **sí es miembro** de `olo_app`, esa pertenencia tiene `inherit_option = false` y `set_option = false`. Así concede PostgreSQL 17 los roles creados por un rol con `CREATEROLE`: el creador obtiene `ADMIN OPTION` pero ni hereda sus privilegios ni puede hacer `SET ROLE`. Sin heredar los privilegios de `olo_app`, no puede ejecutar `REASSIGN OWNED BY` ni `DROP OWNED BY` sobre él.

> La primera versión de este documento atribuía el fallo a que `postgres` «no es miembro» de `olo_app`. Es inexacto: la pertenencia existe. La conclusión operativa no cambia, pero el motivo real importa porque es el mismo que impide usar `SET ROLE olo_app` en las pruebas (ver `Migration_0006.md`).

Dos opciones: conceder a `postgres` la pertenencia a `olo_app`, o eliminar esas sentencias. Se eligió la segunda por menor privilegio y menor complejidad: `olo_app` no tiene `CREATE` en ningún schema, así que **por diseño no puede poseer objetos**, y se verificó que no posee ninguno (A7).

El rollback corregido sustituye `REASSIGN`/`DROP OWNED` por una **verificación explícita**: cuenta los objetos propios y, si hubiera alguno, **aborta** en lugar de destruirlo. Un rollback nunca debe perder objetos.

Efecto secundario útil del fallo: confirmó que la Management API ejecuta cada bloque `DO` en una transacción propia. Al abortar en el paso 3, los `REVOKE` de los pasos 1 y 2 se revirtieron y el estado quedó intacto — verificado antes de corregir.

| # | Verificación tras el rollback | Resultado |
|---|---|---|
| R1 | Rol eliminado | `(no existe)` |
| R2 | Sin default ACL residual en `core`/`audit` | `(ninguno)` |
| R3 | Schemas de 0001 intactos | `audit, core, internal, platform` |
| R4 | Roles de Supabase intactos | `anon, authenticated, authenticator, service_role, supabase_auth_admin` |

R2 importa: sin revertir los `ALTER DEFAULT PRIVILEGES`, `DROP ROLE` habría fallado porque el rol seguiría referenciado en `pg_default_acl`.

## Resultado

**Reaplicación determinista.** Atributos, ausencia de contraseña, `USAGE` y default ACL idénticos a la primera aplicación. Una sola fila por versión en el historial.

Tiempos: aplicación 11,56 s · rollback 0,98 s · reaplicación 10,65 s.

## Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | `olo_app` tiene `USAGE` sobre `public`, heredado del `GRANT USAGE ON SCHEMA public TO public` que trae Supabase. No lo concede esta migración | Baja | **Aceptado.** No habrá tablas de negocio en `public` salvo catálogos de solo lectura. Revocar el `USAGE` de `PUBLIC` sobre `public` podría romper componentes internos de Supabase |
| 2 | Los privilegios por defecto están atados a `FOR ROLE postgres`. Si en el futuro las migraciones se ejecutaran con otro rol, las tablas nuevas no concederían nada a `olo_app` | Media | **Documentado.** `db push` conecta como `postgres`, confirmado por el propietario de los schemas de 0001 |
| 3 | Sin contraseña, `olo_app` no puede conectarse todavía. Es intencionado, pero hay que recordarlo al levantar el backend | Baja | Abierto por diseño |

## Orden obligatorio

Los nueve pasos cumplidos, con la particularidad de que el paso 5 requirió corregir el archivo de rollback y repetirse.
