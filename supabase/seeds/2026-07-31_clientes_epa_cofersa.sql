-- ═══════════════════════════════════════════════════════════════════════════
-- SEMILLA DE DATOS — NO ES UNA MIGRACION
--
-- Fecha  : 2026-07-31
-- Objeto : los dos clientes reales de OLO Costa Rica: EPA y Cofersa
--
-- No va en migrations/ porque son datos de este operador concreto. Una migracion
-- crearia EPA y Cofersa en todos los entornos y para siempre.
--
-- Idempotente por (tenant_id, code): volver a ejecutarlo no duplica nada.
--
-- `legal_name` y `tax_id` quedan NULL a proposito: no los tengo y no los invento.
-- Se rellenan desde la pantalla de Administracion cuando esten a mano.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tenant  uuid;
    v_company uuid;
    v_autor   uuid;
    v_creados int := 0;
    r         record;
BEGIN
    SELECT id INTO v_autor FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;

    -- La company del operador en Costa Rica. Si hubiera varias, hay que elegir a mano:
    -- adivinar cual presta el servicio seria inventar un contrato.
    SELECT c.id, c.tenant_id INTO v_company, v_tenant
      FROM core.companies c
     WHERE c.deleted_at IS NULL
     ORDER BY c.created_at
     LIMIT 1;

    IF v_company IS NULL THEN
        RAISE EXCEPTION 'no hay ninguna core.companies: primero la entidad legal del operador';
    END IF;

    IF (SELECT count(*) FROM core.companies WHERE deleted_at IS NULL) > 1 THEN
        RAISE EXCEPTION
            'hay mas de una company y este script elegiria la primera. Indica a mano '
            'a que entidad legal pertenecen EPA y Cofersa.';
    END IF;

    INSERT INTO core.clients (tenant_id, company_id, code, name, created_by)
    SELECT v_tenant, v_company, x.code, x.name, v_autor
      FROM (VALUES
        ('EPA',     'EPA'),
        ('COFERSA', 'Cofersa')
      ) AS x(code, name)
     WHERE NOT EXISTS (
        SELECT 1 FROM core.clients c
         WHERE c.tenant_id = v_tenant AND c.code = x.code AND c.deleted_at IS NULL
     );
    GET DIAGNOSTICS v_creados = ROW_COUNT;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'company del operador: % (%)',
        (SELECT name FROM core.companies WHERE id = v_company), v_company;
    RAISE NOTICE 'clientes creados en esta ejecucion: %', v_creados;
    FOR r IN SELECT code, name, status FROM core.clients
              WHERE tenant_id = v_tenant AND deleted_at IS NULL ORDER BY code LOOP
        RAISE NOTICE '  % | % | %', rpad(r.code,10), rpad(r.name,20), r.status;
    END LOOP;

    IF (SELECT count(*) FROM core.clients WHERE tenant_id = v_tenant AND deleted_at IS NULL) < 2 THEN
        RAISE EXCEPTION 'FALLO: se esperaban al menos 2 clientes';
    END IF;
    RAISE NOTICE '───────────────────────────────────────────────';
END $$;
