/**
 * MESHLAYER — orquestador de la red neuronal.
 *
 * Resuelve el renderizador de capa mas alta disponible y le pasa el modelo.
 * En Capa 1 obtiene MeshSvg; cuando exista MeshCanvas (Capa 2) obtendra ese sin
 * que este archivo cambie.
 *
 * Vive en el shell y persiste entre vistas: la Mesh nunca se desmonta, solo
 * cambia de densidad y opacidad. Es lo que hace que la sensacion de "sistema
 * continuo" se mantenga al navegar.
 */

import { useRenderer } from '../../capability/LayerContext';
import type { MeshDensity, MeshPulse, MeshRendererProps } from './types';
import { MeshSvg } from './MeshSvg';

/** Presets por contexto. La Mesh cede protagonismo donde hay contenido denso. */
export const MESH_PRESETS = {
  login: { density: 'full' as MeshDensity, opacity: 0.85 },
  overview: { density: 'high' as MeshDensity, opacity: 0.28 },
  immersive: { density: 'low' as MeshDensity, opacity: 0.12 },
  focus: { density: 'medium' as MeshDensity, opacity: 0.18 },
  dense: { density: 'minimal' as MeshDensity, opacity: 0.08 },
} as const;

export type MeshPreset = keyof typeof MESH_PRESETS;

interface MeshLayerProps {
  preset: MeshPreset;
  pulses?: readonly MeshPulse[];
  reducedMotion?: boolean;
  className?: string;
}

export function MeshLayer({ preset, pulses, reducedMotion, className }: MeshLayerProps) {
  const Renderer = useRenderer<MeshRendererProps>('mesh');
  const { density, opacity } = MESH_PRESETS[preset];

  // Si nadie registro un renderizador de mesh, se usa el de SVG directamente.
  // Es el fallback de ultimo recurso: la aplicacion nunca se queda sin fondo.
  const Component = Renderer ?? MeshSvg;

  return (
    <Component
      density={density}
      opacity={opacity}
      {...(pulses ? { pulses } : {})}
      {...(reducedMotion !== undefined ? { reducedMotion } : {})}
      {...(className ? { className } : {})}
    />
  );
}
