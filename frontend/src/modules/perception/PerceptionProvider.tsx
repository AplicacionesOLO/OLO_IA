/**
 * PERCEPTION PROVIDER — inyecta el repositorio.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DevPerceptionRepository } from './DevPerceptionRepository';
import type { PerceptionRepository } from './repository';

const Ctx = createContext<PerceptionRepository | null>(null);

export function PerceptionProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => new DevPerceptionRepository(), []);
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

export function usePerceptionRepo(): PerceptionRepository {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePerceptionRepo debe usarse dentro de PerceptionProvider');
  return ctx;
}
