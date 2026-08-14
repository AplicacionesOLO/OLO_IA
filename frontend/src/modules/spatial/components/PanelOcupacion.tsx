/**
 * PANEL DE OCUPACION — que hay en el almacen, y que no cuadra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE ESTE PANEL DICE Y NO CALLA
 *
 *   1. DE QUE FOTO son los numeros. Un porcentaje de ocupacion sin fecha es una cifra
 *      que parece de hoy y puede ser de la semana pasada. La foto del WMS llega una
 *      vez al dia como mucho, asi que la fecha es parte del dato.
 *
 *   2. QUE SIN FOTO NO ES CERO. Si nadie ha importado inventario, la ocupacion no es
 *      «0 %»: es desconocida. Pintar 0 afirmaria que el almacen esta vacio, que es
 *      una afirmacion sobre el mundo que nadie ha comprobado.
 *
 *   3. LO QUE NO CUADRA. 2.186 huecos donde el WMS se contradice consigo mismo y 773
 *      lineas que apuntan a un hueco inexistente. Es el dato que nadie mira hasta que
 *      algo va mal, y para entonces hay que poder mirarlo sin escribir una consulta.
 *
 * ── LO QUE NO OFRECE ──────────────────────────────────────────────────────
 *
 * Ningun boton de editar. El WMS es el sistema de origen y esto es su espejo: la
 * unica escritura es importar una foto nueva, y eso pasa por fuera de la aplicacion.
 * Quien cuenta lo que hay en el pasillo no esta corrigiendo el inventario, esta
 * observando, y para eso esta el panel de flota.
 */

import { useState } from 'react';
import { AlertTriangle, Boxes, PackageSearch, RefreshCw } from 'lucide-react';

import { Modal } from '../../../design/foundation/Modal';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../lib/apiErrors';
import { useDescuadres, useInventoryResumen } from '../services/useSpatial';

const ETIQUETA_DESCUADRE: Record<string, string> = {
  dice_ocupado_sin_stock: 'el WMS lo marca OCUPADO y no tiene stock',
  dice_libre_con_stock: 'el WMS lo marca LIBRE y si tiene stock',
  bloqueado_con_stock: 'bloqueado, pero con carga dentro',
};

export function PanelOcupacion({ warehouseId }: { warehouseId: string }) {
  const resumen = useInventoryResumen(warehouseId);
  const [verDescuadres, setVerDescuadres] = useState(false);
  // Los descuadres solo se piden si alguien abre el detalle: son dos consultas
  // agregadas sobre 29.312 filas y nadie las mira en cada carga de la pantalla.
  const descuadres = useDescuadres(warehouseId, verDescuadres);

  const d = resumen.data;
  const sinFoto = d != null && d.snapshot === null;

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline-strong)] pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Ocupacion</span>
        <button
          type="button"
          onClick={() => void resumen.refetch()}
          className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
        >
          <RefreshCw strokeWidth={1.5} className={cn('size-3', resumen.isFetching && 'animate-spin')} />
          {resumen.isFetching ? 'leyendo…' : 'releer'}
        </button>
      </div>

      {resumen.isError && (
        <p className="t-mono-xs text-[var(--text-warn)]">
          {resumen.error instanceof ApiError
            ? humanMessage(resumen.error)
            : 'No se pudo leer la ocupacion.'}
        </p>
      )}

      {sinFoto && (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] p-2">
          <Boxes strokeWidth={1.5} className="mt-0.5 size-3.5 shrink-0 text-[var(--icon-muted)]" />
          <p className="t-mono-xs text-[var(--text-faint)]">
            Nadie ha importado el inventario de este almacen todavia, asi que la ocupacion
            no se conoce. No es que este vacio: es que no hay foto del WMS.
          </p>
        </div>
      )}

      {d?.snapshot && (
        <>
          {/* La barra: es la lectura de un vistazo, y el numero exacto va al lado. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-[family-name:var(--font-data)] text-[length:var(--text-lg)] text-[var(--text-primary)]">
                {d.occupancy_pct}%
              </span>
              <span className="t-mono-xs text-[var(--text-faint)]">
                {d.occupied.toLocaleString('es')} de {d.locations.toLocaleString('es')} huecos
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full [background:var(--hairline-strong)]"
              role="img"
              aria-label={`Ocupacion ${d.occupancy_pct} por ciento`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${d.occupancy_pct ?? 0}%`,
                  background:
                    (d.occupancy_pct ?? 0) > 95
                      ? 'var(--state-critical)'
                      : (d.occupancy_pct ?? 0) > 75
                        ? 'var(--state-alert)'
                        : 'var(--accent)',
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Linea k="libres" v={d.free.toLocaleString('es')} />
            <Linea k="unidades" v={d.units != null ? Math.round(d.units).toLocaleString('es') : '—'} />
            <Linea k="pallets" v={d.pallets != null ? d.pallets.toLocaleString('es') : '—'} />
            <Linea k="foto del WMS" v={fecha(d.snapshot.taken_at)} />
            <Linea k="lineas" v={d.snapshot.row_count.toLocaleString('es')} />
            {d.first_expiry && <Linea k="primera caducidad" v={fecha(d.first_expiry)} />}
          </div>

          <Button variant="secondary" size="xs" onClick={() => setVerDescuadres(true)}>
            <AlertTriangle strokeWidth={1.5} className="size-3" />
            Ver descuadres del WMS
          </Button>

          <p className="t-mono-xs flex gap-1.5 text-[var(--text-faint)]">
            <PackageSearch strokeWidth={1.5} className="mt-0.5 size-3 shrink-0" />
            <span>
              Espejo de solo lectura del WMS. El inventario se actualiza importando una foto
              nueva, no editando aqui: dos verdades sobre lo que hay en un hueco harian que
              la de este lado fuera la equivocada.
            </span>
          </p>
        </>
      )}

      {/* ── Los descuadres, en un modal del sistema ─────────────────────── */}
      <Modal
        abierto={verDescuadres}
        titulo="Descuadres del WMS: se contradice consigo mismo"
        descripcion={
          'Estos huecos vienen del mismo sistema y se contradicen: la situacion que declara ' +
          'el catalogo no coincide con las lineas de stock que tiene. No se corrige desde ' +
          'aqui —es un dato del WMS— pero conviene saber cuanto hay.'
        }
        onCerrar={() => setVerDescuadres(false)}
        acciones={
          <Button variant="secondary" size="xs" onClick={() => setVerDescuadres(false)}>
            Entendido
          </Button>
        }
      >
        {descuadres.isLoading && (
          <p className="t-mono-xs text-[var(--text-faint)]">contando…</p>
        )}
        {descuadres.isError && (
          <p className="t-mono-xs text-[var(--text-warn)]">
            {descuadres.error instanceof ApiError
              ? humanMessage(descuadres.error)
              : 'No se pudo leer el informe.'}
          </p>
        )}
        {descuadres.data && (
          <>
            <div className="flex flex-col gap-1.5">
              {Object.entries(descuadres.data.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([tipo, n]) => (
                  <div key={tipo} className="flex items-baseline justify-between gap-3">
                    <span className="t-mono-xs text-[var(--text-muted)]">
                      {ETIQUETA_DESCUADRE[tipo] ?? tipo}
                    </span>
                    <span className="t-mono-xs shrink-0 text-[var(--text-primary)]">
                      {n.toLocaleString('es')}
                    </span>
                  </div>
                ))}
            </div>

            {descuadres.data.orphan_lines > 0 && (
              <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 bg-[var(--state-alert)]/8 p-2">
                <AlertTriangle
                  strokeWidth={1.5}
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--text-warn)]"
                />
                <p className="t-mono-xs text-[var(--text-muted)]">
                  {descuadres.data.orphan_lines.toLocaleString('es')} lineas de stock apuntan a{' '}
                  {descuadres.data.orphan_stock.length} codigos de ubicacion que el catalogo
                  espacial NO conoce
                  {descuadres.data.orphan_stock.length > 0 && (
                    <>
                      {' '}
                      ({descuadres.data.orphan_stock.slice(0, 3).map((o) => o.location_code).join(', ')}
                      {descuadres.data.orphan_stock.length > 3 ? '…' : ''})
                    </>
                  )}
                  . No se descartan al importar: son la discrepancia entre los dos sistemas, y
                  esconderla seria esconder la pregunta de cual de los dos esta desactualizado.
                </p>
              </div>
            )}

            <details>
              <summary className="t-mono-xs cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-muted)]">
                los primeros {descuadres.data.listed.length} de {descuadres.data.total.toLocaleString('es')}
              </summary>
              <ul className="mt-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {descuadres.data.listed.map((m) => (
                  <li key={m.location_id} className="flex items-baseline justify-between gap-2">
                    <span className="t-mono-xs text-[var(--text-muted)]">{m.location_code}</span>
                    <span className="t-mono-xs text-right text-[var(--text-faint)]">
                      {m.wms_situation ?? '—'} · {m.lines} lineas
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </Modal>
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-mono-xs text-[var(--text-faint)]">{k}</span>
      <span className="t-mono-xs text-right text-[var(--text-muted)]">{v}</span>
    </div>
  );
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
