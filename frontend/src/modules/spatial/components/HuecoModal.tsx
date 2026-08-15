/**
 * EL HUECO, SIN SALIR DEL PLANO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ ARREGLA
 *
 * Se puede ver el almacén en 3D con cada hueco pintado por lo que la cámara vio, pero
 * para saber QUÉ vio en uno concreto había que salir: irse a la tabla de reconciliación,
 * buscar la fila, y perder el sitio en el plano. Y volver a encontrar el mismo rack entre
 * 347, con la cámara donde se quedó, no es gratis: es la razón por la que la gente deja de
 * comprobar.
 *
 * Por eso es un modal y no una navegación —fue lo que se pidió, «como un modal, no
 * redirigir a spatial»—: al cerrar, el plano sigue exactamente donde estaba.
 *
 * ── LO QUE ENSEÑA, Y POR QUÉ NO CONSULTA NADA ─────────────────────────────────
 *
 * Todo sale del `SlotLeido` que el visor YA tiene pintado: el mismo dato que decidió el
 * color de la celda. Cero red, y —más importante— cero posibilidad de que el modal diga
 * una cosa y el color otra, que es lo que pasa cuando se vuelve a pedir por otra vía.
 *
 * Las tres imágenes y el «lo que se vio frente a lo que el WMS declara» son los MISMOS
 * componentes de la barra de estado de Spatial. No es ahorro de código: es que ese
 * bloque ya resuelve tres cosas que aquí volverían a decidirse mal —qué significa una
 * imagen que falta, que «no se leyó» no es «no había nada», y que los dos códigos van
 * separados—.
 */

import { X } from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '../../../design/utils/cn';
import { LecturaObservada } from './SelectionReadout';
import { COLOR_SLOT, estadoDeSlot } from '../inspection';
import type { SlotLeido } from '../inspection';

export function HuecoModal({
  slot,
  onCerrar,
  onAbrirEnSpatial,
}: {
  /** El hueco tocado, con su lectura. `null` cierra. */
  slot: SlotLeido | null;
  onCerrar: () => void;
  /**
   * Ir al hueco en Spatial. Opcional: el modal se basta solo.
   *
   * Recibe el `locationId` y no el codigo porque es lo que el enlace profundo de Spatial
   * espera —selecciona por id—. Mandar el codigo abriria la pantalla sin nada elegido.
   */
  onAbrirEnSpatial?: ((locationId: string) => void) | undefined;
}) {
  //  Escape cierra. Es la tecla que la gente pulsa sin pensar, y sin ella un modal sobre
  //  un lienzo que captura el raton se siente atrapado.
  useEffect(() => {
    if (!slot) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [slot, onCerrar]);

  if (!slot) return null;

  const estado = estadoDeSlot(slot.status);
  const meta = COLOR_SLOT[estado];

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4 [background:color-mix(in_oklab,var(--bg-base)_62%,transparent)]"
      /* Pulsar el fondo cierra; pulsar la tarjeta no. Sin el `stopPropagation` de dentro,
         leer el modal lo cerraria. */
      onClick={onCerrar}
      role="presentation"
    >
      <div
        className={cn(
          'flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-[var(--radius-md)] px-4 py-3',
          '[background:var(--glass-3)] shadow-[var(--rim-2)]',
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Hueco ${slot.locationCode ?? ''}`}
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: meta.color }}
            />
            <span className="t-mono-xs text-[length:var(--text-sm)] text-[var(--text-primary)]">
              {slot.locationCode ?? 'hueco sin codigo'}
            </span>
            <span className="t-mono-xs" style={{ color: meta.color }}>
              {meta.etiqueta}
            </span>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--text-primary)]"
          >
            <X strokeWidth={1.5} className="size-4" />
          </button>
        </div>

        {/*  Dónde está, en los términos del almacén. Sin esto el código completo es la
            única referencia, y un código como `RCL47-C018-N01-2` no se lee de un vistazo. */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          {(
            [
              ['cuerpo', slot.bayIndex],
              ['nivel', slot.level],
              ['posicion', slot.position],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="t-label">{k}</dt>
              <dd
                className={cn(
                  't-mono-xs',
                  v == null ? 'text-[var(--text-faint)]' : 'text-[var(--text-primary)]',
                )}
              >
                {v ?? 'sin declarar'}
              </dd>
            </div>
          ))}
        </dl>

        <LecturaObservada ov={slot} />

        {onAbrirEnSpatial && (
          <button
            type="button"
            onClick={() => onAbrirEnSpatial(slot.locationId)}
            className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 [background:var(--glass-2)] hover:[background:var(--glass-1)]"
          >
            <span className="t-mono-xs text-[var(--text-secondary)]">Abrir en Spatial</span>
          </button>
        )}
      </div>
    </div>
  );
}
