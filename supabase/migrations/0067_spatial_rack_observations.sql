-- ══════════════════════════════════════════════════════════════════════════════
-- 0067 · Observaciones de racks: «quién vio qué rack y cuándo»
--
-- Es el extremo RECEPTOR de la visión por computador. Un dron, un móvil o una
-- cámara fija graban el almacén; algo —hoy el módulo de percepción, mañana un
-- modelo en producción— reconoce códigos de rack en los fotogramas. Cada
-- reconocimiento es un hecho atómico:
--
--     a las 14:03:22, la fuente DRONE-01 vio el rack MZ04, con confianza 0,91
--
-- Esta migración guarda ESO y nada más. La ruta no se guarda: se DERIVA, uniendo
-- las observaciones ordenadas por tiempo con la colocación en metros de 0065. Por
-- eso F4 no podía existir antes de F2: sin `rack_placements` una observación es
-- «vi MZ04», que no dice dónde estaba nadie.
--
-- ── QUÉ NO ES ────────────────────────────────────────────────────────────────
--
-- No es visión por computador. Aquí no hay modelo, ni detección, ni fotogramas:
-- hay una tabla que acepta el resultado de un reconocimiento hecho fuera. Se
-- guarda `frame_ref` para poder volver al fotograma original, pero el fotograma
-- vive en el almacenamiento de medios, no aquí.
--
-- Tampoco es una posición del dron. Se guarda «vio el rack X», no «estaba en el
-- punto (x,y)». La diferencia importa: la posición del rack la conocemos con la
-- precisión con la que alguien lo colocó sobre el plano; la del dron no la
-- conocemos en absoluto. Decir «el dron estuvo cerca de MZ04» es cierto; decir
-- «el dron estaba en (40,12)» sería inventarse una telemetría que nadie midió.
--
-- ── POR QUÉ DOS PERMISOS NUEVOS Y NO `areas:write` ──────────────────────────
--
-- Un dron que reporta lo que ve NO debe poder mover racks. Con `areas:write` —el
-- permiso que ya existe y que usa el layout— la credencial de un dispositivo en el
-- pasillo podría reescribir la colocación de los 347 racks del almacén. Son dos
-- capacidades distintas y merecen dos permisos:
--
--     observations:write   registrar lo que se ha visto      (dispositivos)
--     observations:read    consultar rutas e historial       (operadores)
--
-- `observations:write` NO se le da a `viewer` ni a `auditor`: leer sí, escribir no.
-- Y no es privilegiado, porque escribir una observación no cambia el dominio: lo
-- describe.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1 · Permisos ───────────────────────────────────────────────────────────
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('observations:read',  'observations', 'read',
     'Consultar observaciones de racks y las rutas derivadas', false),
    ('observations:write', 'observations', 'write',
     'Registrar observaciones de racks desde drones, camaras o moviles', false)
ON CONFLICT (code) DO NOTHING;

-- Leer: todos los roles que ya ven el almacén. Una ruta es información
-- operativa, y un auditor que no la puede ver no puede auditar el recorrido.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'observations:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator',
                  'auditor', 'viewer')
ON CONFLICT DO NOTHING;

-- Escribir: quien opera el almacén. El `viewer` y el `auditor` quedan fuera a
-- propósito: su papel es mirar, y un auditor que puede añadir observaciones puede
-- fabricar el recorrido que audita.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'observations:write'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator')
ON CONFLICT DO NOTHING;


-- ── 2 · Fuentes ────────────────────────────────────────────────────────────
-- Una fuente es el DISPOSITIVO o el recorrido concreto: «DRONE-01, vuelo del
-- martes». Existe como tabla y no como texto en la observación por tres razones
-- que se pagan si no está:
--
--   · una ruta se dibuja POR FUENTE. Mezclar dos drones en la misma polilínea
--     produce un zigzag que no recorrió nadie.
--   · el `kind` decide cómo se interpreta. Una cámara FIJA ve siempre el mismo
--     rack: sus observaciones no son un recorrido, son un centinela, y unirlas
--     con líneas sería absurdo.
--   · el desfase de reloj es del dispositivo. Un dron con el reloj 40 s adelantado
--     ordena mal TODAS sus observaciones, y corregirlo hay que hacerlo en un sitio.
CREATE TABLE spatial.observation_sources (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id  uuid NOT NULL,

    code          varchar(40) NOT NULL,
    name          varchar(120) NOT NULL,
    -- Vocabulario CERRADO: cada valor cambia cómo se lee la serie temporal, así
    -- que un valor nuevo no es un dato más, es una regla nueva que hay que escribir.
    kind          varchar(16) NOT NULL,

    /**
     * Desfase del reloj del dispositivo, en milisegundos.
     *
     * Se guarda en lugar de corregir los timestamps al insertar: la observación
     * conserva la hora que dijo el dispositivo —que es el dato— y la corrección es
     * una interpretación que puede cambiar cuando se descubre el desfase real.
     */
    clock_skew_ms integer NOT NULL DEFAULT 0,

    is_active     boolean NOT NULL DEFAULT true,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid REFERENCES core.users (id) ON DELETE SET NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid REFERENCES core.users (id) ON DELETE SET NULL,
    deleted_at    timestamptz,

    CONSTRAINT fk_source_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_source_code UNIQUE (tenant_id, warehouse_id, code),
    -- Para que las observaciones puedan tener FK compuesta contra la fuente.
    CONSTRAINT uq_source_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_source_kind CHECK (kind IN ('drone', 'phone', 'fixed_camera', 'forklift', 'manual')),
    CONSTRAINT chk_source_metadata CHECK (jsonb_typeof(metadata) = 'object'),
    -- ±1 h: un desfase mayor no es desfase, es una zona horaria mal configurada, y
    -- corregirla aquí escondería el problema en lugar de arreglarlo en el equipo.
    CONSTRAINT chk_source_skew CHECK (clock_skew_ms BETWEEN -3600000 AND 3600000)
);

COMMENT ON TABLE spatial.observation_sources IS
    'Dispositivo o recorrido que produce observaciones: dron, movil, camara fija, carretilla o registro manual.';
COMMENT ON COLUMN spatial.observation_sources.kind IS
    'Vocabulario cerrado. `fixed_camera` NO produce recorrido: ve siempre el mismo sitio, y unir sus observaciones con lineas seria falso.';


-- ── 3 · Observaciones ──────────────────────────────────────────────────────
CREATE TABLE spatial.rack_observations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id  uuid NOT NULL,
    source_id     uuid NOT NULL,
    rack_node_id  uuid NOT NULL,

    /**
     * Cuándo se vio, según el dispositivo. NO es `now()`.
     *
     * El momento de la observación y el momento en que llega a la base son cosas
     * distintas: un dron sin cobertura sube el vuelo entero al aterrizar, media
     * hora después. Con `now()` las 400 observaciones de un vuelo de 20 minutos
     * caerían en el mismo segundo y la ruta sería un punto.
     */
    observed_at   timestamptz NOT NULL,
    /** Cuándo llegó. Sirve para medir el retraso de la ingesta, no para ordenar. */
    ingested_at   timestamptz NOT NULL DEFAULT now(),

    /**
     * Confianza del reconocimiento, 0..1. `NULL` cuando no la hay —una
     * observación manual no tiene confianza, la tiene una persona— y eso es
     * distinto de tener confianza 1: lo primero es «no aplica», lo segundo es «el
     * modelo está seguro», y confundirlos convertiría cada anotación a mano en la
     * detección más fiable del sistema.
     */
    confidence    double precision,

    /** Referencia al fotograma original, para poder volver a mirarlo. */
    frame_ref     varchar(200),
    /** Milisegundo dentro del vídeo, si viene de uno. */
    frame_ms      integer,
    notes         text,

    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid REFERENCES core.users (id) ON DELETE SET NULL,

    CONSTRAINT fk_obs_source
        FOREIGN KEY (tenant_id, source_id)
        REFERENCES spatial.observation_sources (tenant_id, id) ON DELETE CASCADE,
    -- La MISMA FK compuesta que usa `rack_placements`: hace inexpresable observar
    -- un rack de otro almacén. Sin ella, «vi RCL01» podría referirse al RCL01 del
    -- almacén de al lado y la ruta saltaría entre edificios.
    CONSTRAINT fk_obs_node
        FOREIGN KEY (tenant_id, warehouse_id, rack_node_id)
        REFERENCES spatial.nodes (tenant_id, warehouse_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_obs_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_obs_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT chk_obs_frame_ms CHECK (frame_ms IS NULL OR frame_ms >= 0),
    /**
     * Una fuente no ve el mismo rack dos veces en el mismo instante.
     *
     * Es la clave de la IDEMPOTENCIA de la ingesta: un dron que reintenta subir su
     * vuelo porque se cortó la conexión manda observaciones repetidas, y sin esta
     * restricción el mismo recorrido se contaría dos veces —duplicando la
     * distancia recorrida— sin que nada fallara.
     */
    CONSTRAINT uq_obs_fuente_rack_momento UNIQUE (source_id, rack_node_id, observed_at)
);

COMMENT ON TABLE spatial.rack_observations IS
    'Un rack visto por una fuente en un instante. La RUTA no se guarda: se deriva uniendo esto con spatial.rack_placements.';
COMMENT ON COLUMN spatial.rack_observations.observed_at IS
    'Cuando se VIO, segun el dispositivo. No es la hora de llegada: un dron sin cobertura sube el vuelo entero al aterrizar.';


-- ── 4 · Índices ────────────────────────────────────────────────────────────
-- Por almacén Y TIEMPO: toda consulta de este módulo es «qué se vio en este
-- almacén entre estas dos horas», y sin el tiempo en el índice hay que recorrer
-- todo el histórico del almacén para responder por una ventana de 20 minutos.
CREATE INDEX ix_obs_warehouse_tiempo
    ON spatial.rack_observations (warehouse_id, observed_at DESC);

-- Por fuente y tiempo: es el índice de la RUTA, que siempre es de una fuente.
CREATE INDEX ix_obs_source_tiempo
    ON spatial.rack_observations (source_id, observed_at);

-- Por rack: «¿cuándo se vio este rack por última vez?». Es la pregunta inversa y
-- la que responde si un rack lleva un mes sin que nadie pase por delante.
CREATE INDEX ix_obs_rack_tiempo
    ON spatial.rack_observations (rack_node_id, observed_at DESC);

CREATE INDEX ix_source_warehouse
    ON spatial.observation_sources (warehouse_id)
    WHERE deleted_at IS NULL;


-- ── 5 · `updated_at` de las fuentes ────────────────────────────────────────
CREATE TRIGGER trg_source_updated_at
    BEFORE UPDATE ON spatial.observation_sources
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── 6 · RLS ────────────────────────────────────────────────────────────────
-- Mismo patrón que el resto del esquema: RESTRICTIVE para el aislamiento entre
-- tenants —que no se puede desactivar añadiendo otra policy— y PERMISSIVE para el
-- alcance por almacén.
ALTER TABLE spatial.observation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.rack_observations   ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON spatial.observation_sources
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON spatial.observation_sources
    FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON spatial.rack_observations
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON spatial.rack_observations
    FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.observation_sources TO olo_app;
GRANT SELECT, INSERT, DELETE         ON spatial.rack_observations   TO olo_app;
-- Las observaciones NO se actualizan. Un hecho observado no cambia: si el
-- reconocimiento estaba mal, se borra y se vuelve a registrar, y el histórico
-- refleja que hubo una corrección en lugar de esconderla.


-- ── 7 · La vista de la RUTA ────────────────────────────────────────────────
-- Aquí está lo que hace útil todo lo anterior: une la observación con la
-- COLOCACIÓN del rack (0065) y produce el punto en metros por el que pasó la
-- fuente. Es exactamente «el sistema, por posición de racks, sabe cuál fue la
-- ruta».
--
-- ── LO QUE ESTA VISTA AFIRMA, Y LO QUE NO ──────────────────────────────────
--
-- AFIRMA: la fuente vio el rack MZ04, que está en (40,12), a las 14:03:22.
-- NO AFIRMA: que la fuente estuviera en (40,12). Estaba lo bastante cerca para
-- verlo, y eso es todo lo que se sabe. Por eso la columna se llama `x_m`/`y_m`
-- del RACK y no `posicion_fuente`: nombrarla así sería fabricar telemetría.
--
-- `INNER JOIN` con la colocación, no `LEFT`: una observación de un rack que nadie
-- ha colocado en el plano no tiene punto, así que no puede formar parte de una
-- polilínea. Aparece en `v_rack_observations` —el historial— pero no en la ruta.
-- Contarla como (0,0) metería un vértice en la esquina del almacén.
CREATE VIEW spatial.v_observation_route AS
SELECT o.tenant_id,
       o.warehouse_id,
       o.source_id,
       s.code            AS source_code,
       s.name            AS source_name,
       s.kind            AS source_kind,
       o.id              AS observation_id,
       o.rack_node_id,
       n.node_code       AS rack_code,
       o.observed_at,
       o.confidence,
       o.frame_ref,
       o.frame_ms,
       p.x_m,
       p.y_m,
       p.rotation_deg,
       -- Orden dentro del recorrido de la fuente. Se calcula aquí y no en el
       -- cliente porque es lo que define la polilínea, y dos clientes ordenando
       -- por su cuenta pueden discrepar cuando dos observaciones empatan en tiempo.
       row_number() OVER (
           PARTITION BY o.source_id ORDER BY o.observed_at, o.id
       )                 AS paso
  FROM spatial.rack_observations o
  JOIN spatial.observation_sources s
       ON s.tenant_id = o.tenant_id AND s.id = o.source_id
  JOIN spatial.nodes n
       ON n.tenant_id = o.tenant_id AND n.id = o.rack_node_id
  JOIN spatial.rack_placements p
       ON p.tenant_id = o.tenant_id AND p.rack_node_id = o.rack_node_id;

ALTER VIEW spatial.v_observation_route SET (security_invoker = true);

COMMENT ON VIEW spatial.v_observation_route IS
    'Ruta derivada: observacion x colocacion del rack. x_m/y_m son del RACK, no de la fuente: se sabe que estuvo lo bastante cerca para verlo, no donde estaba.';

-- Historial completo, incluidas las observaciones de racks sin colocar. Es la
-- vista que permite decir «hay 12 observaciones que no salen en la ruta porque
-- esos racks no están en el plano» en lugar de perderlas en silencio.
CREATE VIEW spatial.v_rack_observations AS
SELECT o.tenant_id,
       o.warehouse_id,
       o.id              AS observation_id,
       o.source_id,
       s.code            AS source_code,
       s.kind            AS source_kind,
       o.rack_node_id,
       n.node_code       AS rack_code,
       o.observed_at,
       o.ingested_at,
       o.confidence,
       o.frame_ref,
       o.frame_ms,
       o.notes,
       (p.rack_node_id IS NOT NULL) AS rack_colocado
  FROM spatial.rack_observations o
  JOIN spatial.observation_sources s
       ON s.tenant_id = o.tenant_id AND s.id = o.source_id
  JOIN spatial.nodes n
       ON n.tenant_id = o.tenant_id AND n.id = o.rack_node_id
  LEFT JOIN spatial.rack_placements p
       ON p.tenant_id = o.tenant_id AND p.rack_node_id = o.rack_node_id;

ALTER VIEW spatial.v_rack_observations SET (security_invoker = true);

GRANT SELECT ON spatial.v_observation_route  TO olo_app;
GRANT SELECT ON spatial.v_rack_observations  TO olo_app;


-- ── 8 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_tablas int;
    v_pol    int;
    v_vistas int;
    v_perms  int;
    v_roles  int;
BEGIN
    SELECT count(*) INTO v_tablas FROM information_schema.tables
     WHERE table_schema = 'spatial'
       AND table_name IN ('observation_sources', 'rack_observations');
    IF v_tablas <> 2 THEN
        RAISE EXCEPTION 'se esperaban 2 tablas, hay %', v_tablas;
    END IF;

    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'spatial'
       AND tablename IN ('observation_sources', 'rack_observations');
    IF v_pol <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 policies, hay %', v_pol;
    END IF;

    SELECT count(*) INTO v_vistas FROM pg_views
     WHERE schemaname = 'spatial'
       AND viewname IN ('v_observation_route', 'v_rack_observations');
    IF v_vistas <> 2 THEN
        RAISE EXCEPTION 'faltan vistas: hay %', v_vistas;
    END IF;

    -- `security_invoker` en las dos: sin él la vista consultaría con los permisos
    -- de su propietario y RLS no filtraría nada.
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'spatial'
           AND c.relname IN ('v_observation_route', 'v_rack_observations')
           AND NOT (coalesce(array_to_string(c.reloptions, ','), '') LIKE '%security_invoker=true%')
    ) THEN
        RAISE EXCEPTION 'alguna vista no tiene security_invoker';
    END IF;

    SELECT count(*) INTO v_perms FROM core.permissions
     WHERE code IN ('observations:read', 'observations:write');
    IF v_perms <> 2 THEN
        RAISE EXCEPTION 'faltan permisos: hay %', v_perms;
    END IF;

    SELECT count(*) INTO v_roles FROM core.role_permissions
     WHERE permission_code = 'observations:write';
    IF v_roles < 3 THEN
        RAISE EXCEPTION 'observations:write asignado a solo % roles', v_roles;
    END IF;

    RAISE NOTICE '0067 OK · 2 tablas, 4 policies, 2 vistas con security_invoker, 2 permisos, write en % roles', v_roles;
END $$;
