-- ═══════════════════════════════════════════════════════════════════════════
-- 0056_spatial_import_audit_rollback.sql
-- Revierte : 0056 · elimina spatial.import_row_errors e import_batches
--
-- ⚠ Este rollback DESTRUYE el registro de importaciones. No es reversible en el
--   otro sentido: reaplicar 0056 deja las tablas vacías, y con ellas se pierde
--   la evidencia de qué archivo se importó y cuándo.
--
--   Por eso aborta si hay lotes registrados salvo que se declare la intención
--   con la variable de sesión `olo.confirm_destructive`. Un `DROP TABLE` que se
--   ejecuta sin resistencia sobre datos de auditoría es una trampa esperando
--   a alguien con prisa.
--
--       SET LOCAL olo.confirm_destructive = '0056';
--       \i 0056_spatial_import_audit_rollback.sql
--
--   El orden importa: `import_row_errors` referencia a `import_batches`, así que
--   se elimina primero. El `ON DELETE CASCADE` no ayuda en un DROP.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0 · Orden de reversión ─────────────────────────────────────────────────
--
-- `spatial.warehouse_summary` (0057) consulta `import_batches` para exponer la
-- fecha de la última importación. Con `RESTRICT`, el DROP fallaría con un error
-- de dependencia correcto pero genérico. Esta comprobación nombra la causa y la
-- solución, porque «cannot drop table because other objects depend on it» no
-- dice a nadie que hay que revertir 0057 primero.
DO $$
DECLARE v_dependientes text;
BEGIN
    SELECT string_agg(DISTINCT dependiente.relname, ', ' ORDER BY dependiente.relname)
      INTO v_dependientes
      FROM pg_depend d
      JOIN pg_rewrite r        ON r.oid = d.objid
      JOIN pg_class dependiente ON dependiente.oid = r.ev_class
      JOIN pg_class base        ON base.oid = d.refobjid
      JOIN pg_namespace n       ON n.oid = base.relnamespace
     WHERE n.nspname = 'spatial'
       AND base.relname IN ('import_batches', 'import_row_errors')
       AND dependiente.relkind IN ('v', 'm')
       AND dependiente.relname NOT IN ('import_batches', 'import_row_errors');

    IF v_dependientes IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede revertir 0056 mientras existan objetos que dependen de las '
            'tablas de auditoria: %. Revierta primero las migraciones posteriores '
            '(0057 crea warehouse_summary, que lee import_batches).', v_dependientes;
    END IF;
END
$$;

DO $$
DECLARE v_lotes int; v_errores int; v_confirmado text;
BEGIN
    SELECT count(1) INTO v_lotes   FROM spatial.import_batches;
    SELECT count(1) INTO v_errores FROM spatial.import_row_errors;

    IF v_lotes > 0 OR v_errores > 0 THEN
        v_confirmado := coalesce(current_setting('olo.confirm_destructive', true), '');
        IF v_confirmado <> '0056' THEN
            RAISE EXCEPTION
                'Revertir 0056 destruiria % lote(s) y % error(es) de importacion. '
                'Si es lo que quiere: SET LOCAL olo.confirm_destructive = ''0056'';',
                v_lotes, v_errores;
        END IF;
        RAISE WARNING 'rollback 0056: se destruyen % lote(s) y % error(es) de importacion',
                      v_lotes, v_errores;
    END IF;
END
$$;

DROP TABLE IF EXISTS spatial.import_row_errors;
DROP TABLE IF EXISTS spatial.import_batches;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial'
       AND c.relname IN ('import_batches', 'import_row_errors');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % tabla(s) de auditoria', v_n; END IF;

    -- Las políticas y los índices se van con las tablas; se comprueba que no
    -- quede un huérfano en el catálogo por si algún día dejan de irse.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE schemaname = 'spatial' AND tablename LIKE 'import_%';
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % politica(s) huerfana(s)', v_n; END IF;

    RAISE NOTICE 'OK rollback 0056: import_row_errors e import_batches eliminadas '
                 '(errores primero, por la FK) · sin politicas huerfanas';
END
$$;
