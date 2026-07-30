/**
 * COORDINATE TRANSFORMS — pipeline de transformacion del Layout Editor.
 *
 * Tres sistemas de coordenadas:
 *   SCREEN — pixeles del viewport del navegador (el canvas DOM element)
 *   PLAN   — pixeles de la imagen del plano (la coordenada en el archivo SVG/PNG)
 *   WORLD  — metros/centimetros reales del almacen
 *
 * Pipeline:
 *   screen ←→ plan: definido por zoom + offset (viewport transform)
 *   plan ←→ world: definido por pixelsPerMeter + origin (calibration transform)
 *
 * NUNCA se usa screen como coordenada de dominio.
 * Los racks se posicionan en PLAN coordinates y se convierten a world para display.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ViewportTransform {
  /** Offset del plano respecto a la esquina superior izquierda del canvas. */
  offsetX: number;
  offsetY: number;
  /** Factor de zoom (1 = 100%). */
  zoom: number;
}

export interface CalibrationTransform {
  /** Pixels del plano por metro real. */
  pixelsPerMeter: number;
  /** Origen (0,0) del mundo en coordenadas de plano. */
  originX: number;
  originY: number;
  /** Rotacion del plano respecto al norte (grados). */
  rotation: number;
}

// ── Screen ↔ Plan ───────────────────────────────────────────────────────────

/** Convierte coordenadas del canvas (screen) a coordenadas del plano. */
export function screenToPlan(screen: Vec2, vt: ViewportTransform): Vec2 {
  return {
    x: (screen.x - vt.offsetX) / vt.zoom,
    y: (screen.y - vt.offsetY) / vt.zoom,
  };
}

/** Convierte coordenadas del plano a coordenadas del canvas (screen). */
export function planToScreen(plan: Vec2, vt: ViewportTransform): Vec2 {
  return {
    x: plan.x * vt.zoom + vt.offsetX,
    y: plan.y * vt.zoom + vt.offsetY,
  };
}

// ── Plan ↔ World ────────────────────────────────────────────────────────────

/** Convierte coordenadas de plano (px) a coordenadas del mundo (metros). */
export function planToWorld(plan: Vec2, ct: CalibrationTransform): Vec2 {
  const dx = plan.x - ct.originX;
  const dy = plan.y - ct.originY;

  if (ct.rotation === 0) {
    return {
      x: dx / ct.pixelsPerMeter,
      y: dy / ct.pixelsPerMeter,
    };
  }

  // Aplicar rotacion inversa
  const rad = (-ct.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (dx * cos - dy * sin) / ct.pixelsPerMeter,
    y: (dx * sin + dy * cos) / ct.pixelsPerMeter,
  };
}

/** Convierte coordenadas del mundo (metros) a coordenadas de plano (px). */
export function worldToPlan(world: Vec2, ct: CalibrationTransform): Vec2 {
  const mx = world.x * ct.pixelsPerMeter;
  const my = world.y * ct.pixelsPerMeter;

  if (ct.rotation === 0) {
    return {
      x: mx + ct.originX,
      y: my + ct.originY,
    };
  }

  const rad = (ct.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: mx * cos - my * sin + ct.originX,
    y: mx * sin + my * cos + ct.originY,
  };
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Distancia en pixeles de plano entre dos puntos. */
export function planDistance(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Zoom centrado en un punto de pantalla. */
export function zoomAt(
  vt: ViewportTransform,
  screenX: number,
  screenY: number,
  delta: number,
  min = 0.1,
  max = 10,
): ViewportTransform {
  const factor = 1 + delta * 0.1;
  const newZoom = Math.max(min, Math.min(max, vt.zoom * factor));
  const ratio = newZoom / vt.zoom;
  return {
    offsetX: screenX - (screenX - vt.offsetX) * ratio,
    offsetY: screenY - (screenY - vt.offsetY) * ratio,
    zoom: newZoom,
  };
}

/** Fit bounds: centra un area del plano en el canvas. */
export function fitBounds(
  planWidth: number,
  planHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding = 40,
): ViewportTransform {
  if (planWidth <= 0 || planHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { offsetX: 0, offsetY: 0, zoom: 1 };
  }
  const scaleX = (canvasWidth - padding * 2) / planWidth;
  const scaleY = (canvasHeight - padding * 2) / planHeight;
  const zoom = Math.min(scaleX, scaleY, 5);
  return {
    offsetX: (canvasWidth - planWidth * zoom) / 2,
    offsetY: (canvasHeight - planHeight * zoom) / 2,
    zoom,
  };
}

/** Visible rect in plan coordinates (for culling). */
export function visiblePlanRect(
  vt: ViewportTransform,
  canvasWidth: number,
  canvasHeight: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const tl = screenToPlan({ x: 0, y: 0 }, vt);
  const br = screenToPlan({ x: canvasWidth, y: canvasHeight }, vt);
  return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
}
