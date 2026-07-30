/**
 * VIEWPORT — transformacion 2D con pan y zoom.
 *
 * Pura matematica: recibe eventos y produce una matriz de transformacion.
 * No conoce ni React ni Canvas ni DOM. Es reutilizable en cualquier renderer.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ViewportState {
  /** Offset del mundo en pixeles de pantalla. */
  offset: Vec2;
  /** Factor de escala (1 = 100%). */
  zoom: number;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 6;
export const ZOOM_STEP = 0.12;

export class Viewport {
  offset: Vec2 = { x: 0, y: 0 };
  zoom = 1;

  private _width = 0;
  private _height = 0;

  get width() { return this._width; }
  get height() { return this._height; }

  resize(w: number, h: number) {
    this._width = w;
    this._height = h;
  }

  /** Pantalla → mundo. */
  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.offset.x) / this.zoom,
      y: (sy - this.offset.y) / this.zoom,
    };
  }

  /** Mundo → pantalla. */
  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: wx * this.zoom + this.offset.x,
      y: wy * this.zoom + this.offset.y,
    };
  }

  /** Zoom centrado en un punto de pantalla. */
  zoomAt(screenX: number, screenY: number, delta: number) {
    const factor = 1 + delta * ZOOM_STEP;
    const newZoom = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const ratio = newZoom / this.zoom;

    this.offset.x = screenX - (screenX - this.offset.x) * ratio;
    this.offset.y = screenY - (screenY - this.offset.y) * ratio;
    this.zoom = newZoom;
  }

  /** Pan absoluto. */
  pan(dx: number, dy: number) {
    this.offset.x += dx;
    this.offset.y += dy;
  }

  /** Encuadrar toda el area visible centrada. */
  fitBounds(bounds: ViewportBounds, padding = 40) {
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw === 0 || bh === 0) return;

    const scaleX = (this._width - padding * 2) / bw;
    const scaleY = (this._height - padding * 2) / bh;
    this.zoom = clamp(Math.min(scaleX, scaleY), ZOOM_MIN, ZOOM_MAX);

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.offset.x = this._width / 2 - cx * this.zoom;
    this.offset.y = this._height / 2 - cy * this.zoom;
  }

  /** Rect visible en coordenadas del mundo (para culling). */
  getVisibleWorldRect(): ViewportBounds {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this._width, this._height);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }

  getState(): ViewportState {
    return { offset: { ...this.offset }, zoom: this.zoom };
  }

  setState(s: ViewportState) {
    this.offset = { ...s.offset };
    this.zoom = s.zoom;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
