/**
 * SPATIAL CANVAS — componente React que integra Viewport + Renderer.
 *
 * Maneja: resize, pointer events (pan, click, hover), wheel (zoom),
 * multi-select (Ctrl/Cmd+click), tooltip, y rAF render loop.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LayoutNode, LayoutResult } from '../engine/LayoutEngine';
import { SpatialRenderer } from '../engine/Renderer';
import { Viewport } from '../engine/Viewport';
import type { LocationStatus, SpatialLocation } from '../types/index';
import type { LayerConfig } from './LayerPanel';
import { cn } from '../../../design/utils/cn';
import { STATUS_META } from './StatusLegend';

interface SpatialCanvasProps {
  layout: LayoutResult;
  selectedIds: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onHover: (loc: SpatialLocation | null) => void;
  layers: LayerConfig;
  className?: string;
}

export function SpatialCanvas({
  layout,
  selectedIds,
  onSelect,
  onHover,
  layers,
  className,
}: SpatialCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef(new Viewport());
  const rendererRef = useRef(new SpatialRenderer());
  const rafRef = useRef(0);
  const dirtyRef = useRef(true);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; loc: SpatialLocation;
  } | null>(null);

  // Panning state
  const panRef = useRef({ active: false, startX: 0, startY: 0 });

  const visibleStatuses = useMemo(() => {
    const set = new Set<LocationStatus>();
    for (const [k, v] of Object.entries(layers)) {
      if (v) set.add(k as LocationStatus);
    }
    return set;
  }, [layers]);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  // ── Resize ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current.resize(width, height);
      markDirty();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [markDirty]);

  // ── Attach renderer ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current.attach(canvas);
    return () => rendererRef.current.detach();
  }, []);

  // ── Fit on layout change ──────────────────────────────────────────────
  useEffect(() => {
    if (layout.worldWidth === 0) return;
    viewportRef.current.fitBounds({
      minX: 0, minY: 0,
      maxX: layout.worldWidth,
      maxY: layout.worldHeight,
    });
    markDirty();
  }, [layout.worldWidth, layout.worldHeight, markDirty]);

  // ── Render loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const dpr = window.devicePixelRatio || 1;
        rendererRef.current.render(viewportRef.current, layout.nodes, {
          selectedIds,
          hoveredId,
          visibleStatuses,
          dpr,
        });

        // Minimap
        const miniCanvas = miniRef.current;
        if (miniCanvas) {
          const miniCtx = miniCanvas.getContext('2d');
          if (miniCtx) {
            rendererRef.current.renderMinimap(
              miniCtx, miniCanvas.width, miniCanvas.height,
              viewportRef.current, layout.nodes,
              layout.worldWidth, layout.worldHeight,
              visibleStatuses,
            );
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layout.nodes, layout.worldWidth, layout.worldHeight, selectedIds, hoveredId, visibleStatuses]);

  // Mark dirty when selection or hover changes
  useEffect(() => { markDirty(); }, [selectedIds, hoveredId, markDirty]);

  // ── Hit test ──────────────────────────────────────────────────────────
  const hitTest = useCallback((screenX: number, screenY: number): LayoutNode | null => {
    const vp = viewportRef.current;
    const world = vp.screenToWorld(screenX, screenY);
    for (const node of layout.nodes) {
      if (!visibleStatuses.has(node.location.status)) continue;
      if (
        world.x >= node.x && world.x <= node.x + node.w &&
        world.y >= node.y && world.y <= node.y + node.h
      ) return node;
    }
    return null;
  }, [layout.nodes, visibleStatuses]);

  // ── Pointer events ────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 0) {
      panRef.current = { active: true, startX: e.clientX, startY: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      viewportRef.current.pan(dx, dy);
      panRef.current.startX = e.clientX;
      panRef.current.startY = e.clientY;
      markDirty();
      setTooltip(null);
      return;
    }

    // Hover
    const hit = hitTest(sx, sy);
    const newId = hit?.id ?? null;
    if (newId !== hoveredId) {
      setHoveredId(newId);
      onHover(hit?.location ?? null);
      markDirty();
    }
    if (hit) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, loc: hit.location });
    } else {
      setTooltip(null);
    }
  }, [hitTest, hoveredId, markDirty, onHover]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDrag = Math.abs(e.clientX - panRef.current.startX) > 3 ||
      Math.abs(e.clientY - panRef.current.startY) > 3;
    panRef.current.active = false;

    if (wasDrag) return;

    // Click: select
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = hitTest(sx, sy);

    if (!hit) {
      onSelect(new Set());
      return;
    }

    const multi = e.ctrlKey || e.metaKey;
    if (multi) {
      const next = new Set(selectedIds);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.add(hit.id);
      onSelect(next);
    } else {
      onSelect(new Set([hit.id]));
    }
  }, [hitTest, onSelect, selectedIds]);

  // ── Wheel zoom ────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -1 : 1;
    viewportRef.current.zoomAt(sx, sy, delta);
    markDirty();
  }, [markDirty]);

  return (
    <div ref={containerRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        aria-label="Mapa espacial de ubicaciones. Use scroll para zoom, arrastre para mover."
        role="img"
      />

      {/* Minimap */}
      <canvas
        ref={miniRef}
        width={160}
        height={100}
        className="absolute bottom-3 right-3 rounded-[var(--radius-sm)] border border-[var(--hairline)] [background:var(--glass-1)]"
        aria-hidden="true"
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 flex flex-col gap-1 rounded-[var(--radius-sm)] px-3 py-2 [background:var(--glass-3)] shadow-[var(--drop-3)]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <span className="text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--text-primary)]">
            {tooltip.loc.code}
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {STATUS_META[tooltip.loc.status].label} · {tooltip.loc.occupied}/{tooltip.loc.capacity}
          </span>
        </div>
      )}

      {/* Zoom indicator */}
      <span className="absolute left-3 top-3 t-mono-xs rounded-[var(--radius-xs)] px-2 py-1 text-[var(--text-faint)] [background:var(--glass-1)]">
        {Math.round(viewportRef.current.zoom * 100)}%
      </span>
    </div>
  );
}
