/**
 * PERFIL MOCK — la segunda mitad del modo mock.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * El modo mock cubria solo la IDENTIDAD (el JWT). La AUTORIZACION seguia
 * pidiendose por HTTP a `/v1/auth/me`, asi que sin el backend arrancado el login
 * terminaba en la pantalla de error: identidad valida, perfil inalcanzable.
 *
 * Eso dejaba el modo mock a medias y rompia su proposito, que es poder
 * desarrollar toda la interfaz mientras el backend se construye en paralelo.
 *
 * Este fixture reproduce la forma EXACTA de `MeOut` del backend
 * (api/v1/schemas.py). Si el contrato cambia alli, aqui falla el tipo.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { MeProfile } from './sessionStore';

/** UUIDs fijos: la sesion mock es reproducible entre recargas. */
const MOCK_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_USER_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_COMPANY_ID = '44444444-4444-4444-8444-444444444444';

export const MOCK_WAREHOUSE_IDS = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
] as const;

/**
 * Permisos con comodin por modulo.
 *
 * `hasPermission` resuelve `inventory:*` para cualquier accion de inventario, asi
 * que el mock concede acceso amplio sin enumerar 40 permisos. Es adecuado para
 * desarrollo de interfaz: se quiere ver TODA la navegacion.
 *
 * ⚠ Esto NO afloja ninguna seguridad real: en modo supabase los permisos vienen
 * del backend, y toda accion se valida ahi y en RLS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL MENU ES MAS CORTO EN MODO SUPABASE. ES CORRECTO, NO UN FALLO.
 *
 * El catalogo real (`core.permissions`, migracion 0013) tiene 30 permisos y NO
 * incluye siete familias que si estan aqui. Marcadas abajo con FUTURO.
 *
 * Consecuencia concreta: un `tenant_admin` con los 30 permisos reales —o sea,
 * con todo lo que existe— ve 7 entradas de menu, mientras el mock muestra 12.
 * Faltan Vision (`inference:read`), Flota (`drones:read`), Inteligencia
 * (`ai_models:read`) e Integraciones (`integrations:read`), mas Digital Twin,
 * que se oculta por otra razon: `availableFromLayer: 2` con VITE_VISUAL_LAYER=1.
 *
 * Ninguno de esos modulos tiene ruta, tabla ni endpoint todavia: `router.tsx`
 * solo define `/`, y el resto cae en el catch-all. Ocultarlos describe el
 * estado real del producto; mostrarlos ofreceria caminos que no llevan a ningun
 * sitio.
 *
 * Cuando esos modulos existan, hay que añadir sus permisos al catalogo con una
 * migracion. Hasta entonces esta divergencia es deliberada y esta medida.
 * ─────────────────────────────────────────────────────────────────────────
 */
const MOCK_PERMISSIONS = [
  // Existen en el catalogo real
  'dashboard:*',
  'warehouses:*',
  'companies:*',
  'users:*',
  'roles:*',
  'inventory:*',
  'products:*',
  'reports:*',
  'audit:*',
  'settings:*',
  // Faltan en el catalogo real: areas:* y locations:* SI existen en la base
  // pero no los pedia ningun item de navegacion, asi que se añaden por
  // coherencia con `MeOut`.
  'areas:*',
  'locations:*',
  // FUTURO — no existen en core.permissions. Ver la nota de arriba.
  'ai_models:*',
  'datasets:*',
  'inference:*',
  'training:*',
  'drones:*',
  'missions:*',
  'integrations:*',
];

export function buildMockProfile(email: string): MeProfile {
  // Se derivan nombre y apellido del correo para que la interfaz muestre algo
  // coherente en las iniciales del avatar.
  const local = email.split('@')[0] ?? 'dev';
  const parts = local.split(/[._-]/).filter(Boolean);
  const firstName = capitalize(parts[0] ?? 'Dev');
  const lastName = capitalize(parts[1] ?? 'Local');

  return {
    id: MOCK_USER_ID,
    email,
    first_name: firstName,
    last_name: lastName,
    locale: 'es',
    timezone: 'America/Costa_Rica',
    status: 'active',
    tenant: {
      id: MOCK_TENANT_ID,
      name: 'Entorno local',
      slug: 'entorno-local',
      status: 'active',
      plan: 'enterprise',
    },
    roles: [
      { name: 'tenant_admin', scope_type: 'global' },
      { name: 'warehouse_manager', scope_type: 'company', scope_company_id: MOCK_COMPANY_ID },
    ],
    permissions: MOCK_PERMISSIONS,
    accessible_warehouse_ids: [...MOCK_WAREHOUSE_IDS],
    tenant_wide_access: true,
    // En mock se concede: el modo existe para poder desarrollar toda la interfaz
    // sin backend, y ocultar el modulo de plataforma lo dejaria inalcanzable.
    is_platform_owner: true,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
