/**
 * LA BANDEJA DE INCIDENCIAS — lo que hay que ir a comprobar al pasillo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LO MAS VIEJO PRIMERO, AL REVES QUE TODAS LAS DEMAS LISTAS
 *
 * Una incidencia de hace tres semanas es peor que una de esta mañana: lleva tres
 * semanas sin que nadie la toque. Ordenar por «más reciente» —el reflejo en cualquier
 * lista— la entierra justo cuando más urge.
 *
 * El orden lo pone el servidor; aquí se limita a mostrarse, con los días abiertos
 * delante para que el motivo del orden se vea.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CERRAR AQUI NO CORRIGE EL INVENTARIO
 *
 * Y la pantalla lo dice, porque es el malentendido caro: alguien podría cerrar veinte
 * incidencias creyendo que con eso arregló el stock. Lo que se registra es que una
 * persona fue, miró y decidió. El WMS sigue siendo el sistema de origen.
 */

import { useState } from 'react';
import { ClipboardList, History } from 'lucide-react';

import { AsyncStatus, fase } from '../../../design/foundation/AsyncStatus';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge, Button } from '../../../design/primitives';
import { cn } from '../../../design/utils/cn';
import { ApiError } from '../../../lib/apiErrors';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useAlmacenActivo, useResolviendoAlmacen } from '../../inventory/useInventory';
import { useBandeja, useCambiarEstado, useEventos } from '../useIncidents';
import {
  CIERRAN,
  ESTADO_INFO,
  TRANSICIONES,
  type Incident,
  type IncidentStatus,
} from '../types';

const FILTROS: (IncidentStatus | null)[] = [null, 'open', 'in_progress', 'resolved', 'dismissed'];

export function IncidentsPage() {
  const almacen = useAlmacenActivo();
  const resolviendo = useResolviendoAlmacen();
  const [filtro, setFiltro] = useState<IncidentStatus | null>('open');
  const { data, isLoading, isError } = useBandeja(almacen, filtro);
  const [abierta, setAbierta] = useState<string | null>(null);

  if (!almacen) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="xl">
          {resolviendo ? (
            <AsyncStatus phase="pending" pendingLabel="Buscando tus almacenes" />
          ) : (
            <p className="t-mono-xs text-[var(--text-faint)]">
              No tienes ningún almacén asignado, así que no hay incidencias que mostrar.
            </p>
          )}
        </Panel>
      </CanvasHost>
    );
  }

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Incidencias
          </h1>
          <p className="t-panel-sub mt-1 max-w-[68ch]">
            Descuadres a los que alguien puso nombre y dueño. Se abren desde{' '}
            <strong>Inventario</strong>, en cada hueco que no cuadra.
          </p>
        </div>

        <Panel level="work" radius="xl">
          <PanelHeader
            title="La bandeja"
            subtitle="Lo más viejo primero: llevar tres semanas parada es peor que ser reciente"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {FILTROS.map((f) => (
              <button
                key={f ?? 'todas'}
                type="button"
                onClick={() => setFiltro(f)}
                aria-pressed={filtro === f}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-[var(--radius-xs)] px-3 text-[length:var(--text-xs)] transition-colors',
                  'pointer-coarse:min-h-11',
                  filtro === f
                    ? '[background:var(--glass-3)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:[background:var(--glass-2)]',
                )}
              >
                {f ? ESTADO_INFO[f].etiqueta : 'Todas'}
                {data && (
                  <Badge
                    tone={f === 'open' && (data.counts.open ?? 0) > 0 ? 'alert' : 'neutral'}
                    size="sm"
                  >
                    {f
                      ? (data.counts[f] ?? 0).toLocaleString('es')
                      : Object.values(data.counts)
                          .reduce((a, n) => a + n, 0)
                          .toLocaleString('es')}
                  </Badge>
                )}
              </button>
            ))}
          </div>

          {filtro && (
            <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
              {ESTADO_INFO[filtro].explica}
            </p>
          )}

          {isLoading && (
            <div className="mt-4">
              <AsyncStatus phase="pending" pendingLabel="Leyendo la bandeja" />
            </div>
          )}
          {isError && (
            <p className="t-mono-xs mt-4 text-[var(--text-faint)]">
              No se pudo leer la bandeja de incidencias.
            </p>
          )}

          {data && data.items.length === 0 && (
            <p className="t-mono-xs mt-4 max-w-[72ch] text-[var(--text-faint)]">
              {filtro === 'open'
                ? 'No hay ninguna incidencia abierta. Se abren desde Inventario, en la lista de lo que no cuadra: son 2.186 huecos esperando a que alguien los mire.'
                : 'Nada en este estado.'}
            </p>
          )}

          {data && data.items.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {data.items.map((i) => (
                <Fila
                  key={i.id}
                  incidencia={i}
                  abierta={abierta === i.id}
                  onAlternar={() => setAbierta(abierta === i.id ? null : i.id)}
                />
              ))}
              {data.truncated && (
                <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
                  Se muestran {data.items.length}. Los recuentos de arriba son del total.
                </p>
              )}
            </div>
          )}
        </Panel>

        <p className="t-mono-xs max-w-[76ch] text-[var(--text-faint)]">
          <strong>Cerrar una incidencia no corrige el inventario.</strong> Registra que
          alguien fue al pasillo y decidió algo. Si el hueco estaba vacío, quien tiene que
          corregirse es el WMS: esto recuerda que se comprobó.
        </p>
      </div>
    </CanvasHost>
  );
}

// ── Una incidencia ──────────────────────────────────────────────────────────

function Fila({
  incidencia,
  abierta,
  onAlternar,
}: {
  incidencia: Incident;
  abierta: boolean;
  onAlternar: () => void;
}) {
  const cerrada = CIERRAN.includes(incidencia.status);
  return (
    <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {incidencia.location_code ?? '—'}
        </span>
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {incidencia.title}
        </span>
        <Badge tone={cerrada ? 'neutral' : 'alert'} size="sm">
          {ESTADO_INFO[incidencia.status]?.etiqueta ?? incidencia.status}
        </Badge>
        {/*
          Los días delante y en ámbar a partir de una semana: es lo que justifica que la
          lista esté ordenada al revés que todas las demás.
        */}
        <span
          className={cn(
            't-mono-xs',
            !cerrada && incidencia.dias_abierta >= 7
              ? 'text-[var(--text-warn)]'
              : 'text-[var(--text-faint)]',
          )}
        >
          {cerrada
            ? `cerrada tras ${incidencia.dias_abierta} día(s)`
            : incidencia.dias_abierta === 0
              ? 'abierta hoy'
              : `${incidencia.dias_abierta} día(s) abierta`}
        </span>
        <span className="t-mono-xs ml-auto text-[var(--text-faint)]">
          {incidencia.assigned_to_name ?? 'sin asignar'}
        </span>
        <Button variant="ghost" size="xs" onClick={onAlternar} aria-expanded={abierta}>
          {abierta ? 'Cerrar' : 'Abrir'}
        </Button>
      </div>

      {abierta && <Detalle incidencia={incidencia} />}
    </div>
  );
}

function Detalle({ incidencia }: { incidencia: Incident }) {
  const cambiar = useCambiarEstado();
  const [destino, setDestino] = useState<IncidentStatus | null>(null);
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const posibles = TRANSICIONES[incidencia.status] ?? [];
  const exigeNota = destino ? CIERRAN.includes(destino) : false;

  return (
    <div className="mt-3 border-t border-[var(--rule)] pt-3">
      {incidencia.details && (
        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {incidencia.details}
        </p>
      )}
      {incidencia.resolution && (
        <p className="t-mono-xs mt-1 text-[var(--text-muted)]">
          Se cerró diciendo: «{incidencia.resolution}» — {incidencia.resolved_by_name}
        </p>
      )}
      <p className="t-mono-xs mt-1 text-[var(--text-faint)]">
        Abierta por {incidencia.opened_by_name ?? '—'}
        {incidencia.snapshot_taken_at && (
          <>
            {' · '}sale de la foto del WMS del{' '}
            {new Date(incidencia.snapshot_taken_at).toLocaleDateString('es')}
          </>
        )}
      </p>

      {/* ── Mover el estado ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {posibles.map((p) => (
          <Button
            key={p}
            variant={destino === p ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => {
              setDestino(destino === p ? null : p);
              setError(null);
            }}
          >
            {p === 'open' && incidencia.status !== 'open' ? 'Reabrir' : ESTADO_INFO[p].etiqueta}
          </Button>
        ))}
      </div>

      {destino && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="t-label">
              {exigeNota ? 'qué pasó (obligatorio)' : 'nota (opcional)'}
            </span>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={
                exigeNota
                  ? 'Fui al pasillo y…'
                  : 'Por qué se mueve, si hace falta decirlo'
              }
              className="h-9 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none [background:var(--glass-3)]"
            />
          </label>
          {exigeNota && (
            <p className="t-mono-xs text-[var(--text-faint)]">
              Sin explicación no se puede cerrar: dentro de un mes nadie podrá saber si el
              trabajo se hizo.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="xs"
              loading={cambiar.isPending}
              disabled={exigeNota && nota.trim() === ''}
              onClick={() => {
                setError(null);
                cambiar.mutate(
                  { id: incidencia.id, to: destino, note: nota.trim() || undefined },
                  {
                    onSuccess: () => {
                      setDestino(null);
                      setNota('');
                    },
                    onError: (e) =>
                      setError(e instanceof ApiError ? e.message : 'no se pudo mover'),
                  },
                );
              }}
            >
              Confirmar
            </Button>
            <AsyncStatus
              phase={error ? 'error' : fase(cambiar)}
              pendingLabel="Guardando"
              successLabel="Hecho"
              errorLabel={error}
            />
          </div>
        </div>
      )}

      <Historial incidentId={incidencia.id} />
    </div>
  );
}

/** Quién hizo qué y cuándo. No se puede editar ni borrar: no hay endpoint ni permiso. */
function Historial({ incidentId }: { incidentId: string }) {
  const [visible, setVisible] = useState(false);
  const { data, isLoading } = useEventos(visible ? incidentId : null);

  return (
    <div className="mt-3">
      <Button variant="ghost" size="xs" onClick={() => setVisible(!visible)}>
        <History strokeWidth={1.5} className="mr-1 size-3.5" />
        {visible ? 'Ocultar el historial' : 'Ver el historial'}
      </Button>
      {visible && isLoading && (
        <div className="mt-2">
          <AsyncStatus phase="pending" pendingLabel="Leyendo" />
        </div>
      )}
      {visible && data && (
        <div className="mt-2 flex flex-col gap-1">
          {data.map((e) => (
            <div key={e.id} className="t-mono-xs flex flex-wrap gap-x-3 text-[var(--text-muted)]">
              <span className="text-[var(--text-faint)]">
                {new Date(e.occurred_at).toLocaleString('es', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="text-[var(--text-primary)]">
                {e.from_status ? `${etiqueta(e.from_status)} → ` : ''}
                {etiqueta(e.to_status)}
              </span>
              <span>{e.actor_name}</span>
              {e.note && <span className="text-[var(--text-faint)]">«{e.note}»</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function etiqueta(estado: string): string {
  return ESTADO_INFO[estado as IncidentStatus]?.etiqueta ?? estado;
}

export { ClipboardList };
