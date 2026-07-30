/**
 * LAYER CONTRACT — interfaz que toda capa del renderer implementa.
 *
 * Cada capa dibuja un aspecto distinto del mapa:
 *   - GridLayer: la retícula de fondo
 *   - NodesLayer: las celdas de ubicacion con color y opacidad
 *   - SelectionLayer: el halo y borde de los nodos seleccionados
 *   - LabelsLayer: los códigos de ubicacion (solo a zoom suficiente)
 *   - HighlightsLayer: resaltado temporal (hover, búsqueda, inferencia)
 *
 * Futuras capas (no implementadas todavía):
 *   - HeatmapLayer: mapa de calor de ocupacion
 *   - FlowLayer: rutas de AGV
 *   - DevicesLayer: posiciones de sensores/camaras
 *   - AnnotationsLayer: marcas del operador
 */

import type { LayoutNode } from '../LayoutEngine';
import type { Viewport } from '../Viewport';

export interface LayerContext {
  ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  nodes: LayoutNode[];
  dpr: number;
  /** IDs seleccionados. */
  selectedIds: Set<string>;
  /** ID bajo el cursor. */
  hoveredId: string | null;
  /** Timestamp del frame (para animaciones). */
  time: number;
}

export interface Layer {
  /** Nombre para debugging y el panel de capas. */
  readonly name: string;
  /** Orden de dibujo (menor = primero = mas atras). */
  readonly order: number;
  /** Si la capa esta habilitada. */
  enabled: boolean;
  /** Dibujar un frame. */
  render(lctx: LayerContext): void;
}
