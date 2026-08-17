-- ═══════════════════════════════════════════════════════════════════════════════
-- 0093 · Figuras para el almacén: personas, drones, montacargas
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────────
--
-- El plano 3D dibuja racks y nada más. Un almacén no es una estantería: para juzgar si un
-- pasillo da, si un montacargas gira, si el dron pasa entre dos hileras, hace falta ver
-- las cosas que se mueven — a escala, junto a los racks—.
--
-- Y esas cosas no se pueden dibujar con cajas. Una persona son 1,70 m de algo con una
-- forma reconocible; una caja de 1,70 m es una caja.
--
-- ── QUE SE GUARDA: LA REFERENCIA, NO EL MODELO ────────────────────────────────
--
-- El `.glb` vive en Storage y aquí solo su ruta, igual que el vídeo de una inspección y
-- por la misma razón: un binario de megabytes en una fila hace lenta cualquier consulta
-- que ni lo pida.
--
-- glTF 2.0 binario y no otro formato: es el estándar abierto de Khronos, un solo archivo
-- con geometría, materiales y animación, y su cargador viene en `three` sin dependencias
-- añadidas. OBJ no lleva materiales de verdad, FBX es propietario y DWG el navegador ni lo
-- abre.
--
-- ── POR QUE LA LICENCIA ES UNA COLUMNA OBLIGATORIA ────────────────────────────
--
-- Porque esto es un SaaS multi-tenant. Un modelo CC-BY sirviéndose a clientes SIN el
-- crédito que su licencia exige es un incumplimiento, no un descuido estético. Y el día
-- que haya que responder «¿de dónde salió este montacargas?», la respuesta tiene que estar
-- en la fila y no en la memoria de quien lo subió.
--
-- Es la misma disciplina que ADR-014 impuso con el modelo de visión: RF-DETR sí, YOLO no,
-- porque la licencia decide antes que la calidad.
--
-- ── DOS AMBITOS: LA BASE COMUN Y LA DE CADA OPERADOR ──────────────────────────
--
-- `tenant_id NULL` = biblioteca de la PLATAFORMA, visible para todos. Con dueño = privada
-- de ese operador. Sin la base común, cada cliente nuevo empieza con un almacén sin una
-- sola figura y tiene que salir a buscar modelos; sin la privada, nadie puede meter su
-- propio montacargas.
--
-- El patrón no es nuevo: es el de los modelos de IA, donde la plataforma publica y el
-- operador consume.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El bucket ─────────────────────────────────────────────────────────────
--
-- Aparte de `perception-media` a propósito. Son cosas con ciclos de vida opuestos: un
-- vídeo de inspección se analiza y se puede borrar; una figura del catálogo se sube una vez
-- y la usan mil planos. Mezclarlos haría que una limpieza de material rompiera el catálogo.
--
-- 64 MB por archivo: un modelo de almacén bien hecho —una persona, un dron— pesa entre 1 y
-- 10 MB. 64 deja sitio de sobra y corta el que alguien suba un escaneado de 400 MB que
-- ningún navegador podría cargar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'spatial-assets',
    'spatial-assets',
    false,
    67108864,
    ARRAY['model/gltf-binary', 'model/gltf+json', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── 2 · La regla de la ruta ───────────────────────────────────────────────────
--
-- Misma forma que `core.perception_media_path_ok` (0076) y por el mismo motivo: contar los
-- segmentos es lo que impide que un `a/b/../../otro` navegue fuera de su prefijo.
--
-- La diferencia es el primer segmento: aquí puede ser `plataforma`, porque la biblioteca
-- común no es de ningún tenant. Un literal y no un UUID de relleno: un UUID falso se
-- confundiría con el de alguien.
CREATE OR REPLACE FUNCTION core.spatial_asset_path_ok(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_partes text[] := string_to_array(coalesce(p_name, ''), '/');
    v_uuid   text   := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
    -- `<ambito>/<id-del-modelo>/<archivo>`. Tres exactos.
    IF array_length(v_partes, 1) <> 3 THEN
        RETURN false;
    END IF;

    IF v_partes[2] !~ v_uuid THEN
        RETURN false;
    END IF;

    IF v_partes[3] = '' OR v_partes[3] LIKE '%..%' THEN
        RETURN false;
    END IF;

    -- La biblioteca comun: SOLO la plataforma escribe ahi, y cualquiera la lee. La lectura
    -- la permite la politica de SELECT; esta funcion la usan las cuatro, asi que aqui se
    -- deja pasar y es la politica de escritura la que exige ser Platform Owner.
    IF v_partes[1] = 'plataforma' THEN
        RETURN true;
    END IF;

    -- Y si no, el primer segmento es el tenant de quien pregunta. Aqui esta el
    -- aislamiento: sin esto, cambiar un UUID daria acceso al prefijo de otro operador.
    IF v_partes[1] !~ v_uuid THEN
        RETURN false;
    END IF;
    RETURN v_partes[1]::uuid IS NOT DISTINCT FROM core.current_tenant_id();
END;
$$;

COMMENT ON FUNCTION core.spatial_asset_path_ok(text) IS
    'Valida la ruta de un objeto de `spatial-assets`: tres segmentos, el segundo un UUID, '
    'y el primero o el literal `plataforma` (biblioteca comun) o EL tenant de quien '
    'pregunta. Contar los segmentos es lo que impide salir del prefijo con `..`.';

-- ── 3 · El catálogo ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spatial.asset_models (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- `NULL` = biblioteca de la plataforma, visible para todos.
    tenant_id       uuid REFERENCES core.tenants(id),

    name            varchar(120) NOT NULL,

    -- ── Para qué sirve ────────────────────────────────────────────────────────
    --
    -- Una lista cerrada y no texto libre: la pantalla agrupa por esto, y con texto libre
    -- acabaría con «dron», «drone», «Dron» y «dron dji» como cuatro familias.
    kind            varchar(24) NOT NULL,

    -- ── Dónde están los bytes ─────────────────────────────────────────────────
    glb_path        text NOT NULL,
    -- Una imagen para el selector. Opcional: sin ella la pantalla dibuja el modelo, que
    -- cuesta mas pero funciona.
    thumb_path      text,
    byte_count      bigint,

    -- ── Cuánto mide DE VERDAD ─────────────────────────────────────────────────
    --
    -- En metros, tomadas del propio modelo al subirlo. Sin esto no hay forma de saber si
    -- viene en metros, en centimetros o en unidades de Blender, y una persona de 170 m
    -- junto a un rack de 12 no es un error que se pueda pasar por alto.
    size_x_m        double precision,
    size_y_m        double precision,
    size_z_m        double precision,

    -- Multiplicador para llevarlo a metros reales. `1` si ya venia bien. Se guarda en vez
    -- de reescribir el archivo: el `.glb` no se toca nunca, asi se puede volver atras.
    scale           double precision NOT NULL DEFAULT 1,

    -- ── De dónde salió ────────────────────────────────────────────────────────
    --
    -- `license` es NOT NULL a proposito. Un modelo sin licencia declarada no se puede
    -- servir a un cliente, y permitir `NULL` seria dejar que el problema entre por la
    -- puerta y se descubra en una auditoria.
    license         varchar(60) NOT NULL,
    attribution     text,
    source_url      text,

    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    version         integer NOT NULL DEFAULT 1,
    deleted_at      timestamptz,

    CONSTRAINT chk_asset_kind CHECK (
        kind IN ('persona', 'dron', 'montacargas', 'vehiculo', 'tarima', 'senal', 'mobiliario', 'otro')
    ),
    -- Una escala de cero hace desaparecer la figura sin decir por que; una negativa la
    -- da del reves. El tope de 1.000 corta el error de unidad al reves.
    CONSTRAINT chk_asset_scale CHECK (scale > 0 AND scale <= 1000),
    CONSTRAINT chk_asset_size CHECK (
        (size_x_m IS NULL OR (size_x_m > 0 AND size_x_m <= 200)) AND
        (size_y_m IS NULL OR (size_y_m > 0 AND size_y_m <= 200)) AND
        (size_z_m IS NULL OR (size_z_m > 0 AND size_z_m <= 200))
    ),
    -- Una atribucion vacia no es una atribucion. `CC-BY` sin credito es incumplimiento, y
    -- la base es el ultimo sitio donde se puede exigir.
    CONSTRAINT chk_asset_atribucion CHECK (
        license NOT LIKE '%BY%' OR (attribution IS NOT NULL AND length(trim(attribution)) > 0)
    )
);

-- Nombre unico por ambito: dos «Operario» en la misma biblioteca son dos cosas que nadie
-- sabe distinguir en un selector. `COALESCE` porque `NULL` no compara en un indice unico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_nombre
    ON spatial.asset_models (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_asset_kind
    ON spatial.asset_models (kind) WHERE deleted_at IS NULL;

COMMENT ON TABLE spatial.asset_models IS
    'Catalogo de figuras 3D (.glb) para el plano: personas, drones, montacargas. '
    '`tenant_id NULL` es la biblioteca de la PLATAFORMA, visible para todos; con dueno es '
    'privada de ese operador. `license` es obligatoria: servir un modelo CC-BY sin credito '
    'es incumplir, no un descuido.';

-- ── 4 · Dónde se coloca cada figura ───────────────────────────────────────────
--
-- Separado del catalogo porque son cosas distintas: el modelo es UNO y sus apariciones son
-- muchas. Con todo en una tabla, poner diez operarios duplicaria diez veces la ruta del
-- archivo y sus metadatos, y corregir la licencia habria que hacerlo diez veces.
CREATE TABLE IF NOT EXISTS spatial.asset_instances (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES core.tenants(id),
    warehouse_id    uuid NOT NULL,
    model_id        uuid NOT NULL REFERENCES spatial.asset_models(id),

    -- En METROS y en el mismo sistema que los racks del plano. No en pixeles: el pixel
    -- depende de la calibracion y una figura colocada antes de calibrar se moveria despues.
    x_m             double precision NOT NULL,
    y_m             double precision NOT NULL,
    -- Altura sobre el suelo. Un dron a 6 m es el caso que da sentido a esta columna.
    z_m             double precision NOT NULL DEFAULT 0,
    rotation_deg    double precision NOT NULL DEFAULT 0,
    -- Escala PROPIA de esta aparicion, sobre la del modelo. Sirve para un mismo modelo de
    -- caja a dos tamanos sin subirlo dos veces.
    scale           double precision NOT NULL DEFAULT 1,

    label           varchar(120),
    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    version         integer NOT NULL DEFAULT 1,
    deleted_at      timestamptz,

    CONSTRAINT fk_asset_inst_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_asset_inst_scale CHECK (scale > 0 AND scale <= 1000),
    CONSTRAINT chk_asset_inst_z CHECK (z_m >= 0 AND z_m <= 200)
);

CREATE INDEX IF NOT EXISTS ix_asset_inst_almacen
    ON spatial.asset_instances (warehouse_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE spatial.asset_instances IS
    'Donde esta colocada cada figura, en METROS y en el sistema del plano. Separado del '
    'catalogo: el modelo es uno y sus apariciones son muchas.';

-- ── 5 · RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE spatial.asset_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.asset_models FORCE ROW LEVEL SECURITY;

-- Se ve lo propio Y la biblioteca comun. Es la unica politica de todo `spatial` que deja
-- ver una fila sin dueno, y es a proposito: sin ella la base comun no existiria.
CREATE POLICY asset_models_select ON spatial.asset_models
    FOR SELECT USING (tenant_id IS NULL OR tenant_id = core.current_tenant_id());

-- Escribir en la propia biblioteca. La comun NO: eso es de la plataforma.
CREATE POLICY asset_models_write ON spatial.asset_models
    FOR ALL USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Y la comun, solo el Platform Owner. Politica aparte y no un `OR` en la anterior: asi se
-- lee de un vistazo quien puede tocar la biblioteca de todos.
CREATE POLICY asset_models_plataforma ON spatial.asset_models
    FOR ALL USING (tenant_id IS NULL AND core.is_platform_owner())
    WITH CHECK (tenant_id IS NULL AND core.is_platform_owner());

ALTER TABLE spatial.asset_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.asset_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_inst_select ON spatial.asset_instances
    FOR SELECT USING (tenant_id = core.current_tenant_id());

CREATE POLICY asset_inst_write ON spatial.asset_instances
    FOR ALL USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.asset_models TO olo_app, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.asset_instances TO olo_app, authenticated;

-- ── 6 · Politicas del bucket ──────────────────────────────────────────────────

CREATE POLICY spatial_assets_read ON storage.objects
    FOR SELECT USING (
        bucket_id = 'spatial-assets' AND core.spatial_asset_path_ok(name)
    );

-- Escribir bajo el prefijo propio. La biblioteca comun se excluye aqui y se permite en la
-- politica siguiente, que exige ser Platform Owner.
CREATE POLICY spatial_assets_write ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'spatial-assets'
        AND core.spatial_asset_path_ok(name)
        AND split_part(name, '/', 1) <> 'plataforma'
    );

CREATE POLICY spatial_assets_plataforma ON storage.objects
    FOR ALL USING (
        bucket_id = 'spatial-assets'
        AND split_part(name, '/', 1) = 'plataforma'
        AND core.is_platform_owner()
    )
    WITH CHECK (
        bucket_id = 'spatial-assets'
        AND split_part(name, '/', 1) = 'plataforma'
        AND core.is_platform_owner()
    );

CREATE POLICY spatial_assets_delete ON storage.objects
    FOR DELETE USING (
        bucket_id = 'spatial-assets'
        AND core.spatial_asset_path_ok(name)
        AND split_part(name, '/', 1) <> 'plataforma'
    );

-- ── 7 · Comprobación ──────────────────────────────────────────────────────────
--
-- Las dos tablas quedan VACIAS. Ninguna figura se inventa: se suben, con su licencia
-- delante. Sembrar «modelos tipicos» seria meter en la base archivos que no existen.
DO $$
DECLARE
    v_bucket int;
BEGIN
    SELECT count(*) INTO v_bucket FROM storage.buckets WHERE id = 'spatial-assets';
    IF v_bucket <> 1 THEN
        RAISE EXCEPTION 'el bucket spatial-assets no se creo';
    END IF;

    -- La regla de la ruta, probada aqui mismo: es una cuenta y se comprueba contando.
    IF core.spatial_asset_path_ok('plataforma/2692ad69-e7fd-4fcd-ac1c-d7ddeb2bf416/operario.glb') IS NOT TRUE THEN
        RAISE EXCEPTION 'la biblioteca comun deberia validar';
    END IF;
    IF core.spatial_asset_path_ok('plataforma/no-es-uuid/operario.glb') IS NOT FALSE THEN
        RAISE EXCEPTION 'el segundo segmento tiene que ser un UUID';
    END IF;
    IF core.spatial_asset_path_ok('plataforma/2692ad69-e7fd-4fcd-ac1c-d7ddeb2bf416/a/b.glb') IS NOT FALSE THEN
        RAISE EXCEPTION 'cuatro segmentos no valen: con mas se puede salir del prefijo';
    END IF;
    IF core.spatial_asset_path_ok('plataforma/2692ad69-e7fd-4fcd-ac1c-d7ddeb2bf416/../x.glb') IS NOT FALSE THEN
        RAISE EXCEPTION 'un `..` no puede pasar';
    END IF;

    RAISE NOTICE 'OK · bucket y catalogo creados, VACIOS a proposito: cada figura se sube '
                 'con su licencia declarada. La regla de la ruta pasa sus 4 comprobaciones.';
END $$;
