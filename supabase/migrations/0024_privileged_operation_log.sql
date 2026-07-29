-- ═══════════════════════════════════════════════════════════════════════════
-- 0024_privileged_operation_log.sql
-- Crea     : platform.privileged_operation_log + políticas RLS
-- Depende de: 0019, 0010 (core.users), 0020 (core.is_platform_owner)
-- Riesgo   : bajo
--
-- POR QUÉ EN EL BLOQUE 0 Y NO DESPUÉS.
--
--   Conceder y revocar un Platform Owner son las primeras operaciones
--   privilegiadas que existirán, y ocurren en este bloque. Un registro que
--   empieza a llenarse DESPUÉS de las concesiones iniciales no sirve para
--   auditar cómo se concedieron.
--
-- `audit.events` (auditoría general de negocio) NO entra aquí: es más grande,
-- arrastra la discusión de particionado de DEC-06 —donde se verificó que
-- PARTITION BY es incompatible con la PK que hace falta— y no bloquea nada del
-- módulo. Queda para el bloque de entrenamiento.
--
-- APPEND-ONLY: hay políticas de SELECT e INSERT, ninguna de UPDATE ni DELETE. Un
-- registro de auditoría que se puede editar no es un registro de auditoría.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.privileged_operation_log (
    id              bigserial   PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT now(),

    actor_user_id   uuid        NOT NULL
                                REFERENCES core.users(id) ON DELETE RESTRICT,

    operation       varchar(60) NOT NULL,
    target_type     varchar(40) NOT NULL,
    target_id       uuid        NULL,

    -- Estado antes y después. Ambos nullable: una concesión no tiene «antes» y
    -- una eliminación no tiene «después».
    before_state    jsonb       NULL,
    after_state     jsonb       NULL,

    -- Correlación con la traza HTTP. Nullable porque una operación puede venir
    -- de una migración o de un worker, no solo de una petición.
    request_id      uuid        NULL,
    correlation_id  uuid        NULL,

    CONSTRAINT chk_polog_operation_formato
        CHECK (operation ~ '^[a-z_]+\.[a-z_]+$'),

    -- Un registro sin ningún estado no dice qué cambió. Al menos uno.
    CONSTRAINT chk_polog_algun_estado
        CHECK (before_state IS NOT NULL OR after_state IS NOT NULL)
);

COMMENT ON TABLE platform.privileged_operation_log IS
    'Append-only. Operaciones privilegiadas de plataforma: concesiones de owner, publicacion y rollback de modelos.';
COMMENT ON COLUMN platform.privileged_operation_log.operation IS
    'modulo.accion, p.ej. owner.grant, owner.revoke, model.publish, model.rollback.';

CREATE INDEX idx_polog_reciente ON platform.privileged_operation_log (occurred_at DESC);
CREATE INDEX idx_polog_actor    ON platform.privileged_operation_log (actor_user_id, occurred_at DESC);
CREATE INDEX idx_polog_target   ON platform.privileged_operation_log (target_type, target_id)
    WHERE target_id IS NOT NULL;


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.privileged_operation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.privileged_operation_log FORCE ROW LEVEL SECURITY;

CREATE POLICY polog_platform_only ON platform.privileged_operation_log
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY polog_read ON platform.privileged_operation_log
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

CREATE POLICY polog_insert ON platform.privileged_operation_log
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app
    WITH CHECK (true);

-- Sin UPDATE ni DELETE: append-only.


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_force boolean;
    v_pol   int;
    v_mut   int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'privileged_operation_log';
    IF NOT v_force THEN
        RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY';
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'privileged_operation_log';
    IF v_pol <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 políticas, hay %', v_pol;
    END IF;

    -- Que NO exista política de UPDATE ni de DELETE es la propiedad append-only,
    -- así que se comprueba explícitamente en lugar de darla por supuesta.
    SELECT count(1) INTO v_mut FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'privileged_operation_log'
       AND cmd IN ('UPDATE', 'DELETE');
    IF v_mut <> 0 THEN
        RAISE EXCEPTION 'el registro debe ser append-only: hay % políticas de mutación', v_mut;
    END IF;

    RAISE NOTICE 'OK 0024: RLS forzada, 3 políticas, append-only (0 de UPDATE/DELETE)';
END
$$;
