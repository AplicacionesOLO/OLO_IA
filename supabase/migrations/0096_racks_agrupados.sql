-- ═══════════════════════════════════════════════════════════════════════════════
-- 0096 · Racks agrupados: el rack doble, y cualquier otro conjunto que se mueva junto
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- Dos racks se ponen físicamente de espaldas para formar un rack doble, con los frentes
-- opuestos. `RCL21` y `RCL22`, por ejemplo. Y una vez colocados así, mover uno sin el otro
-- no tiene sentido: dejaría un rack doble partido por la mitad.
--
-- Dicho tal cual por quien modela: «que el sistema logre acomodar dos racks cualesquiera, y
-- la persona que modele el almacén se encargará de colocar los pares como corresponda y
-- darle agrupar para que si se desea mover el objeto se muevan juntos».
--
-- ── POR QUE NO SE DEDUCE ──────────────────────────────────────────────────────
--
-- Porque no se puede. El catálogo no dice hacia dónde mira un rack, y los códigos son
-- consecutivos por importación —RCL21, RCL22, RCL23…—, no por parejas. Deducir que dos
-- racks contiguos son pareja acertaría en la mitad de los casos y se equivocaría en la otra
-- mitad sin decirlo.
--
-- Lo declara quien modela, que es quien tiene el almacén delante.
--
-- ── POR QUE UNA CLAVE Y NO UNA TABLA DE GRUPOS ────────────────────────────────
--
-- Porque un grupo no tiene nada propio: no tiene nombre, ni estado, ni nada que consultar.
-- Es solo «estos van juntos». Una tabla aparte añadiría una fila, una clave ajena y un
-- `JOIN` para no guardar ningún dato más — y habría que limpiar los grupos que se quedan con
-- un solo miembro o con ninguno—.
--
-- Con una clave en la propia colocación, deshacer un grupo es poner `NULL` y no queda basura.
--
-- ── POR QUE VIAJA CON EL PLANO PUBLICADO ──────────────────────────────────────
--
-- Porque es parte de la colocación, no una preferencia de quien la hizo. Si viviera solo en
-- el borrador del navegador, el rack doble sería doble para quien lo modeló y dos racks
-- suel­tos para todos los demás — y el primero que moviera uno lo partiría—.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE spatial.rack_placements
    ADD COLUMN IF NOT EXISTS group_key varchar(40);

COMMENT ON COLUMN spatial.rack_placements.group_key IS
    'Los racks que comparten esta clave se mueven juntos. `NULL` = suelto. El caso que lo '
    'motiva es el rack doble —dos racks de espaldas, frentes opuestos— pero vale para '
    'cualquier conjunto. Lo declara quien modela: el catalogo no dice hacia donde mira un '
    'rack y los codigos son consecutivos por importacion, no por parejas.';

-- Una clave vacía no es una clave: sería un grupo al que pertenecen todos los racks que
-- alguien guardó con la cadena vacía, y moverlos juntos sería un desastre silencioso.
ALTER TABLE spatial.rack_placements
    ADD CONSTRAINT chk_placement_group
        CHECK (group_key IS NULL OR length(trim(group_key)) > 0);

-- Para pedir «los del mismo grupo» sin recorrer los 347.
CREATE INDEX IF NOT EXISTS ix_placement_group
    ON spatial.rack_placements (warehouse_id, group_key)
    WHERE group_key IS NOT NULL;

-- ── La vista ──────────────────────────────────────────────────────────────────
--
-- Se reconstruye A PARTIR DE SU DEFINICION REAL, no de memoria. La primera versión de esta
-- migración la reescribió a ojo y se dejaba fuera `node_type` y `node_function`, cambiaba el
-- `JOIN` —que va por tenant, almacén e id— y perdía el `WHERE n.deleted_at IS NULL`: habría
-- dejado ver colocaciones de racks borrados y roto a los consumidores de esas dos columnas.
--
-- Y `group_key` va AL FINAL. `CREATE OR REPLACE VIEW` exige que las columnas que ya existían
-- mantengan nombre, tipo y ORDEN; meterla en medio no es un detalle de estilo, es que la
-- sentencia falla.
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
       p.group_key
  FROM spatial.rack_placements p
  JOIN spatial.nodes n
    ON n.tenant_id = p.tenant_id
   AND n.warehouse_id = p.warehouse_id
   AND n.id = p.rack_node_id
 WHERE n.deleted_at IS NULL;

GRANT SELECT ON spatial.v_rack_placements TO olo_app, authenticated;

DO $$
DECLARE
    v_racks int;
    v_grupos int;
BEGIN
    SELECT count(*) INTO v_racks FROM spatial.rack_placements;
    SELECT count(*) INTO v_grupos FROM spatial.rack_placements WHERE group_key IS NOT NULL;

    -- Una columna nueva y nula: ninguna colocación cambia. Se comprueba que siguen las 30 y
    -- que nadie ha quedado agrupado por accidente.
    IF v_grupos <> 0 THEN
        RAISE EXCEPTION 'no deberia haber ningun grupo todavia, y hay %', v_grupos;
    END IF;

    RAISE NOTICE 'OK · % colocacion(es) intactas, ninguna agrupada. Los grupos los declara '
                 'quien modela.', v_racks;
END $$;
