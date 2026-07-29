# OLO_IA - EVALUACIÓN DE PREPARACIÓN PARA IMPLEMENTACIÓN

> Versión 3.0 — Recalculado tras la Ronda 1 de sincronización documental.

## CONCLUSIÓN

# READY WITH CONDITIONS

**Sprint 0.1 está autorizado y puede comenzar.** Sprint 0.2 y posteriores permanecen
bloqueados por las condiciones de esta evaluación.

---

## 1. MÉTRICAS RECALCULADAS

| Métrica | Ronda 0 | Ronda 1 (v2.0) | Ahora (v3.0) | Movimiento |
|---------|---------|----------------|--------------|-----------|
| Problemas críticos | 5 | 2 | **1** | -1 (sincronización aplicada) |
| Decisiones bloqueantes | 7 | 0 | **1** | +1 (CONF-06 descubierto) |
| Inconsistencias entre documentos | 5 | 5 | **0** | -5 (los 7 docs autorizados están sincronizados) |
| Riesgos altos | 7 | 4 | **4** | 0 |
| Vacíos bloqueantes | 3 | 0 | **0** | 0 |
| Conflictos abiertos | — | — | **6** | +6 (nuevos, detectados al sincronizar) |
| Documentos sincronizados | 0 | 0 | **7 de 7 autorizados** | +7 |
| Documentos pendientes de sincronizar | 7 | 7 | **11 (no autorizados)** | — |

### Por qué las inconsistencias bajaron a 0 pero aparecieron 6 conflictos

Las 5 inconsistencias eran **contradicciones ya identificadas** con resolución aprobada.
Se aplicaron. Los 6 conflictos son **hallazgos nuevos**: al escribir el detalle de cada
decisión aprobada aparecieron implicaciones que ningún documento resolvía. No son
regresiones: son deuda de diseño que estaba oculta y ahora está visible y registrada.

---

## 2. PROBLEMA CRÍTICO RESIDUAL (1)

| # | Problema | Origen | Resolución |
|---|----------|--------|-----------|
| 1 | **CONF-06**: el JWT no publica `user_id`, pero `core.current_user_id()` de RLS v2.0 lo requiere. Sin él, `accessible_warehouse_ids()` retorna vacío y todo usuario sin `tenant_wide_access` queda sin acceso a ningún almacén | Divergencia entre la instrucción del owner (usar `sub`, claims mínimos) y RLS_STRATEGY v2.0 §3 (`user_id` obligatorio) | Requiere decisión del owner entre 3 opciones. Recomendación: opción C (filtrar por `auth_id`) |

Es un fallo de **disponibilidad**, no de seguridad: el sistema denegaría en exceso, no
en defecto. Pero bloquea el funcionamiento.

---

## 3. DECISIÓN BLOQUEANTE (1)

| # | Decisión | Bloquea | Esfuerzo |
|---|----------|---------|----------|
| 1 | Resolver CONF-06: cómo resuelve PostgreSQL la identidad de negocio (`core.users.id`) en el camino `authenticated` | Sprint 0.2 (funciones de autorización) y Sprint 0.3 (hook) | 30 min de decisión |

Las otras 5 conflictos (CONF-01 a CONF-05) **no bloquean Sprint 0.1** y tienen ventana
de resolución durante las tareas de reconciliación R01-R08.

---

## 4. RIESGOS ALTOS (4, sin cambios)

| # | Riesgo | Mitigación | Cuándo se verifica |
|---|--------|-----------|-------------------|
| 1 | El plan de Supabase no soporta Custom Access Token Hook PL/pgSQL | PoC P01-P09 a cargo de Claude. Plan B documentado (escribir `app_metadata` desde backend) | Sprint 0.3, tarea P01 |
| 2 | Performance de RLS: `accessible_warehouse_ids()` se evalúa por statement pero consulta la BD | Función `STABLE` + índice parcial `idx_uwa_tenant_user_active`. Benchmark obligatorio | Sprint 0.2, tarea 038 |
| 3 | ARQ + Redis sin experiencia previa en el stack | Interfaz `IJobDispatcher` permite cambiar de implementación sin tocar aplicación. No se instala hasta Sprint 1.4 | Sprint 1.4 |
| 4 | Las FK compuestas de `areas`/`locations` añaden rigidez a las migraciones futuras | Documentado. El coste es conocido y aceptado a cambio de garantía de consistencia | Sprint 0.2 |

---

## 5. CONFLICTOS ABIERTOS (6)

| ID | Conflicto | Bloquea | Severidad | Ventana de resolución |
|----|-----------|---------|-----------|---------------------|
| **CONF-06** | `user_id` en JWT vs `current_user_id()` de RLS v2.0 | **Sprint 0.2, 0.3** | **Alta** | Antes de Sprint 0.2 |
| CONF-01 | `roles.permissions` JSONB vs normalizado | Sprint 0.2 | Media | Durante R01-R08 |
| CONF-02 | `tenant_wide_access` no expresa nivel company | Sprint 0.2 | Media | Durante R01-R08 |
| CONF-03 | Unicidad de barcode a nivel tenant | Sprint 0.2 (menor) | Baja | Durante R01-R08 |
| CONF-04 | Retención de telemetría | Nada en Fase 0 | Baja | Fase 3 |
| CONF-05 | Umbral de reconteo | Sprint 1.3 | Baja | Fase 1 |

---

## 6. MATRIZ FINAL DE CONDICIONES PENDIENTES

| # | Condición | Tipo | Bloquea | Responsable | Esfuerzo | Estado |
|---|-----------|------|---------|-------------|----------|--------|
| 1 | Sincronizar SECURITY.md | Doc | Sprint 0.2 | Kiro | 30 min | **COMPLETADA** |
| 2 | Sincronizar DATABASE_DESIGN.md | Doc | Sprint 0.2 | Kiro | 90 min | **COMPLETADA** |
| 3 | Sincronizar MULTITENANT.md | Doc | Sprint 0.2 | Kiro | 40 min | **COMPLETADA** |
| 4 | Sincronizar ARCHITECTURE.md | Doc | Sprint 0.2 | Kiro | 40 min | **COMPLETADA** |
| 5 | Sincronizar DEPLOYMENT.md | Doc | Sprint 0.2 | Kiro | 30 min | **COMPLETADA** |
| 6 | Sincronizar TASKS.md | Doc | Sprint 0.1 | Kiro | 60 min | **COMPLETADA** |
| 7 | Sincronizar FOLDER_STRUCTURE.md | Doc | Sprint 0.1 | Kiro | 30 min | **COMPLETADA** |
| 8 | **Resolver CONF-06** (identidad de negocio en camino `authenticated`) | **Decisión** | **Sprint 0.2, 0.3** | **Owner** | 30 min | **PENDIENTE** |
| 9 | Resolver CONF-01 (permissions JSONB vs tabla) | Decisión | Sprint 0.2 | Owner | 30 min | PENDIENTE |
| 10 | Resolver CONF-02 (nivel company en autorización) | Decisión | Sprint 0.2 | Owner | 45 min | PENDIENTE |
| 11 | Resolver CONF-03 (unicidad de barcode) | Decisión | Sprint 0.2 | Owner | 15 min | PENDIENTE |
| 12 | Recibir auditoría técnica de Claude | Externo | Sprint 0.2 (C2) | Claude | — | PENDIENTE |
| 13 | Reconciliar hallazgos de Claude (R01-R08) | Doc | Sprint 0.2 (C3, C4) | Kiro | 1-2 días | PENDIENTE |
| 14 | Sincronizar los 11 documentos no autorizados | Doc | Sprint 0.2 (C5) | Kiro | 2-3 horas | PENDIENTE (requiere autorización) |
| 15 | Congelar schema de dominio y aprobar | Decisión | Sprint 0.2 (C6) | Owner | — | PENDIENTE |
| 16 | Aprobación explícita para iniciar Sprint 0.2 | Decisión | Sprint 0.2 (C7) | Owner | — | PENDIENTE |
| 17 | PoC del Custom Access Token Hook (P01-P09) | Técnico | Sprint 0.3 | Claude | 2-4 horas | PENDIENTE |

### Resumen de la matriz

| Estado | Cantidad |
|--------|----------|
| Completadas | 7 |
| Pendientes de decisión del owner | 6 |
| Pendientes de terceros (Claude) | 2 |
| Pendientes de Kiro (bloqueadas por lo anterior) | 2 |

---

## 7. QUÉ ESTÁ DESBLOQUEADO AHORA

**Sprint 0.1 puede comenzar inmediatamente.** Ninguna condición pendiente lo bloquea:

| Tarea de Sprint 0.1 | Bloqueada por CONF-06 u otros | Puede ejecutarse |
|---------------------|------------------------------|------------------|
| 001-010 Infraestructura, CI, ADRs, env | No | Sí |
| 011-012 Alembic + smoke test | No (no toca schema de dominio) | Sí |
| 013-015 JobDispatcher, workers vacíos | No | Sí |
| 016-018 App factory, logging, CI check | No | Sí |
| R01-R08 Reconciliación documental | Requiere entrega de Claude para R01 | Parcialmente |

CONF-06 afecta a las funciones de autorización (Sprint 0.2) y al hook (Sprint 0.3).
No afecta a nada de Sprint 0.1.

---

## 8. ORDEN DE EJECUCIÓN RECOMENDADO

```
AHORA
  ├── Sprint 0.1 tareas 001-018        (Kiro, sin bloqueos)
  └── Owner decide CONF-06             (30 min, desbloquea el camino crítico)

EN PARALELO
  ├── Claude entrega auditoría técnica
  └── Owner decide CONF-01, CONF-02, CONF-03

AL RECIBIR AUDITORÍA DE CLAUDE
  └── Sprint 0.1 tareas R01-R08        (reconciliación documental)

TRAS R08 + CONF-06 RESUELTO + AUTORIZACIÓN
  └── Sprint 0.2                       (base de datos y RLS)

TRAS PoC DEL HOOK EXITOSA
  └── Sprint 0.3                       (autenticación)
```

---

## 9. EVIDENCIA DE READY

1. **7 de 7 documentos autorizados sincronizados**, con diff lógico trazable por sección
   en `CHANGELOG_ARCHITECTURE_SYNC.md`.
2. **0 inconsistencias** entre los documentos sincronizados y `RLS_STRATEGY.md` v2.0,
   salvo CONF-06 que está registrada y no oculta.
3. **28 decisiones registradas** con estado, alternativas e impacto.
4. **Sprint 0.1 completamente especificado**: 18 tareas técnicas + 8 de reconciliación,
   con criterio de completitud verificable.
5. **32 tests de seguridad especificados** para Sprint 0.2 (8 multi-tenant, 6 fuga
   horizontal, 9 escalamiento vertical, 9 de PoC del hook).
6. **Gating explícito**: 7 condiciones de entrada a Sprint 0.2, ninguna ambigua.
7. **Ningún vacío bloqueante**: los 6 conflictos abiertos tienen opciones, recomendación
   y ventana de resolución.

## 10. EVIDENCIA DE WITH CONDITIONS

1. **CONF-06 no está resuelta** y tiene efecto funcional directo sobre el acceso a
   almacenes en el camino `authenticated`.
2. **11 documentos siguen sin sincronizar**, incluidos DOMAIN_MODEL.md (que contiene la
   regla de un aggregate por transacción ya corregida en ARCHITECTURE.md) y API_DESIGN.md
   (sin 409 para optimistic locking).
3. **La auditoría técnica de Claude no ha sido recibida**, y las condiciones C2-C3 de
   Sprint 0.2 dependen de ella.
4. **La PoC del hook no se ha ejecutado**: existe riesgo de que el mecanismo elegido no
   esté disponible en el plan contratado.
5. **El schema de dominio no está congelado**, por diseño: se congela tras reconciliar
   los hallazgos de Claude.

---

*Documento recalculado tras Ronda 1 de sincronización.*
*Versión: 3.0*
*Fecha: Julio 2026*
