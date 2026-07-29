# OLO_IA — PUERTA DE IMPLEMENTACIÓN

> **Autor:** Claude Code — responsable de migraciones, Supabase, pruebas e implementación técnica.
> **Versión 2.0** — actualizada tras la resolución de las 13 decisiones y la verificación empírica de los 5 supuestos críticos.
> **Fecha:** 2026-07-28
> **Pregunta que responde:** ¿se puede crear la primera migración real?

---

# VEREDICTO (DEC-13)

| Dimensión | Estado |
|---|---|
| Readiness **documental** | **READY** |
| Readiness **técnico** | **GO WITH CONDITIONS** |
| Readiness para la **primera migración** | **NOT YET** |

Adopto la formulación de tres niveles de DEC-13 porque es más precisa que un veredicto único: las decisiones están tomadas y verificadas, pero quedan cuatro condiciones cuyo cierre no es una decisión sino trabajo.

---

## 1. QUÉ CAMBIÓ RESPECTO A LA v1.0

### 1.1 Las tres condiciones bloqueantes están resueltas

| Condición v1.0 | Resolución |
|---|---|
| **C1** — herramienta de migraciones | **DEC-01: Supabase CLI, fuente única.** Sin historial paralelo de Alembic |
| **C2** — propagación de claims backend→RLS | **DEC-02: dos canales.** A = JWT/`request.jwt.claims` para PostgREST/Realtime/Storage. B = FastAPI con `olo_app` y GUCs propios (`app.auth_user_id`, `app.tenant_id`, `app.request_id`, `app.correlation_id`) fijados con `SET LOCAL` en la misma transacción y conexión |
| **C3** — imagen de Postgres en CI y local | **DEC-03: Supabase CLI con Docker Desktop.** El CI levanta Supabase local; `postgres:15` plano no basta |

Las condiciones C4-C8 de la v1.0 quedan igualmente resueltas por DEC-05, DEC-06, DEC-07, DEC-09 y el acuerdo sobre `core.user_warehouse_access`.

### 1.2 Los cinco supuestos críticos están verificados empíricamente

Ejecutados contra PostgreSQL 15.8 en un cluster desechable. Detalle y evidencia en `TECHNICAL_ASSUMPTION_VERIFICATION.md`.

| # | Supuesto | Veredicto |
|---|---|---|
| V1 | `audit.events` particionada con `id UUID PRIMARY KEY` no se puede crear | **CONFIRMADO** |
| V2 | `core.soft_delete()` afecta a cualquier UPDATE | **CONFIRMADO** |
| V3 | `postgres:15` plano no tiene `auth`, sus funciones ni sus roles | **CONFIRMADO** |
| V4 | asyncpg no recibe `request.jwt.claims` automáticamente | **CONFIRMADO** |
| V5 | Las FK compuestas impiden la jerarquía cruzada | **CONFIRMADO** |
| V6 | Mis seis correcciones propuestas funcionan | **CONFIRMADAS** |

**Ninguna de las 12 afirmaciones críticas de la auditoría ha sido refutada.** La limitación nº1 de la v1.0 de este documento («nada se ha ejecutado») queda cerrada para los cinco puntos que importaban.

Una corrección a mi propia auditoría: en CRIT-06 predije que `core.soft_delete()` como `BEFORE DELETE` daría error. No lo da — hace un no-op silencioso y el borrado físico se ejecuta. La conclusión (eliminar la función) no cambia; el mecanismo real es peor que el que describí.

### 1.3 Hallazgos nuevos de la verificación

Tres resultados que no estaban en la auditoría y que afectan al diseño:

1. **El pooler en modo transaction es seguro, verificado.** `set_config(..., is_local => true)` no filtra el contexto a la siguiente transacción de la misma conexión (prueba 4E). Era una suposición de `RLS_STRATEGY.md` §9.2 y el riesgo CONC-07; ahora es un hecho medido.
2. **`SET LOCAL` fuera de transacción explícita es un no-op silencioso** (prueba 4C): el GUC queda en cadena vacía, sin error, y RLS deniega todo. La transacción explícita pasa de buena práctica a requisito verificado.
3. **Las funciones de contexto pueden ser portables a PostgreSQL vanilla.** Leyendo `current_setting('request.jwt.claims', true)` en lugar de `auth.jwt()` funcionan igual en Supabase y además fuera de él (pruebas 3H y 4F). No revierte DEC-03 —GoTrue, el Hook, Storage y Realtime siguen exigiendo el stack completo— pero da un camino de respaldo para la parte más frecuente de la suite de aislamiento, y **hoy es relevante porque no hay Docker Desktop instalado en la máquina de trabajo**.

---

## 2. CONDICIONES PENDIENTES

Ninguna es ya una decisión. Las cuatro son trabajo.

### CP-1 — Instalar Docker Desktop
**Bloquea:** `supabase start`, el CI, el PoC del Hook. Es decir, Sprint 0.1 y todo lo posterior.
**Estado:** **no instalado.** Verificado: no hay `docker` en PATH, ni `C:\Program Files\Docker`, ni servicio.
**Por qué es la primera condición ahora:** DEC-03 fija Supabase CLI con Docker Desktop como entorno oficial de integración. Sin Docker, la decisión no es ejecutable. Es la única condición que requiere una acción fuera de mi alcance.
**Quién:** Humano.
**Alternativa provisional si se retrasa:** ejecutar la suite de aislamiento contra un Postgres ligero usando funciones de contexto portables (§1.3, punto 3), y diferir solo las pruebas que necesitan GoTrue. No sustituye a Docker; permite no detener Sprint 0.2.

### CP-2 — Rediseñar el modelo de identidad para membresías múltiples
**Bloquea:** las migraciones de `core.users`, `core.user_role_assignments`, `core.user_warehouse_access`, y el Custom Access Token Hook.
**Motivo:** DEC-04 cambia el modelo de forma sustancial. `core.users` pasa a ser **global** (sin `tenant_id`) y la pertenencia se expresa en `core.tenant_memberships` N:N. Eso reubica la unicidad de email, cambia la política RLS de `core.users`, e introduce en la cadena de autorización un eslabón nuevo que las FK compuestas deben cubrir.
**Propuesta:** `DATABASE_RECONCILIATION_PLAN.md` §13, con una ventaja añadida: la FK compuesta `(tenant_id, user_id) → core.tenant_memberships` hace **imposible a nivel de motor asignar un rol o un almacén a alguien que no es miembro del tenant**. Es una garantía que el modelo anterior no ofrecía.
**Quién:** Claude (diseño), ChatGPT (validación).

### CP-3 — Decidir cómo se determina el tenant activo en el JWT **(DEC-14, nueva)**
**Bloquea:** el Custom Access Token Hook y, con él, el canal A completo.
**Motivo:** es una consecuencia directa de DEC-04 que ninguna decisión cubre todavía. El JWT mínimo lleva **un** `tenant_id`. Si una identidad humana pertenece a tres tenants, **el Hook tiene que elegir uno**, y no está definido con qué criterio. El canal A (PostgREST, Realtime, Storage) solo dispone del JWT: si el token no nombra el tenant activo, esos caminos se quedan sin contexto y RLS les deniega todo.
**Opciones:**
 (a) `core.users.active_tenant_id` que el Hook lee, más un endpoint de cambio de tenant que fuerza refresh del token. Mantiene el JWT mínimo y el canal A funcional.
 (b) El JWT no lleva tenant y el backend lo resuelve por request desde una cabecera validada contra la membresía. Rompe el canal A.
 (c) Un token por tenant. Complica la sesión en el frontend.
**Mi recomendación:** (a). Es la única que preserva el canal A sin ampliar el JWT.
**Quién:** Humano + ChatGPT.

### CP-4 — Recalcular los escenarios de escala separando catálogo de stock
**Bloquea:** nada de inmediato. Necesario antes de dimensionar índices y retención en Fase 1.
**Motivo:** DEC-11. La distinción pedida —catálogo con scope tenant frente a stock con scope almacén— corrige el error de unidad de `RNF-SCAL-004`.
**Estado:** aplicado en `DATABASE_RECONCILIATION_PLAN.md` §11. Pendiente de aprobación.
**Quién:** Humano.

---

## 3. QUÉ SE PUEDE EJECUTAR YA

| Alcance | Estado | Condición |
|---|---|---|
| Repositorio, estructura, `pyproject.toml`, `package.json`, ADRs, pre-commit | **GO** | Ninguna |
| Diseño de las migraciones (SQL revisado, sin aplicar) | **GO** | CP-2 para las de identidad |
| Stack local, CI, proyecto Supabase | **BLOQUEADO** | **CP-1** |
| Migraciones de `public`, `core.tenants`, `tenant_countries`, `companies`, jerarquía, `audit`, `platform` | **BLOQUEADO** | CP-1 |
| Migraciones de identidad y autorización | **BLOQUEADO** | CP-1, **CP-2** |
| Custom Access Token Hook | **BLOQUEADO** | CP-1, CP-2, **CP-3** |
| Frontend foundation | **GO tras Sprint 0.1** | Ninguna propia |

---

## 4. CRITERIO DE PASO A GO ABSOLUTO

- [ ] **CP-1** Docker Desktop instalado y `supabase start` levantando el stack completo.
- [ ] **CP-2** Modelo de membresías aprobado por ChatGPT.
- [ ] **CP-3** DEC-14 decidida.
- [ ] **CP-4** Escenarios de escala aprobados.
- [ ] `DATABASE_DESIGN.md` y `SECURITY.md` sincronizados con las 13 decisiones (tarea F0-009).
- [ ] `make check-rls` y `supabase db lint` en CI **demostrando que pueden fallar**. Un verificador que nunca se pone rojo no verifica nada.
- [ ] PoC de contexto (F0-206) reproducido contra Supabase local. Ya está verificado contra PostgreSQL vanilla; falta confirmarlo con `auth.jwt()` real.

**Esfuerzo estimado:** 1-2 días de decisión y diseño, más el tiempo de instalar Docker Desktop. El trabajo técnico de verificación que quedaba pendiente en la v1.0 ya está hecho.

---

## 5. LIMITACIONES QUE PERSISTEN

Actualizadas respecto a la v1.0.

1. **Cerrada.** «Nada se ha ejecutado» ya no aplica a los cinco supuestos críticos. Sigue aplicando a: el Hook en el plan Supabase contratado, el sobrecoste real de RLS con volumen, y CRIT-11 (`jsonb_set` sin `app_metadata` previo).
2. **Persiste.** Cinco documentos sin auditar: `AI_ARCHITECTURE.md`, `INTEGRATION_STRATEGY.md`, `FOLDER_STRUCTURE.md`, `CODING_STANDARDS.md`, `RISK_ANALYSIS.md`. La matriz de conflictos sigue siendo cota inferior.
3. **Persiste, y ahora importa más.** `RLS_STRATEGY.md` v2.0 es de mi autoría y **debe reescribirse** para incorporar DEC-02 (dos canales, GUCs nuevos), DEC-04 (membresías) y CONF-06 (`current_user_id()` resuelto vía `auth_id`). Esa reescritura la haría yo sobre mi propio documento, así que **debería revisarla ChatGPT** antes de que se convierta en la base de las migraciones.
4. **Nueva.** V3 se verificó sobre PostgreSQL 15.8 instalado localmente, no sobre el contenedor `postgres:15` de Docker Hub. La afirmación verificada —PostgreSQL sin las migraciones de plataforma de Supabase carece del schema `auth`— es la relevante, pero la imagen concreta no se ha ejecutado porque no hay Docker.

---

*Puerta de implementación v2.0. Ninguna migración creada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
