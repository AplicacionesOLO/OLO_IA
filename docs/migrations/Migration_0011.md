# Migration 0011 — `create_tenant_memberships`

**Archivo:** `supabase/migrations/0011_create_tenant_memberships.sql` · **Rollback:** `supabase/rollbacks/0011_create_tenant_memberships.down.sql` · **Estado: APLICADA Y VERIFICADA** · **Riesgo: ALTO**

## Objetivo

Eslabón N:N entre identidad y tenant. Ancla toda la autorización: las FK compuestas de `role_assignments` y `user_warehouse_access` apuntarán aquí, de modo que sea **imposible asignar un rol o un almacén a quien no es miembro del tenant** — garantía que el modelo anterior no ofrecía.

## Dos decisiones que no son obvias

**1) `UNIQUE (tenant_id, user_id)` es TOTAL, no parcial.** PostgreSQL no admite índices parciales como destino de clave foránea, y esta tabla lo es. Consecuencia deliberada: hay **una fila por par** (tenant, usuario), y reincorporar a alguien pone `revoked_at` a NULL en la misma fila. El historial de entradas y salidas vive en `audit.events`, que es su sitio.

**2) `uq_membership_one_active_per_user` — esto es lo que disuelve DEC-14.**

```sql
CREATE UNIQUE INDEX uq_membership_one_active_per_user
    ON core.tenant_memberships (user_id)
    WHERE revoked_at IS NULL AND status = 'active';
```

Con una sola membresía activa por usuario, «cuál es el tenant activo» **no tiene ambigüedad posible**: el Hook lo resuelve sin necesidad de `core.users.active_tenant_id`, sin endpoint de cambio de tenant y sin estado extra en el frontend. La pregunta que DEC-14 iba a decidir deja de poder plantearse.

La etapa 2 —multi-tenant real— es **aditiva**: `DROP INDEX`, una columna y un endpoint. **Ninguna política RLS cambia.**

## Objetos creados

Tabla con 13 columnas. **4 CHECK** (status, version, coherencia temporal `revoked_at >= joined_at`, y `status='active'` exige `joined_at`). **Dos UNIQUE totales** como destinos de FK compuesta: `(tenant_id, user_id)` y `(tenant_id, id)`. Dos únicos parciales: una membresía activa por usuario, y un tenant por defecto por usuario. `idx_memb_user (user_id) WHERE revoked_at IS NULL`, que consumirá el Hook. 2 triggers.

RLS **plantilla T6**: `tenant_isolation` RESTRICTIVE + `membership_read` PERMISSIVE **solo `FOR SELECT`** — conceder o revocar una membresía es operación administrativa. Su política **no invoca** `can_access_warehouse()` ni `accessible_warehouse_ids()`: esas funciones leerán `core.user_warehouse_access`, y referenciarlas desde aquí sería recursión.

## Pruebas

| # | Prueba | Resultado |
|---|---|---|
| T6 | Membresía activa creada | OK |
| **T7** | **Segunda membresía activa para el mismo usuario** | **rechazada** — etapa 1 de DEC-04 |
| T8 | Membresía *invitada* en otro tenant a la vez | permitida |
| T9 | Par `(tenant, usuario)` duplicado | rechazado |
| T10 | `status='active'` sin `joined_at` | rechazado |
| T11 | `revoked_at` anterior a `joined_at` | rechazado |
| T12 | Tras revocar, activar en otro tenant | permitido |
| T13 | RLS: ve solo la membresía de su tenant | correcto |

T8 y T12 son los gemelos: la restricción limita las membresías **activas**, no impide invitaciones ni la movilidad entre tenants.

## Rollback

Verificado, más la prueba de dependencia: con `memberships` aplicada, el rollback de 0010 falla por la FK a `core.users`. Tras revertir 0011, funciona. Reaplicación determinista, `db lint` limpio.

## Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | **La política T2 de `core.tenants` sigue sin la comprobación de membresía.** El contrato la incluye vía `core.has_active_membership()`, que no existe todavía | **Media** | **Abierto.** Debe cerrarse en la migración que cree las funciones de scope |
| 2 | La restricción de una membresía activa es una **política operativa**, no del modelo. Si un usuario legítimo necesita dos tenants antes de la etapa 2, la operación falla con `unique_violation` sin mensaje de negocio | Media | Documentado. El backend debería traducirlo a un error accionable |
| 3 | `invited_by` sin FK, coherente con la decisión sobre columnas de auditoría | Baja | Por diseño |
