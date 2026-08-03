-- ═══════════════════════════════════════════════════════════════════════════
-- 0063_core_clients.sql
-- Crea     : core.clients + RLS + 4 permisos de tenant
-- Depende de: 0006-ish (core.tenants), core.companies, core.tenant_countries
-- Riesgo   : bajo — tabla nueva. **NO toca spatial.* ni su RLS**
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ `clients` NO PUEDE SER `companies`
--
-- `core.companies` ya existe y significa otra cosa: es la **entidad legal del
-- operador** en cada país. La única fila es «OLO Costa Rica SA», con su cédula
-- jurídica. Cuando se abra Venezuela, ahí irá «OLO Venezuela CA».
--
-- Y la prueba está en el esquema: **`core.warehouses.company_id`** existe. Un almacén
-- pertenece a UNA company. Si EPA y Cofersa fueran companies, no podrían compartir
-- OLO-CR — que es precisamente lo que hace falta.
--
--     countries → tenants → tenant_countries → companies → warehouses
--      (37)        (OLO)     (OLO en CR)      (OLO CR SA)   (OLO-CR)
--                                                  │
--                                                  └── clients (EPA, Cofersa)
--
-- Esto es un 3PL: OLO **opera** el almacén, y EPA y Cofersa son **dueños de la
-- mercadería** que se guarda en él. Dos roles distintos.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ `client_id` NO VA EN spatial.nodes NI EN spatial.locations. ESTO ES LO IMPORTANTE
--
-- La primera versión de este diseño ponía `client_id` en `spatial.nodes` — «un rack se
-- asigna a un cliente». **Es incorrecto, y por dos motivos independientes:**
--
--   1. `spatial.*` describe el EDIFICIO, y el edificio es del operador. Un rack no
--      pertenece a un cliente: es una estructura de acero que hoy tiene mercadería de
--      uno y mañana de otro. Asignarlo convertiría una convención operativa en un
--      hecho físico del catálogo.
--
--   2. La propiedad viaja con el PALLET, no con el hueco. Este sistema mapea lo que
--      hay físicamente en el rack; quién es el dueño lo sabe el WMS, y se resuelve al
--      reconciliar lo observado contra lo declarado. Si un rack acabara con carga de
--      dos clientes, el sistema seguiría siendo correcto: leería dos pallets y el WMS
--      diría de quién es cada uno.
--
-- La consecuencia práctica es grande: **no hay que tocar el RLS de las 29.312
-- ubicaciones.** Ese predicado ya costó la migración 0060 —60.778 ms → 13,4 ms— y
-- añadirle una comprobación por fila lo habría vuelto a romper.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL AISLAMIENTO POR CLIENTE TODAVÍA NO SE PUEDE HACER, Y NO ES UN OLVIDO
--
-- Comprobado: **no existe ninguna tabla de inventario, stock, pallets ni
-- movimientos.** El inventario no está en la base.
--
-- Sin datos de inventario no hay nada que aislar por cliente. Crear ahora
-- `user_client_access` y `accessible_client_ids()` sería inventar una frontera para
-- datos que no existen, y quedaría sin ejercitar hasta que exista el inventario —
-- momento en el que probablemente haría falta otra forma.
--
-- Esta tabla da lo que hace falta HOY: saber quiénes son los clientes, para el módulo
-- de Administración y para los informes. El aislamiento entra con el inventario.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.clients (
    id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         uuid         NOT NULL REFERENCES core.tenants(id),

    -- Qué entidad legal del operador le presta el servicio. Determina el país y la
    -- facturación: el mismo cliente puede existir en Costa Rica y en Venezuela como
    -- dos filas, porque son dos contratos distintos.
    company_id        uuid         NOT NULL,

    -- Código corto para informes y etiquetas: EPA, COFERSA.
    code              varchar(20)  NOT NULL,
    name              varchar(160) NOT NULL,
    legal_name        varchar(200) NULL,
    tax_id            varchar(40)  NULL,

    address           jsonb        NULL,
    settings          jsonb        NOT NULL DEFAULT '{}'::jsonb,

    status            varchar(12)  NOT NULL DEFAULT 'active',
    notes             text         NULL,

    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    updated_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version           integer      NOT NULL DEFAULT 1,
    deleted_at        timestamptz  NULL,

    -- FK COMPUESTA: la company tiene que ser del MISMO tenant que el cliente. Sin
    -- ella se podría atar un cliente de OLO a la entidad legal de otro tenant, y la
    -- fila sería coherente y falsa a la vez. Mismo patrón que `fk_comp_tenant_country`.
    CONSTRAINT fk_client_company FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, id),

    -- Destino de futuras FK compuestas: cuando el inventario referencie al cliente,
    -- será por `(tenant_id, client_id)` para que no pueda cruzar tenants.
    CONSTRAINT uq_client_tenant_id UNIQUE (tenant_id, id),

    CONSTRAINT chk_client_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
    CONSTRAINT chk_client_name CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_client_status CHECK (status IN ('active', 'inactive', 'suspended')),
    CONSTRAINT chk_client_settings_object CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT chk_client_address_object CHECK (
        address IS NULL OR jsonb_typeof(address) = 'object'
    ),
    CONSTRAINT chk_client_version CHECK (version >= 1)
);

COMMENT ON TABLE core.clients IS
    'Dueños de la mercaderia almacenada (3PL). NO son core.companies: esa es la entidad legal del OPERADOR. Un almacen pertenece a una company y guarda carga de varios clients.';
COMMENT ON COLUMN core.clients.company_id IS
    'Entidad legal del operador que presta el servicio. El mismo cliente en dos paises son dos filas: son dos contratos.';
COMMENT ON COLUMN core.clients.code IS
    'Codigo corto para informes y etiquetas. Se libera si el cliente se borra logicamente.';

-- El código se libera al borrar lógicamente: es una etiqueta, no una identidad.
-- Mismo criterio que `uq_class_nombre` en 0026.
CREATE UNIQUE INDEX uq_client_code ON core.clients (tenant_id, code)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_client_company ON core.clients (company_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_client_updated_at
    BEFORE UPDATE ON core.clients
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Patrón calcado de `core.companies`: restrictiva por tenant + permisiva para los
-- miembros. El predicado no recibe columnas como argumento, así que no cae en el
-- problema de evaluación por fila que corrigió la migración 0060.
ALTER TABLE core.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.clients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.clients
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.clients
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON core.clients TO olo_app;


-- ── Permisos del catálogo ───────────────────────────────────────────────────
-- Scope `tenant`, igual que `companies:*`: es un recurso del operador, no de
-- plataforma. `is_privileged = false` porque leer la lista de clientes no escala
-- privilegios; escribirla sí toca datos maestros, y eso lo controla el rol.
INSERT INTO core.permissions (code, module, action, description, is_privileged, scope)
VALUES
    ('clients:read',   'clients', 'read',   'Ver los clientes del operador',      false, 'tenant'),
    ('clients:create', 'clients', 'create', 'Crear un cliente',                   false, 'tenant'),
    ('clients:update', 'clients', 'update', 'Editar un cliente',                  false, 'tenant'),
    ('clients:delete', 'clients', 'delete', 'Desactivar o borrar un cliente',     false, 'tenant')
ON CONFLICT (code) DO UPDATE
   SET module      = EXCLUDED.module,
       action      = EXCLUDED.action,
       description = EXCLUDED.description,
       scope       = EXCLUDED.scope;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_force  boolean;
    v_pol    int;
    v_perm   int;
    v_fk     int;
    v_spat   int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'clients';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'clients';
    IF v_pol <> 2 THEN RAISE EXCEPTION 'se esperaban 2 politicas, hay %', v_pol; END IF;

    SELECT count(*) INTO v_fk FROM pg_constraint
     WHERE conrelid = 'core.clients'::regclass AND contype = 'f'
       AND array_length(conkey, 1) = 2;
    IF v_fk <> 1 THEN
        RAISE EXCEPTION 'falta la FK compuesta (tenant_id, company_id), hay %', v_fk;
    END IF;

    SELECT count(*) INTO v_perm FROM core.permissions WHERE module = 'clients';
    IF v_perm <> 4 THEN RAISE EXCEPTION 'se esperaban 4 permisos, hay %', v_perm; END IF;

    -- Lo que esta migración NO debe haber hecho: tocar el catálogo espacial. Se
    -- comprueba porque es la decisión de diseño más importante del archivo, y una
    -- migración futura que la olvide reintroduciría el problema.
    SELECT count(*) INTO v_spat FROM information_schema.columns
     WHERE table_schema = 'spatial' AND column_name ~* 'client';
    IF v_spat <> 0 THEN
        RAISE EXCEPTION
            'spatial.* tiene % columna(s) de cliente. El catalogo espacial describe el '
            'EDIFICIO, que es del operador; la propiedad viaja con el pallet.', v_spat;
    END IF;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'core.clients creada · % politicas · % permisos', v_pol, v_perm;
    RAISE NOTICE 'spatial.* SIN columnas de cliente: correcto';
    RAISE NOTICE 'core.permissions ahora: %', (SELECT count(*) FROM core.permissions);
    RAISE NOTICE 'OK 0063: los clientes existen. El aislamiento entra con el inventario.';
    RAISE NOTICE '───────────────────────────────────────────────';
END $$;
