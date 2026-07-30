/**
 * LAYOUT EDITOR CANVAS — el canvas interactivo del editor de plano.
 *
 * Render order:
 *   1. Background (dark floor)
 *   2. Plan image (SVG/PNG/JPG)
 *   3. Grid
 *   4. Axes + origin
 *   5. Racks
 *   6. Labels
 *   7. Selection + handles
 *   8. Calibration line (when calibrating)
 *   9. Cursor coordinates
 *
 * Supports: zoom (wheel), pan (middle-click or space+drag), click to select.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useEditorStore } from '../store';
import {
  fitBounds,
  screenToPlan,
  zoomAt,
  type Vec2,
  type ViewportTransform,
} from '../transforms';
import type { PositionedRack } from '../types';

interface LayoutEditorCanvasProps {
  className?: string | undefined;
}

export function LayoutEditorCanvas({ className }: LayoutEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vt, setVt] = useState<ViewportTransform>({ offsetX: 0, offsetY: 0, zoom: 1 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);

  const {
    plan, calibration, reference, racks, selectedRackId, layers,
    mode, visualMode, isEditing, selectRack, updateRack,
    setCalibration, setReference, recordAction,
  } = useEditorStore();

  // Panning state
  const panRef = useRef({ active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });
  // Dragging rack state
  const dragRef = useRef<{ active: boolean; layoutId: string; startPlan: Vec2; startRack: Vec2 } | null>(null);
  // Calibration state
  const calRef = useRef<{ p1: Vec2 | null; p2: Vec2 | null }>({ p1: null, p2: null });

  // ── Load plan image ───────────────────────────────────────────────────
  useEffect(() => {
    if (!plan) { imgRef.current = null; return; }
    const img = new window.Image();
    img.onload = () => { imgRef.current = img; };
    img.src = plan.objectUrl;
  }, [plan]);

  // ── Resize ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSize({ w: width, h: height });
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // ── Fit on plan load ──────────────────────────────────────────────────
  useEffect(() => {
    if (!plan || size.w === 0) return;
    setVt(fitBounds(plan.width, plan.height, size.w, size.h));
  }, [plan, size.w, size.h]);

  // ── Render loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 1. Background
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, size.w, size.h);

      // Apply viewport transform
      ctx.save();
      ctx.translate(vt.offsetX, vt.offsetY);
      ctx.scale(vt.zoom, vt.zoom);

      // 2. Plan image
      if (layers.plan && imgRef.current && plan) {
        ctx.drawImage(imgRef.current, 0, 0, plan.width, plan.height);
      }

      // 3. Grid
      if (layers.grid) drawGrid(ctx, vt, size.w, size.h);

      // 4. Axes + Origin
      if (layers.axes) drawAxes(ctx, reference.origin, plan?.width ?? 2000, plan?.height ?? 2000);

      // 5. Racks
      if (layers.racks) {
        for (const rack of racks) {
          drawRack(ctx, rack, rack.layoutId === selectedRackId, visualMode === 'holographic', calibration.pixelsPerMeter);
        }
      }

      // 6. Labels
      if (layers.labels) {
        for (const rack of racks) {
          drawRackLabel(ctx, rack, calibration.pixelsPerMeter);
        }
      }

      // 8. Calibration line
      if (mode === 'calibrate' && calRef.current.p1) {
        drawCalibrationLine(ctx, calRef.current.p1, calRef.current.p2 ?? cursor ? screenToPlan(cursor!, vt) : calRef.current.p1);
      }

      ctx.restore();

      // 9. Cursor coordinates (screen space, outside viewport transform)
      if (cursor && plan) {
        const planPt = screenToPlan(cursor, vt);
        const worldX = (planPt.x - reference.origin.x) / calibration.pixelsPerMeter;
        const worldY = (planPt.y - reference.origin.y) / calibration.pixelsPerMeter;
        ctx.fillStyle = 'rgba(200,220,240,0.6)';
        ctx.font = '10px "JetBrains Mono Variable", monospace';
        ctx.fillText(`${worldX.toFixed(2)}m, ${worldY.toFixed(2)}m`, 8, size.h - 8);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  });

  // ── Pointer events ────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const planPt = screenToPlan({ x: sx, y: sy }, vt);

    // Calibration mode: mark points
    if (mode === 'calibrate') {
      if (!calRef.current.p1) {
        calRef.current.p1 = planPt;
      } else if (!calRef.current.p2) {
        calRef.current.p2 = planPt;
        // Prompt for distance (simplified: use window.prompt for now)
        const dist = window.prompt('Distancia real entre los dos puntos (metros):');
        if (dist && parseFloat(dist) > 0) {
          const px = Math.sqrt((calRef.current.p2.x - calRef.current.p1.x) ** 2 + (calRef.current.p2.y - calRef.current.p1.y) ** 2);
          const ppm = px / parseFloat(dist);
          const oldCal = { ...calibration };
          const newCal = { pixelsPerMeter: ppm, points: { p1: calRef.current.p1, p2: calRef.current.p2, realDistance: parseFloat(dist), unit: 'meters' as const } };
          setCalibration(newCal);
          recordAction({ type: 'calibrate', from: oldCal, to: newCal });
        }
        calRef.current = { p1: null, p2: null };
      }
      return;
    }

    // Set origin mode
    if (mode === 'set-origin') {
      const oldRef = { ...reference };
      const newRef = { ...reference, origin: { x: planPt.x, y: planPt.y } };
      setReference(newRef);
      recordAction({ type: 'set-origin', from: oldRef, to: newRef });
      return;
    }

    // Pan (middle button or space held — we'll use middle button for now)
    if (e.button === 1 || mode === 'pan') {
      panRef.current = { active: true, startX: e.clientX, startY: e.clientY, startOffsetX: vt.offsetX, startOffsetY: vt.offsetY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // Select / drag rack
    if (mode === 'select' || mode === 'view') {
      const hit = hitTestRack(planPt, racks, calibration.pixelsPerMeter);
      if (hit) {
        selectRack(hit.layoutId);
        if (isEditing && !hit.locked) {
          dragRef.current = { active: true, layoutId: hit.layoutId, startPlan: planPt, startRack: { x: hit.x, y: hit.y } };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
      } else {
        selectRack(null);
      }
    }
  }, [vt, mode, racks, calibration, reference, isEditing, selectRack, setCalibration, setReference, recordAction]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({ x: sx, y: sy });

    // Pan
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setVt({ ...vt, offsetX: panRef.current.startOffsetX + dx, offsetY: panRef.current.startOffsetY + dy });
      return;
    }

    // Drag rack
    if (dragRef.current?.active) {
      const planPt = screenToPlan({ x: sx, y: sy }, vt);
      const dx = planPt.x - dragRef.current.startPlan.x;
      const dy = planPt.y - dragRef.current.startPlan.y;
      updateRack(dragRef.current.layoutId, {
        x: dragRef.current.startRack.x + dx,
        y: dragRef.current.startRack.y + dy,
      });
    }
  }, [vt, updateRack]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    if (panRef.current.active) {
      panRef.current.active = false;
      return;
    }
    if (dragRef.current?.active) {
      // Record the move action
      const rack = racks.find((r) => r.layoutId === dragRef.current!.layoutId);
      if (rack) {
        recordAction({
          type: 'move-rack',
          layoutId: rack.layoutId,
          from: dragRef.current.startRack,
          to: { x: rack.x, y: rack.y },
        });
      }
      dragRef.current = null;
    }
  }, [racks, recordAction]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -1 : 1;
    setVt(zoomAt(vt, sx, sy, delta));
  }, [vt]);

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, cursor: mode === 'pan' ? 'grab' : mode === 'calibrate' ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        aria-label="Layout editor canvas"
      />
    </div>
  );
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, vt: ViewportTransform, w: number, h: number) {
  const spacing = 50;
  ctx.strokeStyle = 'rgba(100,140,180,0.06)';
  ctx.lineWidth = 1 / vt.zoom;

  const tl = screenToPlan({ x: 0, y: 0 }, vt);
  const br = screenToPlan({ x: w, y: h }, vt);

  ctx.beginPath();
  const startX = Math.floor(tl.x / spacing) * spacing;
  for (let x = startX; x <= br.x; x += spacing) {
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, br.y);
  }
  const startY = Math.floor(tl.y / spacing) * spacing;
  for (let y = startY; y <= br.y; y += spacing) {
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
  }
  ctx.stroke();
}

function drawAxes(ctx: CanvasRenderingContext2D, origin: Vec2, w: number, h: number) {
  // X axis (red)
  ctx.strokeStyle = 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.stroke();
  // Y axis (green)
  ctx.strokeStyle = 'rgba(80,255,80,0.5)';
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.stroke();
  // Origin dot
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawRack(
  ctx: CanvasRenderingContext2D,
  rack: PositionedRack,
  selected: boolean,
  holographic: boolean,
  ppm: number,
) {
  const w = rack.width * ppm;
  const l = rack.length * ppm;

  ctx.save();
  ctx.translate(rack.x, rack.y);
  ctx.rotate((rack.rotation * Math.PI) / 180);

  // Fill
  const alpha = holographic ? 0.15 : 0.3;
  ctx.fillStyle = selected ? `rgba(34,217,245,${alpha + 0.15})` : `rgba(60,100,140,${alpha})`;
  ctx.fillRect(-w / 2, -l / 2, w, l);

  // Border
  ctx.strokeStyle = selected ? '#22d9f5' : 'rgba(100,160,220,0.4)';
  ctx.lineWidth = selected ? 2 : 1;
  if (holographic) {
    ctx.shadowColor = '#22d9f5';
    ctx.shadowBlur = selected ? 12 : 4;
  }
  ctx.strokeRect(-w / 2, -l / 2, w, l);
  ctx.shadowBlur = 0;

  // Selection handles
  if (selected) {
    const hs = 5;
    ctx.fillStyle = '#22d9f5';
    for (const [hx, hy] of [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]] as [number, number][]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }

  // Lock indicator
  if (rack.locked) {
    ctx.fillStyle = 'rgba(245,158,11,0.7)';
    ctx.beginPath();
    ctx.arc(0, -l / 2 - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawRackLabel(ctx: CanvasRenderingContext2D, rack: PositionedRack, ppm: number) {
  ctx.save();
  ctx.translate(rack.x, rack.y);
  ctx.fillStyle = 'rgba(200,220,240,0.8)';
  ctx.font = '10px "JetBrains Mono Variable", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(rack.rackCode, 0, -(rack.length * ppm) / 2 - 4);
  ctx.restore();
}

function drawCalibrationLine(ctx: CanvasRenderingContext2D, p1: Vec2, p2: Vec2) {
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Points
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function hitTestRack(
  planPt: Vec2,
  racks: PositionedRack[],
  ppm: number,
): PositionedRack | null {
  // Iterate in reverse (top-most first)
  for (let i = racks.length - 1; i >= 0; i--) {
    const rack = racks[i]!;
    const w = rack.width * ppm;
    const l = rack.length * ppm;

    // Transform point into rack's local space
    const dx = planPt.x - rack.x;
    const dy = planPt.y - rack.y;
    const rad = (-rack.rotation * Math.PI) / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

    if (lx >= -w / 2 && lx <= w / 2 && ly >= -l / 2 && ly <= l / 2) {
      return rack;
    }
  }
  return null;
}
