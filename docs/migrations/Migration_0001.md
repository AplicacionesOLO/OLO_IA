# Migration 0001 — `create_schemas`

| | |
|---|---|
| **Archivo** | `supabase/migrations/0001_create_schemas.sql` |
| **Rollback** | `supabase/rollbacks/0001_create_schemas.down.sql` |
| **Proyecto** | `lbfdvabxkgzrxvgnzrbj` (OLO_IA — desarrollo) |
| **Fecha** | 2026-07-28 |
| **Estado** | **APLICADA Y VERIFICADA** |
| **Riesgo** | Bajo |

---

## 1. Objetivo

Crear los cuatro schemas que faltan de los cinco que usa la Fase 0 (`public` ya existe), como contenedores de todo el modelo posterior. Ningún otro objeto.

Se aplica la corrección aprobada del roadmap: esta migración **no referencia `olo_app`**, porque ese rol se crea en 0002. La versión original del roadmap revocaba privilegios a `olo_app` aquí, lo que habría hecho abortar la migración.

---

## 2. Tablas

**Ninguna.** Esta migración no crea tablas. Es deliberado: 0001 solo establece los contenedores.

---

## 3. Schemas creados

| Schema | Propietario | Expuesto a PostgREST | Contenido previsto |
|---|---|---|---|
| `core` | `postgres` | Sí | Tenancy, jerarquía, identidad, autorización |
| `audit` | `postgres` | Sí, solo SELECT | Eventos append-only |
| `platform` | `postgres` | **No** | Operaciones cross-tenant, log de privilegios |
| `internal` | `postgres` | **No** | Vistas materializadas |

Los cuatro llevan `COMMENT ON SCHEMA` documentando su propósito y su exposición.

**No creados aquí, por diseño:** `inventory`, `integrations`, `ai`, `devices`, `spatial`. Cada uno nace con su primera tabla (`FINAL_DATABASE_MODEL.md` §2).

---

## 4. Extensiones

**Ninguna creada.** El roadmap preveía `pgcrypto` «si `gen_random_uuid()` no está disponible de serie». Se verificó antes de escribir la migración: la función **está disponible** y `pgcrypto` ya estaba instalado en el schema `extensions` del proyecto.

Estado antes y después, sin cambios: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` — cinco extensiones.

En lugar de crear la extensión, la migración incluye una **guarda de entorno**: un bloque `DO` que lanza excepción si `gen_random_uuid()` no existe. Así la migración falla de forma explícita en un entorno mal provisto, en vez de dejar que el error aparezca más adelante cuando ya haya tablas dependiendo de esa función.

---

## 5. Índices

**Ninguno.** No hay tablas.

---

## 6. Funciones

**Ninguna persistente.** El bloque `DO` de la guarda de entorno es anónimo y no deja objeto.

---

## 7. Políticas RLS

**Ninguna.** No hay tablas sobre las que aplicar políticas. La primera política llegará en 0003 (catálogos globales, plantilla T1).

---

## 8. Privilegios

```sql
REVOKE ALL ON SCHEMA platform, internal FROM PUBLIC;
REVOKE ALL ON SCHEMA platform, internal FROM anon;
REVOKE ALL ON SCHEMA platform, internal FROM authenticated;
```

Solo se referencian roles que ya existían en el proyecto.

**Hallazgo de la verificación:** estos `REVOKE` resultaron ser **no-ops efectivos**. `service_role` —al que deliberadamente no se revocó nada— también quedó sin `USAGE` en los cuatro schemas, lo que confirma que en PostgreSQL un schema recién creado no concede privilegios a ningún rol salvo su propietario. Se mantienen porque dejan la intención escrita y protegen frente a cambios futuros en los privilegios por defecto del proyecto.

---

## 9. Rollback

```sql
DROP SCHEMA IF EXISTS internal;
DROP SCHEMA IF EXISTS platform;
DROP SCHEMA IF EXISTS audit;
DROP SCHEMA IF EXISTS core;
```

Orden inverso al de creación. Usa **RESTRICT** (el comportamiento por defecto), no `CASCADE`: si un schema contiene objetos de migraciones posteriores, el `DROP` **falla a propósito**.

Los `REVOKE` no se deshacen con `GRANT`: desaparecen con el schema, y concederlos explícitamente daría privilegios que el estado previo no tenía.

---

## 10. Pruebas ejecutadas

### 10.1 Verificaciones previas

| # | Verificación | Resultado |
|---|---|---|
| P1 | El ref de `.envlocal` coincide con el aprobado | `lbfdvabxkgzrxvgnzrbj` — coinciden |
| P2 | Sin link previo a otro proyecto | Sin `supabase/.temp/project-ref` |
| P3 | Proyecto vacío | 0 schemas objetivo, 0 tablas en `public` |
| P4 | `gen_random_uuid()` disponible | Sí |
| P5 | Roles existentes | `anon`, `authenticated`, `service_role`, `supabase_auth_admin`. `olo_app` **no existe** |
| P6 | Dry-run | Reconoce `0001_create_schemas.sql` |

### 10.2 Tras la primera aplicación

| # | Verificación | Resultado |
|---|---|---|
| A1 | Los 4 schemas existen, propietario `postgres` | **OK** |
| A2 | Los 4 tienen comentario | **OK** |
| A3 | Extensiones sin cambios (5) | **OK** |
| A4 | `anon`/`authenticated`/`service_role` sin `USAGE` en `platform`, `internal`, `core` | **OK** |
| A5 | `postgres` con `USAGE` y `CREATE` | **OK** |
| A6 | Historial: `0001:create_schemas` | **OK** |
| A7 | `db lint` sobre los 5 schemas | **`No schema errors found`** |

### 10.3 Tras el rollback

| # | Verificación | Resultado |
|---|---|---|
| R1 | Los 4 schemas desaparecen | `(ninguno)` |
| R2 | Schemas de plataforma intactos | `auth, extensions, graphql, public, realtime, storage, vault` |
| R3 | Extensiones intactas (5) | **OK** |
| R4 | Roles intactos | **OK** |
| R5 | Historial marcado como revertido | `migration repair --status reverted 0001` |

### 10.4 Tras la reaplicación

| # | Verificación | Resultado |
|---|---|---|
| B1 | Los 4 schemas con propietario y comentario | **Idéntico a A1/A2** |
| B2 | Privilegios efectivos | **Idéntico a A4** |
| B3 | Una sola fila para `0001` en el historial | `1` — sin duplicado |
| B4 | Sin objetos residuales en los schemas | `0` |
| B5 | `db lint` | **`No schema errors found`** |
| B6 | `migration list` local vs remoto | `0001` = `0001`, sincronizado |

### 10.5 Prueba de la propiedad protectora del rollback

Se verificó que el rollback **rechaza** borrar un schema que contiene objetos, usando una prueba autolimpiable: un bloque `DO` que crea una tabla de sonda, intenta el `DROP SCHEMA`, captura el error y termina lanzando una excepción que aborta la transacción completa, de modo que la sonda no persiste.

```
RESULTADO: CORRECTO, rechazado -> cannot drop schema core because other objects depend on it
```

Comprobado después: `0` objetos en `core` y el schema sigue existiendo. La prueba no dejó rastro.

---

## 11. Tiempo de ejecución

| Operación | Tiempo |
|---|---|
| `db push` (primera aplicación) | 10,48 s |
| Rollback | 0,90 s |
| `db push` (reaplicación) | 10,44 s |

El tiempo de `db push` está dominado por el establecimiento de conexión remota y la verificación del historial, no por el DDL. La diferencia frente al rollback (que va por la Management API) lo hace evidente.

**Rendimiento básico:** no aplicable de forma significativa. Sin tablas no hay planes de consulta que medir. La primera medición de rendimiento con sentido será en 0003, sobre los catálogos con volumen de semilla.

---

## 12. Riesgos

### Detectados durante esta migración

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | **`authenticated` no tiene `USAGE` sobre `core` ni `audit`.** Ambos schemas están destinados a exponerse vía PostgREST, así que el `GRANT USAGE` es imprescindible antes de exponer la primera tabla. **No está previsto en ninguna migración del roadmap.** | **Alta** | **Abierto.** Requiere decisión: migración dedicada de privilegios, o incluirlo en la migración de la primera tabla expuesta |
| 2 | **`service_role` no tiene `USAGE` sobre `platform`.** Las RPC de plataforma (`IDENTITY_AND_AUTH_FLOW.md` §3.7) se ejecutan como `service_role` y viven en ese schema. | **Media** | **Abierto.** Debe resolverse en la migración que cree esas RPC |
| 3 | **`supabase db push` emite `Warning: failed to cache migrations catalog ... Docker Desktop is a prerequisite`.** La migración se aplica correctamente; lo que falla es una caché local opcional. Efecto real: `supabase db diff` no está disponible, así que no hay detección automática de drift. | Media | **Aceptado** mientras no haya Docker. Mitigación: verificación explícita por consulta a los catálogos del sistema tras cada migración, como se ha hecho aquí |
| 4 | La exposición de schemas a PostgREST se declara en `config.toml`, que `db push` **no** aplica al proyecto remoto | Media | **Abierto.** Requerirá `config push` o configuración en el dashboard antes de exponer tablas |

### No materializados

- El nombre `0001_create_schemas.sql` (numeración de cuatro dígitos en lugar del timestamp habitual de Supabase) **es aceptado sin problema** por la CLI 2.110.0: aparece correctamente en `db push`, `migration repair` y `migration list`.

---

## 13. Cumplimiento del orden obligatorio

| Paso | Estado |
|---|---|
| 1. Crear archivo de migración | Hecho |
| 2. Revisar SQL | Hecho, más dry-run |
| 3. Aplicar al proyecto remoto | Hecho, 10,48 s |
| 4. Ejecutar pruebas | Hecho, §10.2 |
| 5. Ejecutar rollback controlado | Hecho, 0,90 s |
| 6. Verificar estado tras rollback | Hecho, §10.3 |
| 7. Reaplicar la migración | Hecho, 10,44 s |
| 8. Ejecutar de nuevo las pruebas | Hecho, §10.4 |
| 9. Documentar el resultado | Este documento |

---

*Migración 0001. Sin datos de negocio. Sin cambios manuales no versionados. Sin push a GitHub.*
