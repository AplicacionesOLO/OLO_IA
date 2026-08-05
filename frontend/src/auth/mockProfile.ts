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
 * El catalogo real (`core.permissions`) no incluye todas las familias que si
 * estan aqui, asi que el mock ofrece mas entradas que un cliente real.
 *
 * ── MEDIDO CONTRA LA BASE, NO SUPUESTO ──────────────────────────────────
 *
 * Cruzando el permiso que pide cada entrada de `navigation.ts` con lo que el rol
 * `tenant_admin` tiene asignado de verdad:
 *
 *   Dashboard, Spatial, Inventario, Incidencias, Analytics,
 *   Configuracion, Auditoria, Vision ................. SI lo tiene
 *   Motor de IA (`ai_projects:read`) .................. no, y es correcto:
 *       todos sus endpoints son `PlatformOwnerRequired`. El taller de anotacion
 *       y entrenamiento es de la plataforma, no del cliente.
 *   Flota (`drones:read`), Integraciones (`integrations:read`) ... el permiso
 *       NO EXISTE en el catalogo todavia.
 *   Digital Twin ...................................... oculto por otra razon:
 *       `availableFromLayer: 2` con VITE_VISUAL_LAYER=1.
 *
 * ── LO QUE ESTE COMENTARIO DECIA Y YA NO ES CIERTO ──────────────────────
 *
 * Decia que Vision pedia `inference:read` y que «ninguno de esos modulos tiene
 * ruta, tabla ni endpoint todavia: router.tsx solo define `/`». Las dos cosas
 * dejaron de ser verdad:
 *
 *   · Vision pide `perception:read` desde 0069, que SI tiene los cinco roles.
 *     `inference:read` existe en el catalogo pero esta asignado a CERO roles, asi
 *     que mientras el menu lo pedia, ningun cliente veia el modulo —y sus
 *     endpoints, que piden otro permiso, funcionaban—.
 *   · hay rutas, tablas y endpoints reales para Spatial, Vision y Motor de IA.
 *
 * Un modulo que se hace real y no actualiza su entrada de menu queda escondido
 * detras de un permiso que nadie tiene. No hay error, solo una opcion que falta.
 *
 * Para los que siguen sin existir, ocultarlos describe el estado real del
 * producto; mostrarlos ofreceria caminos que no llevan a ningun sitio. Cuando
 * existan, hay que añadir sus permisos al catalogo con una migracion.
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
