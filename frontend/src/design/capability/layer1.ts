/**
 * REGISTRO DE RENDERIZADORES — CAPA 1
 *
 * React + Tailwind + Framer Motion + SVG. Sin Canvas, sin WebGL, sin Three.
 *
 * Cuando llegue la Capa 2 se creara `layer2.ts` con sus renderizadores y se
 * concatenara a este array. Ningun componente consumidor cambia: el registro
 * resuelve siempre la capa mas alta disponible.
 */

import type { RendererEntry } from './types';
import { VisualLayer } from './types';
import { MeshSvg } from '../foundation/mesh/MeshSvg';
import { TwinSurface } from '../foundation/twin/TwinSurface';

export const layer1Renderers: readonly RendererEntry<never>[] = [
  {
    kind: 'mesh',
    layer: VisualLayer.SVG,
    label: 'Mesh · SVG',
    component: MeshSvg as never,
  },
  {
    // Ya NO es un placeholder. El Twin de Capa 1 es una escena isometrica que
    // emite luz, respira y tiene trafico. Cuando llegue el Twin 3D (Capa 5) se
    // registra por encima y este pasa a ser el fallback.
    kind: 'twin',
    layer: VisualLayer.SVG,
    label: 'Twin · SVG isometrico',
    component: TwinSurface as never,
  },
];
