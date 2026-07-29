/**
 * COMPOSICION DE PROVIDERS
 *
 * El orden importa y no es arbitrario:
 *
 *   LayerProvider      capacidades visuales — nadie depende de el para existir
 *     QueryProvider    cache de servidor
 *       AuthProvider   necesita el ApiClient, que necesita la config
 *         FocusProvider          coherencia neuronal
 *           SystemStateProvider  provee el reloj ambiental
 *             AppRouter          consume el estado de sesion
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { LayerProvider } from './design/capability/LayerContext';
import { layer1Renderers } from './design/capability/layer1';
import { FocusProvider } from './design/foundation/FocusContext';
import { AuthProvider } from './auth/AuthProvider';
import { SystemStateProvider } from './shell/SystemStateProvider';
import { AppRouter } from './router';
import { env } from './lib/env';
import { ApiError, isTerminal } from './lib/apiErrors';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (attempt, error) => {
          // No se reintenta lo que no tiene arreglo: un 403 o un 404 no cambian
          // por insistir, y reintentarlos solo retrasa el mensaje de error.
          if (error instanceof ApiError && isTerminal(error)) return false;
          return attempt < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function App() {
  const queryClient = useMemo(createQueryClient, []);

  return (
    <LayerProvider renderers={layer1Renderers} maxLayer={env.visualLayer}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FocusProvider>
            <SystemStateProvider>
              <AppRouter />
            </SystemStateProvider>
          </FocusProvider>
        </AuthProvider>
      </QueryClientProvider>
    </LayerProvider>
  );
}
