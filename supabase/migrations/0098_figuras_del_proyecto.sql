-- ═══════════════════════════════════════════════════════════════════════════════
-- 0098 · Figuras DEL PROYECTO: herramientas que vienen con la aplicacion
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- Pedido tal cual: «que no se carguen desde archivos sino que vivan en el proyecto, y poder
-- usarlas como items — copiarlas, duplicarlas, cada uno con su identificador—».
--
-- Hasta ahora toda figura era un archivo SUBIDO: alguien elegia un `.glb`, se reservaba sitio
-- en el bucket, se subia y se registraba. Eso es lo correcto para un modelo que trae el
-- cliente, y es lo peor posible para el palet o la carretilla estandar:
--
--   · Hay que subirlos UNA VEZ POR OPERADOR, o depender de que alguien con permiso de
--     plataforma se acuerde de hacerlo.
--   · Un almacen recien creado no tiene ninguna herramienta hasta que alguien sube algo.
--   · Y si el objeto se borra del bucket, la fila del catalogo sigue ahi ofreciendo una
--     figura que no se puede dibujar.
--
-- ── QUE CAMBIA ────────────────────────────────────────────────────────────────
--
-- Una figura puede ahora estar en UNO de dos sitios, nunca en los dos:
--
--   `glb_path`     el objeto esta en el bucket. Es lo que sube un operador.
--   `builtin_key`  la figura VIENE CON LA APLICACION, servida desde su propio origen.
--
-- Las instancias no cambian ni una linea: `asset_instances` sigue apuntando al modelo por su
-- `id`, con su propia posicion, giro, escala y etiqueta. Por eso duplicar una figura ya es
-- posible sin tocar la base — es una fila mas, con su uuid— y por eso una figura del proyecto
-- se puede mover, girar y animar exactamente igual que una subida.
--
-- ── POR QUE UNA CLAVE Y NO UNA RUTA FALSA ─────────────────────────────────────
--
-- Se penso en poner `glb_path = 'builtin:palet_euro'` y no crear columna. Se descarto: la
-- ruta la consume `sign_download` contra el bucket, asi que una ruta que no es una ruta
-- acabaria pidiendo al Storage un objeto inventado y tragandose el error en silencio — el
-- catalogo mostraria la figura y no se dibujaria—. Con una columna aparte, el codigo pregunta
-- lo que quiere saber: «¿esta en el bucket o viene con la app?».
--
-- ── POR QUE VAN EN LA BIBLIOTECA DE PLATAFORMA ────────────────────────────────
--
-- `tenant_id NULL`, que 0093 definio como «visible para todos». Un palet europeo mide lo
-- mismo en todos los almacenes del mundo: copiarlo por operador serian N filas identicas que
-- hay que migrar N veces cuando se corrija una cota.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE spatial.asset_models
    ADD COLUMN IF NOT EXISTS builtin_key varchar(40);

COMMENT ON COLUMN spatial.asset_models.builtin_key IS
    'Clave de la figura que VIENE CON LA APLICACION. Cuando esta puesta, `glb_path` es NULL y '
    'los bytes los sirve el propio frontend desde su origen, no el bucket. Es lo que permite '
    'que un almacen recien creado ya tenga sus herramientas — palet, carretilla, pilar— sin '
    'que nadie suba nada.';

--  `glb_path` deja de ser obligatorio: una figura del proyecto no tiene objeto en el bucket.
ALTER TABLE spatial.asset_models
    ALTER COLUMN glb_path DROP NOT NULL;

--  Uno de los dos, y solo uno. Sin esto caben dos filas imposibles: una sin bytes en ningun
--  sitio —una figura que no se puede dibujar y sale en el selector— y otra con los dos, donde
--  el codigo tendria que elegir y elegiria distinto en cada sitio.
ALTER TABLE spatial.asset_models
    ADD CONSTRAINT chk_asset_origen
        CHECK ((glb_path IS NOT NULL) <> (builtin_key IS NOT NULL));

--  Una clave por figura. Dos filas con `palet_euro` serian dos palets identicos en el
--  selector y ninguna forma de saber cual se colocó.
CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_builtin
    ON spatial.asset_models (builtin_key)
    WHERE builtin_key IS NOT NULL AND deleted_at IS NULL;

-- ── Las cinco herramientas ────────────────────────────────────────────────────
--
-- Las medidas NO estan escritas a mano aqui: salen de medir la geometria que genera
-- `backend/tools/figuras_generar.py`, que es quien construye los `.glb` que el frontend
-- sirve. Si se regeneran con otra cota, esta tabla se queda vieja — y por eso el generador
-- imprime las medidas al ejecutarse, para poder comprobarlo—.
--
-- Todas CC0-1.0 porque las genera este proyecto. No hay atribucion que declarar, y por eso
-- pasan el CHECK de 0093 que la exige a cualquier licencia con «BY».
INSERT INTO spatial.asset_models (
    tenant_id, name, kind, builtin_key, glb_path,
    size_x_m, size_y_m, size_z_m, scale, license, notes
)
VALUES
    (NULL, 'Palet EUR/EPAL 1200x800', 'tarima', 'palet_euro', NULL,
     1.2, 0.144, 0.8, 1, 'CC0-1.0',
     'Palet europeo normalizado. Generado por el proyecto: tres tablas abajo, nueve tacos, '
     'tres patines y cinco tablas arriba, 1200 x 800 x 144 mm.'),
    (NULL, 'Pilar de acero IPE 300', 'mobiliario', 'pilar_acero', NULL,
     0.4, 6.0, 0.4, 1, 'CC0-1.0',
     'Pilar de nave con perfil en H de 300 x 150 mm y placa de anclaje de 400 x 400. Mide '
     '6 m: para otra altura, la escala de la instancia.'),
    (NULL, 'Tope de proteccion de montante', 'mobiliario', 'tope_proteccion_rack', NULL,
     0.18, 0.408, 0.18, 1, 'CC0-1.0',
     'Protector de pie de montante, 400 mm de alto para montante de 100 mm, en amarillo de '
     'seguridad.'),
    (NULL, 'Cajon demarcado de palet', 'senal', 'cajon_demarcado', NULL,
     1.2, 0.005, 1.0, 1, 'CC0-1.0',
     'Marca de suelo de 1200 x 1000 mm con pintura de 50 mm y esquinas abiertas. Los 5 mm de '
     'espesor evitan que la pintura y el suelo se peleen por el mismo pixel.'),
    (NULL, 'Carretilla contrapesada 2,5 t', 'montacargas', 'carretilla_contrapesada', NULL,
     1.14, 2.1, 3.5, 1, 'CC0-1.0',
     'Contrapesada de 2,5 t: 3,50 m con horquillas, 1,14 de ancho y 2,10 de mastil bajado. '
     'Las cotas son las que deciden si cabe en un pasillo.')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_builtin int;
    v_subidas int;
    v_sin_origen int;
BEGIN
    SELECT count(*) INTO v_builtin
      FROM spatial.asset_models WHERE builtin_key IS NOT NULL AND deleted_at IS NULL;
    SELECT count(*) INTO v_subidas
      FROM spatial.asset_models WHERE glb_path IS NOT NULL AND deleted_at IS NULL;
    SELECT count(*) INTO v_sin_origen
      FROM spatial.asset_models
     WHERE glb_path IS NULL AND builtin_key IS NULL AND deleted_at IS NULL;

    IF v_builtin <> 5 THEN
        RAISE EXCEPTION 'deberian quedar 5 figuras del proyecto y hay %', v_builtin;
    END IF;
    --  Lo que el CHECK ya impide, comprobado igualmente: es la clase de fila que deja una
    --  figura en el selector que no se puede dibujar, y el sintoma seria «no se ve nada».
    IF v_sin_origen <> 0 THEN
        RAISE EXCEPTION '% figura(s) sin bytes en ningun sitio', v_sin_origen;
    END IF;

    RAISE NOTICE 'OK · 5 figuras del proyecto en la biblioteca comun y % subida(s) intactas. '
                 'Las instancias no se han tocado.', v_subidas;
END $$;
