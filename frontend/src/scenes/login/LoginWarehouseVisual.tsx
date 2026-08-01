/**
 * LOGIN WAREHOUSE VISUAL — arquitectura visual híbrida.
 *
 * Capas (de fondo a frente):
 *   1. PictureBase — imagen de referencia del almacén (WebP/AVIF)
 *   2. AtmosphereLayer — scan lines, gradientes, vignette
 *   3. InteractiveOverlay — SVG hotspots, labels, evento demo
 *   4. DiagnosticHud — posicionado externamente por LoginScene
 *
 * Si la imagen no carga, se muestra el fallback SVG programático.
 *
 * Parallax:
 *   - Deshabilitado con prefers-reduced-motion
 *   - Solo en desktop (pointer: fine)
 *   - Muy sutil: 2-6px máximo
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { InteractiveOverlay } from './InteractiveOverlay';
import { WarehouseSceneSvg } from './warehouseScene/WarehouseSceneSvg';

interface LoginWarehouseVisualProps {
  reducedMotion: boolean;
}

// Asset paths — WebP as primary, fallback managed by onError
const WAREHOUSE_IMG = '/login/warehouse-base.webp';

export const LoginWarehouseVisual = memo(function LoginWarehouseVisual({
  reducedMotion,
}: LoginWarehouseVisualProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  // ── IMAGE LOAD ────────────────────────────────────────────────────────
  const handleLoad = useCallback(() => setImageLoaded(true), []);
  const handleError = useCallback(() => setImageFailed(true), []);

  // ── PARALLAX (desktop only, subtle) ───────────────────────────────────
  useEffect(() => {
    if (reducedMotion) return;
    // Only on fine pointer devices (desktop)
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Normalized -1 to 1 from center
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      setParallax({ x: nx * 3, y: ny * 2 }); // max 3px x, 2px y
    };

    const el = containerRef.current;
    el?.addEventListener('mousemove', onMove, { passive: true });
    return () => el?.removeEventListener('mousemove', onMove);
  }, [reducedMotion]);

  const bgTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 0.7}px, ${parallax.y * 0.7}px) scale(1.02)`;
  const overlayTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 1.5}px, ${parallax.y * 1.2}px)`;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
    >
      {/* ── LAYER 1: IMAGE BASE ──────────────────────────────────────── */}
      {!imageFailed && (
        <div
          className="absolute inset-0"
          style={{ transform: bgTransform, transition: 'transform 0.15s ease-out' }}
        >
          <img
            src={WAREHOUSE_IMG}
            alt=""
            aria-hidden="true"
            width={1024}
            height={576}
            onLoad={handleLoad}
            onError={handleError}
            className="h-full w-full object-cover object-[30%_center]"
            style={{
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.6s ease-out',
            }}
          />
        </div>
      )}

      {/* ── FALLBACK: SVG scene (if image fails) ─────────────────────── */}
      {imageFailed && <WarehouseSceneSvg reducedMotion={reducedMotion} />}

      {/* ── LAYER 2: ATMOSPHERE ──────────────────────────────────────── */}
      {imageLoaded && !imageFailed && (
        <>
          {/* Edge vignette */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 120% 100% at 40% 50%, transparent 40%, rgba(2,8,17,0.7) 100%)',
            }}
          />

          {/* Right-edge fade to credential panel */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-[15%]"
            style={{
              background: 'linear-gradient(to right, transparent, var(--canvas))',
            }}
          />

          {/* Bottom gradient */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[20%]"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(2,8,17,0.6))',
            }}
          />

          {/* Scan lines (very subtle) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(200,220,240,0.15) 2px, rgba(200,220,240,0.15) 3px)',
              backgroundSize: '100% 3px',
            }}
          />
        </>
      )}

      {/* ── LAYER 3: INTERACTIVE SVG OVERLAY ─────────────────────────── */}
      {imageLoaded && !imageFailed && (
        <div
          className="absolute inset-0"
          style={{ transform: overlayTransform, transition: 'transform 0.15s ease-out' }}
        >
          <InteractiveOverlay reducedMotion={reducedMotion} />
        </div>
      )}
    </div>
  );
});
