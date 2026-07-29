-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0003_create_global_catalogs.sql
-- Crea      : public.currencies (ISO 4217) y public.countries (ISO 3166-1)
--             con RLS plantilla T1 (catálogo global de solo lectura) y semilla
-- Por qué   : core.tenant_countries (0008) depende de ambas. Un país y una
--             moneda son hechos del mundo, no datos del tenant: por eso viven
--             en `public` sin tenant_id (FINAL_DATABASE_MODEL.md §4.1-4.2).
--             Son la única excepción a la regla R8 (ninguna migración crea
--             datos): estos datos no son de negocio, son catálogos ISO.
-- Depende de: 0002 (olo_app debe existir para concederle SELECT)
-- Rollback  : supabase/rollbacks/0003_create_global_catalogs.down.sql
-- Riesgo    : bajo
--
-- Nota 1: en Supabase el schema `public` tiene privilegios por defecto que
--         conceden DML COMPLETO (arwdDxtm) a anon, authenticated y
--         service_role sobre cada tabla nueva. Por eso el REVOKE del punto 3
--         no es defensivo sino IMPRESCINDIBLE: sin él, cualquier usuario
--         autenticado podría reescribir el catálogo ISO.
-- Nota 2: la semilla cubre los mercados operativos (América Latina, América
--         del Norte) más las principales economías europeas y asiáticas: 29
--         monedas y 37 países. Es un catálogo extensible: completar el resto
--         de ISO 3166-1 es una migración de datos posterior, no un cambio de
--         modelo. Todos los códigos incluidos están verificados uno a uno; se
--         prefirió un catálogo parcial y correcto a uno completo y dudoso.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. public.currencies ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.currencies (
    code           CHAR(3)      PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    symbol         VARCHAR(10)  NOT NULL,
    decimal_places SMALLINT     NOT NULL DEFAULT 2,

    CONSTRAINT chk_currencies_code    CHECK (code = upper(code) AND code ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_currencies_decimals CHECK (decimal_places BETWEEN 0 AND 4)
);

COMMENT ON TABLE  public.currencies IS
    'Catalogo global ISO 4217. Sin tenant_id: una moneda es un hecho del mundo. Solo lectura.';
COMMENT ON COLUMN public.currencies.decimal_places IS
    'Decimales segun ISO 4217. JPY, KRW, CLP y PYG usan 0.';


-- ── 2. public.countries ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.countries (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    iso_code              CHAR(2)      NOT NULL,
    iso_code_3            CHAR(3)      NOT NULL,
    numeric_code          CHAR(3)      NOT NULL,
    name_en               VARCHAR(100) NOT NULL,
    name_es               VARCHAR(100) NOT NULL,
    phone_code            VARCHAR(10),
    default_currency_code CHAR(3)      NOT NULL REFERENCES public.currencies(code),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT chk_countries_iso2    CHECK (iso_code   ~ '^[A-Z]{2}$'),
    CONSTRAINT chk_countries_iso3    CHECK (iso_code_3 ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_countries_numeric CHECK (numeric_code ~ '^[0-9]{3}$')
);

-- Las tres claves comerciales de ISO 3166-1 son únicas y NO admiten reutilización:
-- este catálogo no tiene soft delete, así que los índices son totales, no parciales.
CREATE UNIQUE INDEX IF NOT EXISTS uq_countries_iso2    ON public.countries (iso_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_countries_iso3    ON public.countries (iso_code_3);
CREATE UNIQUE INDEX IF NOT EXISTS uq_countries_numeric ON public.countries (numeric_code);
CREATE        INDEX IF NOT EXISTS idx_countries_currency ON public.countries (default_currency_code);

COMMENT ON TABLE public.countries IS
    'Catalogo global ISO 3166-1. Sin tenant_id. La presencia operativa de un tenant en un pais se modela en core.tenant_countries.';


-- ── 3. Privilegios: solo lectura ───────────────────────────────────────────
-- Imprescindible: el default ACL de `public` en Supabase concede arwdDxtm a
-- anon y authenticated sobre toda tabla nueva. Se retira todo y se concede
-- únicamente SELECT a quien debe leer.
REVOKE ALL ON TABLE public.currencies, public.countries FROM PUBLIC;
REVOKE ALL ON TABLE public.currencies, public.countries FROM anon;
REVOKE ALL ON TABLE public.currencies, public.countries FROM authenticated;

GRANT SELECT ON TABLE public.currencies, public.countries TO authenticated;
GRANT SELECT ON TABLE public.currencies, public.countries TO olo_app;


-- ── 4. RLS plantilla T1 ────────────────────────────────────────────────────
-- Una tabla en `public` sin RLS queda marcada por el linter de Supabase
-- (rls_disabled_in_public) y expuesta vía PostgREST. Se habilita RLS aunque no
-- haya nada que aislar por tenant.
--
-- NO se aplica FORCE ROW LEVEL SECURITY: el propietario (postgres) debe poder
-- sembrar y mantener el catálogo. Es la diferencia deliberada con T2 y T3.
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.countries  ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_read ON public.currencies
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

CREATE POLICY catalog_read ON public.countries
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

-- Sin políticas de INSERT, UPDATE ni DELETE: doble cierre junto al REVOKE.


-- ── 5. Semilla: monedas ISO 4217 ───────────────────────────────────────────
-- ON CONFLICT DO NOTHING hace la semilla idempotente, requisito para que la
-- reaplicación de la migración sea limpia.
INSERT INTO public.currencies (code, name, symbol, decimal_places) VALUES
    ('USD', 'US Dollar',            '$',   2),
    ('EUR', 'Euro',                 '€',   2),
    ('GBP', 'Pound Sterling',       '£',   2),
    ('JPY', 'Yen',                  '¥',   0),
    ('CNY', 'Yuan Renminbi',        '¥',   2),
    ('KRW', 'Won',                  '₩',   0),
    ('INR', 'Indian Rupee',         '₹',   2),
    ('SGD', 'Singapore Dollar',     '$',   2),
    ('CAD', 'Canadian Dollar',      '$',   2),
    ('MXN', 'Mexican Peso',         '$',   2),
    ('GTQ', 'Quetzal',              'Q',   2),
    ('BZD', 'Belize Dollar',        '$',   2),
    ('HNL', 'Lempira',              'L',   2),
    ('NIO', 'Cordoba Oro',          'C$',  2),
    ('CRC', 'Costa Rican Colon',    '₡',   2),
    ('PAB', 'Balboa',               'B/.', 2),
    ('COP', 'Colombian Peso',       '$',   2),
    ('VES', 'Bolivar Soberano',     'Bs.', 2),
    ('PEN', 'Sol',                  'S/',  2),
    ('BOB', 'Boliviano',            'Bs',  2),
    ('CLP', 'Chilean Peso',         '$',   0),
    ('ARS', 'Argentine Peso',       '$',   2),
    ('UYU', 'Peso Uruguayo',        '$U',  2),
    ('PYG', 'Guarani',              '₲',   0),
    ('BRL', 'Brazilian Real',       'R$',  2),
    ('DOP', 'Dominican Peso',       'RD$', 2),
    ('CUP', 'Cuban Peso',           '$',   2),
    ('HTG', 'Gourde',               'G',   2),
    ('JMD', 'Jamaican Dollar',      '$',   2)
ON CONFLICT (code) DO NOTHING;


-- ── 6. Semilla: países ISO 3166-1 ──────────────────────────────────────────
-- Mercados operativos (América Latina y del Norte) + principales economías
-- europeas y asiáticas. Extensible con una migración de datos posterior.
INSERT INTO public.countries
    (iso_code, iso_code_3, numeric_code, name_en, name_es, phone_code, default_currency_code) VALUES
    -- América del Norte
    ('US', 'USA', '840', 'United States',        'Estados Unidos',       '+1',   'USD'),
    ('CA', 'CAN', '124', 'Canada',               'Canadá',               '+1',   'CAD'),
    ('MX', 'MEX', '484', 'Mexico',               'México',               '+52',  'MXN'),
    -- Centroamérica
    ('GT', 'GTM', '320', 'Guatemala',            'Guatemala',            '+502', 'GTQ'),
    ('BZ', 'BLZ', '084', 'Belize',               'Belice',               '+501', 'BZD'),
    ('SV', 'SLV', '222', 'El Salvador',          'El Salvador',          '+503', 'USD'),
    ('HN', 'HND', '340', 'Honduras',             'Honduras',             '+504', 'HNL'),
    ('NI', 'NIC', '558', 'Nicaragua',            'Nicaragua',            '+505', 'NIO'),
    ('CR', 'CRI', '188', 'Costa Rica',           'Costa Rica',           '+506', 'CRC'),
    ('PA', 'PAN', '591', 'Panama',               'Panamá',               '+507', 'PAB'),
    -- Caribe
    ('DO', 'DOM', '214', 'Dominican Republic',   'República Dominicana',  '+1',   'DOP'),
    ('CU', 'CUB', '192', 'Cuba',                 'Cuba',                 '+53',  'CUP'),
    ('HT', 'HTI', '332', 'Haiti',                'Haití',                '+509', 'HTG'),
    ('JM', 'JAM', '388', 'Jamaica',              'Jamaica',              '+1',   'JMD'),
    ('PR', 'PRI', '630', 'Puerto Rico',          'Puerto Rico',          '+1',   'USD'),
    -- América del Sur
    ('CO', 'COL', '170', 'Colombia',             'Colombia',             '+57',  'COP'),
    ('VE', 'VEN', '862', 'Venezuela',            'Venezuela',            '+58',  'VES'),
    ('EC', 'ECU', '218', 'Ecuador',              'Ecuador',              '+593', 'USD'),
    ('PE', 'PER', '604', 'Peru',                 'Perú',                 '+51',  'PEN'),
    ('BO', 'BOL', '068', 'Bolivia',              'Bolivia',              '+591', 'BOB'),
    ('CL', 'CHL', '152', 'Chile',                'Chile',                '+56',  'CLP'),
    ('AR', 'ARG', '032', 'Argentina',            'Argentina',            '+54',  'ARS'),
    ('UY', 'URY', '858', 'Uruguay',              'Uruguay',              '+598', 'UYU'),
    ('PY', 'PRY', '600', 'Paraguay',             'Paraguay',             '+595', 'PYG'),
    ('BR', 'BRA', '076', 'Brazil',               'Brasil',               '+55',  'BRL'),
    -- Europa
    ('ES', 'ESP', '724', 'Spain',                'España',               '+34',  'EUR'),
    ('PT', 'PRT', '620', 'Portugal',             'Portugal',             '+351', 'EUR'),
    ('FR', 'FRA', '250', 'France',               'Francia',              '+33',  'EUR'),
    ('DE', 'DEU', '276', 'Germany',              'Alemania',             '+49',  'EUR'),
    ('IT', 'ITA', '380', 'Italy',                'Italia',               '+39',  'EUR'),
    ('NL', 'NLD', '528', 'Netherlands',          'Países Bajos',         '+31',  'EUR'),
    ('GB', 'GBR', '826', 'United Kingdom',       'Reino Unido',          '+44',  'GBP'),
    -- Asia
    ('CN', 'CHN', '156', 'China',                'China',                '+86',  'CNY'),
    ('JP', 'JPN', '392', 'Japan',                'Japón',                '+81',  'JPY'),
    ('KR', 'KOR', '410', 'Korea, Republic of',   'Corea del Sur',        '+82',  'KRW'),
    ('IN', 'IND', '356', 'India',                'India',                '+91',  'INR'),
    ('SG', 'SGP', '702', 'Singapore',            'Singapur',             '+65',  'SGD')
ON CONFLICT (iso_code) DO NOTHING;


-- ── 7. Verificación interna ────────────────────────────────────────────────
-- La migración se niega a terminar si la semilla quedó incompleta.
DO $$
DECLARE
    v_cur int;
    v_cou int;
BEGIN
    SELECT count(*) INTO v_cur FROM public.currencies;
    SELECT count(*) INTO v_cou FROM public.countries;
    IF v_cur < 29 THEN
        RAISE EXCEPTION 'Semilla de monedas incompleta: % de 29', v_cur;
    END IF;
    IF v_cou < 37 THEN
        RAISE EXCEPTION 'Semilla de paises incompleta: % de 37', v_cou;
    END IF;
END
$$;
