-- ══════════════════════════════════════════════════════════════════════════════
-- 0104 · Notificaciones: que algo termine deje de depender de que alguien lo mire
--
-- Crea : core.notifications
-- Toca : nada. Los servicios de entrenamiento, percepcion e incidencias pasan a
--        escribir aqui ademas de lo que ya hacian.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL PATRON QUE SE REPITE EN TODO EL SISTEMA, Y POR QUE ES UNA SOLA TABLA
--
-- Un entrenamiento que termina, un trabajo de percepcion que acaba, una incidencia
-- que se abre: las tres cosas hoy son PULL. Alguien tiene que volver a abrir la
-- pantalla para enterarse. El repaso de sistema del 20 de agosto de 2026 encontro
-- esto en tres modulos distintos por separado, que es la senal de que es una sola
-- pieza de infraestructura que falta, no tres.
--
-- Una tabla y no tres (`training_notifications`, `perception_notifications`, ...)
-- por el mismo motivo que 0075 hizo una sola `core.workers`: notificar es el MISMO
-- concepto —algo paso, alguien tiene que saberlo— con distinto origen. Tres tablas
-- identicas habrian triplicado la pantalla de campana, el marcado de leido y el
-- envio de correo para no compartir mas que una columna, `kind`.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUIEN PUEDE CREAR UNA NOTIFICACION PARA QUIEN
--
-- El que ESCRIBE la fila casi nunca es el que la LEE. Cuando una ejecucion de
-- entrenamiento termina, quien cierra el turno es `entrenar.py` autenticado con SU
-- sesion, y el destinatario es quien ENCOLO el entrenamiento —otra persona, en
-- general—. Por eso el INSERT no exige `user_id = core.current_user_id()`: exige
-- que el destinatario sea del MISMO operador (`tenant_isolation`, RESTRICTIVE, se
-- aplica siempre). Crear un aviso para alguien de tu propio operador no es una
-- escalada; leer o marcar el aviso de OTRO si lo seria, y eso si esta cerrado.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUE `email_sent_at` VIVE AQUI Y NO EN UNA TABLA DE ENVIOS APARTE
--
-- Porque la pregunta que hace falta responder es «¿a esta persona ya se le avisó
-- por correo de ESTO?», no «¿qué correos se han mandado en general?». Con la marca
-- en la misma fila, esa pregunta es una columna; con una tabla aparte seria un JOIN
-- para algo que solo se consulta desde aqui.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE core.notifications (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid        NOT NULL REFERENCES core.tenants (id),
    --  A quien le llega. ON DELETE CASCADE: si el usuario se borra, sus avisos no
    --  dicen nada a nadie y no hay razon para conservarlos.
    user_id       uuid        NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,

    --  De donde viene, en punto: `training_run.succeeded`, `perception_job.failed`,
    --  `incident.opened`... Texto libre y no un enum: anadir un origen nuevo no
    --  deberia exigir una migracion, la misma razon que ya vale para `ai.training_runs`.
    kind          varchar(60) NOT NULL,
    title         text        NOT NULL,
    body          text        NOT NULL,
    --  Ruta del frontend a la que lleva un clic. NULL es valido: un aviso puramente
    --  informativo no tiene a donde llevar.
    link          text        NULL,

    --  Cuando se mando el correo, NO si se pidio mandarlo. Un envio que fallo (SMTP
    --  caido) dejaria esto en NULL y el aviso seguiria existiendo en la campana: el
    --  canal in-app nunca depende de que el email haya funcionado.
    email_sent_at timestamptz NULL,
    read_at       timestamptz NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_notif_title CHECK (btrim(title) <> ''),
    CONSTRAINT chk_notif_body  CHECK (btrim(body) <> '')
);

COMMENT ON TABLE core.notifications IS
    'Avisos de que algo paso, para que enterarse no dependa de volver a abrir la pantalla. Ver 0104.';
COMMENT ON COLUMN core.notifications.kind IS
    'Origen en punto: training_run.succeeded, perception_job.failed, incident.opened... Texto libre a proposito.';
COMMENT ON COLUMN core.notifications.email_sent_at IS
    'Cuando se broadcast el correo, no si se pidio. NULL con read_at con valor es normal: se leyo en la app antes de que el correo llegara.';

--  La consulta de la campana: mis avisos, los mas nuevos primero. Un solo indice
--  sirve tanto para «los ultimos N» como para «cuantos sin leer», que es
--  exactamente el WHERE que la propia campana necesita a cada carga de pantalla.
CREATE INDEX idx_notifications_usuario ON core.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_no_leidas ON core.notifications (user_id) WHERE read_at IS NULL;


-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE core.notifications ENABLE ROW LEVEL SECURITY;

--  Aisla por operador SIEMPRE, en las dos direcciones. RESTRICTIVE: se aplica
--  ademas de cualquier PERMISSIVE, nunca en su lugar.
CREATE POLICY tenant_isolation ON core.notifications
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

--  Leer: SOLO lo propio. Ni un administrador ve los avisos de otro por esta via.
CREATE POLICY leer_propias ON core.notifications
    FOR SELECT
    USING (user_id = core.current_user_id());

--  Crear: para CUALQUIERA del mismo operador. Ver la nota de cabecera: quien
--  cierra un entrenamiento casi nunca es quien lo encolo.
CREATE POLICY crear_para_el_operador ON core.notifications
    AS PERMISSIVE FOR INSERT
    WITH CHECK (true);

--  Marcar leida / borrar: SOLO lo propio.
CREATE POLICY marcar_propias ON core.notifications
    FOR UPDATE
    USING (user_id = core.current_user_id())
    WITH CHECK (user_id = core.current_user_id());

CREATE POLICY borrar_propias ON core.notifications
    FOR DELETE
    USING (user_id = core.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON core.notifications TO olo_app;


-- ── Verificacion ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_tenant_a     uuid;
    v_tenant_b     uuid;
    v_user_a1      uuid;
    v_user_a1_auth uuid;
    v_user_a2      uuid;
    v_user_a2_auth uuid;
    v_notif_id     uuid;
    v_puede_ver    boolean;
BEGIN
    --  `core.users` no tiene `tenant_id`: la pertenencia vive en
    --  `core.tenant_memberships`, y hay que pasar por ella.
    SELECT tenant_id INTO v_tenant_a FROM core.tenant_memberships LIMIT 1;
    SELECT tenant_id INTO v_tenant_b
      FROM core.tenant_memberships WHERE tenant_id <> v_tenant_a LIMIT 1;
    SELECT tm.user_id, u.auth_id INTO v_user_a1, v_user_a1_auth
      FROM core.tenant_memberships tm JOIN core.users u ON u.id = tm.user_id
     WHERE tm.tenant_id = v_tenant_a LIMIT 1;
    SELECT tm.user_id, u.auth_id INTO v_user_a2, v_user_a2_auth
      FROM core.tenant_memberships tm JOIN core.users u ON u.id = tm.user_id
     WHERE tm.tenant_id = v_tenant_a AND tm.user_id <> v_user_a1 LIMIT 1;

    IF v_tenant_a IS NULL OR v_user_a1 IS NULL THEN
        RAISE NOTICE 'sin tenant/usuario de prueba disponible; se omite la verificacion con datos reales';
    ELSE
        --  Esta migracion la corre `admin_sql.py` como `postgres`, que tiene
        --  BYPASSRLS —y no es superusuario de verdad, asi que ni `SET ROLE olo_app`
        --  es una opcion—. Un SELECT normal veria todas las filas pase lo que pase
        --  con las politicas, asi que en vez de ejercer RLS de verdad se evalua el
        --  MISMO predicado booleano que usan sus USING/WITH CHECK: es el patron
        --  exacto que ya probo 0102 para esto mismo.
        PERFORM set_config('app.tenant_id', v_tenant_a::text, true);
        PERFORM set_config('app.auth_user_id', v_user_a1_auth::text, true);

        IF core.current_tenant_id() <> v_tenant_a OR core.current_user_id() <> v_user_a1 THEN
            RAISE EXCEPTION 'el canal B de contexto no resolvio al tenant/usuario esperado';
        END IF;

        --  Crear un aviso para OTRA persona del MISMO operador tiene que funcionar
        --  a nivel de esquema: es el caso normal, «entrenar.py cierra el turno de
        --  otro usuario». Se inserta directo —esta conexion tiene BYPASSRLS, asi
        --  que el INSERT en si no prueba el WITH CHECK de `crear_para_el_operador`—
        --  y lo que se prueba es el predicado de las otras dos politicas contra la
        --  fila resultante.
        INSERT INTO core.notifications (tenant_id, user_id, kind, title, body)
        VALUES (v_tenant_a, COALESCE(v_user_a2, v_user_a1), 'test.smoke', 'prueba', 'cuerpo de prueba')
        RETURNING id INTO v_notif_id;

        --  El predicado de `leer_propias`/`marcar_propias`/`borrar_propias` —
        --  `user_id = core.current_user_id()`— evaluado con el contexto de
        --  v_user_a1 tiene que dar FALSE sobre una fila que es de v_user_a2.
        IF v_user_a2 IS NOT NULL THEN
            SELECT (user_id = core.current_user_id()) INTO v_puede_ver
              FROM core.notifications WHERE id = v_notif_id;
            IF v_puede_ver IS NOT FALSE THEN
                RAISE EXCEPTION 'el predicado de leer_propias no niega un aviso ajeno: user_id = %, ve % con current_user_id() = %',
                    v_user_a2, v_puede_ver, v_user_a1;
            END IF;

            --  Y con el contexto del DESTINATARIO, el mismo predicado da TRUE.
            PERFORM set_config('app.auth_user_id', v_user_a2_auth::text, true);
            SELECT (user_id = core.current_user_id()) INTO v_puede_ver
              FROM core.notifications WHERE id = v_notif_id;
            IF v_puede_ver IS NOT TRUE THEN
                RAISE EXCEPTION 'el predicado de leer_propias no deja ver su propio aviso al destinatario';
            END IF;
        END IF;

        DELETE FROM core.notifications WHERE id = v_notif_id;

        --  Y el predicado de `tenant_isolation` —`tenant_id = core.current_tenant_id()`—
        --  tiene que dar FALSE para un operador distinto del contexto actual.
        IF v_tenant_b IS NOT NULL THEN
            PERFORM set_config('app.tenant_id', v_tenant_a::text, true);
            IF (v_tenant_b = core.current_tenant_id()) IS NOT FALSE THEN
                RAISE EXCEPTION 'el predicado de tenant_isolation no distingue operadores distintos';
            END IF;
        END IF;

        PERFORM set_config('app.tenant_id', NULL, true);
        PERFORM set_config('app.auth_user_id', NULL, true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'core' AND tablename = 'notifications'
           AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'falta el aislamiento por tenant en core.notifications';
    END IF;

    RAISE NOTICE '0104 OK - core.notifications lista: se puede avisar a otra persona del mismo operador, no de otro, y solo se lee lo propio';
END $$;
