-- ═══════════════════════════════════════════════════════════════════════════
--  0065 · COLOCACIÓN DE LOS RACKS EN EL PLANO
--
--  Crea      : spatial.warehouse_layouts, spatial.rack_placements
--  Depende de: 0005 (core.set_updated_at), 0020 (core.can_access_warehouse),
--              0049 (spatial.sites), 0050 (spatial.nodes)
--  Rollback  : migrations/rollbacks/0065_spatial_rack_placements_rollback.sql
--
--  ── QUÉ PROBLEMA RESUELVE ─────────────────────────────────────────────────
--
--  El editor de plano permite situar cada rack sobre la imagen del almacén, y esa
--  colocación es el ÚNICO dato del sistema que ninguna importación puede deducir:
--  el DWG del almacén no contiene los códigos del WMS —se verificó buscando RCL,
--  PURT, CHEQ y MDESP en el DXF de 8.408 entidades: cero coincidencias—, así que
--  «esta hilera del plano es RCL01» solo lo sabe una persona.
--
--  Hasta ahora ese trabajo vivía en `localStorage` del navegador que lo hizo. No
--  es un detalle de implementación: significa que el visor 3D de un conjunto de
--  racks, los mapas de calor y la ruta de un dron no se pueden construir, porque
--  el dato no existe para nadie más.
--
--  ── POR QUÉ DOS TABLAS ────────────────────────────────────────────────────
--
--  `rack_placements` es DOMINIO: dónde está cada rack, en metros, dentro del
--  almacén. Sobrevive al plano con el que se dibujó y no menciona imágenes.
--
--  `warehouse_layouts` es el ESPACIO DE TRABAJO: qué imagen se usó, cuántos
--  píxeles son un metro y dónde se puso el origen. Sin él, reabrir el editor
--  obliga a recalibrar a mano; con él, el trabajo continúa donde se dejó.
--
--  Mezclarlas obligaría a repetir la calibración en 347 filas y a decidir cuál de
--  ellas manda cuando difieran.
--
--  ── POR QUÉ EN METROS Y NO EN PÍXELES DEL PLANO ───────────────────────────
--
--  El editor trabaja en píxeles de la imagen porque es lo que el ratón toca. Pero
--  un píxel no mide nada: los mismos 20 px son 0,40 m en un plano y 0,75 m en
--  otro, y al cambiar de imagen —o al recalibrar— todas las posiciones dejarían de
--  significar lo mismo. En la base se guardan metros respecto al origen del
--  almacén, que es lo que el negocio entiende y lo que un dron puede comparar.
--
--  ── LO QUE ESTA MIGRACIÓN NO HACE ─────────────────────────────────────────
--
--  No rellena `spatial.locations.world_position` (0052, hoy 100 % NULL). Esa
--  geometría se DERIVA de la colocación del rack combinada con el cuerpo, nivel y
--  posición de cada ubicación, y se materializa en un paso aparte para no meter
--  29.312 escrituras dentro de una migración de esquema.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · El espacio de trabajo del almacén ──────────────────────────────────
CREATE TABLE spatial.warehouse_layouts (
    id                 uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          uuid         NOT NULL REFERENCES core.tenants(id),
    warehouse_id       uuid         NOT NULL,

    -- Nombre del archivo del plano. La IMAGEN NO se guarda aquí: un PNG de un
    -- plano ronda los cientos de KB y la base no es un almacén de archivos. Sirve
    -- para que el editor sepa si el operador tiene cargado el plano correcto.
    plan_name          varchar(200) NULL,
    plan_width_px      integer      NULL,
    plan_height_px     integer      NULL,

    -- La escala. Es el dato que convierte el dibujo en medidas: sin él, todo lo
    -- que hay encima son píxeles.
    pixels_per_meter   double precision NOT NULL DEFAULT 50,

    -- Origen del sistema de coordenadas, en píxeles del plano. Guardarlo permite
    -- reabrir el editor con el mismo encuadre y recomponer los metros al revés.
    origin_x_px        double precision NOT NULL DEFAULT 0,
    origin_y_px        double precision NOT NULL DEFAULT 0,

    -- `true` cuando alguien marcó dos puntos y dijo cuánto miden. Un valor por
    -- defecto de 50 px/m NO es una calibración, y la interfaz debe poder
    -- distinguirlo para no presentar como medido lo que es un supuesto.
    is_calibrated      boolean      NOT NULL DEFAULT false,

    published_at       timestamptz  NULL,
    published_by       uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,

    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    updated_by         uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version            integer      NOT NULL DEFAULT 1,

    -- UN layout por almacén. Varias versiones en paralelo abren la pregunta de
    -- cuál es la buena, y esa pregunta no tiene respuesta automática.
    CONSTRAINT uq_layout_warehouse UNIQUE (tenant_id, warehouse_id),
    -- Requerida por la FK de rack_placements.
    CONSTRAINT uq_layout_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),

    CONSTRAINT chk_layout_ppm     CHECK (pixels_per_meter > 0),
    CONSTRAINT chk_layout_plan_px CHECK (
        (plan_width_px IS NULL AND plan_height_px IS NULL)
        OR (plan_width_px > 0 AND plan_height_px > 0)
    ),
    CONSTRAINT chk_layout_version CHECK (version >= 1)
);

COMMENT ON TABLE spatial.warehouse_layouts IS
    'Espacio de trabajo del editor de plano: imagen usada, escala y origen. Uno por almacen. La imagen NO se guarda aqui.';
COMMENT ON COLUMN spatial.warehouse_layouts.is_calibrated IS
    'true solo si alguien midio dos puntos. El valor por defecto de pixels_per_meter no es una calibracion.';

-- ── 2 · Dónde está cada rack ───────────────────────────────────────────────
CREATE TABLE spatial.rack_placements (
    id               uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        uuid         NOT NULL REFERENCES core.tenants(id),
    warehouse_id     uuid         NOT NULL,
    layout_id        uuid         NOT NULL,

    -- El nodo del árbol espacial que se está colocando. Es la identidad REAL del
    -- rack; el código (`RCL01`) es único por almacén, no globalmente.
    rack_node_id     uuid         NOT NULL,

    -- Centro del rack en METROS respecto al origen del layout.
    x_m              double precision NOT NULL,
    y_m              double precision NOT NULL,
    -- Grados. 0 = el largo apunta al eje Y del plano.
    rotation_deg     double precision NOT NULL DEFAULT 0,

    -- Dimensiones físicas. Se guardan con la colocación y no en el catálogo porque
    -- el catálogo del WMS no las trae: son una medida del mundo que alguien toma.
    width_m          double precision NOT NULL,
    length_m         double precision NOT NULL,
    height_m         double precision NOT NULL,

    -- Cosmético: agrupar visualmente familias o marcar lo pendiente de revisar.
    color            varchar(9)   NULL,
    -- Un rack colocado y verificado se bloquea para que un arrastre no lo mueva.
    is_locked        boolean      NOT NULL DEFAULT false,

    created_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    updated_by       uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,

    -- ⚠ LA GARANTÍA FUERTE, igual que en spatial.nodes: la FK compuesta hace
    -- INEXPRESABLE colocar un rack de otro tenant o de otro almacén. No es una
    -- comprobación que se pueda saltar; es que no se puede escribir.
    CONSTRAINT fk_placement_node FOREIGN KEY (tenant_id, warehouse_id, rack_node_id)
        REFERENCES spatial.nodes (tenant_id, warehouse_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_placement_layout FOREIGN KEY (tenant_id, warehouse_id, layout_id)
        REFERENCES spatial.warehouse_layouts (tenant_id, warehouse_id, id) ON DELETE CASCADE,

    -- Un rack está en un sitio, no en dos.
    CONSTRAINT uq_placement_rack UNIQUE (tenant_id, warehouse_id, rack_node_id),

    -- 5 cm es el mínimo por debajo del cual un rack deja de ser un rack. El
    -- editor ya lo impone al arrastrar; aquí se impide que llegue por API.
    CONSTRAINT chk_placement_medidas CHECK (
        width_m >= 0.05 AND length_m >= 0.05 AND height_m >= 0.05
        AND width_m <= 200 AND length_m <= 200 AND height_m <= 60
    ),
    -- Normalizado a [0, 360): un -270 obliga a normalizar en cada lectura.
    CONSTRAINT chk_placement_rotacion CHECK (rotation_deg >= 0 AND rotation_deg < 360),
    -- ±10 km cubre cualquier almacén y detecta un error de unidades: quien envíe
    -- píxeles en lugar de metros se sale del rango en cuanto el plano es grande.
    CONSTRAINT chk_placement_coords CHECK (
        x_m BETWEEN -10000 AND 10000 AND y_m BETWEEN -10000 AND 10000
    ),
    CONSTRAINT chk_placement_color CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
);

COMMENT ON TABLE spatial.rack_placements IS
    'Donde esta cada rack DENTRO del almacen, en metros. Es el unico dato que ninguna importacion puede deducir: el DWG no contiene los codigos del WMS.';
COMMENT ON COLUMN spatial.rack_placements.x_m IS
    'Centro del rack en metros respecto al origen del layout. En metros y no en pixeles: un pixel no mide nada y cambia con el plano.';

-- ── 3 · Índices ────────────────────────────────────────────────────────────
-- Por almacén: es como se lee siempre —«dame la colocación de este almacén»— y
-- son 347 filas, no una búsqueda por rack.
CREATE INDEX ix_placement_warehouse
    ON spatial.rack_placements (tenant_id, warehouse_id);
CREATE INDEX ix_placement_layout
    ON spatial.rack_placements (layout_id);

-- ── 4 · Disparadores ───────────────────────────────────────────────────────
CREATE TRIGGER trg_layout_updated_at
    BEFORE UPDATE ON spatial.warehouse_layouts
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER trg_placement_updated_at
    BEFORE UPDATE ON spatial.rack_placements
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ── 5 · RLS ────────────────────────────────────────────────────────────────
--
-- Mismo patrón que `spatial.nodes`, y por el mismo motivo: es dato de tenant con
-- alcance de almacén. La RESTRICTIVE aísla el tenant y la PERMISSIVE exige acceso
-- al almacén concreto; combinadas, un usuario ve exactamente los almacenes que
-- puede ver.
ALTER TABLE spatial.warehouse_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.warehouse_layouts FORCE  ROW LEVEL SECURITY;
ALTER TABLE spatial.rack_placements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.rack_placements   FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON spatial.warehouse_layouts
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON spatial.warehouse_layouts
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON spatial.rack_placements
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON spatial.rack_placements
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

-- ── 6 · Grants ─────────────────────────────────────────────────────────────
--
-- No hace falta conceder nada: la 0047 dejó default privileges en el esquema
-- `spatial` que dan DML completo a `olo_app` en cada tabla nueva. Se comprueba en
-- la verificación de abajo en lugar de asumirlo.

-- ── 7 · Vista de lectura ───────────────────────────────────────────────────
--
-- El frontend necesita el CÓDIGO del rack junto a su posición; pedirlo por
-- separado obliga a cruzar 347 filas en el cliente en cada carga.
CREATE VIEW spatial.v_rack_placements AS
SELECT p.id,
       p.tenant_id,
       p.warehouse_id,
       p.layout_id,
       p.rack_node_id,
       n.node_code      AS rack_code,
       n.node_type,
       n.node_function,
       p.x_m,
       p.y_m,
       p.rotation_deg,
       p.width_m,
       p.length_m,
       p.height_m,
       p.color,
       p.is_locked,
       p.updated_at
  FROM spatial.rack_placements p
  JOIN spatial.nodes n
    ON n.tenant_id = p.tenant_id
   AND n.warehouse_id = p.warehouse_id
   AND n.id = p.rack_node_id
 WHERE n.deleted_at IS NULL;

COMMENT ON VIEW spatial.v_rack_placements IS
    'Colocacion con el codigo del rack resuelto. security_invoker: la vista respeta las policies de quien consulta.';

-- Sin esto la vista se ejecutaría con los permisos de su dueño y saltaría RLS.
ALTER VIEW spatial.v_rack_placements SET (security_invoker = true);
GRANT SELECT ON spatial.v_rack_placements TO olo_app, authenticated;

-- ── 8 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_policies integer;
    v_dml      boolean;
BEGIN
    SELECT count(*) INTO v_policies
      FROM pg_policies
     WHERE schemaname = 'spatial'
       AND tablename IN ('warehouse_layouts', 'rack_placements');
    IF v_policies <> 4 THEN
        RAISE EXCEPTION 'Se esperaban 4 policies y hay %', v_policies;
    END IF;

    SELECT has_table_privilege('olo_app', 'spatial.rack_placements', 'INSERT')
      INTO v_dml;
    IF NOT v_dml THEN
        RAISE EXCEPTION 'olo_app no puede escribir en spatial.rack_placements: revisar default privileges de 0047';
    END IF;

    RAISE NOTICE '0065 OK · 2 tablas, 4 policies, vista con security_invoker, DML de olo_app verificado';
END $$;

