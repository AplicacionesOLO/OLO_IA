/**
 * Capas visuales progresivas.
 *
 * REGLA DEL PRODUCTO: cada capa es una MEJORA, nunca un requisito.
 * La aplicacion es completamente funcional con solo la Capa 1 registrada.
 */

export const VisualLayer = {
  /** React + Tailwind + Framer Motion + SVG. */
  SVG: 1,
  /** + Canvas 2D. */
  CANVAS: 2,
  /** + React Three Fiber. */
  THREE: 3,
  /** + shaders y efectos avanzados. */
  SHADERS: 4,
  /** + Digital Twin tridimensional completo. */
  TWIN_3D: 5,
} as const;

export type VisualLayerValue = (typeof VisualLayer)[keyof typeof VisualLayer];

/**
 * Superficies con renderizador intercambiable.
 *
 * Un componente pide una superficie por nombre y recibe la mejor
 * implementacion disponible. Nunca importa la tecnologia.
 */
export type SurfaceKind =
  /** La red neuronal de fondo. SVG (L1) → Canvas (L2). */
  | 'mesh'
  /** El gemelo digital. Placeholder (L1) → 2D (L2) → 3D (L5). */
  | 'twin'
  /** La escena del login. SVG (L1) → R3F (L3). */
  | 'loginScene'
  /** Particulas ambientales. CSS (L1) → Canvas (L2). */
  | 'particles';

/** Un renderizador registrado para una superficie concreta. */
export interface RendererEntry<P = unknown> {
  kind: SurfaceKind;
  /** Capa a la que pertenece. Gana el de capa mas alta registrada. */
  layer: VisualLayerValue;
  /** Etiqueta legible, para el panel de diagnostico. */
  label: string;
  component: React.ComponentType<P>;
}
