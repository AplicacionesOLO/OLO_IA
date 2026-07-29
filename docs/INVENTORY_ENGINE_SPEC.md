# OLO_IA — ESPECIFICACIÓN DEL MOTOR DE INVENTARIO

> **Autor:** Claude Code, Arquitecto Técnico Responsable de la Implementación.
> **Fecha:** 2026-07-28. **Estado:** contrato. Vinculante.
> **Sin decisiones abiertas.** Toda operación tiene un algoritmo único y definido.

---

## 1. PRINCIPIO CENTRAL

**El ledger es la verdad. El balance es una proyección.**

```
inventory.ledger_entries   append-only, deltas firmados   ← la verdad
        │ se aplica atómicamente en la misma transacción
        ▼
inventory.balances         saldo actual                    ← proyección
```

Toda operación de inventario es, sin excepción:

1. Una o más entradas de ledger con `quantity_delta` firmado.
2. La actualización **relativa** del balance correspondiente.
3. Ambas en **una sola transacción**.

### 1.1 Por qué relativo y no absoluto

Es la decisión que resuelve la carrera fundamental del inventario. Con sobrescritura absoluta:

```
t0  El conteo lee la ubicación A-01-01: 100 unidades
t1  Un operario recibe mercancía: el saldo pasa a 130
t2  El conteo cierra con 95 y genera un ajuste (previous=100, new=95)
t3  Se aplica el ajuste: quantity := 95
    → las 30 unidades de t1 desaparecen sin rastro y sin error
```

Con deltas:

```
t3  quantity := quantity + (-5)  →  130 - 5 = 125   ✓ correcto
```

Las operaciones se vuelven **conmutativas**, y PostgreSQL serializa el `UPDATE` sobre la fila, así que ninguna se pierde. Sin ledger, este problema no tiene solución: el optimistic locking detectaría el conflicto, pero entonces el ajuste falla y hay que repetir el conteo entero, lo que es inaceptable en operación.

---

## 2. `inventory.ledger_entries`

```sql
CREATE TABLE inventory.ledger_entries (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    warehouse_id    UUID NOT NULL,
    location_id     UUID NOT NULL,
    product_id      UUID NOT NULL,
    balance_id      UUID NOT NULL,          -- proyección afectada
    lot_number      VARCHAR(50),
    serial_number   VARCHAR(100),

    movement_type   VARCHAR(30) NOT NULL CHECK (movement_type IN (
                        'receipt','issue','transfer_out','transfer_in',
                        'adjustment','count_correction','reserve','release',
                        'damage','quarantine','release_quarantine','expiry','reversal')),
    quantity_delta  NUMERIC(15,4) NOT NULL CHECK (quantity_delta <> 0),
    quantity_after  NUMERIC(15,4) NOT NULL CHECK (quantity_after >= 0),

    source_type     VARCHAR(30) NOT NULL CHECK (source_type IN (
                        'manual','count','adjustment','integration','ai','drone','api','system')),
    source_id       UUID,                   -- count_id, adjustment_id, sync_job_id...
    transfer_group_id UUID,                 -- correlaciona transfer_out/transfer_in
    reverses_entry_id UUID,                 -- para movement_type='reversal'
    reason_code     VARCHAR(50) REFERENCES inventory.adjustment_reasons(code),
    unit_cost       NUMERIC(15,4),
    notes           TEXT,

    performed_by    UUID REFERENCES core.users(id),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id      UUID,
    correlation_id  UUID,

    PRIMARY KEY (id, occurred_at)           -- compuesta desde el inicio: ver §9.3
    -- SIN updated_at, SIN version, SIN deleted_at: append-only
);
```

**Constraints adicionales:**

```sql
-- Un reversal debe apuntar a la entrada que revierte; nada más lo hace
ALTER TABLE inventory.ledger_entries ADD CONSTRAINT chk_reversal
  CHECK ((movement_type = 'reversal') = (reverses_entry_id IS NOT NULL));

-- Las transferencias van siempre en pareja correlacionada
ALTER TABLE inventory.ledger_entries ADD CONSTRAINT chk_transfer_group
  CHECK ((movement_type IN ('transfer_in','transfer_out')) = (transfer_group_id IS NOT NULL));

-- Serial implica una unidad
ALTER TABLE inventory.ledger_entries ADD CONSTRAINT chk_serial_delta
  CHECK (serial_number IS NULL OR abs(quantity_delta) = 1);
```

**Índices:**

```sql
CREATE INDEX idx_ledger_balance  ON inventory.ledger_entries (tenant_id, balance_id, occurred_at DESC);
CREATE INDEX idx_ledger_product  ON inventory.ledger_entries (tenant_id, warehouse_id, product_id, occurred_at DESC);
CREATE INDEX idx_ledger_location ON inventory.ledger_entries (tenant_id, location_id, occurred_at DESC);
CREATE INDEX idx_ledger_source   ON inventory.ledger_entries (tenant_id, source_type, source_id);
CREATE INDEX idx_ledger_transfer ON inventory.ledger_entries (transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE INDEX idx_ledger_brin     ON inventory.ledger_entries USING BRIN (occurred_at);
```

**RLS:** T3 + patrón append-only de T5. Sin políticas de UPDATE ni DELETE; `REVOKE UPDATE, DELETE`.

### 2.1 Invariantes verificables

| # | Invariante | Consulta de verificación |
|---|---|---|
| L1 | El balance es la suma del ledger | `SUM(quantity_delta) GROUP BY balance_id` = `balances.quantity` |
| L2 | `quantity_after` es coherente | El `quantity_after` de la última entrada por `balance_id` = `balances.quantity` |
| L3 | Toda transferencia suma cero | `SUM(quantity_delta) GROUP BY transfer_group_id` = 0 |
| L4 | Ninguna entrada se editó | Sin `updated_at`, no hay forma. Se verifica que la columna no existe |
| L5 | Todo reversal tiene su original | `reverses_entry_id` existe y su `quantity_delta` es el opuesto |

**L1 es el test de convergencia del motor** y debe correr en CI sobre el dataset de semilla.

---

## 3. `inventory.balances`

```sql
CREATE TABLE inventory.balances (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    warehouse_id      UUID NOT NULL,
    location_id       UUID NOT NULL,
    product_id        UUID NOT NULL,
    lot_number        VARCHAR(50),
    serial_number     VARCHAR(100),
    status            VARCHAR(20) NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available','damaged','quarantine','expired')),

    quantity          NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    expiration_date   DATE,
    unit_cost         NUMERIC(15,4),
    last_counted_at   TIMESTAMPTZ,
    last_movement_at  TIMESTAMPTZ,

    version           INT NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT chk_reserved_lte_qty CHECK (reserved_quantity <= quantity),
    CONSTRAINT chk_serial_qty       CHECK (serial_number IS NULL OR quantity <= 1)
);
```

### 3.1 La clave lógica

```sql
CREATE UNIQUE INDEX uq_balance_logical ON inventory.balances (
    tenant_id, warehouse_id, location_id, product_id,
    COALESCE(lot_number, ''), COALESCE(serial_number, ''), status
) WHERE deleted_at IS NULL;
```

**El `COALESCE` no es opcional.** En un índice único, `NULL` no colisiona con `NULL`. Sin él, dos filas con `lot_number IS NULL` se consideran distintas y el índice no protege nada: entran dos balances del mismo stock lógico y la cantidad se parte —medido: 50 + 30 en dos filas donde debía haber una de 80—. A partir de ahí, un ajuste por `balance_id` toca una y deja la otra intacta.

Con este índice, el alta de stock es siempre un **UPSERT**, lo que además elimina la carrera de inserción concurrente sin bloqueo explícito.

### 3.2 Unicidad de serial

Un número de serie identifica una unidad física, que está en un solo sitio:

```sql
CREATE UNIQUE INDEX uq_balance_serial ON inventory.balances (tenant_id, serial_number)
    WHERE serial_number IS NOT NULL AND deleted_at IS NULL;
```

**Decisión de movimiento, distinta según el tipo de artículo:**

| Tipo | Cómo se mueve | Por qué |
|---|---|---|
| **Serializado** | Se **actualiza `location_id`** de la fila de balance | La unidad es la misma; solo cambia de sitio. Mantiene `uq_balance_serial` sin conflictos transitorios |
| **No serializado** | Se **decrementa el balance origen y se hace UPSERT en el destino** | Las unidades son fungibles; el balance es por ubicación |

Ambos casos generan la pareja `transfer_out` / `transfer_in` en el ledger con el mismo `transfer_group_id`. La diferencia está solo en cómo se toca la proyección.

### 3.3 Índices

```sql
CREATE INDEX idx_bal_wh_product ON inventory.balances (tenant_id, warehouse_id, product_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bal_location   ON inventory.balances (tenant_id, location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bal_expiration ON inventory.balances (tenant_id, expiration_date)
    WHERE expiration_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_bal_available  ON inventory.balances (tenant_id, warehouse_id, product_id)
    WHERE status='available' AND quantity > 0 AND deleted_at IS NULL;
```

**RLS:** T3.

---

## 4. OPERACIÓN CANÓNICA

Toda operación pasa por esta función de aplicación. **No hay otro camino para modificar un balance.**

```
apply_movement(
    tenant_id, warehouse_id, location_id, product_id,
    lot_number, serial_number, status,
    movement_type, quantity_delta,
    source_type, source_id, reason_code,
    performed_by, occurred_at, transfer_group_id
) → ledger_entry_id

1. Localizar o crear el balance (UPSERT sobre la clave lógica):
     INSERT INTO inventory.balances (...) VALUES (...)
     ON CONFLICT (tenant_id, warehouse_id, location_id, product_id,
                  COALESCE(lot_number,''), COALESCE(serial_number,''), status)
          WHERE deleted_at IS NULL
     DO NOTHING
     RETURNING id;
     -- si no devuelve: SELECT el existente

2. Aplicar el delta de forma RELATIVA, con la guarda en el WHERE:
     UPDATE inventory.balances
        SET quantity         = quantity + :delta,
            last_movement_at = :occurred_at,
            updated_at       = now()
      WHERE id = :balance_id
        AND quantity + :delta >= 0                    -- no negativo
        AND quantity + :delta >= reserved_quantity    -- no rompe reservas
     RETURNING quantity;
     -- rowcount = 0  ⇒  INSUFFICIENT_STOCK (422). NO es un conflicto de versión

3. Insertar la entrada de ledger con quantity_after = el valor devuelto

4. Emitir AuditEvent
```

**Puntos de contrato que no admiten variación:**

- El paso 2 **no lee antes de escribir**. La guarda va en el `WHERE`, así que PostgreSQL la evalúa sobre la fila bloqueada. No hace falta `SELECT ... FOR UPDATE` y no hay ventana de carrera.
- `rowcount = 0` en el paso 2 significa **stock insuficiente**, no conflicto de concurrencia. Son errores distintos con códigos HTTP distintos: 422 frente a 409.
- **`version` no se incrementa** en el paso 2. Un movimiento no invalida la vista que un usuario tenga del balance; ver §8.

---

## 5. LAS DIEZ OPERACIONES

| # | Operación | `movement_type` | Δ | Entradas de ledger |
|---|---|---|---|---|
| 1 | Recepción | `receipt` | + | 1 |
| 2 | Despacho | `issue` | − | 1 |
| 3 | Transferencia | `transfer_out` + `transfer_in` | − y + | **2**, mismo `transfer_group_id` |
| 4 | Ajuste | `adjustment` | ± | 1 por línea |
| 5 | Corrección por conteo | `count_correction` | ± | 1 por línea |
| 6 | Reserva | `reserve` | 0 sobre `quantity` | 1 (§5.6) |
| 7 | Liberación | `release` | 0 sobre `quantity` | 1 |
| 8 | Daño | `damage` | − origen, + destino | 2 (cambio de `status`) |
| 9 | Cuarentena | `quarantine` | − origen, + destino | 2 (cambio de `status`) |
| 10 | Reversión | `reversal` | opuesto del original | 1 |

### 5.1 Recepción

```
apply_movement(..., movement_type='receipt', quantity_delta=+N,
               source_type='manual'|'integration', source_id=...)
```
Si la ubicación tiene `max_units` o `max_weight_kg`, se valida **antes** en la capa de aplicación. No es un CHECK: depende de la suma de todos los balances de la ubicación, que un CHECK de fila no puede ver.

### 5.2 Despacho

```
apply_movement(..., movement_type='issue', quantity_delta=-N)
```
La guarda `quantity + delta >= reserved_quantity` impide despachar unidades comprometidas en una reserva.

### 5.3 Transferencia

**Una transacción, dos entradas, un `transfer_group_id`.**

```
BEGIN
  tg := gen_random_uuid()
  -- no serializado
  apply_movement(origen,  'transfer_out', -N, transfer_group_id=tg)
  apply_movement(destino, 'transfer_in',  +N, transfer_group_id=tg)
  -- serializado: UPDATE balances SET location_id = destino WHERE serial_number = S
  --              y las dos entradas de ledger igual
COMMIT
```
Invariante L3: `SUM(quantity_delta)` por `transfer_group_id` = 0. Verificable en CI.

**Orden obligatorio: primero la salida, después la entrada.** Si se invierte y la salida falla por stock insuficiente, la transacción aborta igual, pero el orden salida-primero hace que el fallo sea inmediato y el mensaje de error señale la causa real.

### 5.4 Ajuste con workflow

```sql
CREATE TABLE inventory.adjustments (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, warehouse_id UUID NOT NULL,
    count_id UUID,                                  -- si nace de un conteo
    type VARCHAR(20) NOT NULL CHECK (type IN ('increase','decrease','correction')),
    reason_code VARCHAR(50) NOT NULL REFERENCES inventory.adjustment_reasons(code),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','applied','cancelled')),
    requires_approval BOOLEAN NOT NULL,
    approved_by UUID, approved_at TIMESTAMPTZ, applied_at TIMESTAMPTZ,
    rejected_reason TEXT, notes TEXT,
    version INT NOT NULL DEFAULT 1, /* + estándar */
    CONSTRAINT chk_adj_approved  CHECK (status <> 'approved' OR approved_by IS NOT NULL),
    CONSTRAINT chk_adj_temporal  CHECK (applied_at IS NULL OR approved_at IS NULL
                                        OR applied_at >= approved_at)
);

CREATE TABLE inventory.adjustment_items (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, warehouse_id UUID NOT NULL,
    adjustment_id UUID NOT NULL, balance_id UUID,
    location_id UUID NOT NULL, product_id UUID NOT NULL,
    lot_number VARCHAR(50), serial_number VARCHAR(100),
    quantity_delta NUMERIC(15,4) NOT NULL CHECK (quantity_delta <> 0),  -- ← DELTA
    ledger_entry_id UUID,                        -- se rellena al aplicar
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`quantity_delta`, no `previous_quantity`/`new_quantity`.** Es el cambio que convierte los ajustes en conmutativos y elimina la carrera de §1.1.

Ciclo: `pending → approved → applied`. Reglas:
- `requires_approval` se deriva de `adjustment_reasons` y del umbral configurado por almacén.
- **Nadie aprueba su propio ajuste:** `approved_by <> created_by`, validado en aplicación (un CHECK no puede compararlos si `created_by` es de la fila... sí puede, ambos están en la misma fila: `CHECK (approved_by IS NULL OR approved_by <> created_by)`. Se implementa como CHECK).
- `apply` es **idempotente por `Idempotency-Key`** y además guardado por `status='approved'`: aplicar dos veces falla en el segundo intento porque el estado ya es `applied`.
- Aplicar recorre los items y llama `apply_movement` con `movement_type='adjustment'`.

### 5.5 Reversión

**Nunca se edita ni se borra una entrada de ledger.** Un error se corrige insertando su opuesto:

```
apply_movement(..., movement_type='reversal',
               quantity_delta = -original.quantity_delta,
               reverses_entry_id = original.id)
```
Una entrada solo se puede revertir una vez: `UNIQUE (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL`.

### 5.6 Reservas

`reserved_quantity` es un compromiso sobre stock que sigue físicamente presente, así que **no altera `quantity`**.

```sql
-- Reservar: atómico, guarda en el WHERE, sin SELECT previo
UPDATE inventory.balances
   SET reserved_quantity = reserved_quantity + :n, updated_at = now()
 WHERE id = :balance_id
   AND reserved_quantity + :n <= quantity;
-- rowcount = 0 ⇒ INSUFFICIENT_AVAILABLE (422)
```

Esto es lo que cierra la carrera de reservas: dos reservas concurrentes de 60 sobre 100 unidades. Con `SELECT` previo, ambas leen 0 reservado y ambas escriben 60. Con la guarda en el `WHERE`, PostgreSQL serializa y la segunda obtiene `rowcount = 0`.

Se registra en el ledger con `quantity_delta` = ±n y una marca de que afecta a la reserva, no al saldo. **Decisión:** para mantener la invariante L1 (`SUM(delta) = quantity`), las entradas de `reserve` y `release` llevan `quantity_delta` con el signo correspondiente pero **se excluyen de L1** mediante `movement_type NOT IN ('reserve','release')` en la consulta de verificación. La alternativa —un ledger separado de reservas— se descarta: duplica infraestructura para un caso que una cláusula resuelve.

### 5.7 Cambio de estado (daño, cuarentena, vencimiento)

Cambiar el `status` de unas unidades es mover cantidad entre **dos filas de balance** que difieren solo en `status`:

```
BEGIN
  tg := gen_random_uuid()
  apply_movement(..., status='available',  movement_type='damage', delta=-N, transfer_group_id=tg)
  apply_movement(..., status='damaged',    movement_type='damage', delta=+N, transfer_group_id=tg)
COMMIT
```
Suma cero, igual que una transferencia. Coherente y verificable por L3.

---

## 6. CONTEOS Y RECONTEOS

### 6.1 Modelo

```
inventory.counts          (proceso)             raíz, version
   └── count_items        (línea)               raíz PROPIA, version
         └── count_observations  (medición)     append-only, N por línea
   └── count_assignees    (usuarios asignados)
```

`count_items` es aggregate propio, no colección del conteo: un conteo completo son ~120.000 líneas en el escenario de crecimiento y no se instancian en memoria.

```sql
CREATE TABLE inventory.count_observations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    warehouse_id    UUID NOT NULL,
    count_item_id   UUID NOT NULL,
    sequence_number INT  NOT NULL CHECK (sequence_number > 0),
    quantity        NUMERIC(15,4) NOT NULL CHECK (quantity >= 0),
    counted_by      UUID REFERENCES core.users(id),
    counted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id       UUID,
    method          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (method IN ('manual','scanner','drone','camera','ai')),
    evidence_file_id UUID REFERENCES core.files(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_obs_seq UNIQUE (tenant_id, count_item_id, sequence_number)
);
```

`count_items` lleva `UNIQUE (tenant_id, count_id, location_id, product_id)` — sin él entran líneas duplicadas para la misma ubicación y producto, que luego generan ajustes duplicados.

`count_items.counted_quantity` y `accepted_observation_id` son **derivados**, mantenidos por el servicio de conteo. **No son columnas `GENERATED`**: dependen de qué observación se acepta, que es una decisión de negocio.

### 6.2 Reconteo

Es `sequence_number = 2`. La regla «recontar si la discrepancia supera el umbral» es lógica de aplicación sobre datos que ya existen. Resolución cuando hay varias observaciones:

| Situación | Observación aceptada |
|---|---|
| Una sola | Esa |
| Dos que coinciden | La segunda |
| Dos que difieren, sin tercera | **Ninguna.** La línea queda `needs_resolution` y requiere intervención |
| Tres, dos coinciden | La coincidente más reciente |
| Decisión manual del supervisor | La que elija, con `notes` obligatoria |

### 6.3 El cálculo de la corrección — la parte crítica

Al cerrar el conteo, para cada línea con observación aceptada:

```
delta = counted_quantity − (saldo del balance EN EL MOMENTO de counted_at)
```

**No** `counted_quantity − saldo_actual`, y **no** `counted_quantity − system_quantity` capturado al planificar el conteo.

El saldo en un instante se reconstruye del ledger, que es exactamente para lo que sirve:

```sql
SELECT COALESCE(SUM(quantity_delta), 0)
FROM inventory.ledger_entries
WHERE balance_id = :balance_id
  AND occurred_at <= :counted_at
  AND movement_type NOT IN ('reserve','release');
```

Con esto, el escenario de §1.1 se resuelve correctamente **en los dos casos posibles**:

| Cuándo llegó la mercancía | Saldo en `counted_at` | delta | Saldo final |
|---|---|---|---|
| **Después** del conteo físico | 100 | 95 − 100 = −5 | 130 − 5 = **125** ✓ |
| **Antes** del conteo físico | 130 | 95 − 130 = −35 | 130 − 35 = **95** ✓ |

Ninguna otra formulación acierta en ambos casos. Es la justificación funcional del ledger, más allá de la trazabilidad.

**Mitigación operativa recomendada, y preferente:** bloquear la ubicación durante el conteo (`locations.status = 'blocked'`), que es lo que hace un WMS real. Elimina la ambigüedad de raíz. El cálculo del ledger es la red de seguridad para cuando el bloqueo no se aplicó o se saltó.

### 6.4 Cierre del conteo

```
BEGIN
  1. Validar status='in_progress' y version esperada (409 si no)
  2. Para cada count_item con observación aceptada:
       a. delta := calcular según §6.3
       b. si delta = 0 → nada, marcar la línea conforme
       c. si |delta| > umbral del almacén → crear Incident
       d. acumular el item de ajuste
  3. Si hay items: crear Adjustment (status según requires_approval)
  4. counts.status := 'completed', completed_at := now(), version += 1
  5. Actualizar balances.last_counted_at de las líneas contadas
  6. AuditEvent 'inventory.count.completed'
COMMIT
```

El cierre **no aplica** el ajuste: lo crea. Aplicarlo es un paso aparte que pasa por el workflow de aprobación. Separar cierre y aplicación es lo que permite revisar antes de tocar el inventario.

---

## 7. LOTES Y SERIALES

| Aspecto | Lote | Serial |
|---|---|---|
| Cardinalidad | N unidades comparten lote | 1 unidad |
| En la clave lógica | Sí, vía `COALESCE(lot_number,'')` | Sí, vía `COALESCE(serial_number,'')` |
| Unicidad propia | No | `UNIQUE (tenant_id, serial_number) WHERE NOT NULL` |
| `quantity` | Cualquiera ≥ 0 | **Exactamente 0 o 1** (`CHECK`, verificado) |
| Movimiento | Cantidad entre filas de balance | `UPDATE location_id` de la fila |
| FEFO/FIFO | Por `expiration_date` / `created_at` | No aplica |

**Selección FEFO** (`RF-INV-011`), determinista:

```sql
SELECT id, quantity - reserved_quantity AS available
FROM inventory.balances
WHERE tenant_id = :t AND warehouse_id = :w AND product_id = :p
  AND status = 'available' AND quantity > reserved_quantity AND deleted_at IS NULL
ORDER BY expiration_date ASC NULLS LAST, created_at ASC, id ASC
FOR UPDATE SKIP LOCKED;
```

`NULLS LAST`: sin fecha de vencimiento va al final. `id ASC` como desempate final hace el orden **totalmente determinista**, que es lo que hace el resultado reproducible en tests. `SKIP LOCKED` permite que dos pickers trabajen en paralelo sobre el mismo producto sin bloquearse.

---

## 8. OPTIMISTIC LOCKING — DÓNDE SÍ Y DÓNDE NO

Distinción que hay que dejar clara porque es fácil equivocarse:

**El ledger hace innecesario el locking para la aritmética.** Los `UPDATE` relativos con guarda en el `WHERE` ya son seguros bajo concurrencia; PostgreSQL los serializa. Añadir `version` a la ruta de movimientos solo produciría 409 espurios y no aportaría corrección.

**El locking protege decisiones de negocio tomadas sobre una lectura obsoleta.** Ahí sí es imprescindible.

| Entidad | `version` | Protege |
|---|---|---|
| `balances` | **Sí** | Edición de **metadatos**: `status`, `expiration_date`, `unit_cost`. **No** los movimientos |
| `counts` | **Sí** | Transiciones de estado. Dos supervisores cerrando el mismo conteo |
| `count_items` | **Sí** | Aceptar dos observaciones distintas a la vez |
| `adjustments` | **Sí** | **Aprobar y rechazar simultáneamente.** El caso más importante |
| `incidents` | Sí | Resolución y escalado concurrentes |
| `products`, `warehouses`, `areas`, `locations` | Sí | Edición concurrente de configuración |
| `ledger_entries` | **No** | Append-only |
| `count_observations` | **No** | Append-only |

**Patrón único:**

```sql
UPDATE inventory.adjustments
   SET status = 'approved', approved_by = :u, approved_at = now(),
       version = version + 1, updated_at = now()
 WHERE id = :id AND version = :expected AND status = 'pending';
-- rowcount = 0 ⇒ 409 CONFLICT
```

**Transporte en la API:** `ETag` en la respuesta del GET, `If-Match` obligatorio en PATCH/PUT de recursos versionados, `412 Precondition Failed` si no coincide, `428 Precondition Required` si falta. Se prefiere a poner `version` en el cuerpo porque es HTTP estándar.

**El trigger `set_updated_at` no incrementa `version`.** Si lo hiciera, cualquier escritura de sistema invalidaría la versión que el cliente tiene en mano y produciría 409 sin causa real.

---

## 9. CONCURRENCIA — RESUMEN DE MECANISMOS

| Escenario | Mecanismo | Resultado |
|---|---|---|
| Dos movimientos sobre el mismo balance | `UPDATE` relativo, PostgreSQL serializa | Ambos se aplican, ninguno se pierde |
| Movimiento durante un conteo | Reconstrucción del saldo por ledger (§6.3) + bloqueo de ubicación | Correcto en los dos órdenes posibles |
| Dos reservas concurrentes | Guarda en el `WHERE`, sin `SELECT` previo | La segunda obtiene `rowcount=0` → 422 |
| Alta duplicada del mismo balance | `UPSERT` sobre la clave lógica con `COALESCE` | Una sola fila |
| Doble aplicación de un ajuste | `Idempotency-Key` + guarda `status='approved'` | El segundo intento falla |
| Aprobar y rechazar a la vez | `version` en `adjustments` | Uno gana, el otro 409 |
| Dos pickers sobre el mismo producto | `FOR UPDATE SKIP LOCKED` | Trabajan en paralelo sin bloquearse |
| Fuga de contexto por pool | `set_config(..., is_local => true)` en transacción explícita | **Verificado sin fuga** |

### 9.1 Nivel de aislamiento

`READ COMMITTED`, el default de PostgreSQL. **No se usa `SERIALIZABLE`**: los `UPDATE` relativos con guarda en el `WHERE` son correctos en `READ COMMITTED`, y `SERIALIZABLE` introduciría fallos por serialización que habría que reintentar sin ganar corrección.

### 9.2 Transacciones

Toda operación de inventario abre transacción explícita —requisito también del contexto RLS (`SET LOCAL` fuera de transacción es un no-op silencioso, verificado)— y su alcance es una operación de negocio completa: nunca se deja un ledger sin su balance ni al revés.

### 9.3 Particionamiento futuro

`ledger_entries` es la primera candidata tras `audit.events`. Umbrales en `DATABASE_RECONCILIATION_PLAN.md` §10.1; el disparador esperado es **C1** (~180 M de filas al año en el escenario de crecimiento).

**Preparación ya incorporada, coste cero:** `PRIMARY KEY (id, occurred_at)` desde la primera migración. PostgreSQL exige que la clave de partición esté en toda constraint única, así que una PK simple obligaría a **recrear la tabla** cuando llegue el particionamiento —verificado que la forma incorrecta ni se puede crear—. Y `ledger_entries` **no es destino de ninguna FK**, precisamente para no limitar las operaciones de `ATTACH`/`DETACH PARTITION`.

---

## 10. LO QUE ESTE DOCUMENTO CIERRA

| Pendiente previo | Resolución |
|---|---|
| **CRIT-08** sin ledger | `ledger_entries` con deltas firmados (§2) |
| **CRIT-09** balances duplicados | Clave lógica con `COALESCE` (§3.1, verificada) |
| **CONC-01** carrera conteo↔movimiento | Reconstrucción del saldo en `counted_at` (§6.3) |
| **CONC-02** lost update | `UPDATE` relativo; `version` solo donde protege decisiones (§8) |
| **CONC-06** reservas concurrentes | Guarda en el `WHERE` sin `SELECT` previo (§5.6) |
| **ALTO-01** optimistic locking | 7 entidades con `version` + `ETag`/`If-Match` (§8) |
| **ALTO-05** observaciones de conteo | `count_observations` con `sequence_number` (§6.1) |
| **ALTO-07** serial y cantidad | `CHECK` verificado (§7) |
| **ALTO-15** umbrales por almacén | `product_warehouse_settings` (`FINAL_DATABASE_MODEL.md` §4.25) |
| **ALTO-22** líneas de conteo duplicadas | `UNIQUE (tenant_id, count_id, location_id, product_id)` (§6.1) |
| **RF-INV-007** historial de movimientos | Consulta directa al ledger |
| **RF-INV-011** FEFO/FIFO | Selección determinista (§7) |
| **RF-INV-015** valorización | Calculable desde el ledger con `unit_cost` por entrada |

---

*Especificación del motor de inventario. Ninguna migración creada. Ningún documento original modificado.*
*Claude Code — 2026-07-28*
