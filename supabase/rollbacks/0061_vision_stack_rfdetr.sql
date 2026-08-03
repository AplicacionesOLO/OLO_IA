-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK 0061_vision_stack_rfdetr.sql
--
-- Deshace: reactiva las 11 arquitecturas de `ultralytics` y su framework, y retira
--          las 4 de `rf-detr`.
--
-- ⚠ LO QUE ESTE ROLLBACK **NO** DEVUELVE
--
--   El texto original de `notes` de las filas de ultralytics. La migración le
--   AÑADIÓ el sufijo «[RETIRADA 0061] …» y no guardó el valor anterior. Aquí se
--   recorta ese sufijo con `regexp_replace`, lo que recupera el texto original
--   siempre que nadie lo haya editado a mano entre medias.
--
--   Se dice en voz alta en lugar de fingir una reversión perfecta.
--
-- ⚠ ABORTA SI HAY MODELOS USANDO rf-detr
--
--   Desactivar una arquitectura que un modelo usa no rompe nada —para eso existe
--   `is_active`— pero un rollback silencioso dejaría al operador con un modelo cuya
--   arquitectura desapareció de la interfaz sin explicación. Mejor abortar y que
--   decida.
--
-- ⚠ NO BORRA LAS FILAS DE rf-detr
--
--   `ai.models` tiene FK a `ai.architectures`. Si algún modelo llegó a apuntar a
--   `rf-detr-base`, un DELETE fallaría. Se desactivan, igual que hizo la migración
--   con las de ultralytics. Un catálogo de referencia no se reescribe.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_en_uso int;
    v_reactivadas int;
    v_retiradas int;
    r record;
BEGIN
    SELECT count(*) INTO v_en_uso
      FROM ai.models m
      JOIN ai.architectures a ON a.code = m.architecture_code
     WHERE m.deleted_at IS NULL AND a.framework_code = 'rfdetr';

    IF v_en_uso > 0 THEN
        RAISE NOTICE 'Hay % modelo(s) usando arquitecturas rf-detr:', v_en_uso;
        FOR r IN SELECT m.name, m.architecture_code, p.slug AS proyecto
                  FROM ai.models m
                  JOIN ai.architectures a ON a.code = m.architecture_code
                  JOIN ai.projects p ON p.id = m.project_id
                 WHERE m.deleted_at IS NULL AND a.framework_code = 'rfdetr' LOOP
            RAISE NOTICE '  % | % | %', r.name, r.architecture_code, r.proyecto;
        END LOOP;
        RAISE EXCEPTION
            'ABORTADO: revertir dejaria esos modelos apuntando a una arquitectura '
            'retirada sin que nadie lo haya decidido. Repuntalos o archivalos primero.';
    END IF;

    -- ── Reactivar ultralytics ───────────────────────────────────────────────
    UPDATE ai.architectures
       SET is_active  = true,
           updated_at = now(),
           notes      = nullif(
               btrim(regexp_replace(
                   coalesce(notes, ''),
                   '\s*\[RETIRADA 0061\][^$]*$', ''
               )), ''
           )
     WHERE framework_code = 'ultralytics';
    GET DIAGNOSTICS v_reactivadas = ROW_COUNT;

    UPDATE ai.frameworks
       SET is_active = true,
           notes     = nullif(
               btrim(regexp_replace(
                   coalesce(notes, ''),
                   '\s*\[RETIRADO 0061\][^$]*$', ''
               )), ''
           )
     WHERE code = 'ultralytics';

    -- ── Retirar rf-detr ─────────────────────────────────────────────────────
    UPDATE ai.architectures
       SET is_active  = false,
           updated_at = now(),
           notes      = coalesce(notes || ' ', '')
                        || '[REVERTIDA rollback 0061] Catalogo devuelto al estado previo.'
     WHERE framework_code = 'rfdetr';
    GET DIAGNOSTICS v_retiradas = ROW_COUNT;

    UPDATE ai.frameworks SET is_active = false WHERE code = 'rfdetr';

    -- ── Verificación ────────────────────────────────────────────────────────
    IF (SELECT count(*) FROM ai.architectures
         WHERE framework_code = 'ultralytics' AND is_active) <> 11 THEN
        RAISE EXCEPTION 'se esperaban 11 arquitecturas de ultralytics activas';
    END IF;
    IF (SELECT count(*) FROM ai.architectures
         WHERE framework_code = 'rfdetr' AND is_active) <> 0 THEN
        RAISE EXCEPTION 'quedan arquitecturas rf-detr activas';
    END IF;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'reactivadas (ultralytics): %', v_reactivadas;
    RAISE NOTICE 'retiradas (rf-detr):       %', v_retiradas;
    RAISE NOTICE 'OK rollback 0061. Recuerda: ADR-014 sigue vigente — reactivar';
    RAISE NOTICE 'ultralytics reintroduce la obligacion AGPL sobre todo el producto.';
    RAISE NOTICE '───────────────────────────────────────────────';
END $$;
