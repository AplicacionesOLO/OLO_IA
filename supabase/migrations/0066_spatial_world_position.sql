-- ══════════════════════════════════════════════════════════════════════════════
-- 0066 · world_position DERIVADA de la colocación del rack
--
-- La migración 0052 dejó `spatial.locations.world_position` al 100 % NULL y su
-- comentario decía: «NULL hasta que el importador CAD la calcule. NUNCA derivada
-- de logical_x/y/z: esos son índices (TWN-07)». Esta migración la rellena, y hay
-- que ser exacto sobre por qué eso no contradice lo anterior.
--
-- ── QUÉ CAMBIÓ RESPECTO A 0052 ────────────────────────────────────────────────
--
-- En 0052 no existía NINGUNA medida en metros de nada. Derivar coordenadas de
-- `logical_x = 70077` habría sido inventar geometría a partir de un índice del
-- WMS: el número 70077 no mide una distancia, identifica una casilla.
--
-- Ahora existe `spatial.rack_placements` (0065), y lo que contiene SÍ son metros:
-- alguien colocó el rack MZ04 sobre el plano calibrado y dijo «este rack empieza
-- aquí, mide 12 m de largo, 1,10 de ancho y 8,50 de alto». Esa medida es de una
-- persona sobre un plano a escala, no de un índice.
--
-- Así que lo que se deriva es:
--
--     posición de la ubicación = colocación MEDIDA del rack
--                              + reparto de sus 36 cuerpos a lo largo
--                              + reparto de sus 5 niveles a lo alto
--
-- El índice lógico se usa para ORDENAR y CONTAR —el cuerpo 18 de 36 va a la mitad
-- del rack—, nunca como magnitud. Esa es la diferencia con lo que 0052 prohibía, y
-- es la razón de que `logical_x` no aparezca en ninguna fórmula de aquí.
--
-- ── LA SUPOSICIÓN, DECLARADA Y NO ESCONDIDA ──────────────────────────────────
--
-- Se reparten los cuerpos UNIFORMEMENTE a lo largo del rack y los niveles
-- uniformemente a lo alto. En un rack selectivo real los cuerpos son iguales por
-- construcción y los niveles casi, así que el error típico es de centímetros; pero
-- es una suposición y no una medición.
--
-- Por eso cada fila derivada queda marcada, y la marca es `world_frame_id`: apunta
-- al marco de este layout, cuyo `provenance` lleva el método y la versión de esta
-- migración. Preguntar «¿qué ubicaciones tienen geometría calculada?» es unir con
-- el marco y filtrar por su procedencia.
--
-- NO se toca `origin`. Es tentador —el vocabulario ya tiene `inferred`— y sería un
-- error, porque `origin` dice de dónde salió LA UBICACIÓN, no de dónde salió su
-- geometría. Usarlo aquí tendría dos consecuencias malas:
--
--   · `warehouse_summary.inferred_count` pasaría de 0 a 29.310 al publicar un
--     plano. Ese número está documentado como «una anomalía que hay que poder
--     contar»: son las ubicaciones cuyo código el importador no supo interpretar.
--     Convertirlo en «casi todas» lo deja sin uso.
--
--   · el día que el importador SÍ marque una fila como `inferred`, derivar y luego
--     retirar el plano la devolvería a `catalog` y habríamos borrado una
--     procedencia real que nadie derivó.
--
-- El día que exista un levantamiento CAD, sus filas llevarán otro marco y estas se
-- distinguen por el suyo. Sin esa marca habría que adivinar cuáles eran medidas y
-- cuáles calculadas, y nadie se atrevería a pisar ninguna.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UN UPDATE DE UNA VEZ ────────────────────────────
--
-- Son 29.310 ubicaciones y se recalculan CADA VEZ que alguien mueve un rack y
-- vuelve a publicar. Un UPDATE escrito aquí serviría una vez; la función se llama
-- desde el servicio de publicación, que es cuando el dato cambia.
--
-- No es un trigger sobre `rack_placements` a propósito: publicar toca hasta 347
-- colocaciones en una sentencia y un trigger por fila recalcularía las 29.310
-- ubicaciones 347 veces. La derivación es un PASO de la publicación, y quien
-- publica decide cuándo pagarlo.
--
-- ── LO QUE NO HACE ───────────────────────────────────────────────────────────
--
-- No rellena `world_footprint` ni `world_bbox`. Un punto es lo que necesita el
-- visor 3D y el seguimiento de la flota: «¿qué ubicación está más cerca de donde
-- vio el dron?». Una huella poligonal exige saber la profundidad real de cada
-- hueco, que el catálogo del WMS no trae, y rellenarla con el mismo reparto
-- uniforme daría polígonos que parecen medidos y no lo están.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1 · El marco de referencia del almacén ─────────────────────────────────
-- Una coordenada sin marco es un número sin unidad (SPA-07), y la restricción
-- `chk_loc_world_exige_marco` lo impone: no se puede escribir `world_position`
-- sin `world_frame_id`. Había 0 marcos, así que la derivación tiene que crear el
-- suyo.
--
-- Es un marco POR ALMACÉN y no por sitio ni global: el origen es el del layout
-- —la esquina del plano que el operador marcó como (0,0)— y cada almacén tiene su
-- plano. `parent_frame_id` es NULL y por tanto `transform` va vacío, que es lo que
-- pide `chk_frame_transform_coherente`: este marco no se define respecto a otro
-- porque no hay ninguno geodésico al que colgarlo. Cuando exista, se cuelga.
CREATE OR REPLACE FUNCTION spatial.ensure_layout_frame(p_warehouse_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = spatial, core, extensions, pg_catalog
AS $$
DECLARE
    v_tenant_id uuid;
    v_site_id   uuid;
    v_code      varchar(40);
    v_frame_id  uuid;
BEGIN
    SELECT l.tenant_id INTO v_tenant_id
      FROM spatial.warehouse_layouts l
     WHERE l.warehouse_id = p_warehouse_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'el almacen % no tiene layout publicado', p_warehouse_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- `spatial.sites` es obligatorio en el marco (FK compuesta). Se toma el sitio
    -- del almacén; si hubiera varios, el primero por código, porque el marco es
    -- del PLANO y el plano es uno por almacén.
    SELECT s.id INTO v_site_id
      FROM spatial.sites s
     WHERE s.warehouse_id = p_warehouse_id AND s.deleted_at IS NULL
     ORDER BY s.code
     LIMIT 1;
    IF v_site_id IS NULL THEN
        RAISE EXCEPTION 'el almacen % no tiene sitio: no hay donde anclar el marco',
            p_warehouse_id USING ERRCODE = 'no_data_found';
    END IF;

    v_code := 'LAYOUT-' || replace(p_warehouse_id::text, '-', '');

    SELECT f.id INTO v_frame_id
      FROM spatial.reference_frames f
     WHERE f.tenant_id = v_tenant_id AND f.code = v_code AND f.deleted_at IS NULL;

    IF v_frame_id IS NOT NULL THEN
        RETURN v_frame_id;
    END IF;

    INSERT INTO spatial.reference_frames (
        tenant_id, site_id, code, name, kind, unit, axis_convention,
        parent_frame_id, transform, provenance, created_by, updated_by
    ) VALUES (
        v_tenant_id, v_site_id, v_code,
        'Marco del plano del almacen',
        -- `local` y no `geographic`: `chk_frame_srid` exige SRID solo para el
        -- geográfico, y este marco no está georreferenciado. Su origen es la
        -- esquina del plano, no un meridiano.
        -- `z_up` y no `ENU`: `chk_frame_axis` solo admite `z_up` o `y_up`, y es la
        -- convencion correcta aqui. La altura del nivel 3 de un rack sube en Z, que
        -- es lo que espera el visor 3D.
        'local', 'm', 'z_up',
        NULL, '{}'::jsonb,
        jsonb_build_object(
            'method',  'layout-plan-calibration',
            'source',  'spatial.warehouse_layouts',
            'migration', '0066',
            'note', 'Origen en el punto (0,0) del layout; escala medida por el operador sobre el plano.'
        ),
        core.current_user_id(), core.current_user_id()
    )
    RETURNING id INTO v_frame_id;

    RETURN v_frame_id;
END;
$$;

COMMENT ON FUNCTION spatial.ensure_layout_frame(uuid) IS
    'Marco de referencia local del plano de un almacen, creandolo si falta. Idempotente por (tenant_id, code).';


-- ── 2 · La derivación ──────────────────────────────────────────────────────
-- Una sola sentencia para las 29.310 filas. La geometría, en el marco local del
-- plano y en metros:
--
--   u = a lo LARGO del rack   (eje local de `length_m`)
--   v = a lo ANCHO del rack   (eje local de `width_m`)
--   z = ALTURA                (eje del mundo, no rota)
--
--   u = (i - 0,5)/N · length_m − length_m/2      i = cuerpo, N = cuerpos del rack
--   v = (p - 0,5)/P · width_m  − width_m/2       p = posición, P = posiciones
--   z = (k - 0,5)/L · height_m                   k = nivel,   L = niveles
--
-- El −length/2 centra: el rack se colocó por su CENTRO (así lo dice
-- `rack_placements.x_m`), no por una esquina. El +0,5 pone la ubicación en el
-- MEDIO de su cuerpo y no en el borde compartido con el siguiente: dos ubicaciones
-- contiguas en el borde tendrían el mismo punto, y entonces «¿qué hueco es este?»
-- no tendría respuesta única.
--
-- Después se gira (u,v) por `rotation_deg` y se traslada al centro del rack. El
-- giro es el del rack, que el editor permite libre y no en múltiplos de 90.
CREATE OR REPLACE FUNCTION spatial.derive_world_positions(p_warehouse_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = spatial, core, extensions, pg_catalog
AS $$
DECLARE
    v_frame_id uuid;
    v_filas    integer;
BEGIN
    v_frame_id := spatial.ensure_layout_frame(p_warehouse_id);

    WITH cuerpo AS (
        -- Cada cuerpo con su índice y cuántos hay en su rack. `row_number` en vez
        -- de `logical_index` directamente: el índice del WMS podría tener huecos
        -- —un cuerpo dado de baja— y entonces el reparto dejaría un vacío en el
        -- medio del rack en lugar de repartir los que hay.
        SELECT b.id            AS bay_id,
               b.parent_node_id AS rack_id,
               row_number() OVER (
                   PARTITION BY b.parent_node_id
                   ORDER BY b.logical_index NULLS LAST, b.node_code
               )               AS i,
               count(*) OVER (PARTITION BY b.parent_node_id) AS n
          FROM spatial.nodes b
         WHERE b.warehouse_id = p_warehouse_id
           AND b.node_type = 'bay'
           AND b.deleted_at IS NULL
    ),
    dim AS (
        -- Niveles y posiciones REALES de cada rack, contados de sus ubicaciones.
        -- No se supone «5 niveles»: RCL01 tiene 7 y 2 posiciones, MZ04 tiene 5 y 1.
        SELECT c.rack_id,
               max(l.logical_level)    AS niveles,
               max(l.logical_position)  AS posiciones
          FROM cuerpo c
          JOIN spatial.locations l ON l.node_id = c.bay_id AND l.deleted_at IS NULL
         GROUP BY c.rack_id
    ),
    calc AS (
        SELECT l.id,
               p.rotation_deg,
               p.x_m, p.y_m,
               -- Reparto a lo largo, centrado en el rack.
               ((c.i - 0.5) / c.n) * p.length_m - p.length_m / 2       AS u,
               -- Reparto a lo ancho. `coalesce(...,1)` porque la mayoría de racks
               -- tiene una sola posición y entonces la ubicación va centrada.
               ((coalesce(l.logical_position, 1) - 0.5)
                    / greatest(coalesce(d.posiciones, 1), 1)) * p.width_m
                    - p.width_m / 2                                    AS v,
               -- Altura del centro del nivel. Sin centrar: el suelo es z = 0.
               ((coalesce(l.logical_level, 1) - 0.5)
                    / greatest(coalesce(d.niveles, 1), 1)) * p.height_m AS z
          FROM spatial.rack_placements p
          JOIN cuerpo c            ON c.rack_id = p.rack_node_id
          JOIN dim d               ON d.rack_id = p.rack_node_id
          JOIN spatial.locations l ON l.node_id = c.bay_id AND l.deleted_at IS NULL
         WHERE p.warehouse_id = p_warehouse_id
    )
    UPDATE spatial.locations dst
       SET world_frame_id = v_frame_id,
           world_position = extensions.ST_MakePoint(
               calc.x_m + calc.u * cos(radians(calc.rotation_deg))
                        - calc.v * sin(radians(calc.rotation_deg)),
               calc.y_m + calc.u * sin(radians(calc.rotation_deg))
                        + calc.v * cos(radians(calc.rotation_deg)),
               calc.z
           ),
           -- `origin` NO se toca: dice de dónde salió la ubicación, no su
           -- geometría. La marca de «calculada» es `world_frame_id`, arriba.
           updated_at = now(),
           updated_by = core.current_user_id()
      FROM calc
     WHERE dst.id = calc.id;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END;
$$;

COMMENT ON FUNCTION spatial.derive_world_positions(uuid) IS
    'Rellena locations.world_position desde rack_placements repartiendo cuerpos y niveles uniformemente. La marca de «calculada» es world_frame_id, no origin. Devuelve las filas escritas.';


-- ── 3 · Borrar la derivación cuando se retira el layout ────────────────────
-- Sin esto, retirar el plano dejaría 29.310 coordenadas apuntando a posiciones de
-- racks que ya no están colocados: geometría huérfana que parece válida.
--
-- Se borra SOLO lo que cuelga del marco de ESTA migración. Una geometría que venga
-- de un levantamiento CAD tendrá su propio marco y no se toca: deshacer un plano
-- dibujado a mano no debe destruir un dato medido con instrumentos.
CREATE OR REPLACE FUNCTION spatial.clear_derived_world_positions(p_warehouse_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = spatial, core, extensions, pg_catalog
AS $$
DECLARE v_filas integer;
BEGIN
    UPDATE spatial.locations l
       SET world_frame_id = NULL,
           world_position = NULL,
           updated_at = now(),
           updated_by = core.current_user_id()
     WHERE l.warehouse_id = p_warehouse_id
       AND l.world_position IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM spatial.reference_frames f
            WHERE f.id = l.world_frame_id
              AND f.provenance ->> 'migration' = '0066'
       );
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas;
END;
$$;

COMMENT ON FUNCTION spatial.clear_derived_world_positions(uuid) IS
    'Borra SOLO la geometria que cuelga del marco del layout (provenance.migration=0066). Un levantamiento CAD con su propio marco no se toca. No modifica origin.';


-- ── 4 · El índice espacial, ahora que la columna deja de estar vacía ───────
-- 0052 se negó a crearlo y con razón: «con la columna al 100 % NULL sería un
-- índice de nada». Ahora tiene sentido, y el uso que viene lo pide: el
-- seguimiento de la flota pregunta «¿qué ubicación está más cerca de este punto?»
-- y sin GIST eso es un recorrido de 29.310 filas por cada fotograma.
CREATE INDEX IF NOT EXISTS idx_loc_world_position
    ON spatial.locations USING GIST (world_position)
    WHERE world_position IS NOT NULL AND deleted_at IS NULL;


-- ── 5 · Permisos ───────────────────────────────────────────────────────────
-- `SECURITY INVOKER`: las funciones corren con los permisos y el contexto RLS de
-- quien llama, así que `olo_app` solo puede derivar la geometría de los almacenes
-- que sus policies ya le dejan escribir. Una función `SECURITY DEFINER` habría
-- sido un agujero: recalcular la geometría de OTRO tenant pasando su uuid.
GRANT EXECUTE ON FUNCTION spatial.ensure_layout_frame(uuid)          TO olo_app;
GRANT EXECUTE ON FUNCTION spatial.derive_world_positions(uuid)       TO olo_app;
GRANT EXECUTE ON FUNCTION spatial.clear_derived_world_positions(uuid) TO olo_app;


-- ── 6 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_funcs int;
    v_idx   int;
    v_grant int;
BEGIN
    SELECT count(*) INTO v_funcs
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'spatial'
       AND p.proname IN ('ensure_layout_frame', 'derive_world_positions',
                         'clear_derived_world_positions');
    IF v_funcs <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 funciones, hay %', v_funcs;
    END IF;

    SELECT count(*) INTO v_idx FROM pg_indexes
     WHERE schemaname = 'spatial' AND indexname = 'idx_loc_world_position';
    IF v_idx <> 1 THEN
        RAISE EXCEPTION 'falta el indice GIST de world_position';
    END IF;

    SELECT count(*) INTO v_grant
      FROM information_schema.role_routine_grants
     WHERE routine_schema = 'spatial' AND grantee = 'olo_app'
       AND routine_name IN ('ensure_layout_frame', 'derive_world_positions',
                            'clear_derived_world_positions');
    IF v_grant < 3 THEN
        RAISE EXCEPTION 'olo_app no puede ejecutar las 3 funciones (tiene %)', v_grant;
    END IF;

    RAISE NOTICE '0066 OK · 3 funciones, indice GIST, olo_app con EXECUTE';
END $$;
