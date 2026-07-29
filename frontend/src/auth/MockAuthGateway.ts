/**
 * IMPLEMENTACION MOCK
 *
 * Permite desarrollar toda la interfaz sin credenciales de Supabase. Fabrica un
 * JWT con la MISMA forma que produce el Auth Hook real, para que el resto de la
 * aplicacion no distinga.
 *
 * ⚠ Solo se activa con VITE_AUTH_MODE=mock, o cuando VITE_SUPABASE_URL esta
 * vacia. Nunca en produccion: `main.tsx` lo verifica al arrancar.
 */

import { AuthError, type AuthGateway, type AuthTokens } from './AuthGateway';

const STORAGE_KEY = 'olo.mock.session';

/** Credenciales especiales para probar los caminos de error sin backend. */
const NO_MEMBERSHIP_EMAIL = 'sin-membresia@olo.test';

function base64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const utf8 = new TextEncoder().encode(json);
  let bin = '';
  utf8.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintToken(email: string): AuthTokens {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  // Reproduce fielmente el fail-secure del Hook: sin membresia, sin tenant_id.
  const withMembership = email !== NO_MEMBERSHIP_EMAIL;

  const payload = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'authenticated',
    aud: 'authenticated',
    email,
    iat: now,
    exp: expiresAt,
    app_metadata: withMembership
      ? {
          tenant_id: '22222222-2222-4222-8222-222222222222',
          tenant_wide_access: true,
        }
      : {},
  };

  const token = [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url(payload),
    'mock-signature-not-verifiable',
  ].join('.');

  return { accessToken: token, refreshToken: `mock-refresh-${now}`, expiresAt };
}

export class MockAuthGateway implements AuthGateway {
  readonly mode = 'mock' as const;
  private listeners = new Set<(t: AuthTokens | null) => void>();

  async signIn(email: string, password: string): Promise<AuthTokens> {
    // Latencia simulada: sin ella, los estados de carga no se pueden evaluar y
    // la interfaz se diseña sobre una suposicion falsa de instantaneidad.
    await new Promise((r) => setTimeout(r, 620));

    if (!email.includes('@')) {
      throw new AuthError('Introduce un correo valido', 'INVALID_CREDENTIALS');
    }
    if (password.length < 4) {
      throw new AuthError('Credenciales incorrectas', 'INVALID_CREDENTIALS');
    }

    const tokens = mintToken(email);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    this.listeners.forEach((fn) => fn(tokens));
    return tokens;
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    this.listeners.forEach((fn) => fn(null));
  }

  async restore(): Promise<AuthTokens | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const tokens = JSON.parse(raw) as AuthTokens;
      if (tokens.expiresAt * 1000 < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return tokens;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  async refresh(): Promise<AuthTokens | null> {
    const current = await this.restore();
    if (!current) return null;
    const claims = JSON.parse(atob(current.accessToken.split('.')[1] ?? '') || '{}') as {
      email?: string;
    };
    const tokens = mintToken(claims.email ?? 'dev@olo.test');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    return tokens;
  }

  async requestPasswordReset(): Promise<void> {
    await new Promise((r) => setTimeout(r, 400));
  }

  onSessionChange(fn: (t: AuthTokens | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
