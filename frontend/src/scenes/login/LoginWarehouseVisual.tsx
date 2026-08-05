/**
 * LOGIN WAREHOUSE VISUAL — el dibujo del almacén, entero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ASSET YA TRAE SU PROPIA INTERFAZ. ESO CAMBIA TODO.
 *
 * Al superponer una rejilla de porcentajes sobre `warehouse-base.webp` se ve que el
 * dibujo NO es una foto de un almacén: es un render que ya incluye la interfaz.
 * Contiene, pintados:
 *
 *   · las etiquetas de hilera —«RCL-01 112 ubicaciones», «RCL-03 32», «RCL-05 98»,
 *     «RCL-07 32»— con sus líneas de anclaje
 *   · las guías de nivel N01…N07 en el lateral izquierdo
 *   · las etiquetas de cuerpo C001…C012 a lo largo del suelo
 *   · un panel «ESTADO DEL SISTEMA» abajo a la izquierda, con cinco filas
 *   · dos pallets resaltados en cian, uno de ellos con su anillo de pulso
 *
 * El código dibujaba ENCIMA otro juego de etiquetas RCL y otro HUD de estado. De ahí
 * venían las dos quejas:
 *
 *   «RCL-03 32 ubicaciones» aparecía DOS VECES, con unos píxeles de desfase: una es
 *   del dibujo y la otra la pintaba el overlay.
 *
 *   Y el marcado se veía poco serio porque no era un marcado: era una segunda capa de
 *   interfaz peleándose con la que ya estaba, sin poder alinearse con ella.
 *
 * ── POR QUE `contain` Y NO `cover` ──────────────────────────────────────────
 *
 * Con `object-cover` se medía un recorte del 12 % del ancho a 1366 px y del 37 % a
 * 1280×1024. Recortar un 37 % de un dibujo que lleva su HUD abajo a la izquierda y sus
 * etiquetas arriba significa cortarle la interfaz: es exactamente «la imagen se pierde
 * en los márgenes».
 *
 * `contain` no recorta nada. Deja aire alrededor, y ese aire no molesta porque el fondo
 * del propio dibujo es un degradado oscuro con una retícula tenue, que es lo mismo que
 * hay detrás. Un dibujo compuesto se muestra entero o se rompe la composición.
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
  const contenedor = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /**
   * Dónde cae el dibujo DENTRO del contenedor, en píxeles.
   *
   * Con `contain` la imagen no llena su caja: queda centrada con aire a los lados o
   * arriba y abajo, según la proporción. El overlay tiene que ir sobre ese rectángulo y
   * no sobre el contenedor, o vuelve a estar en otro sistema de coordenadas —que es el
   * error que tenía: un `viewBox` cuadrado para un dibujo de proporción 1,5—.
   */
  const [marco, setMarco] = useState<{ left: number; top: number; w: number; h: number } | null>(
    null,
  );

  const onLoad = useCallback(() => setImgReady(true), []);
  const onError = useCallback(() => setImgFailed(true), []);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setImgReady(true);
  }, []);

  // ── El rectángulo del dibujo, medido y no supuesto ──────────────────────
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;

    const medir = () => {
      const c = el.getBoundingClientRect();
      if (c.width === 0 || c.height === 0) return;
      // `contain`: manda el eje que se queda corto.
      const escala = Math.min(c.width / ASSET_NATURAL_WIDTH, c.height / ASSET_NATURAL_HEIGHT);
      const w = ASSET_NATURAL_WIDTH * escala;
      const h = ASSET_NATURAL_HEIGHT * escala;
      setMarco({ left: (c.width - w) / 2, top: (c.height - h) / 2, w, h });
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (imgFailed) {
    return (
      <div ref={contenedor} className="absolute inset-0 overflow-hidden">
        <WarehouseSceneSvg reducedMotion={reducedMotion} />
      </div>
    );
  }

  return (
    <div ref={contenedor} className="absolute inset-0 overflow-hidden">
      {/* ── EL DIBUJO, ENTERO ──────────────────────────────────────────── */}
      <img
        ref={imgRef}
        src="/login/warehouse-base.webp"
        alt=""
        aria-hidden="true"
        width={ASSET_NATURAL_WIDTH}
        height={ASSET_NATURAL_HEIGHT}
        onLoad={onLoad}
        onError={onError}
        // `object-contain`: no se recorta nada. Y sin `objectPosition`, porque centrado
        // es lo único que se puede hacer coincidir con el overlay sin trucos.
        className="absolute inset-0 z-[1] h-full w-full object-contain"
      />

      {/*
        ── ATMOSFERA, LO MINIMO ──────────────────────────────────────────

        Antes había cuatro capas: viñeta radial, degradado al panel, degradado inferior
        y líneas de barrido al 2,5 %. El dibujo ya tiene su propia textura y su propia
        profundidad; cada capa encima le quita definición sin añadir nada.

        Queda solo el degradado hacia el panel de credenciales, que sí resuelve algo: el
        canto derecho del dibujo termina en seco contra el fondo del formulario.
      */}
      {imgReady && marco && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[2]"
          style={{
            left: marco.left,
            top: marco.top,
            width: marco.w,
            height: marco.h,
            background:
              'linear-gradient(to right, transparent 82%, color-mix(in oklab, var(--canvas) 85%, transparent))',
          }}
        />
      )}

      {/* ── LO VIVO, SOBRE EL RECTANGULO EXACTO DEL DIBUJO ─────────────── */}
      {imgReady && marco && (
        <div
          className="pointer-events-none absolute z-[3]"
          style={{ left: marco.left, top: marco.top, width: marco.w, height: marco.h }}
        >
          <InteractiveOverlay reducedMotion={reducedMotion} />
        </div>
      )}
    </div>
  );
});
