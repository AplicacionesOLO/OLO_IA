-- ═══════════════════════════════════════════════════════════════════════════
-- 0050_spatial_node_tree.sql
-- Crea     : spatial.node_types · spatial.node_functions · spatial.node_edges
--            spatial.nodes · core.spatial_node_guard()
-- Depende de: 0020 (core.is_platform_owner), 0049 (spatial.sites)
-- Riesgo   : medio · introduce el árbol y su trigger de integridad
--
-- SEPARACIÓN ESTRUCTURA / FUNCIÓN (ADR-010 §6)
--
--   `node_type`     = QUÉ ES el nodo en el árbol. 6 valores, cerrado por migración.
--   `node_function` = PARA QUÉ SIRVE. Catálogo gobernable, global, sin tenant_id.
--
--   El criterio no es estético: valores con idéntico comportamiento estructural no
--   son tipos estructurales. `dock`, `buffer`, `inspection`, `staging` y `bulk`
--   contienen todos lo mismo —ubicaciones— así que como `node_type` obligarían a
--   una matriz de aristas que crece MULTIPLICATIVAMENTE:
--       vocabulario plano     6 estructurales × 5 funcionales = 30 aristas extra
--       vocabulario separado  6 estructurales + 1 atributo    =  0 aristas extra
--
--   `warehouse` y `site` NO son tipos: son tablas (core.warehouses, spatial.sites).
--   Ponerlos también aquí reintroduciría dos modelos parciales del mismo concepto.
--
-- POR QUÉ node_functions ES CATÁLOGO Y NO ENUM NI CHECK
--
--   ENUM está descartado por medición: se verificó contra este motor que
--   `ALTER TYPE ... ADD VALUE` **no permite usar el valor en la misma
--   transacción** (SQLSTATE 55P04), y cada migración de este proyecto es una sola
--   transacción. Una migración que añada una función y reclasifique filas fallaría.
--
--   Y frente a un CHECK, el catálogo gana porque TIENE ALGO QUE GUARDAR: el mapeo
--   de `Tipo Ubicación` del WMS (5 valores medidos), `implies_bulk`, `is_active`,
--   `display_name`. Con un CHECK ese mapeo viviría en un diccionario del importador
--   y un valor nuevo del WMS exigiría desplegar.
--
-- INTEGRIDAD DE LA JERARQUÍA · tres mecanismos, del más fuerte al más débil
--
--   1. FK COMPUESTA (tenant_id, warehouse_id, parent_node_id) → (tenant_id,
--      warehouse_id, id). Hace INEXPRESABLE que un nodo cuelgue de otro tenant o
--      de otro almacén. Es garantía del motor, no comprobación de aplicación.
--   2. CHECK `parent_node_id <> id`. Cubre el autopadre directo.
--   3. TRIGGER. Los ciclos de más de un salto NO son expresables con CHECK ni FK:
--      A→B→C→A cumple todas las restricciones locales. Hace falta recorrer los
--      ancestros, y eso solo se puede hacer en un trigger. Es el mecanismo mínimo
--      necesario, y también valida la matriz de aristas por la misma razón: es una
--      búsqueda en otra tabla.
--
-- Los códigos de error viajan por `DETAIL` estable, nunca por el texto del mensaje
-- (PLT-07). `SPATIAL_NODE_EDGE_INVALID` y `SPATIAL_NODE_CYCLE` quedan registrados
-- en el traductor de la aplicación; su prueba de exhaustividad lo verifica.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Catálogo 1 · tipos estructurales · CERRADO por migración ───────────────
CREATE TABLE spatial.node_types (
    code         varchar(20)  PRIMARY KEY,
    display_name varchar(60)  NOT NULL,
    -- Orden de profundidad esperado, para ordenar interfaces sin cablearlo.
    depth_hint   smallint     NOT NULL,
    notes        text         NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT chk_nt_code CHECK (code ~ '^[a-z][a-z_]*$'),
    CONSTRAINT chk_nt_depth CHECK (depth_hint BETWEEN 1 AND 20)
);

COMMENT ON TABLE spatial.node_types IS
    'Vocabulario ESTRUCTURAL del arbol espacial. CERRADO: solo cambia por migracion, porque la estructura cambia con obra (SPA-04). Global, sin tenant_id.';

INSERT INTO spatial.node_types (code, display_name, depth_hint, notes) VALUES
    ('building',     'Edificio',            1, 'Nave o edificio dentro de un sitio'),
    ('floor',        'Planta',              2, 'Nivel del edificio. Los prefijos ASCEN/ASCN sugieren ascensor, pero el dato no lo confirma'),
    ('zone',         'Sector',              3, 'Agrupacion logica dentro de una planta'),
    ('aisle',        'Pasillo',             4, 'Pasillo de circulacion entre estanterias'),
    ('rack',         'Estanteria',          5, 'Estructura fisica. RCL57 y CANT1A parecen serlo'),
    ('storage_area', 'Area de almacenaje',  6, 'Contenedor de ubicaciones. Es el tipo de los 347 IdAlmacenamiento medidos');


-- ── Catálogo 2 · funciones operativas · GOBERNABLE, global, sin tenant_id ──
CREATE TABLE spatial.node_functions (
    code          varchar(20)  PRIMARY KEY,
    display_name  varchar(60)  NOT NULL,

    -- El mapeo con el WMS vive AQUI, no en el importador. Un valor nuevo de
    -- `Tipo Ubicacion` es una fila, no un despliegue.
    wms_type_code varchar(10)  NULL,

    -- Un area de granel cambia el ALGORITMO de comparacion con lo observado, no
    -- solo el dibujo: GUACI5 tiene 2.135 contenedores en UNA ubicacion.
    implies_bulk  boolean      NOT NULL DEFAULT false,

    -- Retirar una funcion sin borrar el historico que la usa.
    is_active     boolean      NOT NULL DEFAULT true,
    sort_order    smallint     NOT NULL DEFAULT 100,
    notes         text         NULL,

    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT chk_nf_code CHECK (code ~ '^[a-z][a-z_]*$')
);

COMMENT ON TABLE spatial.node_functions IS
    'Vocabulario FUNCIONAL. Catalogo GOBERNABLE global sin tenant_id: si cada tenant anadiera funciones, dos inventarian nombres distintos para lo mismo y el informe agregado dejaria de ser comparable (SPA-05). Escritura reservada al Platform Owner.';
COMMENT ON COLUMN spatial.node_functions.wms_type_code IS
    'Mapeo con Tipo Ubicacion del WMS. Vive aqui para que el importador haga JOIN en lugar de una rama, y un valor nuevo sea una fila.';

CREATE UNIQUE INDEX uq_nf_wms_type ON spatial.node_functions (wms_type_code)
    WHERE wms_type_code IS NOT NULL;
CREATE INDEX idx_nf_activas ON spatial.node_functions (sort_order) WHERE is_active;

-- Las cinco primeras llevan el codigo del WMS medido en ReporteUbicaciones.
INSERT INTO spatial.node_functions
    (code, display_name, wms_type_code, implies_bulk, sort_order, notes) VALUES
    ('storage',     'Almacenaje',          'ALMREP', false, 10, '71,4 % de las filas del inventario'),
    ('picking',     'Picking',             'PICKIN', false, 20, '22,3 %'),
    ('processing',  'Proceso',             'PROCES', false, 30, '5,2 %. CHEQ, RETIRA, PURT'),
    ('temporary',   'Temporal',            'TEMPOR', false, 40, '0,77 %'),
    ('compact',     'Compacto',            'COMPAC', false, 50, '0,36 %'),
    ('receiving',   'Recepcion',            NULL,    false, 60, 'Sin codigo WMS observado todavia'),
    ('shipping',    'Expedicion',           NULL,    false, 70, NULL),
    ('dock',        'Muelle',               NULL,    false, 80, 'Es un LUGAR, no un dispositivo: por eso es funcion de nodo y no spatial.devices'),
    ('buffer',      'Buffer',               NULL,    false, 90, 'El prefijo BUFFER existe en el dato'),
    ('staging',     'Preparacion',          NULL,    false,100, NULL),
    ('inspection',  'Inspeccion',           NULL,    false,110, NULL),
    ('quarantine',  'Cuarentena',           NULL,    false,120, NULL),
    ('returns',     'Devoluciones',         NULL,    false,130, NULL),
    ('bulk',        'Granel',               NULL,    true, 140, 'GUACI5 tiene 2.135 contenedores en una ubicacion');


-- ── Catálogo 3 · aristas legales del árbol ─────────────────────────────────
-- Un arbol libre admite un `floor` colgando de un `rack`. Esta tabla lo impide, y
-- es DATOS: anadir un nivel es insertar filas, no reescribir un CHECK.
CREATE TABLE spatial.node_edges (
    parent_type varchar(20) NOT NULL REFERENCES spatial.node_types(code) ON DELETE RESTRICT,
    child_type  varchar(20) NOT NULL REFERENCES spatial.node_types(code) ON DELETE RESTRICT,
    notes       text        NULL,

    CONSTRAINT pk_node_edges PRIMARY KEY (parent_type, child_type)

    -- SIN CHECK que prohíba aristas reflexivas, a propósito. Un área que se
    -- subdivide en subáreas es legítima, y prohibirlo aquí obligaría a una
    -- migración para lo que debe ser un cambio de datos. Los ciclos que importan
    -- son los de INSTANCIAS —A→B→C→A entre nodos concretos— y esos los detecta
    -- core.spatial_node_guard(), que es el único mecanismo que puede.
);

COMMENT ON TABLE spatial.node_edges IS
    'Matriz de aristas legales (padre, hijo). El vocabulario separado la mantiene ADITIVA: con funciones como tipos crecería multiplicativamente (ADR-010 6.2).';

INSERT INTO spatial.node_edges (parent_type, child_type, notes) VALUES
    ('building',     'floor',        NULL),
    ('building',     'zone',         'Nave sin plantas diferenciadas'),
    ('building',     'storage_area', 'Camino corto: nave con areas directas'),
    ('floor',        'zone',         NULL),
    ('floor',        'aisle',        NULL),
    ('floor',        'storage_area', NULL),
    ('zone',         'aisle',        NULL),
    ('zone',         'storage_area', NULL),
    ('aisle',        'rack',         NULL),
    ('aisle',        'storage_area', 'Area de suelo dentro de un pasillo'),
    ('rack',         'storage_area', 'El hueco cuelga del area, no del rack'),
    ('storage_area', 'storage_area', 'Subdivision de un area: columna o modulo');


-- ── spatial.nodes ──────────────────────────────────────────────────────────
CREATE TABLE spatial.nodes (
    id              uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid         NOT NULL REFERENCES core.tenants(id),
    -- Desnormalizados a proposito: son lo que hace expresable la FK compuesta del
    -- padre y lo que permite a RLS filtrar sin recorrer el arbol.
    warehouse_id    uuid         NOT NULL,
    site_id         uuid         NOT NULL,

    parent_node_id  uuid         NULL,

    node_type       varchar(20)  NOT NULL
                                 REFERENCES spatial.node_types(code) ON DELETE RESTRICT,
    node_function   varchar(20)  NULL
                                 REFERENCES spatial.node_functions(code) ON DELETE RESTRICT,

    node_code       varchar(40)  NOT NULL,
    name            varchar(120) NOT NULL,

    -- Valores del sistema externo, sin interpretar (principio 3).
    -- `Preambulo` viaja aqui: el dato NO demuestra que sea un sitio.
    external_site_code    varchar(30) NULL,
    -- `IdAlmacenamiento`, en correspondencia 1:1 medida con el primer segmento.
    external_storage_id   varchar(30) NULL,
    raw_source      jsonb        NOT NULL DEFAULT '{}'::jsonb,

    status          varchar(20)  NOT NULL DEFAULT 'active',

    created_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    updated_by      uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version         integer      NOT NULL DEFAULT 1,
    deleted_at      timestamptz  NULL,

    CONSTRAINT fk_node_site FOREIGN KEY (tenant_id, warehouse_id, site_id)
        REFERENCES spatial.sites (tenant_id, warehouse_id, id),

    -- Requerida por la FK del padre y por la de spatial.locations en 0052.
    CONSTRAINT uq_node_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),

    -- ⚠ LA GARANTÍA FUERTE: el padre comparte tenant Y almacén por construcción.
    -- No es una comprobación que alguien pueda saltarse; es inexpresable lo contrario.
    CONSTRAINT fk_node_parent FOREIGN KEY (tenant_id, warehouse_id, parent_node_id)
        REFERENCES spatial.nodes (tenant_id, warehouse_id, id) ON DELETE RESTRICT,

    CONSTRAINT chk_node_no_autopadre CHECK (parent_node_id IS DISTINCT FROM id),
    CONSTRAINT chk_node_code    CHECK (node_code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    CONSTRAINT chk_node_status  CHECK (status IN ('active', 'inactive', 'blocked')),
    CONSTRAINT chk_node_version CHECK (version >= 1),
    CONSTRAINT chk_node_raw     CHECK (jsonb_typeof(raw_source) = 'object')
);

COMMENT ON TABLE spatial.nodes IS
    'Arbol de contencion del espacio. La raiz tiene parent_node_id NULL y cuelga de un sitio. NO contiene ubicaciones: `location` no es un node_type porque una ubicacion es siempre HOJA (SPA-01) y vive en spatial.locations.';
COMMENT ON COLUMN spatial.nodes.external_site_code IS
    'Preambulo del WMS, sin interpretar. NO se asume que sea un sitio: el dato mide que es ortogonal a IdSucursal (principio 8).';
COMMENT ON CONSTRAINT fk_node_parent ON spatial.nodes IS
    'FK TRIPLE: hace inexpresable que un nodo cuelgue de otro tenant o de otro almacen. Los ciclos de mas de un salto necesitan el trigger.';

CREATE UNIQUE INDEX uq_node_code ON spatial.nodes (tenant_id, warehouse_id, node_code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_node_tenant   ON spatial.nodes (tenant_id);
CREATE INDEX idx_node_wh       ON spatial.nodes (tenant_id, warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_node_site     ON spatial.nodes (tenant_id, site_id) WHERE deleted_at IS NULL;
-- El indice que sirve al filtro `parent_id` del endpoint de la letra G.
CREATE INDEX idx_node_parent   ON spatial.nodes (parent_node_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_node_type     ON spatial.nodes (tenant_id, warehouse_id, node_type)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_node_function ON spatial.nodes (node_function)
    WHERE node_function IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_node_storage  ON spatial.nodes (external_storage_id)
    WHERE external_storage_id IS NOT NULL AND deleted_at IS NULL;
-- Las raices, para arrancar el recorrido de la jerarquia.
CREATE INDEX idx_node_raices   ON spatial.nodes (tenant_id, warehouse_id)
    WHERE parent_node_id IS NULL AND deleted_at IS NULL;


-- ── El trigger: aristas legales + ausencia de ciclos ───────────────────────
--
-- Vive en `core` porque `olo_app` no tiene USAGE sobre `spatial` para funciones y
-- porque es la convencion del proyecto para guardas de integridad. SECURITY DEFINER
-- no hace falta: el trigger corre con los privilegios del propietario de la tabla.
CREATE OR REPLACE FUNCTION core.spatial_node_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_tipo_padre varchar(20);
    v_ancestro   uuid;
    v_saltos     int := 0;
BEGIN
    -- Una raiz no tiene arista que validar ni ancestros que recorrer.
    IF NEW.parent_node_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- 1 · La arista (tipo_padre, tipo_hijo) debe existir en la matriz.
    SELECT n.node_type INTO v_tipo_padre
      FROM spatial.nodes n WHERE n.id = NEW.parent_node_id;

    IF v_tipo_padre IS NULL THEN
        -- La FK compuesta ya lo impide; esto cubre el orden de disparo.
        RAISE EXCEPTION 'El nodo padre % no existe', NEW.parent_node_id
            USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_NODE_EDGE_INVALID';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM spatial.node_edges e
         WHERE e.parent_type = v_tipo_padre AND e.child_type = NEW.node_type
    ) THEN
        RAISE EXCEPTION
            'Un nodo de tipo % no puede contener uno de tipo %: la arista no esta en spatial.node_edges',
            v_tipo_padre, NEW.node_type
            USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_NODE_EDGE_INVALID';
    END IF;

    -- 2 · Ciclos. NO son expresables con CHECK ni con FK: A->B->C->A cumple todas
    --     las restricciones locales. Hay que recorrer los ancestros.
    --     El tope de saltos evita un bucle infinito si ya existiera un ciclo por
    --     un camino que este trigger no vigilo.
    v_ancestro := NEW.parent_node_id;
    WHILE v_ancestro IS NOT NULL LOOP
        IF v_ancestro = NEW.id THEN
            RAISE EXCEPTION
                'Colgar el nodo % de % crearia un ciclo en la jerarquia', NEW.id, NEW.parent_node_id
                USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_NODE_CYCLE';
        END IF;
        v_saltos := v_saltos + 1;
        IF v_saltos > 64 THEN
            RAISE EXCEPTION
                'La cadena de ancestros de % supera 64 saltos: hay un ciclo preexistente', NEW.id
                USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_NODE_CYCLE';
        END IF;
        SELECT n.parent_node_id INTO v_ancestro
          FROM spatial.nodes n WHERE n.id = v_ancestro;
    END LOOP;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION core.spatial_node_guard() IS
    'Valida la matriz de aristas y la ausencia de ciclos en spatial.nodes. Es el mecanismo MINIMO: tenant y almacen los garantiza la FK compuesta, el autopadre un CHECK, y los ciclos de mas de un salto no son expresables sin recorrer ancestros.';

CREATE TRIGGER spatial_node_guard
    BEFORE INSERT OR UPDATE OF parent_node_id, node_type ON spatial.nodes
    FOR EACH ROW EXECUTE FUNCTION core.spatial_node_guard();

CREATE TRIGGER set_updated_at_node BEFORE UPDATE ON spatial.nodes
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_node BEFORE UPDATE ON spatial.nodes
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

CREATE TRIGGER set_updated_at_nf BEFORE UPDATE ON spatial.node_functions
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
-- Los dos catálogos y la matriz: patrón de ai.frameworks. Lectura para todos,
-- escritura solo Platform Owner.
ALTER TABLE spatial.node_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.node_types     FORCE  ROW LEVEL SECURITY;
ALTER TABLE spatial.node_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.node_functions FORCE  ROW LEVEL SECURITY;
ALTER TABLE spatial.node_edges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.node_edges     FORCE  ROW LEVEL SECURITY;
ALTER TABLE spatial.nodes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.nodes          FORCE  ROW LEVEL SECURITY;

-- ⚠ AQUÍ NO SIRVE EL PATRÓN DE `ai.frameworks`, y la diferencia importa.
--
--   `ai.frameworks` lleva una RESTRICTIVE `FOR ALL` con `is_platform_owner()`, y es
--   correcto: ese catálogo es del owner y nadie más tiene por qué verlo.
--
--   Estos tres son DISTINTOS: los lee cualquier usuario de tenant en cada consulta
--   del explorador espacial —para mostrar «Almacenaje» en vez de `storage`, y para
--   filtrar por `node_type`—. Una RESTRICTIVE `FOR ALL` aplica también al SELECT y
--   los dejaría ILEGIBLES: se midió con `olo_app` y devolvían 0 filas. «Solo
--   lectura» significa LEGIBLE.
--
--   El patrón correcto son dos PERMISSIVE, que se combinan con OR: la primera abre
--   el SELECT a todos; la segunda es la única vía para escribir y exige ser owner.
--   Sin la segunda, ni el owner podría escribir, porque RLS deniega por defecto.
CREATE POLICY nt_read ON spatial.node_types
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY nt_write_owner ON spatial.node_types
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());

CREATE POLICY nf_read ON spatial.node_functions
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY nf_write_owner ON spatial.node_functions
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());

CREATE POLICY ne_read ON spatial.node_edges
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY ne_write_owner ON spatial.node_edges
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());

-- `nodes` es dato de tenant con alcance de almacén, como areas y locations.
CREATE POLICY tenant_isolation ON spatial.nodes
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON spatial.nodes
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));


-- ── Grants ─────────────────────────────────────────────────────────────────
--
-- Los catálogos globales son de SOLO LECTURA para `olo_app`; su administración
-- queda reservada al Platform Owner.
--
-- ⚠ UN `GRANT SELECT` NO BASTA, y lo detectó la verificación de esta migración:
--   la 0047 dejó `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA spatial
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app`, así que toda tabla
--   nueva de `spatial` NACE con DML completo para `olo_app`. Conceder SELECT
--   encima no quita nada. Hay que REVOCAR explícitamente.
--
--   Es la contrapartida de los default privileges: ahorran repetir grants en cada
--   tabla de dominio, y a cambio obligan a revocar en las excepciones.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.node_types     FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.node_functions FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.node_edges     FROM olo_app;

GRANT SELECT ON spatial.node_types     TO olo_app;
GRANT SELECT ON spatial.node_functions TO olo_app;
GRANT SELECT ON spatial.node_edges     TO olo_app;

-- `nodes` sí es escribible: es dato de tenant, no catálogo.
GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.nodes TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_nt int; v_nf int; v_ne int; v_force int; v_pol int; v_restr int;
    v_idx int; v_trg int; v_rech boolean;
    v_t uuid; v_wh uuid; v_site uuid; v_a uuid; v_b uuid; v_c uuid;
BEGIN
    SELECT count(1) INTO v_nt FROM spatial.node_types;
    SELECT count(1) INTO v_nf FROM spatial.node_functions;
    SELECT count(1) INTO v_ne FROM spatial.node_edges;
    IF v_nt <> 6  THEN RAISE EXCEPTION 'se esperaban 6 node_types, hay %', v_nt; END IF;
    IF v_nf <> 14 THEN RAISE EXCEPTION 'se esperaban 14 node_functions, hay %', v_nf; END IF;
    IF v_ne <> 12 THEN RAISE EXCEPTION 'se esperaban 12 aristas, hay %', v_ne; END IF;

    -- Las 5 funciones con mapeo del WMS, medidas en ReporteUbicaciones.
    IF (SELECT count(1) FROM spatial.node_functions WHERE wms_type_code IS NOT NULL) <> 5 THEN
        RAISE EXCEPTION 'se esperaban 5 funciones con wms_type_code';
    END IF;

    SELECT count(1) INTO v_force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial'
       AND c.relname IN ('node_types', 'node_functions', 'node_edges', 'nodes')
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_force <> 4 THEN RAISE EXCEPTION 'FORCE RLS falta en % tabla(s)', 4 - v_force; END IF;

    SELECT count(1), count(1) FILTER (WHERE permissive = 'RESTRICTIVE')
      INTO v_pol, v_restr FROM pg_policies WHERE schemaname = 'spatial'
       AND tablename IN ('node_types', 'node_functions', 'node_edges', 'nodes');
    IF v_pol <> 8 THEN RAISE EXCEPTION 'se esperaban 8 politicas, hay %', v_pol; END IF;
    -- Solo `nodes` lleva RESTRICTIVE (el aislamiento por tenant). Los catálogos NO:
    -- una RESTRICTIVE FOR ALL los dejaría ilegibles para quien no es owner.
    IF v_restr <> 1 THEN
        RAISE EXCEPTION 'se esperaba 1 politica RESTRICTIVE (solo en nodes), hay %', v_restr;
    END IF;

    -- Los tres catálogos DEBEN tener una política de SELECT sin condición: si
    -- exigieran ser Platform Owner, el explorador espacial no podría traducir
    -- `storage` a «Almacenaje» para un usuario normal. Se comprueba porque ya pasó.
    IF (SELECT count(1) FROM pg_policies
         WHERE schemaname = 'spatial'
           AND tablename IN ('node_types', 'node_functions', 'node_edges')
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND qual = 'true') <> 3 THEN
        RAISE EXCEPTION
            'los 3 catalogos necesitan una politica PERMISSIVE de SELECT con USING (true): '
            'sin ella quedan ilegibles para quien no es Platform Owner';
    END IF;

    SELECT count(1) INTO v_idx FROM pg_index i JOIN pg_class ct ON ct.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname = 'nodes';
    IF v_idx < 10 THEN RAISE EXCEPTION 'se esperaban al menos 10 indices en nodes, hay %', v_idx; END IF;

    SELECT count(1) INTO v_trg FROM pg_trigger t JOIN pg_class ct ON ct.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('nodes', 'node_functions')
       AND NOT t.tgisinternal;
    IF v_trg <> 4 THEN RAISE EXCEPTION 'se esperaban 4 triggers, hay %', v_trg; END IF;

    -- Requisito 11 · los catálogos son de SOLO LECTURA para olo_app.
    IF NOT has_table_privilege('olo_app', 'spatial.node_types', 'SELECT')
       OR NOT has_table_privilege('olo_app', 'spatial.node_functions', 'SELECT')
       OR NOT has_table_privilege('olo_app', 'spatial.node_edges', 'SELECT') THEN
        RAISE EXCEPTION 'olo_app necesita SELECT sobre los tres catalogos';
    END IF;
    IF has_table_privilege('olo_app', 'spatial.node_types', 'INSERT')
       OR has_table_privilege('olo_app', 'spatial.node_functions', 'UPDATE')
       OR has_table_privilege('olo_app', 'spatial.node_edges', 'DELETE') THEN
        RAISE EXCEPTION 'olo_app NO debe poder escribir en los catalogos globales';
    END IF;
    IF NOT has_table_privilege('olo_app', 'spatial.nodes', 'INSERT') THEN
        RAISE EXCEPTION 'olo_app necesita escritura sobre spatial.nodes';
    END IF;

    -- ── PRUEBAS VIVAS DE LA JERARQUÍA ──────────────────────────────────────
    -- Verificar que un trigger existe no demuestra que rechace.
    SELECT t.id INTO v_t FROM core.tenants t LIMIT 1;
    SELECT w.id INTO v_wh FROM core.warehouses w WHERE w.tenant_id = v_t LIMIT 1;
    IF v_wh IS NULL THEN
        RAISE WARNING 'sin almacen sembrado: las pruebas de jerarquia no pudieron correr';
        RAISE NOTICE 'OK 0050 PARCIAL: 6 tipos, 14 funciones, 12 aristas, RLS y grants correctos';
        RETURN;
    END IF;

    INSERT INTO spatial.sites (tenant_id, warehouse_id, name, code)
    VALUES (v_t, v_wh, 'Sitio de prueba 0050', 'T0050') RETURNING id INTO v_site;

    -- Raiz valida: un edificio sin padre.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type, node_code, name)
    VALUES (v_t, v_wh, v_site, 'building', 'T0050-B', 'Nave de prueba') RETURNING id INTO v_a;

    -- Arista legal: building -> floor.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                               node_type, node_code, name)
    VALUES (v_t, v_wh, v_site, v_a, 'floor', 'T0050-F', 'Planta 1') RETURNING id INTO v_b;

    -- 1 · arista ILEGAL: un rack no puede contener una planta.
    v_rech := false;
    BEGIN
        INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                                   node_type, node_code, name)
        VALUES (v_t, v_wh, v_site, v_b, 'building', 'T0050-X', 'Nave dentro de planta');
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto una arista que no esta en node_edges'; END IF;

    -- 2 · autopadre directo: lo cubre el CHECK.
    v_rech := false;
    BEGIN
        UPDATE spatial.nodes SET parent_node_id = id WHERE id = v_b;
    EXCEPTION WHEN check_violation THEN v_rech := true;
              WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto que un nodo sea su propio padre'; END IF;

    -- 3 · CICLO de dos saltos: A -> B, y luego A colgando de B.
    --     Esto NO lo detecta ningun CHECK ni FK. Es la razon de existir del trigger.
    v_rech := false;
    BEGIN
        UPDATE spatial.nodes SET parent_node_id = v_b WHERE id = v_a;
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto un ciclo de dos saltos: el trigger no protege';
    END IF;

    -- 4 · CICLO de tres saltos: A -> B -> C, y A colgando de C.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                               node_type, node_code, name)
    VALUES (v_t, v_wh, v_site, v_b, 'zone', 'T0050-Z', 'Sector') RETURNING id INTO v_c;
    v_rech := false;
    BEGIN
        UPDATE spatial.nodes SET parent_node_id = v_c WHERE id = v_a;
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto un ciclo de tres saltos'; END IF;

    -- 5 · padre de OTRO almacen: lo hace inexpresable la FK compuesta.
    v_rech := false;
    BEGIN
        INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                                   node_type, node_code, name)
        VALUES (v_t, '00000000-0000-0000-0000-000000000009', v_site, v_a,
                'floor', 'T0050-OTRO', 'Planta de otro almacen');
    EXCEPTION WHEN foreign_key_violation THEN v_rech := true;
              WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto un padre de otro almacen'; END IF;

    -- 6 · una funcion inexistente no se puede asignar.
    v_rech := false;
    BEGIN
        UPDATE spatial.nodes SET node_function = 'no_existe' WHERE id = v_c;
    EXCEPTION WHEN foreign_key_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto una node_function inexistente'; END IF;

    -- 7 · y una que si existe, si.
    UPDATE spatial.nodes SET node_function = 'storage' WHERE id = v_c;

    -- Limpieza: hijos antes que padres, por ON DELETE RESTRICT.
    DELETE FROM spatial.nodes WHERE id = v_c;
    DELETE FROM spatial.nodes WHERE id = v_b;
    DELETE FROM spatial.nodes WHERE id = v_a;
    DELETE FROM spatial.sites WHERE id = v_site;

    IF (SELECT count(1) FROM spatial.nodes) <> 0 THEN
        RAISE EXCEPTION 'quedaron nodos de prueba sin limpiar';
    END IF;

    RAISE NOTICE
        'OK 0050: 6 node_types · 14 node_functions (5 con mapeo WMS) · 12 aristas · '
        '% indices en nodes · 4 triggers · 8 politicas (1 restrictive, solo en nodes) · '
        'FORCE RLS · catalogos LEGIBLES por todos y escribibles solo por el owner · '
        '7 pruebas de jerarquia en vivo (arista ilegal, autopadre, ciclo de 2, '
        'ciclo de 3, otro almacen, funcion inexistente)',
        v_idx;
END
$$;
