/**
 * HIGHLIGHTS LAYER — resaltado temporal de nodos (hover, busqueda).
 */

import type { Layer, LayerContext } from './types';

export class HighlightsLayer implements Layer {
  readonly name = 'highlights';
  readonly order = 20;
  enabled = true;

  render({ ctx, viewport, nodes, hoveredId }: LayerContext) {
    if (!this.enabled || !hoveredId) return;

    for (const node of nodes) {
      if (node.id !== hoveredId) continue;

      const lineW = 1.5 / viewport.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.rect(node.x, node.y, node.w, node.h);
      ctx.stroke();
      break;
    }
  }
}
