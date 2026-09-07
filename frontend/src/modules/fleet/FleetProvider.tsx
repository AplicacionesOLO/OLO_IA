/**
 * FLEET PROVIDER — inyecta el repositorio. Mismo patron que `PerceptionProvider`.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { ApiFleetRepository } from './ApiFleetRepository';
import type { FleetRepository } from './repository';

const Ctx = createContext<FleetRepository | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const repo = useMemo(() => new ApiFleetRepository(api), [api]);
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

export function useFleetRepo(): FleetRepository {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFleetRepo debe usarse dentro de FleetProvider');
  return ctx;
}
