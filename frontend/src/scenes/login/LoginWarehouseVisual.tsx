/**
 * LOGIN WAREHOUSE VISUAL — arquitectura visual híbrida.
 *
 * Capas (de fondo a frente):
 *   1. PictureBase — imagen recortada del almacén
 *   2. AtmosphereLayer — vignette, gradientes, scan lines
 *   3. InteractiveOverlay — SVG hotspots, labels, evento demo
 *
 * Si la imagen no carga → fallback al SVG programático.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { InteractiveOverlay } from './InteractiveOverlay';
import { WarehouseSceneSvg } from './warehouseScene/WarehouseSceneSvg';
import { ASSET_NATURAL_WIDTH, ASSET_NATURAL_HEIGHT } from './hotspots';

interface LoginWarehouseVisualProps {
  reducedMotion: boolean;
}

export const LoginWarehouseVisual = memo(function LoginWarehouseVisual({
  reducedMotion,
}: LoginWarehouseVisualProps) {
  const [imgReady, setImgReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const onLoad = useCallback(() => setImgReady(true), []);
  const onError = useCallback(() => setImgFailed(true), []);

  // Detect cached images
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImgReady(true);
    }
  }, []);

  // ── PARALLAX ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      setParallax({ x: nx, y: ny });
    };

    el.addEventListener('mousemove', onMove, { passive: true });
    return () => el.removeEventListener('mousemove', onMove);
  }, [reducedMotion]);

  const imgTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 2}px, ${parallax.y * 1.5}px) scale(1.02)`;
  const overlayTransform = reducedMotion
    ? undefined
    : `translate(${parallax.x * 3}px, ${parallax.y * 2}px)`;

  // ── FALLBACK: show SVG scene if image fails ───────────────────────────
  if (imgFailed) {
    return (
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
        <WarehouseSceneSvg reducedMotion={reducedMotion} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">

      {/* ── IMAGE ────────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          transform: imgTransform,
          transition: reducedMotion ? 'none' : 'transform 0.12s ease-out',
        }}
      >
        <img
          ref={imgRef}
          src="/login/warehouse-base.webp"
          alt=""
          aria-hidden="true"
          width={ASSET_NATURAL_WIDTH}
          height={ASSET_NATURAL_HEIGHT}
          onLoad={onLoad}
          onError={onError}
          className="h-full w-full object-cover"
          style={{ objectPosition: '48% 50%' }}
        />
      </div>

      {/* ── ATMOSPHERE (only after image ready) ──────────────────────── */}
      {imgReady && (
        <div className="pointer-events-none absolute inset-0 z-[2]">
          {/* Edge vignette */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 140% 120% at 45% 50%, transparent 45%, rgba(2,8,17,0.5) 100%)',
            }}
          />
          {/* Right-edge fade to credential panel */}
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 w-[12%]"
            style={{ background: 'linear-gradient(to right, transparent, var(--canvas))' }}
          />
          {/* Bottom gradient */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[15%]"
            style={{ background: 'linear-gradient(to bottom, transparent, rgba(2,8,17,0.45))' }}
          />
          {/* Scan lines */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(200,220,240,0.12) 2px, rgba(200,220,240,0.12) 3px)',
              backgroundSize: '100% 3px',
            }}
          />
        </div>
      )}

      {/* ── INTERACTIVE OVERLAY (only after image ready) ──────────────── */}
      {imgReady && (
        <div
          className="absolute inset-0 z-[3]"
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
