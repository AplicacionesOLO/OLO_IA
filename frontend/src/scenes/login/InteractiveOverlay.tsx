/**
 * LO VIVO SOBRE EL DIBUJO DEL ALMACEN. Una sola cosa, y bien puesta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE HABIA ANTES, Y POR QUE NO PODIA VERSE BIEN
 *
 * Este archivo dibujaba cuatro rectángulos sobre las hileras, cuatro etiquetas
 * «RCL-xx / 32 ubicaciones» con sus líneas de anclaje, un pulso de evento con su propia
 * etiqueta «lectura confirmada», y todo con un filtro de resplandor. Tres problemas
 * encadenados:
 *
 *   1. EL DIBUJO YA TRAE ESO. `warehouse-base.webp` es un render que incluye sus
 *      etiquetas de hilera, sus guías de nivel, sus etiquetas de cuerpo y su panel de
 *      estado. Se pintaba una segunda interfaz sobre la primera. «RCL-03 32
 *      ubicaciones» salía dos veces con unos píxeles de desfase.
 *
 *   2. NO PODIA ALINEARSE. El `viewBox` era `0 0 100 100` —cuadrado— para porcentajes
 *      de un dibujo de proporción 1,5: los dos ejes escalaban distinto. Y el recorte no
 *      coincidía: la imagen con `object-position: 48% 50%` y el SVG con `xMidYMid`, que
 *      es 50%. Ningún ajuste de números lo arreglaba.
 *
 *   3. DEMASIADO MOVIMIENTO. Se midieron 123 animaciones simultáneas en la pantalla de
 *      acceso. Lo que hace que algo parezca poco serio no es el color: es cuántas cosas
 *      se mueven a la vez mientras intentas escribir una contraseña.
 *
 * ── QUE HACE AHORA ──────────────────────────────────────────────────────────
 *
 * Un anillo que respira sobre el pallet que el PROPIO DIBUJO ya tiene resaltado en
 * cian, con una leyenda corta al lado. Nada más: ni cajas, ni etiquetas de hilera, ni
 * HUD, ni interactividad.
 *
 * Que coincida con el resaltado del dibujo es la diferencia entre «el sistema está
 * vivo» y «alguien ha puesto un adorno encima»: el anillo no señala algo nuevo, hace
 * latir lo que la composición ya señalaba.
 *
 * ── POR QUE SE QUITO LA INTERACTIVIDAD ──────────────────────────────────────
 *
 * Las hileras eran clicables y al pulsarlas seleccionaban una. En una pantalla de
 * acceso eso no lleva a ningún sitio: es un control que responde y no hace nada, que se
 * lee peor que una imagen quieta. El sitio para explorar hileras es el explorador, y
 * hay que identificarse para llegar.
 */

import { memo } from 'react';
import { motion } from 'framer-motion';

import { ASSET_NATURAL_HEIGHT, ASSET_NATURAL_WIDTH, PUNTO_VIVO, toPxX, toPxY } from './hotspots';

interface InteractiveOverlayProps {
  reducedMotion: boolean;
}

export const InteractiveOverlay = memo(function InteractiveOverlay({
  reducedMotion,
}: InteractiveOverlayProps) {
  const cx = toPxX(PUNTO_VIVO.x);
  const cy = toPxY(PUNTO_VIVO.y);

  return (
    <svg
      className="h-full w-full"
      /*
        El MISMO espacio que el dibujo: píxeles del asset. Y sin `preserveAspectRatio`
        raro, porque quien lo posiciona ya le da el rectángulo exacto que ocupa la
        imagen —`LoginWarehouseVisual` lo mide con un ResizeObserver—. Así un punto al
        58 % del dibujo cae al 58 % del dibujo, y no al 58 % de una caja distinta.
      */
      viewBox={`0 0 ${ASSET_NATURAL_WIDTH} ${ASSET_NATURAL_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/*
        El anillo. Un solo elemento animado en toda la escena.

        Se expande y se apaga en seis segundos: lo bastante lento para que no tire de la
        vista y lo bastante visible para que se note que algo respira. Con
        `prefers-reduced-motion` se queda quieto —un aro fino y estático— en lugar de
        desaparecer: la marca sigue diciendo dónde mira el sistema.
      */}
      {reducedMotion ? (
        <circle cx={cx} cy={cy} r={26} fill="none" stroke="rgba(94,231,251,0.5)" strokeWidth={1.5} />
      ) : (
        <>
          <motion.circle
            cx={cx}
            cy={cy}
            fill="none"
            stroke="rgba(94,231,251,0.55)"
            strokeWidth={1.5}
            initial={{ r: 10, opacity: 0 }}
            animate={{ r: [10, 46], opacity: [0, 0.55, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeOut', times: [0, 0.25, 1] }}
          />
          <circle cx={cx} cy={cy} r={4} fill="rgba(94,231,251,0.9)" />
        </>
      )}

      {/*
        La leyenda: monoespaciada, pequeña y sin caja.

        Sin recuadro ni fondo a propósito. Una plaquita con borde es un elemento de
        interfaz, y encima de un dibujo que ya tiene los suyos sería el quinto. Texto
        suelto con una sombra suave se lee y no compite.
      */}
      {/*
        A la IZQUIERDA del anillo, no a la derecha.

        A la derecha caía justo encima de la etiqueta «RCL-05 98 ubicaciones» que el
        dibujo ya trae pintada: dos textos superpuestos, que es la misma clase de
        problema que este archivo venía a arreglar. A la izquierda hay pasillo vacío.
      */}
      <text
        textAnchor="end"
        x={cx - 34}
        y={cy + 6}
        fill="rgba(200,230,240,0.72)"
        fontSize={19}
        fontFamily="var(--font-data), monospace"
        letterSpacing={0.6}
        style={{ paintOrder: 'stroke', stroke: 'rgba(2,8,17,0.55)', strokeWidth: 3 }}
      >
        lectura activa
      </text>
    </svg>
  );
});
