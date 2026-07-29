/**
 * AUTHPROVIDER
 *
 * Compone el AuthGateway con el ApiClient y orquesta el flujo de dos fases:
 *   1. Supabase Auth  → identidad (JWT)
 *   2. GET /v1/auth/me → autorizacion (permisos, almacenes, tenant)
 *
 * El ApiClient se construye UNA vez y lee el token de una ref. Si se
 * reconstruyera en cada cambio de token, React Query invalidaria toda su cache
 * en cada refresco: un parpadeo completo de la aplicacion cada hora.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { decodeClaims, type AuthGateway, type AuthTokens } from './AuthGateway';
import { MockAuthGateway } from './MockAuthGateway';
import { SupabaseAuthGateway } from './SupabaseAuthGateway';
import { useSessionStore, type MeProfile } from './sessionStore';
import { buildMockProfile } from './mockProfile';
import { ApiClient } from '../lib/apiClient';
import { ApiError } from '../lib/apiErrors';
import { env } from '../lib/env';

interface AuthContextValue {
  gateway: AuthGateway;
  api: ApiClient;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Reintenta obtener el perfil. Para el caso no-membership. */
  retryProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildGateway(): AuthGateway {
  if (env.authMode === 'supabase' && env.supabaseUrl && env.supabaseAnonKey) {
    return new SupabaseAuthGateway(env.supabaseUrl, env.supabaseAnonKey);
  }
  if (import.meta.env.DEV) {
    console.info(
      '[OLO/auth] Modo MOCK. Cualquier credencial con un @ y 4+ caracteres entra.\n' +
        '           Usa sin-membresia@olo.test para probar el caso NO_ACTIVE_MEMBERSHIP.',
    );
  }
  return new MockAuthGateway();
}

/**
 * Singleton de modulo, NO `useMemo`.
 *
 * Estaba como `useMemo(createGateway, [])`, y `useMemo` no garantiza una sola
 * instancia: React puede descartar el valor memorizado, y con `StrictMode`
 * —activo en `main.tsx`— el componente monta dos veces en desarrollo. Resultado
 * medido en la consola del navegador:
 *
 *   "Multiple GoTrueClient instances detected in the same browser context.
 *    (…) may produce undefined behavior when used concurrently under the same
 *    storage key."
 *
 * Dos clientes de Supabase compartiendo clave de almacenamiento se pisan al
 * rotar el refresh token, y esa clase de fallo aparece como un cierre de sesion
 * aleatorio una hora despues, imposible de reproducir a voluntad.
 *
 * El cliente de Supabase es un recurso de proceso, no de componente: su sitio es
 * el ambito del modulo. Perezoso para que `env` ya este validado al construirlo.
 */
let gatewaySingleton: AuthGateway | null = null;

function getGateway(): AuthGateway {
  gatewaySingleton ??= buildGateway();
  return gatewaySingleton;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useSessionStore;
  const gateway = getGateway();

  // El token vive en una ref para que el ApiClient sea estable.
  const tokenRef = useRef<string | null>(null);
  const warehouseRef = useRef<string | null>(null);

  // Se sincronizan las refs con el store sin provocar re-renders del provider.
  useEffect(() => {
    const unsub = store.subscribe((s) => {
      tokenRef.current = s.tokens?.accessToken ?? null;
      warehouseRef.current = s.activeWarehouseId;
    });
    const initial = store.getState();
    tokenRef.current = initial.tokens?.accessToken ?? null;
    warehouseRef.current = initial.activeWarehouseId;
    return unsub;
  }, [store]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: `${env.apiUrl}/v1`,
        getAccessToken: () => tokenRef.current,
        getWarehouseId: () => warehouseRef.current,
        onRefreshNeeded: async () => {
          const fresh = await gateway.refresh();
          if (!fresh) return null;
          store.getState().setTokens(fresh, decodeClaims(fresh.accessToken));
          tokenRef.current = fresh.accessToken;
          return fresh.accessToken;
        },
        onSessionLost: () => {
          store.getState().clear();
        },
      }),
    [gateway, store],
  );

  /**
   * Fase 2: obtener el perfil.
   *
   * Aqui se distingue el 403 NO_ACTIVE_MEMBERSHIP de cualquier otro fallo. Esa
   * distincion es lo que evita mostrar una aplicacion vacia a un usuario cuyo
   * problema es administrativo y tiene solucion conocida.
   */
  const loadProfile = useCallback(async () => {
    // ── Modo mock: el perfil tambien es mock ────────────────────────────
    // Sin esto, el modo mock quedaba a medias: fabricaba la identidad pero
    // pedia la autorizacion por HTTP, asi que sin el backend arrancado el
    // login terminaba en la pantalla de error.
    if (gateway.mode === 'mock') {
      const email = store.getState().claims?.email ?? 'dev@olo.test';
      store.getState().setProfile(buildMockProfile(email));
      return;
    }

    try {
      const profile = await api.get<MeProfile>('/auth/me');
      store.getState().setProfile(profile);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'NO_ACTIVE_MEMBERSHIP') {
          store.getState().setNoMembership();
          return;
        }
        if (error.status === 401) {
          store.getState().clear();
          return;
        }
        store.getState().setError(error.message);
        return;
      }
      store.getState().setError('No se pudo cargar el perfil');
    }
  }, [api, store, gateway]);

  const applyTokens = useCallback(
    async (tokens: AuthTokens | null) => {
      if (!tokens) {
        store.getState().clear();
        return;
      }
      const claims = decodeClaims(tokens.accessToken);
      store.getState().setTokens(tokens, claims);
      tokenRef.current = tokens.accessToken;

      // Atajo: si el token no trae tenant_id, el Hook aplico su fail-secure y
      // /me va a responder 403. Se evita la peticion y se resuelve de inmediato.
      if (!claims?.tenantId) {
        store.getState().setNoMembership();
        return;
      }
      await loadProfile();
    },
    [loadProfile, store],
  );

  // ── Restauracion al arrancar ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const tokens = await gateway.restore();
      if (cancelled) return;
      if (!tokens) {
        store.getState().setStatus('anonymous');
        return;
      }
      store.getState().setStatus('authenticating');
      await applyTokens(tokens);
    })();

    // Cambios de sesion originados fuera: refresco automatico de Supabase, o
    // cierre de sesion en otra pestaña.
    const unsub = gateway.onSessionChange((tokens) => {
      if (cancelled) return;
      const current = store.getState();
      if (!tokens) {
        if (current.status !== 'anonymous') current.clear();
        return;
      }
      // Solo se recarga el perfil si el usuario cambio; un simple refresco de
      // token no debe disparar una peticion a /me.
      const sameUser = current.claims?.sub === decodeClaims(tokens.accessToken)?.sub;
      if (sameUser && current.status === 'active') {
        current.setTokens(tokens, decodeClaims(tokens.accessToken));
        tokenRef.current = tokens.accessToken;
        return;
      }
      void applyTokens(tokens);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [gateway, applyTokens, store]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      store.getState().setStatus('authenticating');
      try {
        const tokens = await gateway.signIn(email, password);
        await applyTokens(tokens);
      } catch (error) {
        store.getState().setStatus('anonymous');
        throw error;
      }
    },
    [gateway, applyTokens, store],
  );

  const signOut = useCallback(async () => {
    await gateway.signOut();
    store.getState().clear();
  }, [gateway, store]);

  const value = useMemo<AuthContextValue>(
    () => ({ gateway, api, signIn, signOut, retryProfile: loadProfile }),
    [gateway, api, signIn, signOut, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
