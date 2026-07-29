/**
 * AREASPARK — serie temporal como area luminosa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO tiene ejes, ni rejilla, ni marco. Deliberado: los ejes y la cuadricula son
 * exactamente el lenguaje que habia que eliminar. La forma de la curva es la
 * informacion; la escala se comunica con el valor numerico que acompaña al
 * grafico, no con una regla dibujada.
 *
 * La curva es Catmull-Rom suavizada y el relleno se desvanece hacia abajo, asi
 * que el grafico se funde con el panel en lugar de terminar en una linea.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Generico por contrato: recibe `number[]`. No sabe si son detecciones, unidades
 * o milisegundos.
 */

import { memo, useId, useMemo } from 'react';
import { closeToBase, smoothPath, toPoints } from './geometry';
import { naturePaint, type ChartNature } from './nature';
import { cn } from '../utils/cn';

interface AreaSparkProps {
  values: readonly number[];
  nature?: ChartNature;
  /** Marca el ultimo punto con un nodo luminoso que late. */
  markLast?: boolean;
  reducedMotion?: boolean;
  className?: string;
}

const VB = { width: 300, height: 100, padY: 12 } as const;

function AreaSparkImpl({
  values,
  nature = 'measured',
  markLast = true,
  reducedMotion = false,
  className,
}: AreaSparkProps) {
  // `useId` produce `:r0:`, que no es un identificador valido dentro de `url()`.
  const uid = useId().replace(/:/g, '');
  const paint = naturePaint[nature];

  const { line, area, last } = useMemo(() => {
    const points = toPoints(values, VB);
    const linePath = smoothPath(points);
    const tail = points[points.length - 1] ?? null;
    return {
      line: linePath,
      area: closeToBase(linePath, points, VB.height),
      // Se guarda en porcentaje: el marcador se posiciona con CSS y asi
      // permanece circular aunque el SVG se estire (ver nota de abajo).
      last: tail
        ? { xPct: (tail[0] / VB.width) * 100, yPct: (tail[1] / VB.height) * 100 }
        : null,
    };
  }, [values]);

  if (values.length === 0) return null;

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* `preserveAspectRatio="none"` es necesario para que el area ocupe todo
          el ancho del panel sin dejar franjas. El efecto secundario es que
          cualquier circulo dentro del SVG se deformaria en elipse — por eso el
          marcador del ultimo punto vive FUERA del SVG, como un div. */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB.width} ${VB.height}`}
        preserveAspectRatio="none"
      >
        <defs>
          {/* El relleno se desvanece a transparente: es lo que evita que el
              area termine en un bloque de color con canto recto. */}
          <linearGradient id={`ar-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={paint.fillTop} stopOpacity="0.3" />
            <stop offset="55%" stopColor={paint.fillTop} stopOpacity="0.08" />
            <stop offset="100%" stopColor={paint.fillTop} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#ar-${uid})`} />

        {/* `vectorEffect` mantiene el grosor constante pese al estirado en X. */}
        <path
          d={line}
          fill="none"
          stroke={paint.stroke}
          strokeWidth={1.8}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ filter: `drop-shadow(0 0 6px ${paint.glow})` }}
        />
      </svg>

      {markLast && last && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2',
            'rounded-full',
            !reducedMotion && 'olo-pulse',
          )}
          style={{
            left: `${last.xPct}%`,
            top: `${last.yPct}%`,
            background: paint.stroke,
            boxShadow: `0 0 0 4px ${paint.glow}, 0 0 14px 2px ${paint.glow}`,
          }}
        />
      )}
    </div>
  );
}

export const AreaSpark = memo(AreaSparkImpl);
