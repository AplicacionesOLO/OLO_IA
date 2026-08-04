/**
 * PERCEPTION PROVIDER — inyecta el repositorio.
 *
 * Ya no hay adaptador de desarrollo que elegir: `DevPerceptionRepository` y
 * `dev-data.ts` se han borrado del árbol. Lo que se inyecta es la API real.
 *
 * ── POR QUÉ EL REPOSITORIO ES UN `useMemo` SOBRE `api` ──────────────────────
 *
 * Guarda estado: las object URLs de los medios elegidos en esta pestaña, para poder
 * reproducirlos mientras se navega entre el listado y el detalle. Recrearlo en cada
 * render las perdería, y el vídeo que se estaba mirando dejaría de verse al cambiar
 * de pantalla.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { ApiPerceptionRepository } from './ApiPerceptionRepository';
import type { PerceptionRepository } from './repository';

const Ctx = createContext<PerceptionRepository | null>(null);

export function PerceptionProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const repo = useMemo(() => new ApiPerceptionRepository(api), [api]);
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

export function usePerceptionRepo(): PerceptionRepository {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePerceptionRepo debe usarse dentro de PerceptionProvider');
  return ctx;
}
