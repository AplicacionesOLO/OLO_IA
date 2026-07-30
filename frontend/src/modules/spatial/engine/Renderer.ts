/**
 * CANVAS RENDERER — dibuja las ubicaciones en un Canvas 2D.
 *
 * Responsabilidades:
 *  - Leer viewport state y dibujar solo nodos visibles (culling)
 *  - Pintar celda con color de estado y opacidad de ocupacion
 *  - Resaltar seleccionados y hover
 *  - Dibujar etiquetas cuando el zoom lo permite
 *
 * NO maneja eventos: eso lo hace el componente React. NO conoce React.
 */

import type { LayoutNode } from './LayoutEngine';
import type { Viewport } from './Viewport';
import type { LocationStatus } from '../types/index';

export interface RenderOptions {
  /** IDs seleccionados. */
  selectedIds: Set<string>;
  /** ID bajo el cursor. */
  hoveredId: string | null;
  /** Capas visibles. */
  visibleStatuses: Set<LocationStatus>;
  /** DPR del dispositivo. */
  dpr: number;
}

/** Colores resueltos a hex para el renderer (evita parsear CSS vars). */
const STATUS_HEX: Record<LocationStatus, string> = {
  occupied: '#22d9f5',
  available: '#34e5b4',
  inferred: '#a78bfa',
  invalid: '#fb7185',
  reserved: '#fbbf24',
  blocked: '#64748b',
};

export class SpatialRenderer {
  private ctx: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
  }

  detach() {
    this.ctx = null;
    this.canvas = null;
  }

  render(
    viewport: Viewport,
    nodes: LayoutNode[],
    options: RenderOptions,
  ) {
    const { ctx, canvas } = this;
    if (!ctx || !canvas) return;

    const { dpr, selectedIds, hoveredId, visibleStatuses } = options;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04080f';
    ctx.fillRect(0, 0, w, h);

    // Apply viewport transform
    ctx.setTransform(
      viewport.zoom * dpr, 0,
      0, viewport.zoom * dpr,
      viewport.offset.x * dpr,
      viewport.offset.y * dpr,
    );

    // Culling rect in world coordinates
    const visible = viewport.getVisibleWorldRect();
    const pad = 20; // margen para no cortar bordes

    // Draw nodes
    const showLabels = viewport.zoom > 0.8;
    const showDetails = viewport.zoom > 1.5;

    for (const node of nodes) {
      // Cull
      if (
        node.x + node.w < visible.minX - pad ||
        node.x > visible.maxX + pad ||
        node.y + node.h < visible.minY - pad ||
        node.y > visible.maxY + pad
      ) continue;

      // Layer visibility
      if (!visibleStatuses.has(node.location.status)) continue;

      const isSelected = selectedIds.has(node.id);
      const isHovered = hoveredId === node.id;
      const status = node.location.status;
      const color = STATUS_HEX[status];
      const pct = node.location.capacity > 0
        ? node.location.occupied / node.location.capacity
        : 0;

      // Background: opacity driven by occupancy
      const alpha = 0.15 + pct * 0.55;
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.beginPath();
      roundRect(ctx, node.x, node.y, node.w, node.h, 4);
      ctx.fill();

      // Border for selected/hovered
      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? '#22d9f5' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = isSelected ? 2 / viewport.zoom : 1 / viewport.zoom;
        ctx.stroke();
      }

      // Occupancy bar at bottom
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

      // Label
      if (showLabels) {
        const fontSize = Math.max(8, Math.min(11, 10 / viewport.zoom));
        ctx.font = `${fontSize}px "JetBrains Mono Variable", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const label = shortCode(node.location.code);
        ctx.fillText(label, node.x + node.w / 2, node.y + node.h / 2 - (pct > 0 ? 4 : 0));
      }

      // Details (only at high zoom)
      if (showDetails && pct > 0) {
        const detailSize = 7 / viewport.zoom;
        ctx.font = `${detailSize}px "JetBrains Mono Variable", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(
          `${Math.round(pct * 100)}%`,
          node.x + node.w / 2,
          node.y + node.h / 2 + 8,
        );
      }
    }
  }

  /** Render minimap into a separate small canvas. */
  renderMinimap(
    miniCtx: CanvasRenderingContext2D,
    miniW: number,
    miniH: number,
    viewport: Viewport,
    nodes: LayoutNode[],
    worldW: number,
    worldH: number,
    visibleStatuses: Set<LocationStatus>,
  ) {
    // Clear
    miniCtx.fillStyle = '#070d18';
    miniCtx.fillRect(0, 0, miniW, miniH);

    if (worldW === 0 || worldH === 0) return;

    // Scale to fit
    const scaleX = (miniW - 8) / worldW;
    const scaleY = (miniH - 8) / worldH;
    const scale = Math.min(scaleX, scaleY);
    const ox = 4;
    const oy = 4;

    // Draw all nodes as dots
    for (const node of nodes) {
      if (!visibleStatuses.has(node.location.status)) continue;
      const color = STATUS_HEX[node.location.status];
      miniCtx.fillStyle = color;
      miniCtx.fillRect(
        ox + node.x * scale,
        oy + node.y * scale,
        Math.max(2, node.w * scale),
        Math.max(2, node.h * scale),
      );
    }

    // Draw viewport rectangle
    const vr = viewport.getVisibleWorldRect();
    miniCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(
      ox + vr.minX * scale,
      oy + vr.minY * scale,
      (vr.maxX - vr.minX) * scale,
      (vr.maxY - vr.minY) * scale,
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
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

function shortCode(code: string): string {
  const parts = code.split('-');
  if (parts.length >= 4) return parts.slice(-2).join('-');
  if (parts.length >= 3) return parts.slice(-2).join('-');
  return code;
}
