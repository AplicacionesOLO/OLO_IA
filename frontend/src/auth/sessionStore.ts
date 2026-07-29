/**
 * ESTADO DE SESION
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA MAQUINA DE ESTADOS MODELA EL CASO QUE EL BACKEND HACE POSIBLE:
 * autenticado pero SIN autorizacion.
 *
 * El Auth Hook es fail-secure: si no hay membresia activa, el login TIENE EXITO
 * pero el token no lleva tenant_id. Entonces /v1/auth/me responde 403
 * NO_ACTIVE_MEMBERSHIP.
 *
 * Si el estado fuera un booleano `isAuthenticated`, ese usuario veria una
 * aplicacion vacia sin explicacion. Con `no-membership` como estado propio, ve
 * una pantalla que le dice exactamente que hacer.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';
import type { AuthTokens, TokenClaims } from './AuthGateway';

/** Perfil devuelto por GET /v1/auth/me. Espejo exacto de MeOut del backend. */
export interface MeProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  locale: string;
  timezone: string;
  status: string;
  tenant: { id: string; name: string; slug: string; status: string; plan: string };
  roles: {
    name: string;
    scope_type: string;
    scope_company_id?: string | null;
    scope_warehouse_id?: string | null;
  }[];
  permissions: string[];
  accessible_warehouse_ids: string[];
  tenant_wide_access: boolean;
  /**
   * Administracion de plataforma, por encima de los tenants.
   *
   * El backend lo resuelve contra la base en CADA peticion, no desde el JWT, para
   * que revocarlo surta efecto de inmediato. Consecuencia para el cliente: este
   * valor puede cambiar entre dos llamadas a `/auth/me` sin que el token cambie,
   * asi que no se debe cachear mas alla del perfil.
   *
   * Cuando es `true`, `permissions` ya incluye los permisos de alcance
   * plataforma. Sigue ocultando por permiso, no por esta bandera.
   */
  is_platform_owner: boolean;
}

export type SessionStatus =
  /** Comprobando si hay sesion persistida. */
  | 'restoring'
  /** Sin sesion. */
  | 'anonymous'
  /** Credenciales validadas, esperando /me. */
  | 'authenticating'
  /** Sesion completa: identidad + autorizacion. */
  | 'active'
  /** Identidad valida, SIN membresia activa. El caso fail-secure del Hook. */
  | 'no-membership'
  /** Fallo al obtener el perfil por causa distinta a la membresia. */
  | 'error';

interface SessionState {
  status: SessionStatus;
  tokens: AuthTokens | null;
  claims: TokenClaims | null;
  profile: MeProfile | null;
  error: string | null;

  /** Almacen activo. Preferencia de filtrado, no credencial. */
  activeWarehouseId: string | null;

  setStatus: (s: SessionStatus) => void;
  setTokens: (t: AuthTokens | null, c: TokenClaims | null) => void;
  setProfile: (p: MeProfile) => void;
  setError: (message: string) => void;
  setNoMembership: () => void;
  setActiveWarehouse: (id: string | null) => void;
  clear: () => void;

  hasPermission: (permission: string) => boolean;
}

const WAREHOUSE_KEY = 'olo.activeWarehouse';

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'restoring',
  tokens: null,
  claims: null,
  profile: null,
  error: null,
  activeWarehouseId: localStorage.getItem(WAREHOUSE_KEY),

  setStatus: (status) => set({ status }),

  setTokens: (tokens, claims) => set({ tokens, claims }),

  setProfile: (profile) => {
    const current = get().activeWarehouseId;
    // Si el almacen guardado ya no es accesible, se descarta. Mantenerlo
    // produciria 403 WAREHOUSE_NOT_ACCESSIBLE en cada peticion.
    const stillValid = current && profile.accessible_warehouse_ids.includes(current);
    const next = stillValid ? current : (profile.accessible_warehouse_ids[0] ?? null);

    if (next) localStorage.setItem(WAREHOUSE_KEY, next);
    else localStorage.removeItem(WAREHOUSE_KEY);

    set({ profile, status: 'active', error: null, activeWarehouseId: next });
  },

  setError: (error) => set({ status: 'error', error }),

  setNoMembership: () => set({ status: 'no-membership', profile: null, error: null }),

  setActiveWarehouse: (id) => {
    if (id) localStorage.setItem(WAREHOUSE_KEY, id);
    else localStorage.removeItem(WAREHOUSE_KEY);
    set({ activeWarehouseId: id });
  },

  clear: () => {
    localStorage.removeItem(WAREHOUSE_KEY);
    set({
      status: 'anonymous',
      tokens: null,
      claims: null,
      profile: null,
      error: null,
      activeWarehouseId: null,
    });
  },

  /**
   * Los permisos vienen de /me, NUNCA del JWT.
   *
   * Es lo que hace que revocar un permiso surta efecto en la siguiente
   * peticion, sin esperar a que el token se refresque.
   *
   * ⚠ Esta comprobacion es solo para la INTERFAZ (ocultar botones). La
   * autorizacion real la aplica el backend y RLS. Un usuario que manipule el
   * store veria botones, y cada accion seria rechazada con 403.
   */
  hasPermission: (permission) => {
    const { profile } = get();
    if (!profile) return false;
    if (profile.permissions.includes(permission)) return true;
    // Comodin por modulo: "inventory:*" concede "inventory:write"
    const [module] = permission.split(':');
    return profile.permissions.includes(`${module}:*`);
  },
}));

/** Selectores estables, para no re-renderizar por cambios irrelevantes. */
export const selectStatus = (s: SessionState) => s.status;
export const selectProfile = (s: SessionState) => s.profile;
export const selectActiveWarehouse = (s: SessionState) => s.activeWarehouseId;
