/**
 * PUERTO DE AUTENTICACION
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE UN PUERTO Y NO USAR SUPABASE DIRECTAMENTE
 *
 * 1. Permite desarrollar la interfaz sin credenciales de Supabase. Sin esto, un
 *    diseñador o un desarrollador nuevo no puede arrancar el proyecto.
 * 2. Aisla el unico punto donde el frontend depende de Supabase. Si algun dia se
 *    migra a otro proveedor (el propio RISK_ANALYSIS lo contempla), se cambia
 *    una implementacion.
 * 3. Hace testeable el flujo completo sin red.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * FLUJO REAL, verificado contra el backend:
 *
 *   1. Frontend → Supabase Auth (signInWithPassword)
 *        El Auth Hook (migracion 0016) inyecta en app_metadata:
 *          tenant_id, tenant_wide_access
 *        FAIL-SECURE: sin membresia activa NO inyecta nada.
 *   2. Frontend recibe JWT + refresh token
 *   3. Frontend → GET /v1/auth/me con el JWT
 *        Devuelve perfil, tenant, roles, permissions, warehouses accesibles
 *
 * CONSECUENCIA: la sesion se compone de DOS fuentes. Un usuario puede estar
 * autenticado (paso 2) y sin autorizacion (paso 3 responde 403
 * NO_ACTIVE_MEMBERSHIP). El estado de sesion modela ese caso explicitamente.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch en segundos. */
  expiresAt: number;
}

/** Claims que el Auth Hook publica. Nada mas: el JWT es minimo por diseño. */
export interface TokenClaims {
  /** Identificador de Supabase Auth. NO es core.users.id. */
  sub: string;
  role: string;
  email?: string;
  /** Ausente cuando el usuario no tiene membresia activa (fail-secure). */
  tenantId?: string;
  tenantWideAccess: boolean;
}

export interface AuthGateway {
  readonly mode: 'mock' | 'supabase';
  signIn(email: string, password: string): Promise<AuthTokens>;
  signOut(): Promise<void>;
  /** Devuelve la sesion persistida al arrancar, o null. */
  restore(): Promise<AuthTokens | null>;
  refresh(): Promise<AuthTokens | null>;
  requestPasswordReset(email: string): Promise<void>;
  /** Notifica cambios de sesion originados fuera de la aplicacion. */
  onSessionChange(fn: (tokens: AuthTokens | null) => void): () => void;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_CREDENTIALS' | 'NETWORK' | 'RATE_LIMITED' | 'UNKNOWN',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Decodifica el payload del JWT SIN verificar la firma.
 *
 * ⚠ La verificacion la hace el backend contra el JWKS de Supabase. Aqui solo se
 * lee para poblar la interfaz. Nunca se toma una decision de seguridad con esto:
 * un JWT manipulado seria rechazado por el backend en la siguiente peticion.
 */
export function decodeClaims(accessToken: string): TokenClaims | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;

    // base64url → base64, con el padding que atob exige
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = JSON.parse(
      decodeURIComponent(
        atob(padded)
          .split('')
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join(''),
      ),
    ) as Record<string, unknown>;

    const appMeta = (json.app_metadata ?? {}) as Record<string, unknown>;
    const sub = typeof json.sub === 'string' ? json.sub : null;
    if (!sub) return null;

    return {
      sub,
      role: typeof json.role === 'string' ? json.role : 'authenticated',
      ...(typeof json.email === 'string' ? { email: json.email } : {}),
      ...(typeof appMeta.tenant_id === 'string' ? { tenantId: appMeta.tenant_id } : {}),
      tenantWideAccess: appMeta.tenant_wide_access === true,
    };
  } catch {
    return null;
  }
}
