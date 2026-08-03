/**
 * PROVIDER DEL MODULO SPATIAL
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE CAMBIA RESPECTO A LA VERSION ANTERIOR
 *
 * Antes habia un booleano, `VITE_SPATIAL_BACKEND`, que elegia entre el adaptador
 * real y datos simulados. Eso ya no aplica por dos motivos:
 *
 *   1. El backend EXISTE y sirve el catalogo real. `DevSpatialRepository` ya no
 *      es «el adaptador mientras no haya backend»: seria datos falsos junto a
 *      datos verdaderos, que es la unica combinacion peor que no tener datos.
 *
 *   2. El backend no lo sirve TODO, y no por falta de trabajo: no hay geometria
 *      metrica ni ocupacion porque esos datos no existen en la base. Un booleano
 *      global no puede expresar eso; las capacidades si.
 *
 * Asi que aqui siempre se usa el adaptador real, y lo que decide si una pantalla
 * puede pintarse es `useSpatialCapabilities()`, no un modo de ejecucion.
 *
 * `DevSpatialRepository` y `dev-data/` estan ELIMINADOS, no solo desconectados:
 * un adaptador de datos falsos que sigue en el arbol es un adaptador que alguien
 * vuelve a enchufar el dia que el backend falle, y ese es justo el dia en que hay
 * que ver el fallo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuth } from '../../../auth/AuthProvider';
import {
  resolveCapabilities,
  type SpatialCapabilities,
} from '../capabilities';
import { ApiSpatialRepository } from '../repositories/ApiSpatialRepository';
import { LocalLayoutRepository } from '../repositories/LocalLayoutRepository';
import type { LayoutRepository } from '../repositories/LayoutRepository';
import type { SpatialRepository } from '../repositories/SpatialRepository';

interface SpatialContextValue {
  /** LO QUE ES: estructura y catalogo, del backend, con RLS. */
  spatial: SpatialRepository;
  /** COMO SE VE: plano, calibracion, posiciones. Local, del operador. */
  layout: LayoutRepository;
  capabilities: SpatialCapabilities;
}

const SpatialContext = createContext<SpatialContextValue | null>(null);

export function SpatialProvider({ children }: { children: ReactNode }) {
  // El hook se llama SIEMPRE, sin condicion. La version anterior hacia
  // `FLAG ? useAuthSafe() : null`, que viola las reglas de hooks: funcionaba solo
  // porque la flag era una constante de modulo y nunca cambiaba entre renders.
  const { api } = useAuth();

  const value = useMemo<SpatialContextValue>(
    () => ({
      spatial: new ApiSpatialRepository(api),
      layout: new LocalLayoutRepository(),
      capabilities: resolveCapabilities(),
    }),
    [api],
  );

  return <SpatialContext.Provider value={value}>{children}</SpatialContext.Provider>;
}

function useSpatialContext(): SpatialContextValue {
  const ctx = useContext(SpatialContext);
  if (!ctx) {
    throw new Error(
      'Los hooks de spatial deben usarse dentro de <SpatialProvider>, y este ' +
        'dentro de <AuthProvider>.',
    );
  }
  return ctx;
}

export function useSpatialRepo(): SpatialRepository {
  return useSpatialContext().spatial;
}

export function useLayoutRepo(): LayoutRepository {
  return useSpatialContext().layout;
}

/**
 * Que puede servir el backend, capacidad por capacidad.
 *
 * Se consulta por capacidad concreta —`caps.floorGeometry`— y no por un modo
 * global, para que una pantalla que necesita el catalogo funcione aunque la
 * geometria no exista.
 */
export function useSpatialCapabilities(): SpatialCapabilities {
  return useSpatialContext().capabilities;
}
