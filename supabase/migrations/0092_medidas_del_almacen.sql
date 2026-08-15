-- ═══════════════════════════════════════════════════════════════════════════════
-- 0092 · Las medidas reales del almacén: de convención a dato
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────────
--
-- El modelo 3D dibuja los racks con medidas INVENTADAS. Están declaradas y comentadas
-- —1,35 m por posición, 1,7 m por nivel, 1,1 m de fondo— y sirven para que las
-- proporciones entre racks sean correctas: uno con el triple de cuerpos se dibuja tres
-- veces más largo.
--
-- Pero no son las de este almacén. Nadie las ha medido. Y eso pone un techo a todo lo que
-- venga después: sin metros reales no hay volumen de un hueco, no hay comprobación de si
-- una tarima cabe, y no hay simulación posible — la distancia que recorre un dron entre
-- dos niveles es aritmética simple SOBRE MEDIDAS CIERTAS, y basura sobre medidas supuestas.
--
-- ── POR QUE NO ES UNA SOLA FILA POR ALMACEN ───────────────────────────────────
--
-- Porque las familias no miden igual. Medido en el catálogo real:
--
--     RCL   21 cuerpos, 7 niveles, 2 posiciones por cuerpo
--     MZ    27 cuerpos, 5 niveles, 1 posición por cuerpo
--
-- Un cuerpo de dos posiciones es del orden del doble de ancho que uno de una. Con una
-- medida única para el almacén, la mitad de los racks se dibujarían mal — y peor: los
-- cálculos de volumen darían un número con aspecto de exacto.
--
-- Así que: una fila SIN familia es la medida por defecto del almacén, y una fila CON
-- familia la sustituye para esos racks. Es la misma idea que una hoja de estilo: lo general
-- y sus excepciones, no una tabla por cada caso.
--
-- ── LO QUE NO HACE ESTA MIGRACION ─────────────────────────────────────────────
--
-- No inventa medidas. Todas las columnas son NULL hasta que alguien las mida, y el visor
-- sigue usando sus convenciones mientras tanto — diciendo que lo son—. Rellenar esto con
-- «valores típicos de almacén» sería exactamente el defecto que el panel de inicio tuvo:
-- una cifra inventada presentada como medida.
--
-- `double_deep` es el ejemplo claro: HOY el sistema no lo usa para nada, y aun así se
-- guarda, porque decide si un hueco puede tener dos tarimas y la cámara solo ve una. Sin
-- ese dato, «vacío inesperado» en un rack de doble fondo es un falso positivo sistemático.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS spatial.warehouse_metrics (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES core.tenants(id),
    warehouse_id    uuid NOT NULL,

    -- ── A quién se aplica ─────────────────────────────────────────────────────
    --
    -- `NULL` = las medidas por defecto del almacén. Un prefijo —`RCL`, `MZ`, `PURT`—
    -- sustituye a las de por defecto para esos racks. El prefijo y no el rack concreto:
    -- 209 racks `RCL` comparten construcción, y una fila por rack serían 347 filas que
    -- nadie mantiene.
    rack_family     varchar(20),

    -- ── La tarima ─────────────────────────────────────────────────────────────
    pallet_width_m  double precision,
    pallet_depth_m  double precision,
    pallet_height_m double precision,

    -- ── El hueco ──────────────────────────────────────────────────────────────
    --
    -- El fondo es el que se mide con cinta; el ancho y el alto salen del cuerpo y del
    -- nivel, pero se pueden declarar aparte cuando el hueco no ocupa el cuerpo entero.
    slot_width_m    double precision,
    slot_height_m   double precision,
    slot_depth_m    double precision,

    -- ── La estructura ─────────────────────────────────────────────────────────
    bay_width_m     double precision,
    level_height_m  double precision,
    rack_height_m   double precision,
    rack_depth_m    double precision,
    upright_width_m double precision,
    beam_height_m   double precision,

    -- ── El entorno ────────────────────────────────────────────────────────────
    aisle_width_m   double precision,
    aisle_length_m  double precision,

    -- ── Lo que cambia los cálculos y hoy no se usa ────────────────────────────
    --
    -- Un rack de doble fondo guarda dos tarimas por hueco, una detrás de otra, y la cámara
    -- solo puede ver la de delante. El sistema no lo tiene en cuenta todavía; guardarlo es
    -- lo que permitirá que «vacío inesperado» deje de ser un falso positivo ahí.
    double_deep     boolean,

    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    version         integer NOT NULL DEFAULT 1,
    deleted_at      timestamptz,

    CONSTRAINT fk_metrics_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses(tenant_id, id) ON DELETE CASCADE
);

-- Una fila por almacén y familia. `NULL` cuenta como valor: dos filas por defecto del
-- mismo almacén serían dos verdades sobre lo mismo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics_ambito
    ON spatial.warehouse_metrics (warehouse_id, COALESCE(rack_family, ''))
    WHERE deleted_at IS NULL;

-- ── Ninguna medida puede ser cero o negativa ─────────────────────────────────
--
-- Un cero no es «no lo sé» —para eso está NULL— y un rack de altura cero desaparece del
-- visor sin decir por qué. El tope de 100 m corta los errores de unidad: quien teclee
-- centímetros donde van metros lo descubre al guardar, no al ver un almacén de 12 km.
ALTER TABLE spatial.warehouse_metrics
    ADD CONSTRAINT chk_metrics_positivas CHECK (
        (pallet_width_m  IS NULL OR (pallet_width_m  > 0 AND pallet_width_m  <= 100)) AND
        (pallet_depth_m  IS NULL OR (pallet_depth_m  > 0 AND pallet_depth_m  <= 100)) AND
        (pallet_height_m IS NULL OR (pallet_height_m > 0 AND pallet_height_m <= 100)) AND
        (slot_width_m    IS NULL OR (slot_width_m    > 0 AND slot_width_m    <= 100)) AND
        (slot_height_m   IS NULL OR (slot_height_m   > 0 AND slot_height_m   <= 100)) AND
        (slot_depth_m    IS NULL OR (slot_depth_m    > 0 AND slot_depth_m    <= 100)) AND
        (bay_width_m     IS NULL OR (bay_width_m     > 0 AND bay_width_m     <= 100)) AND
        (level_height_m  IS NULL OR (level_height_m  > 0 AND level_height_m  <= 100)) AND
        (rack_height_m   IS NULL OR (rack_height_m   > 0 AND rack_height_m   <= 100)) AND
        (rack_depth_m    IS NULL OR (rack_depth_m    > 0 AND rack_depth_m    <= 100)) AND
        (upright_width_m IS NULL OR (upright_width_m > 0 AND upright_width_m <= 100)) AND
        (beam_height_m   IS NULL OR (beam_height_m   > 0 AND beam_height_m   <= 100)) AND
        (aisle_width_m   IS NULL OR (aisle_width_m   > 0 AND aisle_width_m   <= 100)) AND
        (aisle_length_m  IS NULL OR (aisle_length_m  > 0 AND aisle_length_m  <= 1000))
    );

COMMENT ON TABLE spatial.warehouse_metrics IS
    'Medidas REALES del almacen, medidas con cinta. Una fila sin `rack_family` es la '
    'medida por defecto; una con familia la sustituye para esos racks. Todo NULL hasta '
    'que alguien lo mida: el visor usa convenciones mientras tanto y lo dice.';

-- ── RLS, igual que el resto de `spatial` ─────────────────────────────────────

ALTER TABLE spatial.warehouse_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.warehouse_metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY metrics_select ON spatial.warehouse_metrics
    FOR SELECT USING (tenant_id = core.current_tenant_id());

CREATE POLICY metrics_write ON spatial.warehouse_metrics
    FOR ALL USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.warehouse_metrics TO olo_app, authenticated;

-- ── El volumen de un hueco, derivado y no guardado ───────────────────────────
--
-- Se calcula, no se almacena: un volumen guardado se queda viejo en cuanto alguien corrige
-- una de las tres medidas, y entonces hay dos verdades sobre el mismo hueco.
CREATE OR REPLACE VIEW spatial.v_warehouse_metrics
WITH (security_invoker = true) AS
SELECT m.*,
       CASE
           WHEN m.slot_width_m IS NOT NULL
            AND m.slot_height_m IS NOT NULL
            AND m.slot_depth_m IS NOT NULL
           THEN round((m.slot_width_m * m.slot_height_m * m.slot_depth_m)::numeric, 4)
       END AS slot_volume_m3,
       CASE
           WHEN m.pallet_width_m IS NOT NULL
            AND m.pallet_depth_m IS NOT NULL
            AND m.pallet_height_m IS NOT NULL
           THEN round((m.pallet_width_m * m.pallet_depth_m * m.pallet_height_m)::numeric, 4)
       END AS pallet_volume_m3,
       --  Cuantas medidas de las 14 estan tomadas. Es lo que permite a la pantalla decir
       --  «faltan 9» en vez de enseñar una tabla de huecos sin explicar nada.
       (
           (m.pallet_width_m IS NOT NULL)::int + (m.pallet_depth_m IS NOT NULL)::int +
           (m.pallet_height_m IS NOT NULL)::int + (m.slot_width_m IS NOT NULL)::int +
           (m.slot_height_m IS NOT NULL)::int + (m.slot_depth_m IS NOT NULL)::int +
           (m.bay_width_m IS NOT NULL)::int + (m.level_height_m IS NOT NULL)::int +
           (m.rack_height_m IS NOT NULL)::int + (m.rack_depth_m IS NOT NULL)::int +
           (m.upright_width_m IS NOT NULL)::int + (m.beam_height_m IS NOT NULL)::int +
           (m.aisle_width_m IS NOT NULL)::int + (m.aisle_length_m IS NOT NULL)::int
       ) AS medidas_tomadas
  FROM spatial.warehouse_metrics m
 WHERE m.deleted_at IS NULL;

GRANT SELECT ON spatial.v_warehouse_metrics TO olo_app, authenticated;

DO $$
BEGIN
    RAISE NOTICE 'OK · tabla de medidas creada, VACIA a proposito: ninguna medida se '
                 'inventa. El visor sigue con sus convenciones y lo dice.';
END $$;
