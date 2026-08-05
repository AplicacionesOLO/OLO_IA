-- ══════════════════════════════════════════════════════════════════════════════
-- 0073 · OLOBOT — el asistente del almacén
--
-- Crea    : esquema `olobot`; tablas `access`, `conversations`, `messages`, `actions`
-- Añade   : permisos `olobot:use`, `olobot:write`, `olobot:admin`
-- Toca    : core.role_permissions (asignaciones iniciales)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA DECISIÓN QUE GOBIERNA TODO ESTE ARCHIVO
--
-- **El nivel de OLOBOT nunca CONCEDE nada. Solo RECORTA.**
--
-- El bot no tiene credenciales propias: habla por la sesión del usuario, con su
-- `core.current_tenant_id()`, su `core.can_access_warehouse()` y sus permisos
-- comprobados por el mismo `require_permission` que la API. Un `viewer` cuyo nivel
-- de bot fuera `owner` seguiría sin poder escribir nada, porque el 403 lo pone el
-- permiso, no el nivel.
--
-- Esto no es un detalle de implementación: es lo que impide que el asistente sea
-- una puerta lateral. Si el nivel concediera capacidades, cualquiera con
-- `olobot:admin` podría fabricar un administrador dándole nivel `owner` a un
-- operario, sin tocar la matriz de permisos y sin que se viera en ella.
--
-- Lo que el nivel SÍ hace es limitar qué herramientas se le ofrecen al modelo:
--
--     user        leer y navegar. Nada más.
--     supervisor  + escribir en datos de operación (siempre con confirmación)
--     admin       + escribir en configuración (siempre con confirmación)
--     owner       todo lo que el usuario ya puede hacer por sí mismo
--
-- La lista de capacidades por nivel vive en `olobot/domain/level.py`, no aquí: es
-- lógica de aplicación y duplicarla en SQL crearía dos verdades que divergen.
-- Aquí solo se guarda el nivel y se garantiza que sea uno de los cuatro.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ LAS CONVERSACIONES SON PRIVADAS Y LAS ESCRITURAS NO
--
-- `messages` es visible SOLO para su dueño, ni siquiera para un `tenant_admin`.
-- `actions` —lo que el bot escribió— es visible para todo el tenant.
--
-- Son dos cosas distintas. Auditar los cambios que se hicieron en el sistema es
-- necesario y es lo que pide cualquier operación seria. Leer lo que alguien le
-- preguntó a un asistente es vigilancia, y además destruiría la utilidad del
-- asistente: nadie pregunta «¿me van a echar por esto?» a un chat que lee su jefe.
--
-- La consecuencia práctica: el registro de auditoría guarda QUÉ se cambió, con qué
-- argumentos y quién lo confirmó, sin el texto de la conversación que lo originó.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS olobot;
COMMENT ON SCHEMA olobot IS
    'OLOBOT: nivel de acceso por usuario, conversaciones y auditoria de sus escrituras.';

GRANT USAGE ON SCHEMA olobot TO olo_app;


-- ── 1 · Los permisos, que sí van a la matriz ────────────────────────────────
--
-- Tres, no cuatro. Los NIVELES son cuatro y se asignan por usuario; los PERMISOS
-- dicen qué puede hacer un ROL, y son otra pregunta. Poner cuatro permisos —uno por
-- nivel— habría mezclado las dos y dejado la matriz mintiendo: marcar
-- «olobot:owner» a un rol no convierte a nadie en owner.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('olobot:use',   'olobot', 'use',
     'Hablar con OLOBOT. El bot lee los mismos datos que el usuario, nunca mas',
     false),
    ('olobot:write', 'olobot', 'write',
     'Permitir que OLOBOT proponga escrituras. Cada una exige confirmacion explicita '
     'y se registra en olobot.actions. No amplia lo que el usuario ya puede escribir',
     false),
    ('olobot:admin', 'olobot', 'admin',
     'Asignar el nivel de OLOBOT a otros usuarios del operador',
     true)
ON CONFLICT (code) DO NOTHING;

-- Usar: todos los roles. Un asistente que solo puede consultar lo que el usuario ya
-- ve no añade riesgo, y negarlo a `viewer` o `auditor` lo dejaría fuera justamente a
-- quien más consulta y menos escribe.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'olobot:use'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator',
                  'auditor', 'viewer')
ON CONFLICT DO NOTHING;

-- Escribir: quien ya escribe. `viewer` no escribe, y `auditor` tampoco —por lo mismo
-- que en 0069: quien audita no debe poder fabricar lo que audita, y darle una vía
-- conversacional para hacerlo sería peor, no mejor, que dársela por formulario.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'olobot:write'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator')
ON CONFLICT DO NOTHING;

-- Administrar niveles: solo `tenant_admin`. Es la capacidad de decidir qué puede
-- hacer el asistente de otra persona.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'olobot:admin'
  FROM core.roles r
 WHERE r.name = 'tenant_admin'
ON CONFLICT DO NOTHING;


-- ── 2 · El nivel por usuario ────────────────────────────────────────────────
--
-- Tabla y no columna en `core.users` por dos razones. `core.users` es global —un
-- usuario puede pertenecer a varios operadores— y el nivel es una decisión DE ESTE
-- operador: el mismo consultor puede ser `admin` en un tenant y `user` en otro. Y
-- porque quién lo concedió y cuándo es parte del dato, no metadato: es la respuesta
-- a «¿quién le dio a este operario permiso para que su bot escriba?».
CREATE TABLE olobot.access (
    tenant_id   uuid        NOT NULL REFERENCES core.tenants (id),
    user_id     uuid        NOT NULL,

    level       varchar(12) NOT NULL,

    granted_by  uuid        NOT NULL REFERENCES core.users (id),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    note        text,

    CONSTRAINT pk_olobot_access PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT chk_olobot_level CHECK (level IN ('user', 'supervisor', 'admin', 'owner')),
    --  Compuesta contra la MEMBRESÍA, no dos FK sueltas contra tenants y users. Así
    --  «dar nivel de bot a alguien que no es de este operador» no es una regla que
    --  haya que recordar comprobar: es una fila que no se puede escribir.
    CONSTRAINT fk_olobot_access_membresia FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.tenant_memberships (tenant_id, user_id)
);

COMMENT ON TABLE olobot.access IS
    'Nivel de OLOBOT de un usuario EN ESTE operador. Recorta lo que el bot puede hacer; nunca lo amplia.';
COMMENT ON COLUMN olobot.access.level IS
    'user | supervisor | admin | owner. Las capacidades de cada uno viven en domain/olobot/level.py.';
COMMENT ON COLUMN olobot.access.granted_by IS
    'Quien concedio el nivel. Es la respuesta a «quien dejo que el bot de esta persona escriba».';

CREATE INDEX idx_olobot_access_user ON olobot.access (user_id);

CREATE TRIGGER trg_olobot_access_updated_at
    BEFORE UPDATE ON olobot.access
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Sin fila no hay bot. La ausencia significa «este usuario no tiene OLOBOT», que es
-- lo correcto por omisión: un asistente con acceso a los datos del almacén no debe
-- aparecer solo, sino porque alguien decidió dárselo.
--
-- El operador que existe hoy arranca con su administrador en `owner`. Sin esto,
-- nadie podría conceder niveles porque nadie tendría bot con el que empezar.
INSERT INTO olobot.access (tenant_id, user_id, level, granted_by, note)
SELECT m.tenant_id, m.user_id, 'owner', m.user_id,
       'Nivel inicial de la migracion 0073: el administrador del operador'
  FROM core.tenant_memberships m
  JOIN core.role_assignments ra ON ra.user_id = m.user_id AND ra.tenant_id = m.tenant_id
  JOIN core.roles r             ON r.id = ra.role_id AND r.name = 'tenant_admin'
 WHERE m.revoked_at IS NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;


-- ── 3 · Conversaciones ──────────────────────────────────────────────────────
CREATE TABLE olobot.conversations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES core.tenants (id),
    user_id         uuid        NOT NULL,

    title           text        NOT NULL DEFAULT 'Conversación nueva',
    --  El almacén que estaba activo al empezar. El bot necesita saber de qué
    --  almacén se habla cuando alguien dice «¿cuántos pallets hay?», y el usuario
    --  puede tener varios.
    warehouse_id    uuid,

    created_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    --  Igual que en `access`: la conversación de alguien ajeno al operador no es una
    --  regla que recordar, es una fila inexpresable.
    CONSTRAINT fk_olobot_conv_membresia FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.tenant_memberships (tenant_id, user_id)
);

COMMENT ON TABLE olobot.conversations IS
    'Un hilo de conversacion con OLOBOT. Visible SOLO para su dueno: ver la nota de privacidad en 0073.';

CREATE INDEX idx_olobot_conv_user ON olobot.conversations (user_id, last_message_at DESC)
    WHERE deleted_at IS NULL;


-- ── 4 · Mensajes ────────────────────────────────────────────────────────────
--
-- `role` sigue el vocabulario de la API de OpenAI —system, user, assistant, tool—
-- porque el historial se le vuelve a mandar tal cual en cada turno. Traducirlo a
-- nombres propios obligaría a una tabla de conversión en los dos sentidos que no
-- añade nada.
CREATE TABLE olobot.messages (
    id              bigserial   PRIMARY KEY,
    conversation_id uuid        NOT NULL REFERENCES olobot.conversations (id) ON DELETE CASCADE,
    tenant_id       uuid        NOT NULL REFERENCES core.tenants (id),

    role            varchar(12) NOT NULL,
    content         text,

    --  Cuando el modelo pide una herramienta. `tool_calls` es lo que dijo el
    --  modelo; `tool_call_id` es a qué llamada responde un mensaje de rol `tool`.
    tool_calls      jsonb,
    tool_call_id    text,

    --  Coste real, para poder responder «cuanto cuesta esto» con una cifra.
    tokens_in       integer,
    tokens_out      integer,
    model           varchar(60),

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_olobot_msg_role
        CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    --  Un mensaje sin contenido y sin llamadas no dice nada: seria una fila que
    --  ocupa un turno del historial sin aportarlo.
    CONSTRAINT chk_olobot_msg_algo
        CHECK (content IS NOT NULL OR tool_calls IS NOT NULL)
);

COMMENT ON TABLE olobot.messages IS
    'Historial de un hilo, en el vocabulario de la API del modelo. PRIVADO: solo su dueno lo lee.';

CREATE INDEX idx_olobot_msg_conv ON olobot.messages (conversation_id, id);


-- ── 5 · Auditoría de escrituras ─────────────────────────────────────────────
--
-- Aquí está la diferencia entre un asistente y un riesgo. Ninguna escritura del bot
-- ocurre en el mismo paso en que el modelo la propone: se registra `proposed`, el
-- usuario ve exactamente qué va a cambiar, y solo entonces se ejecuta.
--
-- Que la propuesta se guarde ANTES de confirmarse es deliberado. Un modelo que
-- propone borrar treinta almacenes y recibe un «no» es información que hay que
-- conservar; si solo se guardara lo ejecutado, ese intento no dejaría rastro.
CREATE TABLE olobot.actions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES core.tenants (id),
    conversation_id uuid        NOT NULL REFERENCES olobot.conversations (id) ON DELETE CASCADE,
    user_id         uuid        NOT NULL REFERENCES core.users (id),

    tool            varchar(60) NOT NULL,
    arguments       jsonb       NOT NULL,
    --  En castellano y con los valores dentro: es lo que se le enseña al usuario en
    --  el modal. Se genera en el servidor y no en el navegador, porque el texto que
    --  describe una escritura tiene que venir del mismo sitio que la ejecuta.
    summary         text        NOT NULL,

    status          varchar(10) NOT NULL DEFAULT 'proposed',
    error_message   text,
    result          jsonb,

    proposed_at     timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz,
    --  Quien confirmo. Casi siempre el mismo `user_id`, y por eso mismo se guarda
    --  aparte: el dia que se permita que otro confirme, la columna ya distingue.
    decided_by      uuid        REFERENCES core.users (id),

    CONSTRAINT chk_olobot_action_status
        CHECK (status IN ('proposed', 'executed', 'rejected', 'failed')),
    --  Una accion decidida tiene fecha y autor de la decision, y una pendiente no.
    --  Sin esto, un `executed` sin `decided_at` seria indistinguible de algo que se
    --  ejecuto sin que nadie lo confirmara.
    CONSTRAINT chk_olobot_action_decidida CHECK (
        (status = 'proposed' AND decided_at IS NULL AND decided_by IS NULL)
        OR (status <> 'proposed' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    ),
    CONSTRAINT chk_olobot_action_fallo
        CHECK ((status = 'failed') = (error_message IS NOT NULL))
);

COMMENT ON TABLE olobot.actions IS
    'Escrituras que OLOBOT propuso. Se guarda la propuesta ANTES de confirmarla: un «no» tambien es informacion.';
COMMENT ON COLUMN olobot.actions.summary IS
    'Lo que se le ensena al usuario antes de confirmar. Lo genera el servidor, que es quien ejecuta.';

CREATE INDEX idx_olobot_actions_tenant ON olobot.actions (tenant_id, proposed_at DESC);
CREATE INDEX idx_olobot_actions_conv   ON olobot.actions (conversation_id);


-- ── 6 · RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE olobot.access        ENABLE ROW LEVEL SECURITY;
ALTER TABLE olobot.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE olobot.messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE olobot.actions       ENABLE ROW LEVEL SECURITY;

-- `access`: mismo patrón que `core.clients` y compañía —RLS acota al TENANT y la
-- autoridad sobre quién escribe vive en la API, en `require("olobot:admin")`.
-- Que un usuario VEA su propio nivel es necesario: la interfaz tiene que poder
-- decirle qué puede pedirle al bot.
CREATE POLICY tenant_isolation ON olobot.access
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_members ON olobot.access
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- `conversations` y `messages`: RESTRICTIVE por tenant Y por dueño. Dos candados a
-- propósito, y el segundo es el que importa: un `tenant_admin` no lee las
-- conversaciones de su equipo. Ver la nota de privacidad de arriba.
CREATE POLICY tenant_isolation ON olobot.conversations
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY solo_su_dueno ON olobot.conversations
    AS RESTRICTIVE FOR ALL
    USING (user_id = core.current_user_id())
    WITH CHECK (user_id = core.current_user_id());
CREATE POLICY propias ON olobot.conversations
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY tenant_isolation ON olobot.messages
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY solo_su_dueno ON olobot.messages
    AS RESTRICTIVE FOR ALL
    USING (EXISTS (
        SELECT 1 FROM olobot.conversations c
         WHERE c.id = messages.conversation_id
           AND c.user_id = core.current_user_id()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM olobot.conversations c
         WHERE c.id = messages.conversation_id
           AND c.user_id = core.current_user_id()
    ));
CREATE POLICY propios ON olobot.messages
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- `actions`: auditable por todo el tenant en LECTURA, escribible solo por su dueño.
-- La asimetría es el punto: el registro existe para que otros lo revisen, y nadie
-- debe poder tocar el registro de otro.
CREATE POLICY tenant_isolation ON olobot.actions
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY auditable ON olobot.actions
    FOR SELECT
    USING (true);
CREATE POLICY solo_las_propias ON olobot.actions
    AS RESTRICTIVE FOR INSERT
    WITH CHECK (user_id = core.current_user_id());
CREATE POLICY propias_insert ON olobot.actions
    FOR INSERT
    WITH CHECK (true);
CREATE POLICY propias_update ON olobot.actions
    FOR UPDATE
    USING (user_id = core.current_user_id())
    WITH CHECK (user_id = core.current_user_id());


-- ── 7 · Privilegios ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE         ON olobot.access        TO olo_app;
GRANT SELECT, INSERT, UPDATE         ON olobot.conversations TO olo_app;
GRANT SELECT, INSERT                 ON olobot.messages      TO olo_app;
GRANT USAGE, SELECT ON SEQUENCE olobot.messages_id_seq       TO olo_app;
GRANT SELECT, INSERT, UPDATE         ON olobot.actions        TO olo_app;

-- Sin DELETE en `messages` ni en `actions`. Un historial que se puede borrar fila a
-- fila no es un historial, y un registro de auditoría que el auditado puede vaciar
-- no audita nada. Una conversación se retira poniendo `deleted_at`, que conserva lo
-- que se dijo y lo que se cambió.


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_permisos  integer;
    v_asigna    integer;
    v_owner     integer;
    v_tablas    integer;
    v_privadas  integer;
BEGIN
    SELECT count(*) INTO v_permisos
      FROM core.permissions WHERE module = 'olobot';
    IF v_permisos <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 permisos de olobot, hay %', v_permisos;
    END IF;

    -- Que ningún permiso de olobot haya quedado huérfano. Un permiso de alcance
    -- `tenant` con cero roles es un 403 para todo el mundo, incluido el owner: es
    -- exactamente lo que pasó con `clients:*` y costó una tarde encontrarlo.
    SELECT count(DISTINCT p.code) INTO v_asigna
      FROM core.permissions p
      JOIN core.role_permissions rp ON rp.permission_code = p.code
     WHERE p.module = 'olobot';
    IF v_asigna <> 3 THEN
        RAISE EXCEPTION
            'hay permisos de olobot sin ningun rol: asignados %, esperados 3', v_asigna;
    END IF;

    SELECT count(*) INTO v_owner FROM olobot.access WHERE level = 'owner';
    IF v_owner = 0 THEN
        RAISE EXCEPTION
            'nadie quedo con nivel owner: nadie podria conceder niveles a nadie';
    END IF;

    SELECT count(*) INTO v_tablas
      FROM pg_tables WHERE schemaname = 'olobot';
    IF v_tablas <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 tablas en olobot, hay %', v_tablas;
    END IF;

    -- Lo que hace privadas a las conversaciones: una RESTRICTIVE por dueño en cada
    -- una de las dos tablas. Si alguien las quitara, un tenant_admin empezaría a
    -- leer los chats de su equipo y nada fallaría.
    SELECT count(*) INTO v_privadas
      FROM pg_policies
     WHERE schemaname = 'olobot'
       AND tablename IN ('conversations', 'messages')
       AND policyname = 'solo_su_dueno'
       AND permissive = 'RESTRICTIVE';
    IF v_privadas <> 2 THEN
        RAISE EXCEPTION
            'faltan las politicas de privacidad de las conversaciones: hay %', v_privadas;
    END IF;

    RAISE NOTICE '0073 OK · olobot: 3 permisos asignados, % con nivel owner, 4 tablas, conversaciones privadas', v_owner;
END $$;
