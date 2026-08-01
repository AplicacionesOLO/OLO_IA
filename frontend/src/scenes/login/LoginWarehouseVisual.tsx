/**
 * LOGIN WAREHOUSE VISUAL — arquitectura visual híbrida.
 *
 * Capas (de fondo a frente):
 *   1. PictureBase — imagen recortada del almacén (solo racks, piso, grid, atmósfera)
 *   2. AtmosphereLayer — vignette, gradientes, scan lines
 *   3. InteractiveOverlay — SVG hotspots, labels, evento demo
 *
 * IMPORTANTE sobre el asset:
 *   - warehouse-base.webp debe contener SOLO el almacén (panel izquierdo recortado)
 *   - NO debe incluir formulario, logo, inputs, footer ni divisor
 *   - Los labels RCL y "lectura confirmada" los dibuja el overlay, no la imagen
 *
 * Si la imagen no carga → fallback al SVG programático.
 *
 * Parallax coherente:
 *   - imagen: 2px max
 *   - overlay: 3px max (misma dirección, mínima diferencia)
 *   - partículas: controladas externamente (5px)
 *   - Se desactiva con prefers-reduced-motion
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { InteractiveOverlay } from './InteractiveOverlay';
import { WarehouseSceneSvg } from './warehouseScene/WarehouseSceneSvg';
import { ASSET_NATURAL_WIDTH, ASSET_NATURAL_HEIGHT } from './hotspots';

interface LoginWarehouseVisualProps {
  reducedMotion: boolean;
}

type LoadState = 'loading' | 'loaded' | 'error';

export const LoginWarehouseVisual = memo(function LoginWarehouseVisual({
  reducedMotion,
}: LoginWarehouseVisualProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  // ── IMAGE LOAD STATES ─────────────────────────────────────────────────
  const handleLoad = useCallback(() => setLoadState('loaded'), []);
  const handleError = useCallback(() => setLoadState('error'), []);

  // ── PARALLAX (desktop only, coherent between layers) ──────────────────
  useEffect(() => {
    if (reducedMotion) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Normalized -1 to 1 from center
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      setParallax({ x: nx, y: ny });
    };

    const el = containerRef.current;
    el?.addEventListener('mousemove', onMove, { passive: true });
    return () => el?.removeEventListener('mousemove', onMove);
  }, [reducedMotion]);

  // Parallax transforms — coherent: overlay follows image closely
  const imgTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 2}px, ${parallax.y * 1.5}px) scale(1.02)`;
  const overlayTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 3}px, ${parallax.y * 2}px)`;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">

      {/* ── STATE: LOADING — dark background, no flash ────────────────── */}
      {loadState === 'loading' && (
        <div className="absolute inset-0 bg-[var(--canvas)]" />
      )}

      {/* ── STATE: ERROR — SVG fallback ───────────────────────────────── */}
      {loadState === 'error' && (
        <WarehouseSceneSvg reducedMotion={reducedMotion} />
      )}

      {/* ── LAYER 1: IMAGE BASE ──────────────────────────────────────── */}
      {loadState !== 'error' && (
        <div
          className="absolute inset-0"
          style={{
            transform: imgTransform,
            transition: reducedMotion ? 'none' : 'transform 0.12s ease-out',
          }}
        >
          <picture>
            <source srcSet="/login/warehouse-base.avif" type="image/avif" />
            <source srcSet="/login/warehouse-base.webp" type="image/webp" />
            <img
              src="/login/warehouse-base.webp"
              alt=""
              aria-hidden="true"
              width={ASSET_NATURAL_WIDTH}
              height={ASSET_NATURAL_HEIGHT}
              onLoad={handleLoad}
              onError={handleError}
              className="h-full w-full object-cover"
              style={{
                objectPosition: 'center center',
                opacity: loadState === 'loaded' ? 1 : 0,
                transition: 'opacity 0.5s ease-out',
              }}
            />
          </picture>
        </div>
      )}

      {/* ── LAYER 2: ATMOSPHERE ──────────────────────────────────────── */}
      {loadState === 'loaded' && (
        <>
          {/* Edge vignette — keeps focus on racks */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 130% 110% at 45% 50%, transparent 35%, rgba(2,8,17,0.65) 100%)',
            }}
          />

          {/* Right-edge fade — smooth transition to credential panel */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-[12%]"
            style={{
              background: 'linear-gradient(to right, transparent, var(--canvas))',
            }}
          />

          {/* Bottom gradient — space for HUD */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%]"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(2,8,17,0.55))',
            }}
          />

          {/* Top gradient — subtle */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[8%]"
            style={{
              background: 'linear-gradient(to top, transparent, rgba(2,8,17,0.3))',
            }}
          />

          {/* Scan lines (extremely subtle) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(200,220,240,0.12) 2px, rgba(200,220,240,0.12) 3px)',
              backgroundSize: '100% 3px',
            }}
          />
        </>
      )}

      {/* ── LAYER 3: INTERACTIVE SVG OVERLAY ─────────────────────────── */}
      {loadState === 'loaded' && (
        <div
          className="absolute inset-0"
          style={{
            transform: overlayTransform,
            transition: reducedMotion ? 'none' : 'transform 0.12s ease-out',
          }}
        >
          <InteractiveOverlay reducedMotion={reducedMotion} />
        </div>
      )}
    </div>
  );
});
