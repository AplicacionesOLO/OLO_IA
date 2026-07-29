/**
 * REGISTRO DE RENDERIZADORES POR CAPACIDAD
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * Si un componente hace `import { Canvas } from '@react-three/fiber'`, la Capa 3
 * pasa a ser un requisito de build: sin esa dependencia el proyecto no compila.
 * Eso convierte una mejora opcional en un bloqueo.
 *
 * LA SOLUCION
 *
 * Cada capa REGISTRA sus renderizadores. El componente pide una superficie por
 * nombre y recibe la implementacion de capa mas alta que este registrada. Si no
 * hay ninguna de capa superior, usa la inferior. Nunca falla.
 *
 *     const Mesh = useRenderer('mesh');   // MeshSvg hoy, MeshCanvas mañana
 *
 * Añadir la Capa 2 es registrar un renderizador mas. Cero cambios en los
 * componentes que lo consumen.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  VisualLayer,
  type RendererEntry,
  type SurfaceKind,
  type VisualLayerValue,
} from './types';

interface LayerContextValue {
  /** Capa maxima permitida. Se puede forzar a la baja por configuracion. */
  maxLayer: VisualLayerValue;
  /** Resuelve el mejor renderizador disponible para una superficie. */
  resolve: <P>(kind: SurfaceKind) => React.ComponentType<P> | null;
  /** Capa efectiva de la superficie resuelta. Para diagnostico. */
  layerOf: (kind: SurfaceKind) => VisualLayerValue | null;
  /** Inventario completo, para el panel de diagnostico. */
  registry: readonly RendererEntry<never>[];
}

const LayerContext = createContext<LayerContextValue | null>(null);

interface LayerProviderProps {
  children: ReactNode;
  /**
   * Renderizadores disponibles. En Capa 1 solo llegan los de SVG; cuando
   * exista la Capa 2 se añaden aqui sin tocar nada mas.
   */
  renderers: readonly RendererEntry<never>[];
  /**
   * Techo de capa. Permite forzar una capa inferior para comparar rendimiento
   * sin desinstalar dependencias.
   */
  maxLayer?: VisualLayerValue;
}

export function LayerProvider({
  children,
  renderers,
  maxLayer = VisualLayer.TWIN_3D,
}: LayerProviderProps) {
  const value = useMemo<LayerContextValue>(() => {
    // Se indexa una sola vez: por cada superficie, el candidato de capa mas
    // alta que no supere el techo.
    const best = new Map<SurfaceKind, RendererEntry<never>>();

    for (const entry of renderers) {
      if (entry.layer > maxLayer) continue;
      const current = best.get(entry.kind);
      if (!current || entry.layer > current.layer) {
        best.set(entry.kind, entry);
      }
    }

    return {
      maxLayer,
      resolve: <P,>(kind: SurfaceKind) =>
        (best.get(kind)?.component as React.ComponentType<P> | undefined) ?? null,
      layerOf: (kind) => best.get(kind)?.layer ?? null,
      registry: renderers,
    };
  }, [renderers, maxLayer]);

  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>;
}

export function useLayers(): LayerContextValue {
  const ctx = useContext(LayerContext);
  if (!ctx) throw new Error('useLayers debe usarse dentro de LayerProvider');
  return ctx;
}

/**
 * Devuelve el mejor renderizador disponible para una superficie.
 *
 * Puede devolver `null` si nadie registro nada para esa superficie: el
 * consumidor debe tratarlo, y ese es precisamente el contrato que hace que una
 * capa ausente degrade en lugar de romper.
 */
export function useRenderer<P>(kind: SurfaceKind): React.ComponentType<P> | null {
  return useLayers().resolve<P>(kind);
}
