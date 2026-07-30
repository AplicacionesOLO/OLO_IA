/**
 * SELECTION LAYER — halo y borde de nodos seleccionados.
 */

import type { Layer, LayerContext } from './types';

export class SelectionLayer implements Layer {
  readonly name = 'selection';
  readonly order = 30;
  enabled = true;

  render({ ctx, viewport, nodes, selectedIds }: LayerContext) {
    if (!this.enabled || selectedIds.size === 0) return;

    const lineW = 2 / viewport.zoom;

    for (const node of nodes) {
      if (!selectedIds.has(node.id)) continue;

      // Glow
      ctx.shadowColor = '#22d9f5';
      ctx.shadowBlur = 12 / viewport.zoom;
      ctx.strokeStyle = '#22d9f5';
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.rect(node.x - lineW, node.y - lineW, node.w + lineW * 2, node.h + lineW * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}
