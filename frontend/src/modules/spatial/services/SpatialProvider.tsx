/**
 * PROVIDER DEL REPOSITORIO SPATIAL
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MECANISMO DEV / PRODUCCION
 *
 * En desarrollo (VITE_SPATIAL_BACKEND !== 'true'):
 *   Se usa DevSpatialRepository con datos locales.
 *   El banner "DATOS DE DESARROLLO" es visible en la TopBar.
 *
 * En produccion (o con VITE_SPATIAL_BACKEND === 'true'):
 *   Se usa ApiSpatialRepository.
 *   Si el backend no responde, la pantalla muestra un error explicito.
 *   NUNCA se mezclan datos simulados con reales.
 *
 * La variable VITE_SPATIAL_BACKEND se añade al .env.local cuando Claude
 * entregue los endpoints. Hasta entonces, el frontend funciona con el
 * adaptador temporal.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { env } from '../../../lib/env';
import { ApiSpatialRepository } from '../repositories/ApiSpatialRepository';
import { DevSpatialRepository } from '../repositories/DevSpatialRepository';
import type { SpatialRepository } from '../repositories/SpatialRepository';

const SpatialRepoContext = createContext<SpatialRepository | null>(null);

/**
 * `true` cuando el backend spatial esta disponible.
 *
 * Se lee de import.meta.env en lugar de `env.ts` para no contaminar el
 * objeto de entorno global con una flag temporal de modulo.
 */
const SPATIAL_BACKEND_READY =
  import.meta.env.VITE_SPATIAL_BACKEND === 'true' || env.isProduction;

export function SpatialProvider({ children }: { children: ReactNode }) {
  // En produccion SIEMPRE se usa el adaptador real. Si el backend no esta
  // listo, las queries fallaran y la pantalla mostrara el error state.
  // Nunca se caera silenciosamente a datos falsos.
  const auth = SPATIAL_BACKEND_READY ? useAuthSafe() : null;

  const repo = useMemo<SpatialRepository>(() => {
    if (SPATIAL_BACKEND_READY) {
      if (!auth) {
        // Esto no deberia pasar: si estamos en produccion, AuthProvider
        // ya envolvio todo. Pero si pasa, fallamos fuerte.
        throw new Error(
          '[Spatial] Modo produccion activo pero no hay ApiClient disponible. ' +
          'Asegurate de que SpatialProvider este dentro de AuthProvider.',
        );
      }
      return new ApiSpatialRepository(auth);
    }

    // ──────────────────────────────────────────────────────────────────
    // DEV ONLY — datos locales. No puede llegar a produccion.
    // ──────────────────────────────────────────────────────────────────
    if (env.isProduction) {
      throw new Error(
        '[Spatial] DevSpatialRepository activado en produccion. Esto es un error de configuracion. ' +
        'Configura VITE_SPATIAL_BACKEND=true o implementa los endpoints del backend.',
      );
    }
    return new DevSpatialRepository();
  }, [auth]);

  return (
    <SpatialRepoContext.Provider value={repo}>
      {children}
    </SpatialRepoContext.Provider>
  );
}

export function useSpatialRepo(): SpatialRepository {
  const ctx = useContext(SpatialRepoContext);
  if (!ctx) throw new Error('useSpatialRepo debe usarse dentro de SpatialProvider');
  return ctx;
}

/**
 * Wrapper que obtiene el ApiClient de forma segura.
 * Separado para que el hook se llame incondicionalmente (regla de hooks).
 */
function useAuthSafe() {
  try {
    const { api } = useAuth();
    return api;
  } catch {
    return null;
  }
}
