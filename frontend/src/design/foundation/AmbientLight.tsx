/**
 * AMBIENT LIGHT — la luz del lienzo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Resuelve la queja de "negro plano".
 *
 * Tres focos de luz radiales muy difusos, colocados asimetricamente, mas una
 * vignette que cierra los bordes del viewport. El resultado es un fondo con
 * profundidad y direccion de luz, sin usar una sola imagen ni un solo borde.
 *
 * Los focos derivan MUY lentamente (periodos de 30-45 segundos, desfasados
 * entre si) para que el fondo nunca este del todo quieto. El movimiento es
 * imperceptible de forma consciente y perceptible de forma ambiental: es lo que
 * hace que una captura estatica se sienta viva.
 *
 * Coste: 3 divs con `background` radial y una animacion CSS de `transform`.
 * Cero JavaScript, cero re-renders.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { memo } from 'react';
import { cn } from '../utils/cn';

interface AmbientLightProps {
  /** Atenua toda la luz. Para zonas donde el contenido debe dominar. */
  intensity?: number;
  /** Desactiva la deriva. */
  still?: boolean;
  /** Añade la vignette de cierre de bordes. */
  vignette?: boolean;
  className?: string;
}

function AmbientLightImpl({
  intensity = 1,
  still = false,
  vignette = true,
  className,
}: AmbientLightProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={{ opacity: intensity }}
    >
      <span
        className={cn('absolute inset-0', !still && 'olo-drift-a')}
        style={{ background: 'var(--ambient-glow-a)' }}
      />
      <span
        className={cn('absolute inset-0', !still && 'olo-drift-b')}
        style={{ background: 'var(--ambient-glow-b)' }}
      />
      <span
        className={cn('absolute inset-0', !still && 'olo-drift-c')}
        style={{ background: 'var(--ambient-glow-c)' }}
      />
      {vignette && (
        <span className="absolute inset-0" style={{ background: 'var(--vignette)' }} />
      )}
    </div>
  );
}

export const AmbientLight = memo(AmbientLightImpl);
