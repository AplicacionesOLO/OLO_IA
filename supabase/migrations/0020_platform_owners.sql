-- ═══════════════════════════════════════════════════════════════════════════
-- 0020_platform_owners.sql
-- Crea     : platform.owners, core.is_platform_owner(),
--            platform.prevent_last_owner_revocation() + trigger, políticas RLS
-- Depende de: 0010 (core.users), 0015 (core.current_user_id), 0019
-- Riesgo   : ALTO — es la tabla que gobierna el acceso a todo el módulo
--
-- POR QUÉ NO ES UN ROL DE TENANT
--
--   `core.role_assignments` tiene `tenant_id NOT NULL` y cinco claves foráneas
--   compuestas hacia `core.tenant_memberships` (0014): todo rol se concede
--   DENTRO de un tenant. Un Platform Owner está por encima de los tenants, y el
--   modelo de identidad ya separa eso (`core.users` es global, DEC-04).
--
--   Un rol `platform_owner` en `core.roles` obligaría a atarlo a un tenant
--   arbitrario. Funcionaría por accidente y significaría algo falso: que su
--   poder emana de pertenecer a `olo-demo`.
--
-- EL PRIVILEGIO NO VIAJA EN EL JWT (decisión 2)
--
--   El Hook (0016) podría publicar `is_platform_owner` como claim. NO debe: el
--   token vive 1 h, así que revocar el privilegio más potente del sistema
--   tardaría hasta una hora. Se resuelve por consulta en cada petición, igual
--   que los permisos. RLS no necesita el claim porque `current_user_id()` ya
--   funciona por los dos canales de DEC-02.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.owners (
    user_id     uuid        PRIMARY KEY
                            REFERENCES core.users(id) ON DELETE RESTRICT,
    granted_by  uuid        NULL
                            REFERENCES core.users(id) ON DELETE SET NULL,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz NULL,
    reason      text        NOT NULL,

    CONSTRAINT chk_owner_revoked_after_granted
        CHECK (revoked_at IS NULL OR revoked_at >= granted_at),

    -- Nadie se concede el privilegio a sí mismo. NULL está permitido y es el
    -- caso del primer owner (0021), que por definición no lo concede nadie.
    CONSTRAINT chk_owner_no_self_grant
        CHECK (granted_by IS DISTINCT FROM user_id),

    CONSTRAINT chk_owner_reason_no_vacia
        CHECK (length(btrim(reason)) >= 10)
);

COMMENT ON TABLE platform.owners IS
    'Platform Owners. Alcance PLATAFORMA, no tenant: por eso no está en core.role_assignments.';
COMMENT ON COLUMN platform.owners.revoked_at IS
    'Revocación lógica: se conserva la historia de quién tuvo el privilegio y cuándo.';
COMMENT ON COLUMN platform.owners.granted_by IS
    'NULL solo para el owner inicial, que se siembra por migración.';

-- La PK indexa user_id, pero no puede expresar el predicado parcial. Este índice
-- sirve al EXISTS de is_platform_owner(), que corre en CADA petición al módulo.
CREATE INDEX idx_owners_activos ON platform.owners (user_id) WHERE revoked_at IS NULL;


-- ── La función de comprobación ─────────────────────────────────────────────
--
-- SECURITY DEFINER por la misma razón que core.current_auth_id() en 0018:
-- `olo_app` no tiene USAGE sobre `platform` y concederlo abriría el schema
-- entero cuando solo hace falta esta lectura.
--
-- Además resuelve un problema de recursión: la política RLS de platform.owners
-- invoca esta función, y la función lee platform.owners. Al ejecutarse como
-- `postgres` —que tiene rolbypassrls— la lectura interna no evalúa políticas, así
-- que no hay recursión. Es la misma clase de arranque circular que hubo que
-- corregir en 0017 con core.users, y aquí se evita por construcción.
CREATE OR REPLACE FUNCTION core.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM platform.owners o
        WHERE o.user_id = core.current_user_id()
          AND o.revoked_at IS NULL
    )
$$;

COMMENT ON FUNCTION core.is_platform_owner() IS
    'Privilegio de plataforma, resuelto contra la base en cada petición. NO viaja en el JWT: la revocación debe ser inmediata.';

GRANT EXECUTE ON FUNCTION core.is_platform_owner() TO olo_app, authenticated;


-- ── Guarda del último owner ────────────────────────────────────────────────
--
-- Si se revocara al último owner activo, nadie podría volver a conceder el
-- privilegio y el módulo quedaría inaccesible SIN vía de recuperación por la
-- aplicación. Un CHECK no puede verlo: es una condición sobre la tabla completa.
--
-- FOR EACH ROW y no FOR EACH STATEMENT a propósito. Un trigger de sentencia se
-- dispara aunque no cambie ninguna fila, así que un UPDATE que no afecta a nadie
-- sobre una tabla vacía abortaría con «quedarían cero owners» — un falso
-- positivo. Por fila solo se dispara cuando algo cambió de verdad.
CREATE OR REPLACE FUNCTION platform.prevent_last_owner_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Un UPDATE que no reduce el número de owners activos no es asunto de este
    -- trigger: editar `reason`, o revocar a alguien ya revocado, no es peligroso.
    IF TG_OP = 'UPDATE'
       AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM platform.owners WHERE revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'No se puede dejar la plataforma sin ningún Platform Owner activo. '
            'Concede el privilegio a otro usuario antes de revocar este.'
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN NULL;
END
$$;

COMMENT ON FUNCTION platform.prevent_last_owner_revocation() IS
    'Impide el bloqueo total: sin owners activos no habría forma de recuperar el acceso desde la aplicación.';

CREATE TRIGGER trg_owners_last_guard
    AFTER UPDATE OR DELETE ON platform.owners
    FOR EACH ROW
    EXECUTE FUNCTION platform.prevent_last_owner_revocation();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.owners FORCE ROW LEVEL SECURITY;

-- RESTRICTIVE: el piso duro. Se evalúa con AND contra todo lo demás, así que
-- ninguna política permisiva futura puede abrirlo por error.
CREATE POLICY owners_platform_only ON platform.owners
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

COMMENT ON POLICY owners_platform_only ON platform.owners IS
    'Piso duro: solo un Platform Owner ve o toca esta tabla. Sin identidad, current_user_id() es NULL y no hay filas.';

-- PERMISSIVE: concede. El aislamiento no es su tarea.
CREATE POLICY owners_read ON platform.owners
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

CREATE POLICY owners_insert ON platform.owners
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app
    WITH CHECK (true);

CREATE POLICY owners_update ON platform.owners
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app
    USING (true) WITH CHECK (true);

-- Sin política de DELETE: revocar es lógico. Un borrado físico perdería la
-- historia de quién tuvo el privilegio.


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_rls     boolean;
    v_force   boolean;
    v_pol     int;
    v_secdef  boolean;
BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'owners';

    IF NOT v_rls OR NOT v_force THEN
        RAISE EXCEPTION 'platform.owners necesita RLS activada Y forzada';
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'owners';
    IF v_pol <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol;
    END IF;

    SELECT p.prosecdef INTO v_secdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'is_platform_owner';
    IF NOT v_secdef THEN
        RAISE EXCEPTION 'core.is_platform_owner() debe ser SECURITY DEFINER';
    END IF;

    -- Con la tabla vacía la función debe devolver false, no error. Es la prueba
    -- de que no hay recursión entre la política y la función.
    IF core.is_platform_owner() THEN
        RAISE EXCEPTION 'con la tabla vacía is_platform_owner() debe ser false';
    END IF;

    RAISE NOTICE 'OK 0020: RLS forzada, 4 políticas, función SECURITY DEFINER, sin recursión';
END
$$;
