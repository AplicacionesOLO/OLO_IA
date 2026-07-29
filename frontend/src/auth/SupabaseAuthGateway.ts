/**
 * IMPLEMENTACION REAL — Supabase Auth
 *
 * El login va DIRECTO a Supabase, no a traves del backend propio: el backend no
 * expone `/v1/auth/login`. Verificado en el codigo de `api/v1/auth.py`, que solo
 * tiene `/me`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuthError, type AuthGateway, type AuthTokens } from './AuthGateway';

function toTokens(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}): AuthTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    // `expires_at` es opcional en el tipo de Supabase; el fallback de una hora
    // evita tratar la sesion como caducada por un campo ausente.
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

export class SupabaseAuthGateway implements AuthGateway {
  readonly mode = 'supabase' as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: {
        // Supabase gestiona la persistencia y la rotacion del refresh token.
        // Reimplementarlo aqui seria duplicar logica de seguridad delicada.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'olo.auth',
      },
    });
  }

  async signIn(email: string, password: string): Promise<AuthTokens> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });

    if (error) {
      // Se normaliza el mensaje: los textos de Supabase son en ingles y
      // filtran detalles que no aportan al operador.
      if (error.status === 400) {
        throw new AuthError('Credenciales incorrectas', 'INVALID_CREDENTIALS');
      }
      if (error.status === 429) {
        throw new AuthError('Demasiados intentos. Espera un momento.', 'RATE_LIMITED');
      }
      throw new AuthError('No se pudo conectar con el servicio de identidad', 'NETWORK');
    }
    if (!data.session) {
      throw new AuthError('El servicio no devolvio una sesion', 'UNKNOWN');
    }

    return toTokens(data.session);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async restore(): Promise<AuthTokens | null> {
    const { data } = await this.client.auth.getSession();
    return data.session ? toTokens(data.session) : null;
  }

  async refresh(): Promise<AuthTokens | null> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error || !data.session) return null;
    return toTokens(data.session);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // No se propaga el error al usuario a proposito: revelar si un correo esta
    // registrado permite enumerar cuentas. El mensaje siempre es el mismo.
    if (error && import.meta.env.DEV) {
      console.warn('[OLO/auth] reset password:', error.message);
    }
  }

  onSessionChange(fn: (tokens: AuthTokens | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      fn(session ? toTokens(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }
}
