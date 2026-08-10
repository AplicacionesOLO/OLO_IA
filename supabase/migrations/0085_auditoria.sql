-- ═══════════════════════════════════════════════════════════════════════════════
-- 0085 · AUDITORÍA — quién cambió qué, y cuándo
--
-- El esquema `audit` existía VACÍO: cero tablas. `audit:read` estaba en el catálogo
-- desde el principio, asignado a dos roles, apuntando a nada. Esto lo llena.
--
-- ── SE CAPTURA EN EL MOTOR, NO EN LA API ──────────────────────────────────────
--
-- Un registro que escribe la aplicación solo ve lo que pasa por la aplicación. Y por
-- esta base se escribe además desde `tools/admin_sql.py`, desde las migraciones y
-- desde el panel de Supabase. Un cambio de permisos hecho por ahí no aparecería, y el
-- silencio de un registro de auditoría se lee como «no pasó nada».
--
-- Con triggers, la única forma de escribir sin dejar rastro es tener permiso para
-- desactivar el trigger — que es exactamente el privilegio que se quiere vigilar.
--
-- ── LO QUE NO SE AUDITA, Y ES LA DECISIÓN IMPORTANTE ──────────────────────────
--
-- Auditar «todo» suena a rigor y es lo contrario. Estas tablas quedan FUERA:
--
--     inventory.wms_stock      41.055 filas por importación
--     spatial.locations        29.312 filas
--     spatial.nodes            miles
--     ai.images, ai.annotations, ai.dataset_items
--     inventory.readings, inventory.scans
--     spatial.import_row_errors
--
-- Una importación del WMS es UNA decisión de una persona, y ya está registrada en
-- `inventory.wms_snapshots` con su autor, su fichero y su hash. Auditarla fila a fila
-- añadiría 41.055 entradas que dicen lo mismo, multiplicaría el tamaño de la base en
-- cada importación, y enterraría los cambios que sí importan —un permiso concedido,
-- un almacén dado de alta— bajo un muro de ruido.
--
-- Lo que SÍ se audita son las decisiones: quién puede hacer qué, qué estructura
-- existe, qué se publicó, qué se resolvió.
--
-- ── EL TRIGGER PUEDE TUMBAR LA ESCRITURA, Y ES DELIBERADO ─────────────────────
--
-- Si `audit.registrar()` falla, la operación auditada falla con él. La alternativa
-- —tragarse el error y seguir— produce un registro con agujeros que nadie puede
-- detectar, y un registro de auditoría en el que no se sabe si falta algo no sirve
-- para lo único que sirve un registro de auditoría.
--
-- Así que la función es deliberadamente mínima: `to_jsonb`, comparar claves, insertar.
-- La ÚNICA llamada que podría fallar por causas externas es la que lee el contexto de
-- sesión, y esa va envuelta en su propio bloque.
--
-- ── `entries` Y NO `events`: NO ES LA TABLA QUE PEDÍA EL PLAN ──────────────────
--
-- `docs/TASKS.md` habla de `audit.events` (tareas 029 y T07), para eventos de dominio:
-- login, logout, intento fallido. Eso es otra cosa y sigue pendiente — un login no es
-- un cambio de fila y no lo captura ningún trigger.
--
-- Esta tabla es el rastro de CAMBIOS DE FILA, y se llama `entries` para que las dos
-- puedan convivir sin que una se lea como la otra. Meter los dos tipos en una sola
-- tabla obligaría a dejar `schema_name`, `table_name` y `row_id` vacíos en la mitad de
-- las filas, y a que cada consulta empezara filtrando por el tipo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El registro ───────────────────────────────────────────────────────────
--
-- `id` es `bigint` y no uuid: esto se lee en orden temporal y dos entradas del mismo
-- milisegundo tienen que poder ordenarse. Un uuid v4 no desempata nada.
CREATE TABLE IF NOT EXISTS audit.entries (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at   timestamptz NOT NULL DEFAULT now(),

    -- Del CONTEXTO, no de la fila. Un cambio en `core.users` —que no tiene
    -- `tenant_id`— hecho por un administrador se atribuye a SU tenant, que es quien
    -- tiene derecho a verlo. Si no hay contexto queda NULL: lo hizo una migración o
    -- una herramienta, y eso no es un evento de ningún tenant.
    tenant_id     uuid REFERENCES core.tenants (id) ON DELETE SET NULL,

    schema_name   text NOT NULL,
    table_name    text NOT NULL,
    row_id        text,
    operation     text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),

    -- Quién. `actor_user_id` es la persona de `core.users`; `db_role` es el rol del
    -- motor. Los dos porque responden a preguntas distintas: sin el segundo, un cambio
    -- hecho por `postgres` desde una herramienta sería indistinguible de uno hecho por
    -- nadie.
    actor_user_id uuid REFERENCES core.users (id) ON DELETE SET NULL,
    actor_auth_id uuid,
    db_role       text NOT NULL,

    -- Qué cambió. `changed` está calculado para que la interfaz no tenga que comparar
    -- dos objetos en el navegador para pintar un diff.
    changed       text[],
    before        jsonb,
    after         jsonb,

    CONSTRAINT chk_entry_coherente CHECK (
        (operation = 'INSERT' AND before IS NULL     AND after IS NOT NULL)
     OR (operation = 'DELETE' AND before IS NOT NULL AND after IS NULL)
     OR (operation = 'UPDATE' AND before IS NOT NULL AND after IS NOT NULL)
    )
);

COMMENT ON TABLE audit.entries IS
    'Registro de auditoria: solo se anade. `olo_app` tiene SELECT y nada mas; escriben '
    'los triggers via SECURITY DEFINER. Ver 0085 para que se audita y que no.';

-- El índice del uso normal: la última página del registro, por tenant.
CREATE INDEX IF NOT EXISTS ix_entries_tenant_fecha
    ON audit.entries (tenant_id, occurred_at DESC, id DESC);

-- «La historia de ESTA fila», que es la otra pregunta que se hace siempre.
CREATE INDEX IF NOT EXISTS ix_entries_fila
    ON audit.entries (schema_name, table_name, row_id, occurred_at DESC);

-- «Qué ha hecho esta persona». Parcial: las entradas sin actor son de herramientas y
-- nadie las busca por autor.
CREATE INDEX IF NOT EXISTS ix_entries_actor
    ON audit.entries (actor_user_id, occurred_at DESC)
 WHERE actor_user_id IS NOT NULL;


-- ── 2 · Solo se añade ─────────────────────────────────────────────────────────
--
-- El candado de verdad son los PRIVILEGIOS, no las políticas: `olo_app` no tiene
-- INSERT, UPDATE ni DELETE sobre esta tabla, así que la aplicación no puede reescribir
-- su propio rastro ni por error ni a propósito. Los triggers escriben porque
-- `audit.registrar()` es SECURITY DEFINER y su dueño sí puede.
REVOKE ALL ON audit.entries FROM olo_app;
GRANT SELECT ON audit.entries TO olo_app;
GRANT USAGE ON SCHEMA audit TO olo_app;

ALTER TABLE audit.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.entries FORCE ROW LEVEL SECURITY;

-- Aislamiento entre tenants. RESTRICTIVE: se aplica SIEMPRE, sumado a lo que digan las
-- permisivas. El dueño de la plataforma ve también las entradas sin tenant, que son las
-- de las migraciones y las herramientas.
DROP POLICY IF EXISTS entries_tenant_isolation ON audit.entries;
CREATE POLICY entries_tenant_isolation ON audit.entries
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id() OR core.is_platform_owner());

-- Y hace falta el permiso. Ver el registro de auditoría no es una consecuencia de
-- poder entrar: dice quién hizo qué, y eso es información sobre las personas.
DROP POLICY IF EXISTS entries_read ON audit.entries;
CREATE POLICY entries_read ON audit.entries
    FOR SELECT
    USING (core.tiene_permiso('audit:read'));


-- ── 3 · La captura ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit.registrar() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_antes    jsonb;
    v_despues  jsonb;
    v_cambios  text[];
    v_tenant   uuid;
    v_usuario  uuid;
    v_auth     uuid;
BEGIN
    -- ── El contexto de sesión, y es lo único que va protegido ─────────────────
    --
    -- Estas tres funciones leen el JWT o los `SET LOCAL` de la sesión. Con un contexto
    -- a medias podrían fallar, y un fallo aquí tumbaría la escritura auditada por una
    -- razón que no tiene nada que ver con ella. El resto de la función no se protege:
    -- si falla, se quiere saber.
    BEGIN
        v_usuario := core.current_user_id();
        v_auth    := core.current_auth_id();
        v_tenant  := core.current_tenant_id();
    EXCEPTION WHEN OTHERS THEN
        v_usuario := NULL;
        v_auth    := NULL;
        v_tenant  := NULL;
    END;

    IF TG_OP <> 'INSERT' THEN
        v_antes := audit.limpiar(to_jsonb(OLD));
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_despues := audit.limpiar(to_jsonb(NEW));
    END IF;

    -- El tenant de la FILA manda sobre el de la sesión: una entrada sobre un almacén
    -- del tenant A tiene que verla el tenant A, aunque la haya escrito un operador de
    -- plataforma cuyo contexto dice otra cosa.
    v_tenant := coalesce(
        (coalesce(v_despues, v_antes) ->> 'tenant_id')::uuid,
        v_tenant
    );

    IF TG_OP = 'UPDATE' THEN
        v_cambios := ARRAY(
            SELECT key FROM jsonb_each(v_despues)
             WHERE v_antes -> key IS DISTINCT FROM value
             ORDER BY key
        );

        -- ── Un UPDATE que solo movió la contabilidad NO es un evento ──────────
        --
        -- Muchas escrituras tocan `updated_at`, `version` y `updated_by` sin cambiar
        -- nada que a nadie le importe: un PATCH que reenvía los mismos valores, o un
        -- guardado sin editar. Registrarlas llenaría el historial de una fila de
        -- entradas idénticas entre las que habría que buscar el cambio de verdad.
        IF v_cambios IS NULL
           OR v_cambios <@ ARRAY['updated_at', 'updated_by', 'version']::text[]
        THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit.entries (
        tenant_id, schema_name, table_name, row_id, operation,
        actor_user_id, actor_auth_id, db_role, changed, before, after
    ) VALUES (
        v_tenant,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        coalesce(v_despues, v_antes) ->> 'id',
        TG_OP,
        v_usuario,
        v_auth,
        -- `session_user`, NO `current_user`.
        --
        -- Dentro de una funcion SECURITY DEFINER, `current_user` es el DUENO de la
        -- funcion —aqui `postgres`—, siempre, sin importar quien la haya llamado. Con
        -- ella la columna decia `postgres` en todas las entradas y no distinguia nada:
        -- ni una escritura de la aplicacion de una de una herramienta, que es lo unico
        -- para lo que existe. `session_user` es el rol que abrio la conexion.
        session_user,
        v_cambios,
        v_antes,
        v_despues
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

COMMENT ON FUNCTION audit.registrar() IS
    'Trigger de auditoria. SECURITY DEFINER porque olo_app no puede escribir en '
    'audit.entries: es lo que impide que la aplicacion reescriba su propio rastro.';


-- ── 4 · Nada que parezca un secreto entra en el registro ──────────────────────
--
-- Hoy no hay ninguna columna así en los esquemas auditados —se comprobó: cero—. Esto
-- existe para MAÑANA: una columna nueva llamada `api_token` empezaría a copiarse en
-- cada entrada sin que nadie lo notara, y un registro de auditoría es exactamente el
-- sitio donde un secreto sobrevive más tiempo, porque nadie borra el historial.
CREATE OR REPLACE FUNCTION audit.limpiar(p_fila jsonb) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
    SELECT coalesce(
        jsonb_object_agg(
            key,
            CASE
                WHEN key ILIKE '%token%'
                  OR key ILIKE '%secret%'
                  OR key ILIKE '%password%'
                  OR key ILIKE '%api_key%'
                  OR key ILIKE '%_hash'
                THEN '"[oculto]"'::jsonb
                ELSE value
            END
        ),
        '{}'::jsonb
    )
    FROM jsonb_each(p_fila)
$$;


-- ── 5 · A qué tablas se engancha ──────────────────────────────────────────────
--
-- Lista EXPLÍCITA, no «todas las de estos esquemas». Las exclusiones son el criterio
-- del módulo, y un bucle sobre `pg_class` las perdería en la primera tabla nueva.
CREATE OR REPLACE FUNCTION audit.vigilar(p_tabla text) RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF to_regclass(p_tabla) IS NULL THEN
        RAISE NOTICE 'audit: % no existe todavia, no se vigila', p_tabla;
        RETURN;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar ON %s', p_tabla);
    EXECUTE format(
        'CREATE TRIGGER trg_auditar AFTER INSERT OR UPDATE OR DELETE ON %s '
        'FOR EACH ROW EXECUTE FUNCTION audit.registrar()', p_tabla
    );
END $$;

DO $$
DECLARE
    v_tabla text;
    -- Quién puede hacer qué, qué estructura existe, qué se publicó, qué se resolvió.
    v_vigiladas text[] := ARRAY[
        -- Gobierno: el objetivo clásico de una auditoría.
        'core.users',
        'core.tenant_memberships',
        'core.role_assignments',
        'core.role_permissions',
        'core.roles',
        'core.user_warehouse_access',
        'core.permissions',
        -- Estructura.
        'core.tenants',
        'core.companies',
        'core.clients',
        'core.warehouses',
        'core.tenant_countries',
        'core.workers',
        -- Decisiones de operación.
        'incidents.incidents',
        'inventory.clusters',
        'inventory.cluster_members',
        'inventory.wms_snapshots',
        'spatial.sites',
        'spatial.warehouse_layouts',
        'spatial.rack_placements',
        'spatial.reference_frames',
        'spatial.import_batches',
        -- Qué modelo está publicado y con qué se entrenó.
        'ai.projects',
        'ai.models',
        'ai.model_versions',
        'ai.dataset_versions',
        'ai.training_runs'
    ];
BEGIN
    FOREACH v_tabla IN ARRAY v_vigiladas LOOP
        PERFORM audit.vigilar(v_tabla);
    END LOOP;
END $$;


-- ── 6 · Verificación ──────────────────────────────────────────────────────────
--
-- No basta con que exista: se comprueba que CAPTURA, que el diff sale bien, que el
-- ruido se descarta y que `olo_app` no puede tocarlo.
DO $$
DECLARE
    v_id       uuid;
    v_n        bigint;
    v_antes    bigint;
    v_cambios  text[];
    v_op       text;
    v_nombre   text;
    v_triggers int;
BEGIN
    SELECT count(*) INTO v_triggers
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'trg_auditar' AND NOT t.tgisinternal;
    IF v_triggers < 20 THEN
        RAISE EXCEPTION 'Solo % tablas vigiladas; se esperaban 27', v_triggers;
    END IF;

    -- Las de volumen tienen que quedar FUERA. Es la decisión del módulo, y si alguien
    -- engancha `wms_stock` por comodidad, la siguiente importación mete 41.055 entradas.
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE t.tgname = 'trg_auditar'
           AND n.nspname || '.' || c.relname IN (
               'inventory.wms_stock', 'spatial.locations', 'spatial.nodes',
               'ai.images', 'ai.annotations', 'ai.dataset_items',
               'inventory.readings', 'inventory.scans')
    ) THEN
        RAISE EXCEPTION 'Hay una tabla de volumen vigilada: eso multiplica la base';
    END IF;

    SELECT count(*) INTO v_antes FROM audit.entries;

    -- ── Captura de un INSERT ──────────────────────────────────────────────────
    INSERT INTO core.clients (tenant_id, company_id, name, code, status)
    SELECT c.tenant_id, c.id, 'ZZZ Cliente de verificacion 0085', 'ZZZ-0085', 'active'
      FROM core.companies c ORDER BY c.created_at LIMIT 1
    RETURNING id INTO v_id;

    SELECT count(*) INTO v_n FROM audit.entries
     WHERE table_name = 'clients' AND row_id = v_id::text AND operation = 'INSERT';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'El INSERT no se registro (% entradas)', v_n;
    END IF;

    -- ── Captura de un UPDATE, con su diff ─────────────────────────────────────
    UPDATE core.clients SET name = 'ZZZ Cliente renombrado' WHERE id = v_id;

    SELECT changed INTO v_cambios FROM audit.entries
     WHERE table_name = 'clients' AND row_id = v_id::text AND operation = 'UPDATE'
     ORDER BY id DESC LIMIT 1;
    IF v_cambios IS NULL OR NOT ('name' = ANY (v_cambios)) THEN
        RAISE EXCEPTION 'El diff no dice que cambio `name`: %', v_cambios;
    END IF;

    -- ── Un UPDATE que no cambia nada NO deja entrada ──────────────────────────
    SELECT count(*) INTO v_antes FROM audit.entries WHERE row_id = v_id::text;
    UPDATE core.clients SET name = 'ZZZ Cliente renombrado' WHERE id = v_id;
    SELECT count(*) INTO v_n FROM audit.entries WHERE row_id = v_id::text;
    IF v_n <> v_antes THEN
        RAISE EXCEPTION 'Un UPDATE sin cambios dejo entrada: el historial se llena de ruido';
    END IF;

    -- ── Captura de un DELETE, guardando lo borrado ────────────────────────────
    DELETE FROM core.clients WHERE id = v_id;

    SELECT operation, before ->> 'name' INTO v_op, v_nombre
      FROM audit.entries
     WHERE table_name = 'clients' AND row_id = v_id::text AND operation = 'DELETE'
     ORDER BY id DESC LIMIT 1;
    IF v_op IS NULL THEN
        RAISE EXCEPTION 'El DELETE no se registro';
    END IF;
    IF v_nombre <> 'ZZZ Cliente renombrado' THEN
        RAISE EXCEPTION 'El DELETE no guardo la fila borrada: %', v_nombre;
    END IF;

    -- La fila ya no existe y su historia sí. Eso es justo el punto: quedan 3 entradas
    -- de un cliente que no está.
    SELECT count(*) INTO v_n FROM audit.entries WHERE row_id = v_id::text;
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'Se esperaban 3 entradas del cliente borrado, hay %', v_n;
    END IF;

    -- ── `db_role` tiene que distinguir quien escribio ─────────────────────────
    --
    -- Con `current_user` esta columna decia `postgres` en TODAS las entradas, porque
    -- dentro de SECURITY DEFINER `current_user` es el dueno de la funcion. Aqui la
    -- migracion corre como `postgres` de verdad, asi que lo que se comprueba es que el
    -- valor registrado coincida con `session_user` y no este cableado.
    SELECT db_role INTO v_nombre FROM audit.entries
     WHERE row_id = v_id::text ORDER BY id DESC LIMIT 1;
    IF v_nombre IS DISTINCT FROM session_user THEN
        RAISE EXCEPTION 'db_role dice % y la sesion es %: la columna no distingue quien '
                        'escribio', v_nombre, session_user;
    END IF;

    -- Se limpia lo de la verificación, con permiso de dueño. `olo_app` no podría.
    DELETE FROM audit.entries WHERE row_id = v_id::text;

    -- ── El candado ────────────────────────────────────────────────────────────
    IF has_table_privilege('olo_app', 'audit.entries', 'INSERT')
       OR has_table_privilege('olo_app', 'audit.entries', 'UPDATE')
       OR has_table_privilege('olo_app', 'audit.entries', 'DELETE') THEN
        RAISE EXCEPTION 'olo_app puede escribir en el registro: entonces no es un registro';
    END IF;
    IF NOT has_table_privilege('olo_app', 'audit.entries', 'SELECT') THEN
        RAISE EXCEPTION 'olo_app no puede leer el registro';
    END IF;

    -- El ocultado de secretos, sobre una clave inventada.
    IF audit.limpiar('{"api_token":"abc","name":"x"}'::jsonb) ->> 'api_token' <> '[oculto]' THEN
        RAISE EXCEPTION 'Un valor que parece secreto entro en claro en el registro';
    END IF;

    RAISE NOTICE 'OK · % tablas vigiladas · INSERT, UPDATE y DELETE capturados · '
                 'el ruido descartado · olo_app solo lee', v_triggers;
END $$;
