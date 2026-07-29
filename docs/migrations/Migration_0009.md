# Migration 0009 — `create_companies`

**Archivo:** `supabase/migrations/0009_create_companies.sql` · **Rollback:** `supabase/rollbacks/0009_create_companies.down.sql` · **Estado: APLICADA Y VERIFICADA** · Riesgo: medio

## Objetivo

Entidad legal dentro de un tenant, padre de `core.warehouses`. **Introduce el mecanismo central de integridad jerárquica del modelo.**

## El mecanismo: FK compuesta

```sql
CONSTRAINT fk_comp_tenant_country
    FOREIGN KEY (tenant_id, tenant_country_id)
    REFERENCES core.tenant_countries (tenant_id, id)
```

Con dos FK independientes —una a `tenants` y otra a `tenant_countries`— cada una sería válida por separado y **nada las relacionaría**: se podría insertar una company del tenant A apuntando al país operativo del tenant B. RLS lo ocultaría, pero el dato ya estaría corrupto y aparecería en cualquier consulta hecha con privilegio.

La FK compuesta lo hace **imposible a nivel de motor**.

## Objetos creados

Tabla con 15 columnas. **5 CHECK** (status, version, longitud de name, `jsonb_typeof` de settings y address). `UNIQUE (tenant_id, id)` como destino para `warehouses` (0012). Único parcial doble `(tenant_id, tenant_country_id, tax_id) WHERE tax_id IS NOT NULL AND deleted_at IS NULL`. 2 índices, 2 triggers, RLS T2 con 2 políticas y `FORCE`.

## Pruebas

| # | Prueba | Resultado |
|---|---|---|
| T1 | Company coherente | permitida |
| **T2** | **Tenant A apuntando al país operativo de B** | **`foreign_key_violation`** |
| **T3** | **Tenant B apuntando al de A (inverso)** | **`foreign_key_violation`** |
| T4 | `tax_id` duplicado en el mismo país | rechazado |
| T5 | El mismo `tax_id` en otro país del mismo tenant | permitido |
| T6 | `prevent_tenant_change` | excepción |
| T7 | CHECK `address` como escalar | rechazado |
| T8 | RLS: ve 2 filas propias | correcto |
| T9 | Sin contexto | 0 filas |

**Prueba de dependencia del rollback.** Con `companies` aplicada, el rollback de 0008 falla como debe:

```
ERROR 2BP01: cannot drop table core.tenant_countries because other objects depend on it
DETAIL: constraint fk_comp_tenant_country on table core.companies depends on it
```

Es la protección buscada: revertir una migración padre con hijas aplicadas destruiría datos de tenant.

## Rollback

Verificado: `companies` eliminada, `tenant_countries` intacta. Reaplicación determinista. `db lint` limpio.

Tiempos: 14,77 s · 1,03 s · 14,33 s.

## Riesgos

| # | Riesgo | Severidad |
|---|---|---|
| 1 | Las FK compuestas exigen mantener el `UNIQUE (tenant_id, id)` en cada tabla padre. Olvidarlo en una tabla futura rompe la cadena silenciosamente | Media — el checklist de `RLS_IMPLEMENTATION_GUIDE.md` §8 lo cubre; conviene una verificación automática en CI |
| 2 | `logo_file_id` no tiene FK: `core.files` llega en la migración 0023 | Baja — planificado |
