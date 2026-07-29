/**
 * TWINSLOT — el hueco donde vive el gemelo digital.
 *
 * Resuelve el renderizador de capa mas alta disponible. Hoy devuelve
 * `TwinSurface` (SVG isometrico); cuando exista Twin2D (Capa 2) o Twin3D
 * (Capa 5), devolvera esos sin que este archivo ni sus consumidores cambien.
 *
 * El Dashboard consume SIEMPRE este componente, nunca una implementacion
 * concreta.
 */

import { useRenderer } from '../../capability/LayerContext';
import { TwinSurface } from './TwinSurface';
import { DEFAULT_TWIN_LAYERS, type TwinSurfaceProps } from './types';

export function TwinSlot(props: TwinSurfaceProps) {
  const Renderer = useRenderer<TwinSurfaceProps>('twin');
  // Fallback de ultimo recurso: si nadie registro nada, el Twin sigue existiendo.
  const Component = Renderer ?? TwinSurface;

  return <Component layers={DEFAULT_TWIN_LAYERS} camera="iso" {...props} />;
}
