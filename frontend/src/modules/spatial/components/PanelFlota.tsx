/**
 * PANEL DE FLOTA — que se ha visto del almacen, y por donde se paso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE MUESTRA
 *
 * Las cifras que contestan «¿esta cubierto el almacen?»: racks vistos de los que
 * hay, cuando fue la ultima vez que alguien paso, y cuantas fuentes han reportado.
 * Y por cada ruta, sus metricas: avistamientos, racks distintos y distancia.
 *
 * ── LA DISTANCIA SE NOMBRA COMO ES ─────────────────────────────────────────
 *
 * «en rectas», no «recorrida». Es la suma de las lineas entre racks observados
 * consecutivos: una cota INFERIOR del recorrido real, porque entre dos avistamientos
 * la fuente pudo dar la vuelta al pasillo. Llamarla «distancia recorrida» convertiria
 * una cota en una medicion, y alguien acabaria calculando consumo de bateria con ella.
 *
 * ── EL REGISTRO A MANO NO ES UN GENERADOR DE DATOS ─────────────────────────
 *
 * `Registrar paso` existe porque el operador TAMBIEN observa: recorre el pasillo,
 * lee los codigos y los apunta. Es la fuente `manual` y es informacion real. Lo que
 * no hay —ni habra aqui— es un boton que fabrique un vuelo de prueba: un recorrido
 * inventado en la base es indistinguible de uno medido, y el dia que alguien audite
 * la cobertura no habria forma de saber cual es cual.
 *
 * ── LO QUE NO EXISTE TODAVIA ───────────────────────────────────────────────
 *
 * El reconocimiento automatico. Aqui llega el RESULTADO de reconocer codigos en
 * fotogramas; quien lo hace es otro sistema. El panel lo dice en lugar de dejar creer
 * que el dron ya esta conectado.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, Plane, Radio, Smartphone, Trash2, Truck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Modal } from '../../../design/foundation/Modal';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../lib/apiErrors';
import type { ObservationSourceKind, RouteDto } from '../repositories/dto';
import { spatialKeys } from '../services/queryKeys';
import { useObservationRepo } from '../services/SpatialProvider';
import {
  useCoberturaDeObservacion,
  useObservaciones,
  useRutas,
} from '../services/useSpatial';
import type { FloorPlanCell } from '../types/index';
import type { RutaPreparada } from '../cluster3d/index';

const ICONO: Record<ObservationSourceKind, typeof Plane> = {
  drone: Plane,
  phone: Smartphone,
  fixed_camera: Camera,
  forklift: Truck,
  manual: Radio,
};

interface Props {
  warehouseId: string;
  /** Racks del almacen, para el desplegable del registro manual. */
  catalogo: readonly FloorPlanCell[];
  /** Rutas ya preparadas: de aqui salen los colores, los mismos que en el lienzo. */
  rutas: readonly RutaPreparada[];
  /** Racks totales del almacen, para leer la cobertura como fraccion. */
  racksTotales: number | null;
}

export function PanelFlota({ warehouseId, catalogo, rutas, racksTotales }: Props) {
  const repo = useObservationRepo();
  const qc = useQueryClient();
  const cobertura = useCoberturaDeObservacion(warehouseId);
  const historial = useObservaciones(warehouseId);
  const consulta = useRutas(warehouseId);

  const [registrando, setRegistrando] = useState(false);
  const [purgar, setPurgar] = useState<string | null>(null);

  const invalidar = () => {
    // Las cuatro consultas: la ruta cambia, la cobertura cambia, el historial cambia
    // y la lista de fuentes puede tener una nueva. Invalidar solo la ruta dejaria la
    // cabecera diciendo «0 racks vistos» sobre una ruta recien dibujada.
    void qc.invalidateQueries({ queryKey: ['spatial', 'routes', warehouseId] });
    void qc.invalidateQueries({ queryKey: spatialKeys.observationCoverage(warehouseId) });
    void qc.invalidateQueries({ queryKey: spatialKeys.observations(warehouseId) });
    void qc.invalidateQueries({ queryKey: spatialKeys.observationSources(warehouseId) });
  };

  const borrar = useMutation({
    mutationFn: (source: string) => repo.purgar(warehouseId, source),
    onSuccess: () => {
      setPurgar(null);
      invalidar();
    },
  });

  const cob = cobertura.data;
  const sinColocar = cob?.sin_colocar ?? 0;

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline-strong)] pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Flota</span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {consulta.isFetching || cobertura.isFetching ? 'leyendo…' : 'observaciones'}
        </span>
      </div>

      {cobertura.isError ? (
        <p className="t-mono-xs text-[var(--state-alert)]">
          {cobertura.error instanceof ApiError
            ? humanMessage(cobertura.error)
            : 'No se pudo leer la cobertura.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Linea
            k="racks vistos"
            v={
              racksTotales != null
                ? `${cob?.racks_vistos ?? 0} de ${racksTotales}`
                : String(cob?.racks_vistos ?? 0)
            }
          />
          <Linea k="observaciones" v={String(cob?.total ?? 0)} />
          <Linea k="fuentes" v={String(cob?.fuentes ?? 0)} />
          <Linea k="ultimo paso" v={cob?.ultima ? fecha(cob.ultima) : '—'} />
        </div>
      )}

      {sinColocar > 0 && (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--state-alert)]/40 bg-[var(--state-alert)]/8 p-2">
          <AlertTriangle
            strokeWidth={1.5}
            className="mt-0.5 size-3.5 shrink-0 text-[var(--state-alert)]"
          />
          <p className="t-mono-xs text-[var(--text-muted)]">
            {sinColocar} observaciones son de racks que nadie ha colocado en el plano, asi
            que no salen en la ruta: no hay punto por el que dibujarlas. Coloca esos racks
            en el editor y apareceran.
          </p>
        </div>
      )}

      {/* ── Las rutas ────────────────────────────────────────────────────── */}
      {rutas.length > 0 && (
        <div className="flex flex-col gap-2">
          {rutas.map((r) => (
            <FilaRuta
              key={r.ruta.source_id}
              ruta={r.ruta}
              color={r.color}
              onBorrar={() => setPurgar(r.ruta.source_code)}
            />
          ))}
        </div>
      )}

      {rutas.length === 0 && !cobertura.isLoading && (
        <p className="t-mono-xs text-[var(--text-faint)]">
          Nadie ha registrado todavia por donde paso. Cuando un dron, una camara o un
          movil reporten los racks que ven, la ruta aparecera sobre el plano.
        </p>
      )}

      <p className="t-mono-xs flex gap-1.5 text-[var(--text-faint)]">
        <Radio strokeWidth={1.5} className="mt-0.5 size-3 shrink-0" />
        <span>
          El reconocimiento automatico de codigos en video todavia no esta conectado.
          Esto recibe el RESULTADO de reconocer, venga de un modelo o de una persona
          recorriendo el pasillo.
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="xs" onClick={() => setRegistrando(true)}>
          Registrar paso
        </Button>
      </div>

      {/* ── Historial ────────────────────────────────────────────────────── */}
      {(historial.data?.length ?? 0) > 0 && (
        <details className="flex flex-col gap-1">
          <summary className="t-mono-xs cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-muted)]">
            historial · {historial.data?.length} avistamientos
          </summary>
          <ul className="mt-1.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {historial.data?.slice(0, 100).map((o) => (
              <li key={o.observation_id} className="flex items-baseline justify-between gap-2">
                <span className="t-mono-xs text-[var(--text-muted)]">
                  {o.rack_code}
                  {!o.rack_colocado && (
                    <span className="ml-1 text-[var(--state-alert)]" title="Rack sin colocar en el plano">
                      ·
                    </span>
                  )}
                </span>
                <span className="t-mono-xs text-right text-[var(--text-faint)]">
                  {o.source_code} · {hora(o.observed_at)}
                  {o.confidence != null && ` · ${Math.round(o.confidence * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <DialogoRegistrar
        abierto={registrando}
        catalogo={catalogo}
        onCerrar={() => setRegistrando(false)}
        onRegistrado={() => {
          setRegistrando(false);
          invalidar();
        }}
        warehouseId={warehouseId}
      />

      <Modal
        abierto={purgar !== null}
        titulo={`Borrar las observaciones de ${purgar ?? ''}`}
        descripcion={
          'Se borran los avistamientos de esa fuente y su ruta desaparece. Ni la fuente ' +
          'ni los racks se tocan, y las demas fuentes no se ven afectadas.'
        }
        onCerrar={() => setPurgar(null)}
        acciones={
          <>
            <Button variant="ghost" size="xs" onClick={() => setPurgar(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="xs"
              onClick={() => purgar && borrar.mutate(purgar)}
              disabled={borrar.isPending}
            >
              {borrar.isPending ? 'borrando…' : 'Borrar'}
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * Registro manual de un paso.
 *
 * Un rack y una hora. La hora se rellena con la actual porque el caso real es
 * «acabo de pasar por aqui», pero es editable: alguien que apunta en papel y lo
 * transcribe media hora despues tiene que poder poner la hora de verdad, y con la
 * hora de transcripcion la ruta saldria comprimida en un minuto.
 */
function DialogoRegistrar({
  abierto,
  catalogo,
  warehouseId,
  onCerrar,
  onRegistrado,
}: {
  abierto: boolean;
  catalogo: readonly FloorPlanCell[];
  warehouseId: string;
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const repo = useObservationRepo();
  const [rack, setRack] = useState('');
  const [cuando, setCuando] = useState(() => paraInput(new Date()));
  const [codigo, setCodigo] = useState('MANUAL-1');

  const ordenado = useMemo(
    () => [...catalogo].sort((a, b) => a.rackCode.localeCompare(b.rackCode)),
    [catalogo],
  );

  const registrar = useMutation({
    mutationFn: () =>
      repo.ingerir(warehouseId, {
        source_code: codigo,
        source_name: 'Registro manual',
        source_kind: 'manual',
        observations: [
          {
            rack_node_id: rack,
            observed_at: new Date(cuando).toISOString(),
            // Sin confianza a proposito: `null` es «no aplica» y 1 seria «el modelo
            // esta seguro». Confundirlos convertiria cada anotacion a mano en la
            // deteccion mas fiable del sistema.
            confidence: null,
            notes: 'Registrado a mano desde el explorador',
          },
        ],
      }),
    onSuccess: () => {
      setRack('');
      onRegistrado();
    },
  });

  return (
    <Modal
      abierto={abierto}
      titulo="Registrar un paso"
      descripcion={
        'Un rack y la hora a la que se paso por delante. Es informacion real —alguien ' +
        'estuvo ahi— y cuenta igual que la de un dron en la cobertura y en la ruta.'
      }
      onCerrar={onCerrar}
      acciones={
        <>
          <Button variant="ghost" size="xs" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={() => registrar.mutate()}
            disabled={!rack || registrar.isPending}
          >
            {registrar.isPending ? 'registrando…' : 'Registrar'}
          </Button>
        </>
      }
    >
      <Campo etiqueta="Rack">
        <select
          value={rack}
          onChange={(e) => setRack(e.target.value)}
          className="t-mono-xs w-full rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--glass-1)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">elige un rack…</option>
          {ordenado.map((c) => (
            <option key={c.rackId} value={c.rackId}>
              {c.rackCode}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Cuando se paso">
        <input
          type="datetime-local"
          step={1}
          value={cuando}
          onChange={(e) => setCuando(e.target.value)}
          className="t-mono-xs w-full rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--glass-1)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </Campo>

      <Campo etiqueta="Fuente">
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          maxLength={40}
          className="t-mono-xs w-full rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--glass-1)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </Campo>
      <p className="t-mono-xs text-[var(--text-faint)]">
        Los pasos con la misma fuente forman UN recorrido. Usa codigos distintos para
        recorridos distintos: mezclarlos dibujaria un zigzag entre dos rondas.
      </p>

      {registrar.isError && (
        <p className="t-mono-xs text-[var(--state-alert)]">
          {registrar.error instanceof ApiError
            ? humanMessage(registrar.error)
            : 'No se pudo registrar.'}
        </p>
      )}
    </Modal>
  );
}

function FilaRuta({
  ruta,
  color,
  onBorrar,
}: {
  ruta: RouteDto;
  color: string;
  onBorrar: () => void;
}) {
  const Icono = ICONO[ruta.source_kind] ?? Radio;
  return (
    <div className="flex flex-col gap-0.5 border-l-2 pl-2" style={{ borderColor: color }}>
      <div className="flex items-center justify-between gap-2">
        <span className="t-mono-xs flex items-center gap-1.5 text-[var(--text-primary)]">
          <Icono strokeWidth={1.5} className="size-3 text-[var(--icon-muted)]" />
          {ruta.source_code}
        </span>
        <button
          type="button"
          onClick={onBorrar}
          title={`Borrar las observaciones de ${ruta.source_code}`}
          aria-label={`Borrar las observaciones de ${ruta.source_code}`}
          className="flex size-5 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] transition-colors hover:text-[var(--crimson-400)]"
        >
          <Trash2 strokeWidth={1.5} className="size-3" />
        </button>
      </div>
      <span className="t-mono-xs text-[var(--text-faint)]">
        {ruta.point_count} avistamientos · {ruta.distinct_racks} racks
      </span>
      {ruta.forms_path ? (
        <span className="t-mono-xs text-[var(--text-faint)]">
          {ruta.straight_line_distance_m.toFixed(1)} m en rectas
          {ruta.duration_s != null && ` · ${duracionCorta(ruta.duration_s)}`}
          {ruta.avg_speed_ms != null && ` · ${ruta.avg_speed_ms.toFixed(2)} m/s`}
        </span>
      ) : (
        <span className="t-mono-xs text-[var(--text-faint)]">
          camara fija: no forma recorrido, es un centinela
        </span>
      )}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-mono-xs text-[var(--text-faint)]">{etiqueta}</span>
      {children}
    </label>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-mono-xs text-[var(--text-faint)]">{k}</span>
      <span className={cn('t-mono-xs text-right text-[var(--text-muted)]')}>{v}</span>
    </div>
  );
}

/** `datetime-local` quiere `YYYY-MM-DDTHH:mm:ss` en hora LOCAL, sin zona. */
function paraInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

function hora(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function duracionCorta(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
