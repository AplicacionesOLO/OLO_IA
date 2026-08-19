-- ═══════════════════════════════════════════════════════════════════════════════
-- 0101 · El nombre de una clase es una CLAVE, no una etiqueta para leer
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- Se crearon dos clases desde la pantalla —`Larguero` y `Paral`— con la capitalizacion
-- natural de quien las escribe. Y el nombre de una clase se compara en codigo:
--
--     CLASES_DE_CODIGO    = {'qr_ubicacion', 'qr_pallet'}
--     CLASES_CON_PRUEBA   = {'qr_ubicacion', 'qr_pallet', 'pallet', 'hueco_vacio'}
--     CLASES_DE_UBICACION = {'qr_ubicacion'}
--
-- Todas esas comparaciones son exactas. Una clase llamada `Larguero` no casa nunca con un
-- `'larguero'` escrito en el codigo, y el sintoma NO es un error: es una deteccion que se
-- guarda sin recorte, o un hueco que no se promueve a observacion, sin una sola linea en
-- ningun log. La clase de fallo que solo se descubre semanas despues.
--
-- ── SE ARREGLA AHORA PORQUE AHORA ES GRATIS ───────────────────────────────────
--
-- Las dos tienen CERO anotaciones. Renombrar no arrastra nada. Con anotaciones encima
-- habria que migrarlas y reentrenar, asi que la ventana es esta.
--
-- ── Y EL COLOR TAMBIEN IMPORTA ────────────────────────────────────────────────
--
-- `Larguero` quedo en blanco y el larguero de verdad ES blanco: la caja desaparecia justo
-- sobre lo que marca. `Paral` quedo en #280193, azul casi negro, sobre un almacen que en
-- el video sale oscuro. Los dos eran invisibles al revisar, que es cuando se usan.
--
-- Se les da rosa y naranja: distinguibles entre si, de las otras cinco clases, y visibles
-- tanto sobre el metal claro como sobre el fondo negro.
--
-- ── EL CHECK ES `NOT VALID` A PROPOSITO ───────────────────────────────────────
--
-- `NOT VALID` no revisa las filas que ya estan; solo obliga a las nuevas. Es exactamente
-- lo que hace falta: hay una clase `PasilloPrueba` en un proyecto de pruebas que no es
-- nuestra para renombrar, y bloquear la migracion por ella seria dejar el sistema sin la
-- garantia por un dato que no molesta a nadie.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE ai.classes SET name = 'larguero', color = '#F472B6', updated_at = now()
 WHERE name = 'Larguero';

UPDATE ai.classes SET name = 'paral', color = '#FB923C', updated_at = now()
 WHERE name = 'Paral';

ALTER TABLE ai.classes
    ADD CONSTRAINT chk_class_name_canonico
    CHECK (name = lower(name) AND name !~ '[^a-z0-9_]')
    NOT VALID;

COMMENT ON CONSTRAINT chk_class_name_canonico ON ai.classes IS
    'El nombre de una clase se compara en codigo (CLASES_DE_CODIGO y compania), asi que '
    'tiene que ser canonico: minusculas, digitos y guion bajo. NOT VALID porque las filas '
    'anteriores se conservan tal cual; la normalizacion la hace `normalizar_nombre`.';

DO $$
DECLARE
    v_mal int;
    v_larg int;
    v_par int;
BEGIN
    SELECT count(*) INTO v_larg FROM ai.classes WHERE name = 'larguero';
    SELECT count(*) INTO v_par  FROM ai.classes WHERE name = 'paral';
    IF v_larg <> 1 OR v_par <> 1 THEN
        RAISE EXCEPTION 'esperaba una `larguero` y una `paral` y hay % y %', v_larg, v_par;
    END IF;

    --  Que no queden mayusculas en el proyecto de verdad. `PasilloPrueba` vive en otro.
    SELECT count(*) INTO v_mal
      FROM ai.classes c
      JOIN ai.projects p ON p.id = c.project_id
     WHERE c.name <> lower(c.name) AND p.name NOT ILIKE '%prueba%';
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'quedan % clase(s) con mayusculas en proyectos reales', v_mal;
    END IF;

    --  Y que el CHECK de verdad rechace lo que tiene que rechazar. Sin esto, un CHECK mal
    --  escrito pasaria por bueno y el problema volveria por la misma puerta.
    --  `created_by` es NOT NULL, asi que hay que darle uno: se reutiliza el de una clase
    --  que ya existe. Sin el, el INSERT moria por el NOT NULL ANTES de llegar al CHECK y
    --  la comprobacion pasaba por buena sin haber probado nada.
    BEGIN
        INSERT INTO ai.classes (project_id, name, class_index, color, created_by)
        SELECT c.project_id, 'ClaseMala', 9999, '#FFFFFF', c.created_by
          FROM ai.classes c WHERE c.created_by IS NOT NULL LIMIT 1;
        RAISE EXCEPTION 'el CHECK admitio `ClaseMala`: no protege nada';
    EXCEPTION
        WHEN check_violation THEN
            NULL;  --  lo esperado
    END;

    RAISE NOTICE 'OK - larguero y paral en minuscula con colores visibles, y el CHECK '
                 'rechaza nombres no canonicos (comprobado insertando uno).';
END $$;
