/**
 * GRID LAYER — retícula de fondo.
 *
 * Dibuja líneas de referencia que escalan con el zoom. A zoom bajo muestra
 * divisiones gruesas; a zoom alto muestra subdivisiones. Da contexto espacial
 * sin competir con los nodos.
 */

import type { Layer, LayerContext } from './types';

export class GridLayer implements Layer {
  readonly name = 'grid';
  readonly order = 0;
  enabled = true;

  render({ ctx, viewport }: LayerContext) {
    if (!this.enabled) return;

    const vr = viewport.getVisibleWorldRect();
    const zoom = viewport.zoom;

    // Spacing adaptativo: a mas zoom, lineas mas finas
    const baseSpacing = zoom > 2 ? 20 : zoom > 1 ? 50 : zoom > 0.5 ? 100 : 200;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();

    // Verticales
    const startX = Math.floor(vr.minX / baseSpacing) * baseSpacing;
    for (let x = startX; x <= vr.maxX; x += baseSpacing) {
      ctx.moveTo(x, vr.minY);
      ctx.lineTo(x, vr.maxY);
    }

    // Horizontales
    const startY = Math.floor(vr.minY / baseSpacing) * baseSpacing;
    for (let y = startY; y <= vr.maxY; y += baseSpacing) {
      ctx.moveTo(vr.minX, y);
      ctx.lineTo(vr.maxX, y);
    }

    ctx.stroke();
  }
}
