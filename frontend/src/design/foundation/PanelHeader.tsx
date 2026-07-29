/**
 * PANELHEADER — encabezado de panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE CAMBIAN RESPECTO AL `StationHeader` ANTERIOR
 *
 * 1. NO hay linea divisoria bajo el titulo. La separacion entre encabezado y
 *    contenido la da el espacio (20px), no un `border-b`.
 * 2. NO va pegado a los bordes. El anterior tenia altura fija de 36px y padding
 *    horizontal propio, asi que el titulo quedaba contra el canto del panel.
 *    Este hereda el padding del `Panel`, que es generoso por defecto.
 * 3. El titulo va en CAPITALIZACION NORMAL. El encabezado en mayusculas era,
 *    mas que ningun color, lo que producia la sensacion de terminal.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

interface PanelHeaderProps {
  title: string;
  /** Contexto de una linea. Opcional: no todos los paneles lo necesitan. */
  subtitle?: string;
  /** Contenido alineado a la derecha: un badge, un estado, una accion. */
  trailing?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, subtitle, trailing, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex shrink-0 items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="t-panel-title truncate">{title}</h2>
        {subtitle && <p className="t-panel-sub truncate">{subtitle}</p>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2.5">{trailing}</div>}
    </div>
  );
}
