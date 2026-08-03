-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 · INVENTARIO: LO QUE EL WMS DICE  vs.  LO QUE NOSOTROS VEMOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ DOS INVENTARIOS Y NO UNO
--
-- El WMS es la fuente de verdad DECLARADA: dice qué debería haber en cada
-- ubicación. Nosotros no la corregimos ni la escribimos — la recibimos y la
-- consultamos. Por eso `wms_*` se carga por lotes y no se edita fila a fila.
--
-- Nuestra aportación es la fuente de verdad OBSERVADA: lo que el dron o el vídeo
-- realmente vio. Esa es `readings`, y es nuestra.
--
-- El valor del producto NO está en ninguna de las dos por separado: está en la
-- DIFERENCIA. Por eso la comparación no es una tabla sino una vista derivada —
-- si se materializara, habría que mantenerla coherente con dos orígenes que
-- cambian a ritmos distintos, y el primer desajuste sería invisible.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LA DECISIÓN DE DISEÑO QUE IMPORTA: TRES EJES, NO UN ENUM
--
-- La tentación es guardar un solo estado por ubicación («coincide», «vacía
-- inesperada», «pallet sin QR»…). No funciona, y se ve con un caso real:
-- «la ubicación está vacía PERO su QR no era legible».
--
-- Eso son dos hechos independientes. Un enum plano obliga a elegir uno y perder
-- el otro. Lo que se observa tiene tres ejes que varían por separado:
--
--   1. ATRIBUCIÓN  ¿pude saber QUÉ ubicación estoy mirando?   → location_qr
--   2. CONTENIDO   ¿qué había en el hueco?                    → content
--   3. IDENTIDAD   ¿pude saber QUÉ pallet es?                 → pallet_qr
--
-- Se guardan los tres. El estado único que pinta el mapa se DERIVA de ellos
-- contra lo declarado, en `v_reconciliation`. Así la regla de negocio se puede
-- cambiar sin volver a leer el almacén: los hechos observados siguen intactos.
--
-- ───────────────────────────────────────────────────────────────────────────
-- EL HALLAZGO QUE NO CABE EN UNA CELDA
--
-- «Un pallet colocado donde no le corresponde» NO es un estado de una ubicación:
-- es una relación entre DOS. Un solo error físico produce dos síntomas en dos
-- sitios distintos —un hueco con pallet ajeno y otro que quedó vacío— y si no se
-- enlazan, el operario ve dos incidencias sueltas en vez de un movimiento.
-- Por eso existe `v_misplaced` aparte, con las dos ubicaciones en la misma fila.
--
-- ───────────────────────────────────────────────────────────────────────────
-- DÓNDE ESTÁN LOS RACKS  (no hacía falta inventar nada)
--
-- Se creía que faltaba la geometría porque `world_position` está NULL en las
-- 29.312 ubicaciones. Pero la rejilla lógica SÍ está: `logical_x/y/z` rellenos en
-- 29.310 de 29.312, y con semántica coherente —comprobado sobre RCL01:
--   logical_y = bahía a lo largo del rack · logical_x = línea del rack en planta
--   logical_z = nivel
-- 322 de los 347 racks tienen (x,y) distinta entre sí y caben en x=[1..2002],
-- y=[3..1102]: cero colisiones. De los 25 restantes, 13 son virtuales (BUFFER,
-- CAAU, DEST01, TARI01) y 12 son ENTREPLANTA —MZ01..MZ12, 1.525 ubicaciones
-- reales— cuya `y` es genuina pero cuya `x` es el marcador 70077.
--
-- Esa distinción no es cosmética: tratar los MZ como planta normal los dibujaría
-- 35 veces más lejos que el rack más remoto y colapsaría el mapa a un punto;
-- tratarlos como virtuales borraría el 5 % del almacén. Por eso `v_rack_layout`
-- devuelve `placement` con tres valores y no un booleano.
--
-- Conclusión: el plano se deriva de datos que YA existen. Esta migración no crea
-- geometría; crea la vista `v_rack_layout` que la expone agregada por rack para
-- que el mapa no tenga que recorrer 29.312 filas para dibujar 347 cajas.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS inventory;

COMMENT ON SCHEMA inventory IS
    'Inventario declarado (WMS, solo lectura para nosotros) y observado (nuestras lecturas). La comparacion es derivada, no almacenada.';

GRANT USAGE ON SCHEMA inventory TO olo_app, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · LO DECLARADO — llega del WMS, no lo editamos
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE inventory.wms_snapshots (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id      uuid        NOT NULL REFERENCES core.tenants(id),
    warehouse_id   uuid        NOT NULL,

    -- Momento al que se refiere el corte, NO cuándo llegó el fichero. Un WMS puede
    -- mandar a las 09:00 el corte de medianoche; comparar contra la hora de
    -- recepción daría diferencias que no existen.
    taken_at       timestamptz NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now(),

    source         varchar(24) NOT NULL,
    external_ref   varchar(120) NULL,

    row_count      integer     NOT NULL DEFAULT 0,
    status         varchar(12) NOT NULL DEFAULT 'loading',

    notes          text        NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version        integer     NOT NULL DEFAULT 1,
    deleted_at     timestamptz NULL,

    CONSTRAINT fk_snap_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT uq_snap_tenant_id UNIQUE (tenant_id, id),

    CONSTRAINT chk_snap_source CHECK (source IN ('wms_api', 'csv', 'xlsx', 'manual', 'seed')),
    CONSTRAINT chk_snap_status CHECK (status IN ('loading', 'ready', 'failed', 'superseded')),
    CONSTRAINT chk_snap_rows   CHECK (row_count >= 0),
    CONSTRAINT chk_snap_version CHECK (version >= 1)
);

COMMENT ON TABLE inventory.wms_snapshots IS
    'Un corte del inventario tal como lo declara el WMS. Se carga entero y no se edita fila a fila: es referencia, no dato propio.';
COMMENT ON COLUMN inventory.wms_snapshots.taken_at IS
    'Momento al que se refiere el corte, no cuando llego el fichero. Comparar contra received_at inventaria diferencias que no existen.';

CREATE INDEX idx_snap_wh_taken ON inventory.wms_snapshots (warehouse_id, taken_at DESC)
    WHERE deleted_at IS NULL AND status = 'ready';

CREATE TRIGGER trg_snap_updated_at
    BEFORE UPDATE ON inventory.wms_snapshots
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


CREATE TABLE inventory.wms_stock (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id      uuid        NOT NULL REFERENCES core.tenants(id),
    snapshot_id    uuid        NOT NULL,
    warehouse_id   uuid        NOT NULL,

    -- NULL a propósito: el WMS puede nombrar una ubicación que no existe en
    -- nuestro mapa. Rechazar la fila perdería justamente la incidencia más
    -- interesante —«el WMS cree que hay un hueco que no tenemos»—, así que se
    -- guarda el código en crudo y se resuelve si se puede.
    location_id    uuid        NULL,
    location_code  varchar(60) NOT NULL,

    pallet_code    varchar(80) NULL,
    sku            varchar(80) NULL,
    description    varchar(240) NULL,
    qty            numeric(14,3) NULL,
    uom            varchar(12) NULL,

    -- De quién es la mercadería. Es lo que colorea las zonas del mapa, y por eso
    -- vive AQUÍ y no en el rack: un rack no pertenece a un cliente, su contenido sí.
    client_id      uuid        NULL,

    lot            varchar(60) NULL,
    expires_at     date        NULL,

    raw            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_stock_snapshot FOREIGN KEY (tenant_id, snapshot_id)
        REFERENCES inventory.wms_snapshots (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT fk_stock_client FOREIGN KEY (tenant_id, client_id)
        REFERENCES core.clients (tenant_id, id),

    CONSTRAINT chk_stock_qty CHECK (qty IS NULL OR qty >= 0),
    CONSTRAINT chk_stock_raw_object CHECK (jsonb_typeof(raw) = 'object'),
    CONSTRAINT chk_stock_code CHECK (length(btrim(location_code)) > 0)
);

COMMENT ON TABLE inventory.wms_stock IS
    'Filas de un corte del WMS: que dice que hay en cada ubicacion. location_id es NULL si el codigo no existe en nuestro mapa, y esa discrepancia se conserva a proposito.';
COMMENT ON COLUMN inventory.wms_stock.client_id IS
    'Dueno de la mercaderia. Colorea las zonas del mapa. Vive aqui y no en el rack porque un rack no pertenece a un cliente, su contenido si.';

CREATE INDEX idx_stock_snapshot ON inventory.wms_stock (snapshot_id);
CREATE INDEX idx_stock_location ON inventory.wms_stock (snapshot_id, location_id)
    WHERE location_id IS NOT NULL;
-- Para `v_misplaced`: buscar un pallet por código dentro del corte.
CREATE INDEX idx_stock_pallet ON inventory.wms_stock (snapshot_id, pallet_code)
    WHERE pallet_code IS NOT NULL;
CREATE INDEX idx_stock_client ON inventory.wms_stock (snapshot_id, client_id)
    WHERE client_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · LO OBSERVADO — esto sí es nuestro
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE inventory.scans (
    id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        uuid        NOT NULL REFERENCES core.tenants(id),
    warehouse_id     uuid        NOT NULL,

    -- Contra qué corte del WMS se compara. Si es NULL, la lectura se puede ver
    -- pero no se puede reconciliar: no hay «esperado» con el que contrastar.
    wms_snapshot_id  uuid        NULL,

    -- Con qué modelo se leyó. Sin esto, «este pallet no se detectó» no se puede
    -- atribuir ni a la cámara ni al modelo, y la incidencia no es accionable.
    model_version_id uuid        NULL REFERENCES ai.model_versions(id) ON DELETE SET NULL,

    source           varchar(16) NOT NULL,
    status           varchar(12) NOT NULL DEFAULT 'running',

    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz NULL,

    notes            text        NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version          integer     NOT NULL DEFAULT 1,
    deleted_at       timestamptz NULL,

    CONSTRAINT fk_scan_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT fk_scan_snapshot FOREIGN KEY (tenant_id, wms_snapshot_id)
        REFERENCES inventory.wms_snapshots (tenant_id, id),
    CONSTRAINT uq_scan_tenant_id UNIQUE (tenant_id, id),

    CONSTRAINT chk_scan_source CHECK (source IN ('drone', 'video', 'handheld', 'manual', 'seed')),
    CONSTRAINT chk_scan_status CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
    CONSTRAINT chk_scan_finished CHECK (finished_at IS NULL OR finished_at >= started_at),
    -- Un recorrido terminado tiene que decir cuándo. Sin esto, «done» sin
    -- `finished_at` haría que cualquier informe por fecha lo perdiera.
    CONSTRAINT chk_scan_done_has_end CHECK (
        status <> 'done' OR finished_at IS NOT NULL
    ),
    CONSTRAINT chk_scan_version CHECK (version >= 1)
);

COMMENT ON TABLE inventory.scans IS
    'Un recorrido del dron o un video procesado. Apunta al corte del WMS contra el que se compara: sin el, la lectura se ve pero no se reconcilia.';

CREATE INDEX idx_scan_wh_started ON inventory.scans (warehouse_id, started_at DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_scan_updated_at
    BEFORE UPDATE ON inventory.scans
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


CREATE TABLE inventory.readings (
    id                    uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             uuid          NOT NULL REFERENCES core.tenants(id),
    scan_id               uuid          NOT NULL,
    warehouse_id          uuid          NOT NULL,

    -- NULL cuando no se pudo atribuir la lectura a ninguna ubicación conocida.
    -- Es un resultado legítimo, no un fallo de carga.
    location_id           uuid          NULL,

    -- ── EJE 1 · ATRIBUCIÓN ──────────────────────────────────────────────────
    location_qr           varchar(16)   NOT NULL DEFAULT 'not_attempted',
    location_code_observed varchar(60)  NULL,
    location_confidence   real          NULL,

    -- ── EJE 2 · CONTENIDO ───────────────────────────────────────────────────
    content               varchar(16)   NOT NULL DEFAULT 'unknown',
    content_confidence    real          NULL,

    -- ── EJE 3 · IDENTIDAD ───────────────────────────────────────────────────
    pallet_qr             varchar(16)   NOT NULL DEFAULT 'not_attempted',
    pallet_code_observed  varchar(80)   NULL,
    pallet_confidence     real          NULL,

    -- De dónde salió, para poder ir a mirar la foto cuando el operario discuta
    -- el resultado. Sin esto la incidencia no es defendible.
    image_id              uuid          NULL REFERENCES ai.images(id) ON DELETE SET NULL,
    bbox                  jsonb         NULL,

    observed_at           timestamptz   NOT NULL DEFAULT now(),
    created_at            timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT fk_read_scan FOREIGN KEY (tenant_id, scan_id)
        REFERENCES inventory.scans (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_read_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),

    CONSTRAINT chk_read_locqr CHECK (
        location_qr IN ('read', 'unreadable', 'absent', 'not_attempted')
    ),
    CONSTRAINT chk_read_content CHECK (
        content IN ('pallet', 'object_no_qr', 'empty', 'obstructed', 'unknown')
    ),
    CONSTRAINT chk_read_palqr CHECK (
        pallet_qr IN ('read', 'unreadable', 'absent', 'not_attempted')
    ),

    -- Coherencia entre ejes: si se leyó un QR, tiene que haber código, y al revés.
    -- Sin esto entran filas que dicen «leído» sin decir qué, y la reconciliación
    -- las trataría como identificadas.
    CONSTRAINT chk_read_locqr_code CHECK (
        (location_qr = 'read') = (location_code_observed IS NOT NULL)
    ),
    CONSTRAINT chk_read_palqr_code CHECK (
        (pallet_qr = 'read') = (pallet_code_observed IS NOT NULL)
    ),
    -- No se puede haber leído el QR de un pallet en un hueco declarado vacío.
    CONSTRAINT chk_read_empty_sin_pallet CHECK (
        content <> 'empty' OR pallet_qr IN ('absent', 'not_attempted')
    ),

    CONSTRAINT chk_read_conf_loc CHECK (
        location_confidence IS NULL OR location_confidence BETWEEN 0 AND 1
    ),
    CONSTRAINT chk_read_conf_con CHECK (
        content_confidence IS NULL OR content_confidence BETWEEN 0 AND 1
    ),
    CONSTRAINT chk_read_conf_pal CHECK (
        pallet_confidence IS NULL OR pallet_confidence BETWEEN 0 AND 1
    ),
    CONSTRAINT chk_read_bbox_object CHECK (bbox IS NULL OR jsonb_typeof(bbox) = 'object')
);

COMMENT ON TABLE inventory.readings IS
    'Lo que el dron o el video observo. Tres ejes independientes —atribucion, contenido, identidad— porque «vacia Y con QR ilegible» son dos hechos y un enum plano solo guardaria uno.';
COMMENT ON COLUMN inventory.readings.location_qr IS
    'EJE 1 atribucion: pude saber QUE ubicacion miro. read | unreadable | absent | not_attempted';
COMMENT ON COLUMN inventory.readings.content IS
    'EJE 2 contenido: que habia en el hueco. pallet | object_no_qr | empty | obstructed | unknown';
COMMENT ON COLUMN inventory.readings.pallet_qr IS
    'EJE 3 identidad: pude saber QUE pallet es. read | unreadable | absent | not_attempted';

CREATE INDEX idx_read_scan ON inventory.readings (scan_id);
CREATE INDEX idx_read_scan_loc ON inventory.readings (scan_id, location_id)
    WHERE location_id IS NOT NULL;
-- Para `v_misplaced`: buscar dónde apareció un pallet.
CREATE INDEX idx_read_pallet ON inventory.readings (scan_id, pallet_code_observed)
    WHERE pallet_code_observed IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · LA COMPARACIÓN — derivada, nunca almacenada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ `security_invoker = true` NO es opcional. Una vista normal en Postgres
--   aplica el RLS de su PROPIETARIO, no el de quien consulta: sin esta opción
--   estas tres vistas serían un agujero que devuelve datos de todos los tenants
--   a cualquiera que las lea. Requiere PG 15+; aquí corre 17.6.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIEW inventory.v_reconciliation
WITH (security_invoker = true) AS
SELECT
    r.id                     AS reading_id,
    r.scan_id,
    r.tenant_id,
    r.warehouse_id,
    r.location_id,
    COALESCE(l.code, r.location_code_observed) AS location_code,
    l.logical_x, l.logical_y, l.logical_z,

    r.location_qr,
    r.content,
    r.pallet_qr,
    r.pallet_code_observed,
    r.location_confidence,
    r.content_confidence,
    r.pallet_confidence,
    r.image_id,
    r.observed_at,

    -- El lado esperado viene AGREGADO, no unido fila a fila. Una ubicación puede
    -- tener varias filas de stock —dos SKU, dos pallets— y un LEFT JOIN directo
    -- multiplicaría la lectura por N: la misma observación contada dos veces, y
    -- todos los recuentos del mapa inflados sin que se note.
    e.n                      AS expected_rows,
    e.pallet_codes           AS expected_pallets,
    CASE WHEN e.n = 1 THEN e.pallet_codes[1] END AS expected_pallet,
    e.client_ids             AS expected_clients,
    CASE WHEN array_length(e.client_ids, 1) = 1 THEN e.client_ids[1] END AS expected_client,
    e.skus                   AS expected_skus,
    (COALESCE(e.n, 0) > 0)   AS wms_expects_pallet,

    CASE
        -- Sin atribución no se puede afirmar NADA sobre esta ubicación: la
        -- lectura existe pero no se sabe de dónde es. Va primero a propósito.
        WHEN r.location_id IS NULL OR r.location_qr = 'unreadable'
            THEN 'location_qr_unreadable'

        WHEN r.content = 'obstructed'                THEN 'obstructed'
        WHEN r.content = 'unknown'                   THEN 'not_scanned'

        -- Vacío observado: la diferencia está en si se esperaba algo.
        WHEN r.content = 'empty' AND COALESCE(e.n, 0) = 0 THEN 'verified_empty'
        WHEN r.content = 'empty'                     THEN 'unexpected_empty'

        -- Hay bulto pero sin identidad legible.
        WHEN r.content = 'object_no_qr'
          OR r.pallet_qr IN ('unreadable', 'absent') THEN 'pallet_without_qr'

        -- Hay pallet identificado y el WMS no esperaba nada aquí.
        WHEN r.pallet_qr = 'read' AND COALESCE(e.n, 0) = 0 THEN 'unexpected_pallet'

        -- Hay pallet identificado y ES uno de los que tocaban. Se compara contra
        -- el CONJUNTO esperado, no contra uno solo: si el WMS declara dos pallets
        -- en el hueco y vemos uno de ellos, eso es una coincidencia — tratarlo
        -- como «pallet inesperado» generaría una incidencia falsa en cada
        -- ubicación multi-pallet del almacén.
        WHEN r.pallet_qr = 'read'
         AND r.pallet_code_observed = ANY (e.pallet_codes) THEN 'verified_match'

        -- Identificado, se esperaba algo, y no es ninguno de ellos.
        WHEN r.pallet_qr = 'read'                    THEN 'unexpected_pallet'

        ELSE 'manual_review'
    END AS status,

    -- Una lectura con poca confianza que sale «coincide» sigue mereciendo que
    -- alguien la mire. Se marca aparte en vez de pisar el estado, para no perder
    -- la conclusión ni la duda.
    (COALESCE(r.content_confidence, 1) < 0.60
     OR COALESCE(r.pallet_confidence, 1) < 0.60) AS low_confidence

FROM inventory.readings r
JOIN inventory.scans s        ON s.id = r.scan_id
LEFT JOIN spatial.locations l ON l.id = r.location_id
LEFT JOIN LATERAL (
    -- `FILTER` y no `array_remove(..., NULL)`: el NULL sin tipo deja la llamada
    -- ambigua y Postgres no siempre puede resolverla.
    SELECT count(*)                                                        AS n,
           array_agg(DISTINCT w.pallet_code)
               FILTER (WHERE w.pallet_code IS NOT NULL)                    AS pallet_codes,
           array_agg(DISTINCT w.client_id)
               FILTER (WHERE w.client_id IS NOT NULL)                      AS client_ids,
           array_agg(DISTINCT w.sku)
               FILTER (WHERE w.sku IS NOT NULL)                            AS skus
      FROM inventory.wms_stock w
     WHERE w.snapshot_id = s.wms_snapshot_id
       AND w.location_id = r.location_id
) e ON r.location_id IS NOT NULL;

COMMENT ON VIEW inventory.v_reconciliation IS
    'Estado por ubicacion, DERIVADO de los tres ejes observados contra lo declarado. Cambiar la regla no exige volver a leer el almacen.';


-- El hallazgo relacional: un pallet que aparece donde no le toca. Dos ubicaciones
-- en la misma fila, porque un solo error físico produce dos síntomas separados.
CREATE VIEW inventory.v_misplaced
WITH (security_invoker = true) AS
SELECT DISTINCT      -- un pallet duplicado en el corte del WMS no debe generar
                     -- dos veces la misma incidencia
    r.tenant_id,
    r.warehouse_id,
    r.scan_id,
    r.pallet_code_observed        AS pallet_code,
    r.location_id                 AS found_location_id,
    lf.code                       AS found_location_code,
    e.location_id                 AS expected_location_id,
    e.location_code               AS expected_location_code,
    e.client_id,
    e.sku,
    r.image_id,
    r.observed_at
FROM inventory.readings r
JOIN inventory.scans s      ON s.id = r.scan_id
JOIN inventory.wms_stock e  ON e.snapshot_id = s.wms_snapshot_id
                           AND e.pallet_code = r.pallet_code_observed
LEFT JOIN spatial.locations lf ON lf.id = r.location_id
WHERE r.pallet_qr = 'read'
  AND r.location_id IS NOT NULL
  AND e.location_id IS DISTINCT FROM r.location_id;

COMMENT ON VIEW inventory.v_misplaced IS
    'Pallets vistos donde no les toca. Un error fisico produce DOS sintomas en dos ubicaciones; aqui van enlazados en una fila para que el operario vea un movimiento y no dos incidencias sueltas.';


-- El plano: 347 cajas en vez de 29.312 filas. Sale entero de `logical_x/y/z`,
-- que ya estaban rellenos; esta vista solo los agrega por rack.
CREATE VIEW inventory.v_rack_layout
WITH (security_invoker = true) AS
SELECT
    rk.tenant_id,
    rk.warehouse_id,
    rk.id                  AS rack_id,
    rk.node_code           AS rack_code,
    rk.name                AS rack_name,
    count(DISTINCT b.id)   AS bays,
    count(l.id)            AS locations,
    min(l.logical_x)       AS x0,
    max(l.logical_x)       AS x1,
    min(l.logical_y)       AS y0,
    max(l.logical_y)       AS y1,
    min(l.logical_z)       AS z0,
    max(l.logical_z)       AS z1,
    -- Tres categorías, no un booleano. Un `is_virtual` sí/no se estrella contra los
    -- datos reales de este almacén:
    --
    --   floor      322 racks · x=[1..2002] y=[3..1102] · el plano de verdad
    --   mezzanine   12 racks · MZ01..MZ12 · 1.525 ubicaciones REALES cuya `y` es
    --               genuina (1054..1354) pero cuya `x` es el marcador 70077. Son
    --               entreplanta: almacenaje de verdad, en otro nivel del edificio.
    --               Pintarlos en el plano principal a x=70077 —35 veces más lejos
    --               que el rack más remoto— colapsaría el mapa entero a un punto.
    --               Necesitan su propio plano, no que se les descarte.
    --   virtual     13 racks · DEST01, TARI01 y los 11 con coordenada >= 100000
    --               (BUFFER, CAAU…). No son sitios físicos.
    CASE
        WHEN min(l.logical_x) >= 10000 AND min(l.logical_y) >= 10000 THEN 'virtual'
        WHEN min(l.logical_x) >= 10000 OR  min(l.logical_y) >= 10000 THEN 'mezzanine'
        ELSE 'floor'
    END AS placement
FROM spatial.nodes rk
JOIN spatial.nodes b       ON b.parent_node_id = rk.id AND b.deleted_at IS NULL
JOIN spatial.locations l   ON l.node_id = b.id AND l.deleted_at IS NULL
WHERE rk.node_type = 'rack'
  AND rk.deleted_at IS NULL
GROUP BY rk.tenant_id, rk.warehouse_id, rk.id, rk.node_code, rk.name;

COMMENT ON VIEW inventory.v_rack_layout IS
    'Huella en planta de cada rack, agregada desde logical_x/y/z que ya existian. placement = floor (322, el plano) | mezzanine (12 racks MZ, 1.525 ubicaciones reales con x=70077 de marcador, necesitan plano propio) | virtual (13, no son sitios fisicos).';


-- Las zonas de color del mapa. Un rack NO pertenece a un cliente —eso ya se
-- decidió— así que la zona no es un atributo: se deriva de quién es la mercadería
-- que hay dentro, y por eso cambia con cada corte del WMS.
--
-- Eso es una ventaja, no un problema: un rack que era 100 % EPA y hoy sale 60/40
-- está enseñando una invasión de zona que un campo estático habría ocultado.
--
-- Lleva `snapshot_id` en la salida en vez de fijar «el último»: el mapa elige
-- contra qué corte pinta, y así se pueden comparar dos fechas.
CREATE VIEW inventory.v_rack_clients
WITH (security_invoker = true) AS
SELECT
    w.tenant_id,
    w.snapshot_id,
    rk.warehouse_id,
    rk.id                    AS rack_id,
    rk.node_code             AS rack_code,
    w.client_id,
    c.code                   AS client_code,
    c.name                   AS client_name,
    count(*)                 AS locations,
    -- Cuánto del rack es de este cliente. Con esto el mapa puede pintar el rack
    -- del color del dueño mayoritario y marcar los mixtos.
    round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY w.snapshot_id, rk.id), 1)
                             AS pct_del_rack
FROM inventory.wms_stock w
JOIN spatial.locations l   ON l.id = w.location_id AND l.deleted_at IS NULL
JOIN spatial.nodes b       ON b.id = l.node_id AND b.deleted_at IS NULL
JOIN spatial.nodes rk      ON rk.id = b.parent_node_id
                          AND rk.node_type = 'rack' AND rk.deleted_at IS NULL
LEFT JOIN core.clients c   ON c.id = w.client_id
WHERE w.location_id IS NOT NULL
GROUP BY w.tenant_id, w.snapshot_id, rk.warehouse_id, rk.id, rk.node_code,
         w.client_id, c.code, c.name;

COMMENT ON VIEW inventory.v_rack_clients IS
    'Reparto por cliente de cada rack en un corte dado: las zonas de color del mapa. Derivado del contenido, no un atributo del rack — por eso un rack que pasa de 100% a 60/40 delata una invasion de zona.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Patrón calcado de `core.clients` (0063): restrictiva por tenant + permisiva
-- para los miembros, y FORCE para que ni el propietario se la salte.
--
-- ⚠ Recordatorio de por qué FORCE importa aquí: una tabla con RLS y sin política
--   para una operación NO la rechaza — afecta a CERO FILAS en silencio. Las
--   cuatro tablas llevan política FOR ALL para que no quede ningún hueco mudo.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['wms_snapshots', 'wms_stock', 'scans', 'readings']
    LOOP
        EXECUTE format('ALTER TABLE inventory.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE inventory.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON inventory.%I
                AS RESTRICTIVE FOR ALL TO authenticated, olo_app
                USING (tenant_id = core.current_tenant_id())
                WITH CHECK (tenant_id = core.current_tenant_id())
        $f$, t);

        EXECUTE format($f$
            CREATE POLICY tenant_members ON inventory.%I
                AS PERMISSIVE FOR ALL TO authenticated, olo_app
                USING (tenant_id = core.current_tenant_id())
                WITH CHECK (tenant_id = core.current_tenant_id())
        $f$, t);

        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.%I TO olo_app', t);
    END LOOP;
END $$;

GRANT SELECT ON inventory.v_reconciliation, inventory.v_misplaced,
                inventory.v_rack_layout, inventory.v_rack_clients
    TO olo_app, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · PERMISOS DEL CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════════
-- Scope `tenant`. `inventory:import` es privilegiado: cargar un corte del WMS
-- redefine cuál es «lo esperado» para todo el almacén, y por tanto puede hacer
-- desaparecer incidencias reales.
--
-- ⚠ `inventory:read` NO SE TOCA AQUÍ. Ya existe desde la migración 0013, que además
--   lo concede a los cinco roles del sistema. Incluirlo en este INSERT era inocuo
--   —el ON CONFLICT lo absorbía— pero convertía el ROLLBACK en destructivo: borraba
--   las concesiones de un permiso que esta migración no creó. Ocurrió: dejó
--   `core.role_permissions` en 67 en vez de 72 y `tenant_admin` en 29 en vez de 30.
--
--   Regla que se saca de ahí: una migración solo puede retirar lo que ella misma
--   introdujo. Si un permiso ya existe, se USA, no se redeclara.

INSERT INTO core.permissions (code, module, action, description, is_privileged, scope)
VALUES
    ('inventory:import', 'inventory', 'import', 'Cargar un corte del WMS',                    true,  'tenant'),
    ('scans:read',       'scans',     'read',   'Ver los recorridos y su reconciliacion',     false, 'tenant'),
    ('scans:create',     'scans',     'create', 'Lanzar o registrar un recorrido',            false, 'tenant'),
    ('scans:export',     'scans',     'export', 'Exportar incidencias a Excel',               false, 'tenant')
ON CONFLICT (code) DO UPDATE
   SET module      = EXCLUDED.module,
       action      = EXCLUDED.action,
       description = EXCLUDED.description,
       scope       = EXCLUDED.scope;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_tablas int; v_force int; v_pol int; v_vistas int;
    v_inv    int; v_perm int; v_racks int;
    v_floor  int; v_mez int; v_virt int;
BEGIN
    SELECT count(*) INTO v_tablas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'inventory' AND c.relkind = 'r';
    IF v_tablas <> 4 THEN
        RAISE EXCEPTION 'esperaba 4 tablas en inventory, hay %', v_tablas;
    END IF;

    SELECT count(*) INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'inventory' AND c.relkind = 'r'
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_force <> 4 THEN
        RAISE EXCEPTION 'las 4 tablas deben tener RLS + FORCE, tienen %', v_force;
    END IF;

    SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname = 'inventory';
    IF v_pol <> 8 THEN
        RAISE EXCEPTION 'esperaba 8 politicas (2 por tabla), hay %', v_pol;
    END IF;

    SELECT count(*) INTO v_vistas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'inventory' AND c.relkind = 'v';
    IF v_vistas <> 4 THEN
        RAISE EXCEPTION 'esperaba 4 vistas, hay %', v_vistas;
    END IF;

    -- Lo más importante de toda la verificación: sin `security_invoker` las
    -- vistas devolverían datos de otros tenants.
    SELECT count(*) INTO v_inv
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'inventory' AND c.relkind = 'v'
       AND c.reloptions @> ARRAY['security_invoker=true'];
    IF v_inv <> 4 THEN
        RAISE EXCEPTION 'las 4 vistas deben ser security_invoker, lo son %', v_inv;
    END IF;

    -- Los 5 códigos que el módulo necesita tienen que EXISTIR. Cuatro los crea esta
    -- migración; `inventory:read` viene de la 0013 y solo se comprueba que siga ahí.
    SELECT count(*) INTO v_perm FROM core.permissions
     WHERE code IN ('inventory:read','inventory:import','scans:read','scans:create','scans:export');
    IF v_perm <> 5 THEN
        RAISE EXCEPTION 'faltan permisos: de los 5 codigos solo existen %', v_perm;
    END IF;

    -- Y `inventory:read` tiene que conservar sus concesiones de la 0013. Si esto
    -- salta, alguien volvió a tratarlo como propio de esta migración.
    SELECT count(*) INTO v_perm FROM core.role_permissions
     WHERE permission_code = 'inventory:read';
    IF v_perm <> 5 THEN
        RAISE EXCEPTION
            'inventory:read deberia seguir concedido a los 5 roles de la 0013, esta en %',
            v_perm;
    END IF;

    -- El plano tiene que salir de datos que ya existían, y el reparto tiene que
    -- ser el medido: si `mezzanine` sale 0, el umbral volvió a tragarse los MZ y el
    -- mapa se colapsaría a un punto sin avisar.
    SELECT count(*) FILTER (WHERE placement = 'floor'),
           count(*) FILTER (WHERE placement = 'mezzanine'),
           count(*) FILTER (WHERE placement = 'virtual'),
           count(*)
      INTO v_floor, v_mez, v_virt, v_racks
      FROM inventory.v_rack_layout;
    RAISE NOTICE 'v_rack_layout: % racks · floor=% mezzanine=% virtual=%',
                 v_racks, v_floor, v_mez, v_virt;
    IF v_racks <> 347 THEN
        RAISE EXCEPTION 'el plano ve % racks; esperaba 347', v_racks;
    END IF;
    IF v_mez <> 12 THEN
        RAISE EXCEPTION 'esperaba 12 racks de entreplanta (MZ01..MZ12), hay %', v_mez;
    END IF;
    IF v_floor <> 322 THEN
        RAISE EXCEPTION 'esperaba 322 racks en planta, hay %', v_floor;
    END IF;

    RAISE NOTICE '0064 OK · 4 tablas · 8 politicas · 4 vistas security_invoker · 5 permisos';
END $$;
