/**
 * PROVIDER DEL REPOSITORIO SPATIAL
 *
 * Inyecta la implementacion del repositorio via contexto. Hoy resuelve
 * DevSpatialRepository; cuando el backend este listo se cambia aqui y
 * ningun componente se entera.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SpatialRepository } from '../repositories/SpatialRepository';
import { DevSpatialRepository } from '../repositories/DevSpatialRepository';

const SpatialRepoContext = createContext<SpatialRepository | null>(null);

export function SpatialProvider({ children }: { children: ReactNode }) {
  // TODO: cuando exista ApiSpatialRepository, elegir segun env o feature flag.
  const repo = useMemo(() => new DevSpatialRepository(), []);

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
