-- ═══════════════════════════════════════════════════════════════════════════
-- 0032_create_perception_schema.sql
-- Crea     : schema `perception`, privilegios, default privileges
-- Tablas   : NINGUNA. Las de percepción son del Bloque 7.
-- Depende de: 0002 (rol olo_app)
-- Riesgo   : bajo
--
-- ⚠ RÉGIMEN DISTINTO AL DE `ai`. LEER ANTES DE CREAR LA PRIMERA TABLA AQUÍ.
--
--   `ai`         → régimen PLATFORM OWNER: USING (core.is_platform_owner())
--   `perception` → régimen TENANT:         USING (core.current_tenant_id() …)
--
--   Las observaciones son DATOS DEL CLIENTE. Un dron volando en el almacén del
--   tenant X produce observaciones sobre el inventario del tenant X. Copiar aquí
--   la política de `ai` produciría una de estas dos cosas:
--
--     · con la política de owner: ningún usuario del tenant vería sus propios
--       datos y el módulo sería inútil;
--     · si alguien la relajara para arreglarlo: un tenant vería las
--       observaciones de otro. Fotos, distribución y mercancía de un cliente
--       visibles a otro. Es la peor fuga posible en un SaaS multi-tenant.
--
--   Por eso el schema se crea vacío y con este aviso: quien escriba la primera
--   tabla lo leerá antes de copiar la política de al lado.
--
-- POR QUÉ VACÍO Y AHORA
--
--   Los default privileges tienen que existir ANTES de la primera tabla. Si se
--   crean después, las tablas ya creadas no los heredan y hay que conceder a
--   mano. Ese error ya costó una migración de corrección en este proyecto (0018).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ESTRATEGIA DE PARTICIONADO, CLAVE PRIMARIA Y RETENCIÓN
--
-- Se documenta aquí, versionada junto al DDL, y NO se implementa todavía. Con la
-- tabla vacía el particionado no aporta nada, pero condiciona la clave primaria,
-- que sí queda decidida ahora porque cambiarla después obliga a reescribir.
--
-- VOLUMEN ESTIMADO
--   Un dron a 5 fps con ~20 detecciones por frame produce ~100 filas/s, unos
--   8,6 millones de filas al día por dron activo. `perception.observations` será
--   la tabla más grande del sistema por órdenes de magnitud — `platform.owners`
--   tiene una fila.
--
-- CLAVE PRIMARIA:  (observed_at, id)
--   `PARTITION BY RANGE (observed_at)` exige que la columna de partición esté
--   incluida en TODA restricción única de la tabla, incluida la primaria. DEC-06
--   ya midió empíricamente que PostgreSQL rechaza una PK que no la incluya, y que
--   afecta a cualquier UNIQUE, no solo a la PK.
--   No es una concesión al particionado: una PK que empieza por tiempo sirve al
--   patrón de consulta real —«qué se observó en este rango»— mejor que un uuid
--   suelto, que obliga a recorrer todas las particiones.
--
-- PARTICIONADO:  RANGE mensual sobre `observed_at`
--   Mensual y no diario: con 8,6 M filas/día, las particiones diarias darían
--   cientos de particiones al año y el planificador se degrada. Mensual mantiene
--   el número manejable y permite desprender un mes completo con DETACH, que es
--   instantáneo frente a un DELETE masivo.
--   Creación de particiones futuras con pg_partman o tarea programada. Hace falta
--   una partición DEFAULT como red: una fila cuya fecha caiga fuera de toda
--   partición produce un error de inserción, y perder una observación por eso
--   sería perder evidencia.
--
-- RETENCIÓN por estado, no solo por edad
--   · matched      → 12 meses. Ya cumplieron su función: cuadraron con inventario.
--   · discarded    → 90 días. Se conservan un trimestre para poder medir la tasa
--                    de falsos positivos del modelo.
--   · unmatched    → SIN CADUCIDAD hasta resolverse. Son las que señalan una
--                    discrepancia real; borrarlas destruiría la evidencia del
--                    problema que aún está abierto.
--   · superseded   → 90 días.
--   Y una regla que domina a todas: una observación que sustente una discrepancia
--   ABIERTA no se borra nunca, con independencia de su edad y su estado.
--
--   Consecuencia operativa: la retención NO puede ser un simple DROP de la
--   partición más antigua. Antes de desprender un mes hay que comprobar que no
--   contiene observaciones vivas; las que queden se migran a almacenamiento frío
--   o a una partición de conservación.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA perception;

COMMENT ON SCHEMA perception IS
    'Ejecucion y EVIDENCIA de IA: sesiones de inferencia, lotes y observaciones. Regimen TENANT (no owner): son datos del cliente. Ver la cabecera de la migracion 0032 antes de crear tablas aqui.';

GRANT USAGE ON SCHEMA perception TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA perception
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA perception
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_usage   boolean;
    v_create  boolean;
    v_default int;
    v_tablas  int;
BEGIN
    SELECT has_schema_privilege('olo_app', 'perception', 'USAGE'),
           has_schema_privilege('olo_app', 'perception', 'CREATE')
      INTO v_usage, v_create;
    IF NOT v_usage THEN RAISE EXCEPTION 'olo_app necesita USAGE sobre perception'; END IF;
    IF v_create  THEN RAISE EXCEPTION 'olo_app NO debe tener CREATE sobre perception'; END IF;

    SELECT count(1) INTO v_default
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'perception' AND d.defaclrole = 'postgres'::regrole;
    IF v_default = 0 THEN
        RAISE EXCEPTION 'no hay default privileges de postgres en perception';
    END IF;

    -- Debe quedar VACÍO: las tablas operativas son del Bloque 7.
    SELECT count(1) INTO v_tablas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception' AND c.relkind = 'r';
    IF v_tablas <> 0 THEN
        RAISE EXCEPTION 'perception debe quedar sin tablas, tiene %', v_tablas;
    END IF;

    RAISE NOTICE
        'OK 0032: schema perception preparado (usage=si create=no), % entradas de default_acl, 0 tablas',
        v_default;
END
$$;
