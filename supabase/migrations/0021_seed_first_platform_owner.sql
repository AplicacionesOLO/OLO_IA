-- ═══════════════════════════════════════════════════════════════════════════
-- 0021_seed_first_platform_owner.sql
-- Crea     : ninguna tabla. Inserta UNA fila en platform.owners.
-- Depende de: 0020
-- Riesgo   : bajo
--
-- EL ÚNICO SITIO DEL SISTEMA DONDE UN CORREO DECIDE ALGO.
--
--   Es aceptable exactamente aquí y en ningún otro lugar: el primer owner no lo
--   puede conceder otro owner, así que el arranque tiene que venir de DDL
--   revisada y versionada. A partir de esta fila, conceder el privilegio es una
--   operación de la API que exige ya ser owner.
--
-- NO FALLA SI EL USUARIO NO EXISTE.
--
--   Es un INSERT ... SELECT: en un entorno donde ese correo no esté sembrado
--   inserta cero filas y la migración pasa. Así el archivo es aplicable en
--   cualquier entorno sin ser específico de este, que es lo que se le pide a una
--   migración versionada.
--
-- Sobre RLS: `postgres` tiene rolbypassrls (verificado), así que la siembra no
-- choca con FORCE ROW LEVEL SECURITY y no hace falta ningún artificio.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO platform.owners (user_id, granted_by, granted_at, reason)
SELECT u.id,
       NULL,                       -- el primero no lo concede nadie
       now(),
       'Owner inicial de plataforma. Bootstrap del Bloque 0 del modulo de IA.'
  FROM core.users u
 WHERE u.email = 'arojas@ologistics.com'
   AND u.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_existe_usuario boolean;
    v_es_owner       boolean;
    v_total_activos  int;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM core.users
         WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL
    ) INTO v_existe_usuario;

    SELECT count(1) INTO v_total_activos
      FROM platform.owners WHERE revoked_at IS NULL;

    IF v_existe_usuario THEN
        SELECT EXISTS (
            SELECT 1
              FROM platform.owners o
              JOIN core.users u ON u.id = o.user_id
             WHERE u.email = 'arojas@ologistics.com' AND o.revoked_at IS NULL
        ) INTO v_es_owner;

        IF NOT v_es_owner THEN
            RAISE EXCEPTION
                'El usuario existe pero no quedó registrado como owner activo';
        END IF;

        RAISE NOTICE
            'OK 0021: arojas@ologistics.com es Platform Owner activo. Owners activos: %',
            v_total_activos;
    ELSE
        -- No es un fallo: es un entorno donde ese usuario no está sembrado.
        RAISE NOTICE
            'AVISO 0021: arojas@ologistics.com no existe en este entorno. '
            'Cero filas insertadas. Owners activos: %', v_total_activos;
    END IF;
END
$$;
