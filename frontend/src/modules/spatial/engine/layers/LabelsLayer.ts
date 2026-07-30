/**
 * LABELS LAYER — códigos de ubicación visibles a zoom suficiente.
 */

import type { Layer, LayerContext } from './types';

export class LabelsLayer implements Layer {
  readonly name = 'labels';
  readonly order = 40;
  enabled = true;

  render({ ctx, viewport, nodes }: LayerContext) {
    if (!this.enabled) return;
    if (viewport.zoom < 0.8) return; // No labels at low zoom

    const vr = viewport.getVisibleWorldRect();
    const showDetail = viewport.zoom > 1.5;
    const fontSize = Math.max(8, Math.min(11, 10 / viewport.zoom));

    ctx.font = `${fontSize}px "JetBrains Mono Variable", monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const node of nodes) {
      if (node.x + node.w < vr.minX || node.x > vr.maxX ||
          node.y + node.h < vr.minY || node.y > vr.maxY) continue;

      const label = shortCode(node.location.code);
      const hasPct = node.location.capacity > 0 && node.location.occupied > 0;
      ctx.fillText(label, node.x + node.w / 2, node.y + node.h / 2 - (hasPct ? 4 : 0));

      if (showDetail && hasPct) {
        const pct = Math.round((node.location.occupied / node.location.capacity) * 100);
        const detailSize = 7 / viewport.zoom;
        ctx.font = `${detailSize}px "JetBrains Mono Variable", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`${pct}%`, node.x + node.w / 2, node.y + node.h / 2 + 8);
        ctx.font = `${fontSize}px "JetBrains Mono Variable", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
      }
    }
  }
}

function shortCode(code: string): string {
  const parts = code.split('-');
  if (parts.length >= 4) return parts.slice(-2).join('-');
  if (parts.length >= 3) return parts.slice(-2).join('-');
  return code;
}
