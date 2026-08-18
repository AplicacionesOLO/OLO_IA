-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0098 · Se quitan las figuras del proyecto
--
-- ── LO QUE SE PIERDE ──────────────────────────────────────────────────────────
--
-- Las cinco herramientas de la biblioteca comun. No es grave: las genera
-- `backend/tools/figuras_generar.py` y las vuelve a poner esta misma migracion, asi que
-- volver atras y volver adelante deja lo mismo.
--
-- Lo que SI seria grave es dejar instancias apuntando a un modelo borrado: una figura
-- colocada en un plano sin modelo que dibujar. Por eso se para si hay alguna.
--
-- ── Y POR QUE VUELVE EL NOT NULL AL FINAL ─────────────────────────────────────
--
-- Porque era el estado de 0093 y un rollback que deja la columna mas permisiva no ha vuelto
-- atras: ha dejado una tercera forma de la tabla que nadie ha probado. Solo se puede
-- restaurar si no queda ninguna fila sin `glb_path`, que es justo lo que garantiza haber
-- borrado antes las del proyecto.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_colocadas int;
BEGIN
    SELECT count(*) INTO v_colocadas
      FROM spatial.asset_instances i
      JOIN spatial.asset_models m ON m.id = i.model_id
     WHERE m.builtin_key IS NOT NULL AND i.deleted_at IS NULL;

    IF v_colocadas > 0 THEN
        RAISE EXCEPTION
            'hay % figura(s) del proyecto colocadas en algun plano. Quitalas antes: borrar '
            'el modelo dejaria una figura en el plano que no se puede dibujar.', v_colocadas;
    END IF;
END $$;

--  Se borran DE VERDAD y no con `deleted_at`: son filas que puso la migracion, no datos que
--  alguien escribio. Un borrado logico las dejaria ocupando su `builtin_key` en el indice
--  unico y volver a aplicar 0098 fallaria.
DELETE FROM spatial.asset_models WHERE builtin_key IS NOT NULL;

DROP INDEX IF EXISTS spatial.ux_asset_builtin;

ALTER TABLE spatial.asset_models
    DROP CONSTRAINT IF EXISTS chk_asset_origen;

ALTER TABLE spatial.asset_models
    DROP COLUMN IF EXISTS builtin_key;

ALTER TABLE spatial.asset_models
    ALTER COLUMN glb_path SET NOT NULL;

DO $$
DECLARE
    v int;
BEGIN
    SELECT count(*) INTO v FROM spatial.asset_models WHERE deleted_at IS NULL;
    RAISE NOTICE 'OK · 0098 deshecha. Quedan % figura(s), todas con objeto en el bucket.', v;
END $$;
