/**
 * LECTURA DE LA SELECCION — la linea de estado del operador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE, SI EL INSPECTOR YA MUESTRA ESTO
 *
 * Porque el inspector se puede colapsar y porque el operador trabaja mirando el
 * rack, no el panel derecho. Esta barra es el equivalente a la linea de estado de
 * una consola industrial: dice QUE esta seleccionado sin apartar la vista del rack.
 *
 * Y porque el hueco existe: un rack de 27 cuerpos y 7 niveles es un objeto de 6,9:1
 * dentro de un area de trabajo de 1,8:1. Encajado por ancho —que es lo que hay que
 * hacer para poder contar los cuerpos— deja mas de la mitad del alto sin usar. Esto
 * es lo que ocupa ese alto, y es informacion, no relleno.
 *
 * ── NO AÑADE NINGUNA CONSULTA ───────────────────────────────────────────────
 *
 * Consume el mismo `useLocationDetail()` que el inspector. Si la ubicacion ya esta
 * cargada, esto es cero red.
 *
 * ── LOS TRES CAMPOS QUE NO SE INVENTAN ──────────────────────────────────────
 *
 *   · nivel y posicion pueden ser `null` (codigo opaco): se dice «sin declarar»,
 *     no se pone 1;
 *   · la capacidad tiene TRES estados y «sin limite declarado» no es un numero;
 *   · el estado espacial y la situacion del WMS van SEPARADOS, porque en 2.365
 *     ubicaciones del catalogo real se contradicen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { MousePointerClick } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import { capacidadResumen } from './LocationDetail';
import { STATUS_META, situationDescription, situationLabel } from './StatusLegend';
import type { SpatialLocation } from '../types/index';

export function SelectionReadout({
  location,
  loading,
  hayId,
  className,
}: {
  location: SpatialLocation | undefined;
  loading: boolean;
  /** Si hay una ubicacion ELEGIDA. Distinto de tenerla ya cargada. */
  hayId: boolean;
  className?: string;
}) {
  if (!hayId) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius-md)] px-4 py-3 [background:var(--glass-1)]',
          className,
        )}
      >
        <MousePointerClick strokeWidth={1.5} className="size-3.5 text-[var(--icon-muted)]" />
        <span className="t-mono-xs text-[var(--text-faint)]">
          Pulsa una celda del rack para leer su ubicacion. Doble clic la centra.
        </span>
      </div>
    );
  }

  if (loading || !location) {
    return (
      <div
        className={cn(
          'flex items-center rounded-[var(--radius-md)] px-4 py-3 [background:var(--glass-1)]',
          className,
        )}
      >
        <span className="t-mono-xs animate-pulse text-[var(--text-faint)]">
          Cargando la ubicacion…
        </span>
      </div>
    );
  }

  const meta = STATUS_META[location.status];
  const campos: [string, string][] = [
    ['rack', location.rackCode ?? '—'],
    ['cuerpo', location.bayCode ?? '—'],
    ['nivel', location.logicalLevel != null ? String(location.logicalLevel) : 'sin declarar'],
    [
      'posicion',
      location.logicalPosition != null ? String(location.logicalPosition) : 'sin declarar',
    ],
    ['codigo completo', location.code],
    ['forma', location.codeForm],
    ['origen', location.origin],
    ['capacidad', capacidadResumen(location.capacity)],
  ];

  return (
    <div
      className={cn(
        'flex flex-col gap-3 overflow-y-auto rounded-[var(--radius-md)] px-4 py-3',
        '[background:var(--glass-1)] shadow-[var(--rim-1)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="t-label">Seleccionado</span>
        <span className="t-mono-xs text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {location.code}
        </span>
        <span
          className="flex items-center gap-1.5 rounded-[var(--radius-full)] px-2 py-0.5"
          style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)` }}
          title={meta.description}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: meta.color }} />
          <span className="t-mono-xs text-[var(--text-secondary)]">{meta.label}</span>
        </span>
        <span
          className="rounded-[var(--radius-full)] px-2 py-0.5 [background:var(--glass-2)]"
          title={situationDescription(location.situation)}
        >
          <span className="t-mono-xs text-[var(--text-muted)]">
            WMS {situationLabel(location.situation)}
          </span>
        </span>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {campos.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="t-label">{k}</dt>
            <dd
              className={cn(
                't-mono-xs',
                v === 'sin declarar' || v === '—'
                  ? 'text-[var(--text-faint)]'
                  : 'text-[var(--text-primary)]',
              )}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
