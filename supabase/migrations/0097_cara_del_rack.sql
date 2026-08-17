-- ═══════════════════════════════════════════════════════════════════════════════
-- 0097 · La CARA del rack: por dónde se saca la mercancía
--
-- ── EL FALLO QUE ARREGLA ──────────────────────────────────────────────────────
--
-- Un rack de estantería tiene UNA cara operativa: la que da al pasillo. Por la otra no se
-- saca nada, porque detrás hay una pared, otro rack, o el aire.
--
-- El modelo no lo sabía. Ni la base, ni el catálogo importado, ni el visor. Así que las
-- placas de los huecos se pintaban en LAS DOS caras largas de cada rack — un compromiso
-- razonable mientras «cuál es la buena» no tuviera respuesta—.
--
-- Con el rack doble ese compromiso pasa de aproximado a FALSO. Dos racks de espaldas
-- —RCL21 y RCL22— tienen sus caras interiores pegadas la una a la otra:
--
--     pasillo │ ███ RCL21 ███ ║ ███ RCL22 ███ │ pasillo
--             ↑ cara buena    ↑↑ aqui no hay nada, y se pintaba dos veces
--
-- Las dos caras interiores ocupan el mismo plano físico, así que se solapan y muestran
-- datos contradictorios: dos huecos distintos peleándose por el mismo píxel. Y las dos son
-- mentira, porque por ahí no se coge un palet.
--
-- ── POR QUE LA COLUMNA ADMITE NULOS ───────────────────────────────────────────
--
-- Porque no hay de dónde sacar el dato. El catálogo importado no trae la cara, y no se puede
-- deducir: `node_function` no la dice, y adivinarla por la posición de los vecinos acertaría
-- en unos racks y fallaría en otros SIN DECIR EN CUALES.
--
-- Poner un valor por defecto sería inventarse el almacén. Cada rack afirmaría una cara que
-- nadie ha comprobado, la mitad estarían al revés, y no habría forma de distinguir «esta cara
-- la declaró alguien» de «esta cara la puso la migración a cara o cruz».
--
-- Así que `NULL` significa SIN DECLARAR, y significa algo operativo: mientras un rack no
-- tenga cara, se sigue pintando por las dos, exactamente como hasta hoy. Ningún rack cambia
-- de aspecto al aplicar esto. Lo que cambia es que ahora se puede declarar, y quien lo haga
-- verá su rack pintado solo por donde de verdad se trabaja.
--
-- ── POR QUE −1 / +1 Y NO 'norte' NI 'izquierda' ───────────────────────────────
--
-- Porque la cara es un LADO DEL PROPIO RACK, no una dirección del almacén. Un rack girado
-- 90° tiene la misma cara de siempre, solo que apuntando a otro sitio; guardar «norte» la
-- dejaría mintiendo en cuanto alguien lo rotase.
--
-- En el marco local del rack —el mismo en el lienzo 2D, el axonométrico y el 3D— el ancho va
-- sobre el eje X y el largo sobre el Y. Las dos caras largas son entonces `x = +ancho/2` y
-- `x = −ancho/2`, y no hay una tercera. `+1` y `−1` nombran esas dos y nada más.
--
-- El efecto que importa sale gratis: el gemelo de un rack doble se modela girado 180°, y un
-- giro de 180° ya invierte hacia dónde apunta esa cara en el mundo. Los dos racks del par
-- pueden tener el MISMO valor y sus frentes salen opuestos, que es justo la realidad física.
-- Es lo mismo que hace la numeración de cuerpos: la regla se escribe en el marco del rack y
-- el giro se encarga del resto.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE spatial.rack_placements
    ADD COLUMN IF NOT EXISTS facing smallint;

COMMENT ON COLUMN spatial.rack_placements.facing IS
    'Cara operativa del rack —la que da al pasillo— como lado del marco LOCAL del rack: '
    '+1 es la cara en x = +ancho/2 y -1 la de x = -ancho/2. NULL = sin declarar, y entonces '
    'se sigue pintando por las dos caras, que es el comportamiento anterior a 0097. Se guarda '
    'en el marco local y no como rumbo del almacen para que rotar el rack no la deje '
    'mintiendo: el gemelo de un rack doble se modela a 180 grados y con el mismo valor le '
    'sale la cara contraria, que es lo que ocurre en el suelo.';

ALTER TABLE spatial.rack_placements
    ADD CONSTRAINT chk_placement_facing
        CHECK (facing IS NULL OR facing IN (-1, 1));

-- ── La vista ──────────────────────────────────────────────────────────────────
--
-- Reconstruida a partir de su definición real, con `facing` AL FINAL: `CREATE OR REPLACE
-- VIEW` exige que las columnas que ya existían mantengan nombre, tipo y orden, así que la
-- nueva va detrás de `group_key`, que es la que añadió 0096.
CREATE OR REPLACE VIEW spatial.v_rack_placements
WITH (security_invoker = true) AS
SELECT p.id,
       p.tenant_id,
       p.warehouse_id,
       p.layout_id,
       p.rack_node_id,
       n.node_code AS rack_code,
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
       p.updated_at,
       p.group_key,
       p.facing
  FROM spatial.rack_placements p
  JOIN spatial.nodes n
    ON n.tenant_id = p.tenant_id
   AND n.warehouse_id = p.warehouse_id
   AND n.id = p.rack_node_id
 WHERE n.deleted_at IS NULL;

GRANT SELECT ON spatial.v_rack_placements TO olo_app, authenticated;

DO $$
DECLARE
    v_racks    int;
    v_con_cara int;
    v_cols     int;
BEGIN
    SELECT count(*), count(facing) INTO v_racks, v_con_cara
      FROM spatial.rack_placements;

    -- Nadie puede haber quedado con cara: no hay de dónde sacarla, y si algo la hubiera
    -- puesto sería un valor inventado que después nadie sabría distinguir de uno declarado.
    IF v_con_cara <> 0 THEN
        RAISE EXCEPTION
            'ningun rack deberia tener cara todavia y % la tienen. Una cara que no declaro '
            'nadie es un dato inventado.', v_con_cara;
    END IF;

    -- Y la vista tiene que seguir sirviendo lo de antes MAS la columna nueva. Si un
    -- `CREATE OR REPLACE` se hubiera dejado columnas por el camino, el 500 aparecería en
    -- cada peticion de layout y no aqui.
    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'v_rack_placements';
    IF v_cols <> 19 THEN
        RAISE EXCEPTION 'la vista deberia tener 19 columnas y tiene %', v_cols;
    END IF;

    RAISE NOTICE 'OK · % colocacion(es), ninguna con cara declarada. Se siguen pintando las '
                 'dos caras hasta que alguien diga cual es la buena.', v_racks;
END $$;
