/**
 * SPATIAL ENGINE — motor de renderizado 2D.
 *
 * Arquitectura:
 *   SpatialExplorer → Viewport → Renderer → Layers
 *                                              ├── GridLayer
 *                                              ├── NodesLayer
 *                                              ├── SelectionLayer
 *                                              ├── LabelsLayer
 *                                              └── HighlightsLayer
 *
 * Cada capa implementa Layer y se dibuja en orden. El renderer orquesta
 * el rAF loop y aplica la transformacion del viewport antes de cada capa.
 */

export { Viewport, ZOOM_MIN, ZOOM_MAX, type Vec2, type ViewportState, type ViewportBounds } from './Viewport';
export { computeLayout, type LayoutNode, type LayoutResult } from './LayoutEngine';
export { SpatialRenderer, type RenderOptions } from './Renderer';
export { Camera, type CameraState } from './Camera';
export { HitTester } from './HitTester';
export type { Layer, LayerContext } from './layers/types';
