-- ══════════════════════════════════════════════════════════════════════════════
-- 0075 · Registro de workers: que «hay quien lo procese» deje de ser una constante
--
-- Crea : core.workers, core.worker_esta_vivo()
-- Toca : nada. Los servicios de percepción y entrenamiento pasan a consultarla.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ ESTABA MAL
--
-- Dos sitios del código respondían a la misma pregunta con una constante:
--
--     services/perception.py    "worker_available": False
--     services/ai/training.py   "runner_available": False
--
-- Y era la respuesta CORRECTA mientras no hubiera ningún worker: la pantalla avisaba
-- de que la cola no iba a avanzar, que es mucho mejor que dibujar una barra de
-- progreso sobre nada. Pero es una constante, así que el día que alguien arranca un
-- worker la pantalla sigue diciendo que no hay ninguno.
--
-- Esta tabla es lo que convierte esa constante en un hecho comprobable.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ UNA SOLA TABLA PARA LOS DOS, Y EN `core`
--
-- Un worker de inferencia y un runner de entrenamiento son el MISMO concepto: un
-- proceso fuera de la API que coge trabajo encolado, lo hace donde hay GPU, y reporta.
-- Dos tablas idénticas con distinto nombre habrían duplicado el latido, la caducidad y
-- la consulta de disponibilidad, en dos esquemas, para no compartir la única columna
-- que los distingue: `kind`.
--
-- Va en `core` y no en `perception` ni en `ai` porque no pertenece a ninguno de los
-- dos. Si viviera en `perception`, el servicio de entrenamiento tendría que leer una
-- tabla de percepción para saber si hay quien entrene, que es exactamente el tipo de
-- dependencia cruzada que no se sostiene.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL LATIDO CADUCA, Y ESO ES EL DISEÑO
--
-- Un worker no se «desregistra»: se muere. Se le corta la luz, se cierra el portátil,
-- se cae la red. Si la disponibilidad dependiera de que el worker avise al irse, un
-- proceso muerto quedaría marcado como disponible para siempre y la cola volvería a
-- mentir, esta vez en la otra dirección —peor, porque nadie avisaría—.
--
-- Así que lo que se guarda es CUÁNDO se le oyó por última vez, y `worker_esta_vivo()`
-- decide con una ventana. 90 segundos: el worker late cada 30, así que tolera dos
-- latidos perdidos antes de darlo por muerto. Más corto lo declararía muerto en cada
-- hipo de red; más largo dejaría al operador esperando un proceso que ya no existe.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE core.workers (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid        NOT NULL REFERENCES core.tenants (id),

    --  Qué clase de trabajo coge. Es la única diferencia entre los dos.
    kind          varchar(12) NOT NULL,
    --  Cómo se llama la máquina. No es un identificador: dos portátiles pueden
    --  llamarse igual, y por eso la unicidad incluye `kind` y el nombre juntos —un
    --  reinicio del mismo worker actualiza su fila en vez de crear otra—.
    name          varchar(120) NOT NULL,

    --  Qué sabe hacer. En inferencia son los `pipeline` que soporta; en
    --  entrenamiento, los frameworks. Sirve para no encolar contra un worker que no
    --  puede: se guarda desde el principio porque añadirlo después obligaría a
    --  suponer que los antiguos lo pueden todo.
    capabilities  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    --  Qué versión del guion corre, y si tiene GPU. Cuando un trabajo salga mal, la
    --  primera pregunta va a ser «¿con qué lo procesaste?».
    agent_version varchar(40),
    device        varchar(40),

    registered_at timestamptz NOT NULL DEFAULT now(),
    --  El latido. Todo lo demás de esta tabla existe para dar contexto a esta columna.
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    --  En qué está ahora, si está en algo. Informativo: la autoridad sobre el estado
    --  de un trabajo es el trabajo.
    current_job   uuid,

    CONSTRAINT chk_worker_kind CHECK (kind IN ('inference', 'training')),
    CONSTRAINT uq_worker_nombre UNIQUE (tenant_id, kind, name)
);

COMMENT ON TABLE core.workers IS
    'Procesos externos que cogen trabajo encolado. La disponibilidad se deduce del latido, no de que el worker avise al morir.';
COMMENT ON COLUMN core.workers.last_seen_at IS
    'Ultimo latido. core.worker_esta_vivo() lo compara con una ventana de 90 s: dos latidos perdidos.';
COMMENT ON COLUMN core.workers.capabilities IS
    'Lista JSON de lo que sabe hacer: pipelines en inferencia, frameworks en entrenamiento.';

CREATE INDEX idx_workers_vivos ON core.workers (kind, last_seen_at DESC);


-- ── La pregunta, en un solo sitio ───────────────────────────────────────────
--
-- Como función y no como una condición repetida en dos servicios: la ventana de 90 s
-- es una decisión, y escrita dos veces son dos decisiones que se separan en cuanto
-- alguien ajuste una.
CREATE OR REPLACE FUNCTION core.worker_esta_vivo(p_kind text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM core.workers w
         WHERE w.kind = p_kind
           AND w.last_seen_at > now() - interval '90 seconds'
    );
$$;

COMMENT ON FUNCTION core.worker_esta_vivo(text) IS
    'Si hay algun worker de ese tipo con latido reciente. SECURITY INVOKER: pasa por RLS, asi que un tenant no ve los workers de otro.';


-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Un worker se registra con las credenciales de un usuario —así lo hace ya
-- `tools/entrenar.py`—, así que tiene tenant y se acota como todo lo demás.
--
-- Se acota aunque una máquina de GPU pueda servir a varios operadores: lo que esta
-- tabla dice es «hay quien procese MI cola», y el latido de un worker que trabaja
-- para otro operador no responde a esa pregunta.
ALTER TABLE core.workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.workers
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.workers
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON core.workers TO olo_app;
GRANT EXECUTE ON FUNCTION core.worker_esta_vivo(text) TO olo_app;

-- DELETE sí, a diferencia del historial de OLOBOT: un worker que se retira de verdad
-- —una máquina que se devuelve— debe poder borrarse. No es un registro de lo que
-- pasó; es una lista de lo que hay.


-- ── El permiso ──────────────────────────────────────────────────────────────
--
-- `perception:ingest` ya existe y es la credencial de MÁQUINA de este módulo: lo tiene
-- `tenant_admin` y `warehouse_manager`, y deliberadamente NO el operario. Registrar un
-- worker es la misma clase de acto que depositar detecciones, así que reutiliza ese
-- permiso en vez de inventar uno.
--
-- Leer la lista no exige nada especial: la pantalla de percepción necesita saber si
-- hay quien procese, y eso lo pregunta cualquiera que pueda ver un trabajo.


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_vivo boolean;
BEGIN
    -- Sin filas, la respuesta tiene que ser NO. Es el estado de hoy y es el que la
    -- pantalla enseña: si esto devolviera `true` con la tabla vacía, la cola volvería
    -- a mentir en la dirección peor.
    SELECT core.worker_esta_vivo('inference') INTO v_vivo;
    IF v_vivo THEN
        RAISE EXCEPTION 'con la tabla vacia no puede haber workers vivos';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'core' AND tablename = 'workers'
           AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'falta el aislamiento por tenant en core.workers';
    END IF;

    RAISE NOTICE '0075 OK · registro de workers listo, y hoy responde que no hay ninguno';
END $$;
