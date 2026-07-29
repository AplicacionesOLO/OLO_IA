-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0006_verify_context_propagation.sql
-- Crea      : NADA PERMANENTE. Es una migración de verificación.
-- Por qué   : demostrar que el mecanismo de contexto + RLS funciona por los
--             DOS canales ANTES de construir 15 tablas encima. Descubrir aquí
--             que el contexto no llega cuesta una migración; descubrirlo en
--             0012 cuesta el sprint. Queda registrada en el historial como
--             prueba fechada de que el mecanismo se validó.
-- Depende de: 0004 (funciones de contexto), 0002 (rol olo_app)
-- Rollback  : supabase/rollbacks/0006_verify_context_propagation.down.sql
--             (no-op: la migración no deja objetos)
-- Riesgo    : alto por lo que verifica, nulo por lo que deja
--
-- Notas de entorno, verificadas en este proyecto:
--   • `postgres` tiene BYPASSRLS = true, así que NO sirve para probar RLS:
--     lo bypasea todo. Las pruebas se ejecutan como `authenticated`.
--   • `postgres` NO puede SET ROLE olo_app: la pertenencia existe pero con
--     inherit_option = false y set_option = false (PostgreSQL 17 concede así
--     los roles creados por un rol con CREATEROLE). La suite de aislamiento
--     de Fase 0 se conectará como olo_app con sus propias credenciales, no por
--     SET ROLE.
--   • `authenticated` no tiene USAGE sobre `core` y por decisión aprobada no
--     debe tenerlo todavía. Se concede TEMPORALMENTE dentro de esta
--     transacción y se revoca antes de terminar, dejando el estado intacto.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Tabla de sonda con el patrón RLS real (T2) ──────────────────────────
CREATE TABLE core.__context_poc (
    id        int PRIMARY KEY,
    tenant_id uuid NOT NULL,
    label     text NOT NULL
);

-- Semilla: 2 filas del tenant A, 1 del tenant B.
-- Se inserta antes de habilitar RLS y como postgres (BYPASSRLS).
INSERT INTO core.__context_poc (id, tenant_id, label) VALUES
    (1, '11111111-1111-1111-1111-111111111111', 'A-uno'),
    (2, '11111111-1111-1111-1111-111111111111', 'A-dos'),
    (3, '22222222-2222-2222-2222-222222222222', 'B-uno');

ALTER TABLE core.__context_poc ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.__context_poc FORCE  ROW LEVEL SECURITY;

-- Patrón obligatorio: una RESTRICTIVE (piso duro, se evalúa con AND) y una
-- sola PERMISSIVE (la concesión). Es lo que impide que una política futura
-- amplíe el aislamiento por la vía del OR.
CREATE POLICY tenant_isolation ON core.__context_poc
    AS RESTRICTIVE FOR ALL TO authenticated
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.__context_poc
    AS PERMISSIVE FOR ALL TO authenticated
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Privilegios TEMPORALES, revocados en el punto 3.
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.__context_poc TO authenticated;


-- ── 2. Verificación ────────────────────────────────────────────────────────
DO $$
DECLARE
    TA uuid := '11111111-1111-1111-1111-111111111111';
    TB uuid := '22222222-2222-2222-2222-222222222222';
    v_n     int;
    v_ajeno int;
    v_ok    boolean;
BEGIN
    -- T1 · CANAL B (GUC): el tenant A ve sus 2 filas y solo las suyas
    SET LOCAL ROLE authenticated;
    PERFORM set_config('app.tenant_id', TA::text, true);
    SELECT count(*) INTO v_n     FROM core.__context_poc;
    SELECT count(*) INTO v_ajeno FROM core.__context_poc WHERE tenant_id <> TA;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'T1 canal B: se esperaban 2 filas del tenant A, se vieron %', v_n;
    END IF;
    IF v_ajeno <> 0 THEN
        RAISE EXCEPTION 'T1 canal B: FUGA, se vieron % filas de otro tenant', v_ajeno;
    END IF;

    -- T2 · CANAL A (claims del JWT): el tenant B ve su única fila
    PERFORM set_config('app.tenant_id', '', true);
    PERFORM set_config('request.jwt.claims',
        '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","app_metadata":{"tenant_id":"22222222-2222-2222-2222-222222222222"}}',
        true);
    SELECT count(*) INTO v_n     FROM core.__context_poc;
    SELECT count(*) INTO v_ajeno FROM core.__context_poc WHERE tenant_id <> TB;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'T2 canal A: se esperaba 1 fila del tenant B, se vieron %', v_n;
    END IF;
    IF v_ajeno <> 0 THEN
        RAISE EXCEPTION 'T2 canal A: FUGA, se vieron % filas de otro tenant', v_ajeno;
    END IF;

    -- T3 · FAIL-SECURE: sin contexto, cero filas. Nunca "todas".
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('app.tenant_id',      '', true);
    SELECT count(*) INTO v_n FROM core.__context_poc;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'T3 fail-secure: sin contexto se vieron % filas, debian ser 0', v_n;
    END IF;

    -- T4 · WITH CHECK: no se puede insertar con el tenant_id de otro
    PERFORM set_config('app.tenant_id', TA::text, true);
    v_ok := false;
    BEGIN
        INSERT INTO core.__context_poc (id, tenant_id, label) VALUES (99, TB, 'intruso');
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok := true;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'T4 WITH CHECK: se permitio insertar con el tenant_id de otro tenant';
    END IF;

    -- T5 · UPDATE cross-tenant: no falla, simplemente no afecta a ninguna fila
    UPDATE core.__context_poc SET label = 'hackeado' WHERE tenant_id = TB;
    IF FOUND THEN
        RAISE EXCEPTION 'T5 UPDATE cross-tenant modifico filas de otro tenant';
    END IF;

    -- T6 · el acceso legitimo SIGUE funcionando (gemelo obligatorio de T3:
    --      una politica que deniega todo tambien pasaria T1-T5)
    UPDATE core.__context_poc SET label = 'A-uno-editado' WHERE id = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'T6 se bloqueo un UPDATE legitimo del propio tenant';
    END IF;

    RESET ROLE;
    RAISE NOTICE '0006 PoC de contexto: T1..T6 OK (canal A, canal B, fail-secure, WITH CHECK, cross-tenant, acceso legitimo)';
END
$$;


-- ── 3. Restitución del estado ──────────────────────────────────────────────
-- El DROP TABLE se lleva sus políticas y sus grants de tabla. El USAGE sobre
-- el schema hay que devolverlo a su estado previo explícitamente.
DROP TABLE core.__context_poc;
REVOKE USAGE ON SCHEMA core FROM authenticated;
