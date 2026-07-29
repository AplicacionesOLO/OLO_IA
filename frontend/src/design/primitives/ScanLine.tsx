/**
 * SCANLINE — sustituye al spinner generico.
 *
 * Un spinner circular no comunica nada: el usuario no sabe si falta 1 segundo o
 * 60, ni QUE se esta procesando. Un barrido sobre una region concreta comunica
 * "estoy analizando ESTO".
 *
 * Es CSS puro (una keyframe de transform) para que su coste sea despreciable
 * aunque haya varios simultaneos.
 */

import { cn } from '../utils/cn';

interface ScanLineProps {
  /** Naturaleza del proceso: mide o infiere. Determina el color. */
  nature?: 'measured' | 'inferred';
  className?: string;
}

export function ScanLine({ nature = 'inferred', className }: ScanLineProps) {
  const color = nature === 'measured' ? 'var(--data-measured)' : 'var(--data-inferred)';

  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <span
        className="olo-scan-line absolute inset-x-0 h-[2px]"
        style={{
          // El gradiente que se desvanece en los extremos es lo que hace que
          // parezca un haz y no una barra.
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          boxShadow: `0 0 12px ${color}`,
        }}
      />
    </span>
  );
}
