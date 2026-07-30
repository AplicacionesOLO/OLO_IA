/**
 * NODES LAYER — dibuja las celdas de ubicacion.
 *
 * Color = estado, opacidad = ocupacion, micro-barra = capacidad.
 * Es la capa principal del mapa.
 */

import type { Layer, LayerContext } from './types';
import type { LocationStatus } from '../../types/index';

const STATUS_HEX: Record<LocationStatus, string> = {
  occupied: '#22d9f5',
  available: '#34e5b4',
  inferred: '#a78bfa',
  invalid: '#fb7185',
  reserved: '#fbbf24',
  blocked: '#64748b',
};

export class NodesLayer implements Layer {
  readonly name = 'nodes';
  readonly order = 10;
  enabled = true;

  render({ ctx, viewport, nodes }: LayerContext) {
    if (!this.enabled) return;

    const vr = viewport.getVisibleWorldRect();
    const pad = 20;

    for (const node of nodes) {
      // Culling
      if (
        node.x + node.w < vr.minX - pad ||
        node.x > vr.maxX + pad ||
        node.y + node.h < vr.minY - pad ||
        node.y > vr.maxY + pad
      ) continue;

      const color = STATUS_HEX[node.location.status];
      const pct = node.location.capacity > 0
        ? node.location.occupied / node.location.capacity
        : 0;
      const alpha = 0.15 + pct * 0.55;

      // Cell background
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.beginPath();
      roundRect(ctx, node.x, node.y, node.w, node.h, 3);
      ctx.fill();

      // Occupancy bar
      if (pct > 0) {
        const barH = 3 / viewport.zoom;
        const barY = node.y + node.h - barH - 2 / viewport.zoom;
        const barW = (node.w - 6 / viewport.zoom) * pct;
        const barX = node.x + 3 / viewport.zoom;

        ctx.fillStyle = hexToRgba(color, 0.8);
        ctx.beginPath();
        roundRect(ctx, barX, barY, barW, barH, 1);
        ctx.fill();
      }
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
