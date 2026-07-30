/**
 * CAMERA — estado persistible del punto de vista.
 *
 * Diferencia con Viewport: el viewport es el mecanismo de transformacion;
 * la camara es el ESTADO SEMANTICO (que estoy mirando, a que zoom, con que
 * intención). Permite guardar y restaurar vistas, animar transiciones entre
 * posiciones, y compartir un punto de vista entre usuarios.
 */

import { Viewport, type ViewportBounds } from './Viewport';

export interface CameraState {
  centerX: number;
  centerY: number;
  zoom: number;
}

export class Camera {
  private viewport: Viewport;
  private targetState: CameraState | null = null;
  private animating = false;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
  }

  /** Estado actual derivado del viewport. */
  getState(): CameraState {
    const vr = this.viewport.getVisibleWorldRect();
    return {
      centerX: (vr.minX + vr.maxX) / 2,
      centerY: (vr.minY + vr.maxY) / 2,
      zoom: this.viewport.zoom,
    };
  }

  /** Mover instantaneamente a un estado. */
  jumpTo(state: CameraState) {
    this.viewport.zoom = state.zoom;
    this.viewport.offset.x = this.viewport.width / 2 - state.centerX * state.zoom;
    this.viewport.offset.y = this.viewport.height / 2 - state.centerY * state.zoom;
    this.targetState = null;
    this.animating = false;
  }

  /** Encuadrar un area con animacion suave. */
  fitBounds(bounds: ViewportBounds, padding = 40) {
    this.viewport.fitBounds(bounds, padding);
    this.targetState = null;
    this.animating = false;
  }

  /** Centrar en una coordenada del mundo a un zoom dado. */
  focusOn(worldX: number, worldY: number, zoom?: number) {
    const z = zoom ?? this.viewport.zoom;
    this.jumpTo({ centerX: worldX, centerY: worldY, zoom: z });
  }

  /** Animar hacia un estado (para futuras transiciones suaves). */
  animateTo(state: CameraState) {
    this.targetState = state;
    this.animating = true;
  }

  /** Llamar en cada frame del render loop. Retorna true si hubo cambio. */
  tick(): boolean {
    if (!this.animating || !this.targetState) return false;

    const current = this.getState();
    const t = this.targetState;
    const LERP = 0.12;
    const THRESHOLD = 0.5;

    const dx = t.centerX - current.centerX;
    const dy = t.centerY - current.centerY;
    const dz = t.zoom - current.zoom;

    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD && Math.abs(dz) < 0.01) {
      this.jumpTo(t);
      return true;
    }

    this.jumpTo({
      centerX: current.centerX + dx * LERP,
      centerY: current.centerY + dy * LERP,
      zoom: current.zoom + dz * LERP,
    });
    return true;
  }

  isAnimating(): boolean {
    return this.animating;
  }
}
