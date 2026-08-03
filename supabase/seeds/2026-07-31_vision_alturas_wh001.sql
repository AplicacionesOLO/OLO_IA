-- ═══════════════════════════════════════════════════════════════════════════
-- SEMILLA DE DATOS — NO ES UNA MIGRACIÓN
--
-- Fecha    : 2026-07-31
-- Objeto   : proyecto de visión «Inspección de alturas — WH-001» y sus 5 clases,
--            más la retirada de la clase de prueba `PasilloPrueba`.
--
-- ── POR QUÉ NO VA EN supabase/migrations/ ─────────────────────────────────────
--
-- Esto NO es esquema: es contenido de usuario. Una migración se ejecuta en todos
-- los entornos y para siempre, así que meter aquí un proyecto concreto crearía
-- «Inspección de alturas — WH-001» en producción y en cualquier entorno futuro,
-- pertenezca o no ese almacén a ese entorno.
--
-- Por eso vive en `supabase/seeds/`, NO se registra en
-- `supabase_migrations.schema_migrations`, y es IDEMPOTENTE: se puede volver a
-- ejecutar sin duplicar nada.
--
-- ── LOS DOS INVARIANTES QUE CONDICIONAN ESTE ARCHIVO ─────────────────────────
--
-- 1 · `class_index` ES EL ÍNDICE YOLO. Es inmutable —lo impone el disparador
--     `trg_class_index_inmutable`— y `uq_class_indice` NO filtra por `deleted_at`
--     a propósito: un índice liberado y reutilizado haría que un modelo ya
--     entrenado devolviera la etiqueta equivocada SIN error alguno.
--
--     De ahí que las 5 clases vayan en un proyecto NUEVO y no en «Prueba»: en
--     «Prueba» el índice 0 está quemado por `PasilloPrueba`, y las clases reales
--     habrían arrancado en 1 con un hueco muerto delante.
--
-- 2 · `PasilloPrueba` NO SE PUEDE BORRAR EN DURO. `ai.model_classes` la
--     referencia con `ON DELETE RESTRICT` —una versión de modelo la tiene atada
--     al índice 0—, así que un `DELETE` falla. La vía correcta es la que
--     documenta el propio esquema: «Desactivar es la via correcta de retirar una
--     clase». Se marca `is_active = false` y `deleted_at`, que es exactamente lo
--     que hace el repositorio de la aplicación (`soft_delete = True`).
-- ═══════════════════════════════════════════════════════════════════════════

-- Sin metacomandos de psql: este archivo se ejecuta con `tools/admin_sql.py`, que
-- envía SQL por el driver y aborta la transacción completa ante cualquier error.
DO $$
DECLARE
    v_autor    uuid;
    v_proyecto uuid;
    v_n        int;
    v_retirada int;
BEGIN
    -- ── Autor ───────────────────────────────────────────────────────────────
    -- `created_by` es NOT NULL con FK a core.users: sin autor real, la fila no
    -- entra. Se resuelve por email en lugar de fijar un UUID a mano.
    SELECT id INTO v_autor FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;

    IF v_autor IS NULL THEN
        RAISE EXCEPTION 'no existe el usuario arojas@ologistics.com: sin autor no se puede sembrar';
    END IF;

    -- ── Proyecto ────────────────────────────────────────────────────────────
    -- Idempotente por `slug`, que es el identificador estable. `status` se deja
    -- en 'draft', el valor por omisión: es la aplicación la que debe moverlo a
    -- 'collecting' cuando entren imágenes, no esta semilla.
    SELECT id INTO v_proyecto FROM ai.projects
     WHERE slug = 'inspeccion-alturas-wh-001' AND deleted_at IS NULL;

    IF v_proyecto IS NULL THEN
        INSERT INTO ai.projects (name, slug, description, status, created_by)
        VALUES (
            'Inspección de alturas — WH-001',
            'inspeccion-alturas-wh-001',
            'Lectura de ubicación y pallet en niveles N03 y superiores del CD San José. '
            || 'Alcance: 20.734 ubicaciones de 29.312 (70,7 %). '
            || 'N01 y N02 se mantienen en el catálogo pero quedan FUERA de alcance: '
            || 'son picking y no se trabajan por ahora.',
            'draft',
            v_autor
        )
        RETURNING id INTO v_proyecto;
        RAISE NOTICE 'proyecto CREADO: %', v_proyecto;
    ELSE
        RAISE NOTICE 'proyecto ya existía: % (no se toca)', v_proyecto;
    END IF;

    -- ── Las 5 clases ────────────────────────────────────────────────────────
    --
    -- Índices 0..4 EXPLÍCITOS y contiguos. La aplicación los asigna con un
    -- advisory lock porque ahí hay concurrencia; aquí no la hay, y fijarlos hace
    -- el archivo reproducible: la misma semilla da el mismo mapa de etiquetas.
    --
    -- Los colores salen de los tokens del sistema de diseño, para que la UI de
    -- anotación no invente una paleta propia.
    INSERT INTO ai.classes (project_id, name, class_index, color, description, created_by)
    SELECT v_proyecto, c.name, c.idx, c.color, c.descripcion, v_autor
      FROM (VALUES
        (0, 'qr_ubicacion',      '#60A5FA',
            'Etiqueta de ubicación con su QR, en montante o viga. Encuadra la etiqueta '
            || 'completa, no solo el QR: el código legible forma parte del objeto.'),
        (1, 'qr_pallet',         '#A78BFA',
            'Etiqueta del pallet con su QR — las de «eflow WMS», 13 dígitos. Va sobre la '
            || 'carga o el film, no en la estructura.'),
        (2, 'pallet',            '#34E5B4',
            'Pallet completo: base de madera más carga. Un hueco puede tener más de uno; '
            || 'se anota cada uno por separado.'),
        (3, 'hueco_vacio',       '#64748B',
            'Hueco sin nada. Es una clase POSITIVA, no la ausencia de anotación: es lo que '
            || 'permite distinguir «leído y vacío» de «no leído».'),
        (4, 'etiqueta_ilegible', '#FBBF24',
            'Etiqueta presente pero no legible: rota, tapada, borrosa o fuera de foco. Se '
            || 'anota la etiqueta, no lo que la tapa.')
      ) AS c(idx, name, color, descripcion)
     WHERE NOT EXISTS (
        SELECT 1 FROM ai.classes x
         WHERE x.project_id = v_proyecto AND x.name = c.name AND x.deleted_at IS NULL
     );

    SELECT count(*) INTO v_n FROM ai.classes
     WHERE project_id = v_proyecto AND deleted_at IS NULL;
    RAISE NOTICE 'clases activas en el proyecto: %', v_n;

    -- ── Retirada de la clase de prueba ──────────────────────────────────────
    --
    -- Baja lógica, no borrado: ver el invariante 2 de la cabecera. `version` se
    -- incrementa a mano porque `core.set_updated_at()` NO lo toca —deliberadamente,
    -- para no producir 409 espurios— y el bloqueo optimista de la aplicación
    -- espera que cada cambio lo suba.
    UPDATE ai.classes
       SET is_active  = false,
           deleted_at = now(),
           updated_by = v_autor,
           version    = version + 1
     WHERE name = 'PasilloPrueba'
       AND deleted_at IS NULL;

    GET DIAGNOSTICS v_retirada = ROW_COUNT;
    RAISE NOTICE 'clases de prueba retiradas: %', v_retirada;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--
-- Aborta si el resultado no es exactamente el esperado. Una semilla que dice
-- «OK» sin comprobar nada es peor que no ejecutarla: deja creer que el estado
-- es el que se pidió.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_proyecto uuid;
    v_n        int;
    v_min      int;
    v_max      int;
    v_mock     int;
    r          record;
BEGIN
    SELECT id INTO v_proyecto FROM ai.projects
     WHERE slug = 'inspeccion-alturas-wh-001' AND deleted_at IS NULL;

    IF v_proyecto IS NULL THEN
        RAISE EXCEPTION 'FALLO: el proyecto no existe tras la siembra';
    END IF;

    -- 5 clases, índices 0..4 contiguos.
    SELECT count(*), min(class_index), max(class_index)
      INTO v_n, v_min, v_max
      FROM ai.classes WHERE project_id = v_proyecto AND deleted_at IS NULL;

    IF v_n <> 5 THEN
        RAISE EXCEPTION 'FALLO: se esperaban 5 clases activas, hay %', v_n;
    END IF;
    IF v_min <> 0 OR v_max <> 4 THEN
        RAISE EXCEPTION 'FALLO: los indices YOLO deben ser 0..4, son %..%', v_min, v_max;
    END IF;

    -- Ninguna clase de prueba activa en NINGÚN proyecto.
    SELECT count(*) INTO v_mock FROM ai.classes
     WHERE name = 'PasilloPrueba' AND deleted_at IS NULL;
    IF v_mock <> 0 THEN
        RAISE EXCEPTION 'FALLO: quedan % clases de prueba activas', v_mock;
    END IF;

    -- Y la referencia del modelo sigue intacta: retirar no es romper.
    SELECT count(*) INTO v_mock FROM ai.model_classes;
    IF v_mock < 1 THEN
        RAISE EXCEPTION 'FALLO: se perdio la referencia de ai.model_classes';
    END IF;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'proyecto: %', v_proyecto;
    FOR r IN SELECT class_index, name, color FROM ai.classes
              WHERE project_id = v_proyecto AND deleted_at IS NULL
              ORDER BY class_index LOOP
        RAISE NOTICE '  [%] % %', r.class_index, rpad(r.name, 18), r.color;
    END LOOP;
    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'OK: 5 clases con indices 0..4, PasilloPrueba retirada, model_classes intacta';
END $$;
