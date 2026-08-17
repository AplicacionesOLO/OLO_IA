/**
 * PANEL DE RECORRIDOS: definirlos, medirlos y reproducirlos.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE ENSEÑA, Y POR QUE ESE ES EL PRODUCTO
 *
 * El número. «51,30 m · 1 min 28 s» es lo que se lleva a una reunión; la animación es una
 * forma de comprobar que el número describe lo que uno cree.
 *
 * Y por eso el número está arriba y grande, antes de la lista de paradas: quien abre esto
 * viene a saber cuánto se anda, no a leer una tabla.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO QUE SE DICE SIN QUE NADIE PREGUNTE
 *
 * · Que la distancia es EN LINEA RECTA, así que es una cota inferior: entre dos huecos de
 *   pasillos distintos hay racks en medio. Callarlo convertiría una cota en una promesa.
 * · Cuántas paradas se quedaron sin sitio porque su rack no está colocado. Un recorrido de
 *   diez paradas contando cuatro sale barato precisamente porque le faltan seis.
 */

import { Pause, Play, Plus, Route, SkipBack, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../../../design/utils/cn';
import { Button } from '../../../design/primitives/Button';
import type { RackEnEscena } from '../cluster3d/escena';
import {
  useActualizarRecorrido,
  useBorrarRecorrido,
  useCrearRecorrido,
  useGuardarParadas,
  useRecorrido,
  useRecorridos,
} from '../services/useSpatial';
import { comoDuracion, posicionEn, simular } from './recorrido';
import type { Parada } from './recorrido';
import { NOMBRE_DE_OPERACION, SEGUNDOS_TIPICOS, VELOCIDADES } from './tipos';
import type { Operacion } from './tipos';

export function PanelDeRecorridos({
  warehouseId,
  escena,
  /** Qué hueco está seleccionado ahora mismo, para poder añadirlo como parada. */
  huecoElegido,
  onInstante,
  className,
}: {
  warehouseId: string | null;
  escena: readonly RackEnEscena[];
  huecoElegido?: { locationId: string; code: string | null } | null | undefined;
  /**
   * Dónde está la figura en el instante actual, para que el visor la dibuje.
   *
   * El panel lleva el reloj y el visor dibuja: así el número y la animación salen del MISMO
   * cálculo, y no puede pasar que la figura vaya por un sitio y el total diga otro.
   */
  onInstante?: ((posicion: { x: number; y: number } | null) => void) | undefined;
  className?: string;
}) {
  const lista = useRecorridos(warehouseId);
  const crear = useCrearRecorrido(warehouseId);
  const borrar = useBorrarRecorrido(warehouseId);
  const guardar = useGuardarParadas(warehouseId);
  const actualizar = useActualizarRecorrido(warehouseId);

  const [elegido, setElegido] = useState<string | null>(null);
  const detalle = useRecorrido(elegido);

  //  Los racks por nodo: es la clave con la que una parada encuentra su rack. La misma que
  //  0095 arregló en la vista — antes venía el cuerpo y no encontraba nada—.
  const racksPorNodo = useMemo(() => {
    const m = new Map<string, RackEnEscena>();
    for (const r of escena) if (r.rackId) m.set(r.rackId, r);
    return m;
  }, [escena]);

  const paradas: Parada[] = useMemo(
    () =>
      (detalle.data?.stops ?? []).map((s) => ({
        id: s.id,
        seq: s.seq,
        locationCode: s.locationCode,
        rackNodeId: s.rackNodeId,
        bayIndex: s.bayIndex,
        level: s.level,
        position: s.position,
        operation: s.operation,
        dwellS: s.dwellS,
      })),
    [detalle.data],
  );

  const sim = useMemo(
    () => simular(paradas, racksPorNodo, detalle.data?.speedMps ?? 1.2),
    [paradas, racksPorNodo, detalle.data?.speedMps],
  );

  // ── El reloj ────────────────────────────────────────────────────────────────
  const [ms, setMs] = useState(0);
  const [corriendo, setCorriendo] = useState(false);
  const [x, setX] = useState(1);
  const ultimo = useRef<number | null>(null);

  //  Al cambiar de recorrido el reloj vuelve a cero: seguir en el segundo 40 de otro
  //  recorrido que dura 12 dejaría la figura fuera de su ventana y sin dibujar.
  useEffect(() => {
    setMs(0);
    setCorriendo(false);
  }, [elegido]);

  useEffect(() => {
    if (!corriendo || sim.duracionMs <= 0) return;
    let vivo = true;
    const paso = (t: number) => {
      if (!vivo) return;
      const dt = ultimo.current == null ? 0 : t - ultimo.current;
      ultimo.current = t;
      setMs((v) => {
        const siguiente = v + dt * x;
        //  Al llegar al final se PARA, no se repite: un bucle infinito hace imposible leer
        //  el total, que es para lo que existe esto.
        if (siguiente >= sim.duracionMs) {
          setCorriendo(false);
          return sim.duracionMs;
        }
        return siguiente;
      });
      requestAnimationFrame(paso);
    };
    const id = requestAnimationFrame(paso);
    return () => {
      vivo = false;
      ultimo.current = null;
      cancelAnimationFrame(id);
    };
  }, [corriendo, x, sim.duracionMs]);

  //  La posición sale del MISMO cálculo que el total. Dos fuentes harían que la figura fuera
  //  por un sitio y el número dijera otro.
  useEffect(() => {
    if (!onInstante) return;
    if (sim.tramos.length === 0) {
      onInstante(null);
      return;
    }
    const p = posicionEn(sim, ms);
    onInstante(p ? { x: p.x, y: p.y } : null);
  }, [ms, sim, onInstante]);

  const anadirParada = (op: Operacion) => {
    if (!elegido || !huecoElegido) return;
    guardar.mutate({
      tripId: elegido,
      paradas: [
        ...paradas.map((p) => ({
          locationId: (detalle.data?.stops ?? []).find((s) => s.id === p.id)!.locationId,
          operation: p.operation as Operacion,
          dwellS: p.dwellS,
        })),
        { locationId: huecoElegido.locationId, operation: op, dwellS: SEGUNDOS_TIPICOS[op] },
      ],
    });
  };

  const quitarParada = (id: string) => {
    if (!elegido) return;
    guardar.mutate({
      tripId: elegido,
      paradas: (detalle.data?.stops ?? [])
        .filter((s) => s.id !== id)
        .map((s) => ({
          locationId: s.locationId,
          operation: s.operation as Operacion,
          dwellS: s.dwellS,
        })),
    });
  };

  const mover = (id: string, delta: number) => {
    if (!elegido) return;
    const orden = [...(detalle.data?.stops ?? [])];
    const i = orden.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= orden.length) return;
    [orden[i]!, orden[j]!] = [orden[j]!, orden[i]!];
    guardar.mutate({
      tripId: elegido,
      paradas: orden.map((s) => ({
        locationId: s.locationId,
        operation: s.operation as Operacion,
        dwellS: s.dwellS,
      })),
    });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="t-label">Recorridos</span>
        <Button
          variant="secondary"
          size="xs"
          disabled={!warehouseId || crear.isPending}
          onClick={() =>
            crear.mutate(
              { name: `Recorrido ${(lista.data?.length ?? 0) + 1}`, speedMps: 1.2 },
              { onSuccess: (r) => setElegido(r.id) },
            )
          }
        >
          <Plus strokeWidth={1.5} className="size-3.5" />
          Nuevo
        </Button>
      </div>

      {(lista.data?.length ?? 0) === 0 ? (
        <p className="t-mono-xs text-[var(--text-faint)]">
          Ninguno todavía. Crea uno, elige huecos en el plano y añádelos como paradas: el
          panel dice cuántos metros y cuánto tiempo sale.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {lista.data!.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setElegido(r.id === elegido ? null : r.id)}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left',
                r.id === elegido ? '[background:var(--glass-3)]' : '[background:var(--glass-2)]',
              )}
            >
              <Route strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
              <span className="t-mono-xs min-w-0 flex-1 truncate text-[var(--text-primary)]">
                {r.name}
              </span>
              <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
                {r.stopCount} · {r.speedMps} m/s
              </span>
            </button>
          ))}
        </div>
      )}

      {elegido && detalle.data && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] p-2 [background:var(--glass-1)]">
          {/*  ── EL NUMERO, ARRIBA Y GRANDE ────────────────────────────────────
               Es el producto. Quien abre esto viene a saber cuánto se anda. */}
          <div className="flex flex-col gap-0.5">
            <span className="t-mono-xs text-[length:var(--text-sm)] text-[var(--text-primary)]">
              {sim.metros.toFixed(2)} m · {comoDuracion(sim.segundosTotal)}
            </span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {comoDuracion(sim.segundosMarcha)} andando · {comoDuracion(sim.segundosParado)} parado
            </span>
            {/*  Que es una COTA INFERIOR. Callarlo convertiría una cota en una promesa. */}
            {sim.tramos.length > 0 && (
              <span className="t-mono-xs text-[var(--text-faint)]">
                En línea recta entre paradas: es el mínimo, no el camino real — hay racks en
                medio.
              </span>
            )}
            {sim.paradasSinSitio.length > 0 && (
              <span className="t-mono-xs text-[var(--text-warn)]">
                {sim.paradasSinSitio.length} parada(s) no cuentan: su rack no está colocado en
                el plano.
              </span>
            )}
          </div>

          {/* ── La velocidad ─────────────────────────────────────────────────── */}
          <label className="flex items-center gap-2">
            <span className="t-label text-[var(--text-faint)]">velocidad</span>
            <select
              value={detalle.data.speedMps}
              //  Su propia mutación. Reenviar las paradas para cambiar la velocidad las
              //  reescribiría enteras —con sus identificadores nuevos— por tocar un número
              //  que no tiene nada que ver con ellas.
              onChange={(e) =>
                actualizar.mutate({ tripId: elegido, speedMps: Number(e.target.value) })
              }
              className="t-mono-xs rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] text-[var(--text-primary)] outline-none"
            >
              {VELOCIDADES.map((v) => (
                <option key={v.mps} value={v.mps}>
                  {v.etiqueta} · {v.mps} m/s
                </option>
              ))}
            </select>
          </label>

          {/* ── El reproductor ───────────────────────────────────────────────── */}
          {sim.duracionMs > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCorriendo((v) => !v)}
                  title={corriendo ? 'Pausar' : 'Reproducir'}
                  className="rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--icon-accent)]"
                >
                  {corriendo ? (
                    <Pause strokeWidth={1.5} className="size-4" />
                  ) : (
                    <Play strokeWidth={1.5} className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMs(0);
                    setCorriendo(false);
                  }}
                  title="Volver al principio"
                  className="rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--icon-accent)]"
                >
                  <SkipBack strokeWidth={1.5} className="size-3.5" />
                </button>
                {[1, 4, 16].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setX(v)}
                    className={cn(
                      't-mono-xs rounded-[var(--radius-xs)] px-1.5 py-0.5',
                      x === v ? '[background:var(--glass-3)]' : '',
                      x === v ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
                    )}
                  >
                    ×{v}
                  </button>
                ))}
                <span className="t-mono-xs ml-auto text-[var(--text-secondary)]">
                  {comoDuracion(ms / 1000)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={sim.duracionMs}
                value={ms}
                onChange={(e) => {
                  setMs(Number(e.target.value));
                  setCorriendo(false);
                }}
                className="w-full"
              />
            </div>
          )}

          {/* ── Las paradas ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            {paradas.length === 0 && (
              <span className="t-mono-xs text-[var(--text-faint)]">
                Sin paradas. Elige un hueco en el plano y añádelo.
              </span>
            )}
            {paradas.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 rounded-[var(--radius-xs)] px-1.5 py-1 [background:var(--glass-2)]"
              >
                <span className="t-mono-xs w-4 shrink-0 text-[var(--text-faint)]">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="t-mono-xs truncate text-[var(--text-primary)]">
                    {p.locationCode ?? 'sin código'}
                  </span>
                  <span className="t-mono-xs text-[var(--text-faint)]">
                    {NOMBRE_DE_OPERACION[p.operation as Operacion] ?? p.operation}
                    {p.dwellS > 0 && ` · ${p.dwellS.toFixed(0)} s`}
                    {!p.rackNodeId && ' · sin rack'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => mover(p.id, -1)}
                  disabled={i === 0}
                  title="Subir"
                  className="t-mono-xs shrink-0 px-1 text-[var(--icon-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => mover(p.id, 1)}
                  disabled={i === paradas.length - 1}
                  title="Bajar"
                  className="t-mono-xs shrink-0 px-1 text-[var(--icon-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => quitarParada(p.id)}
                  title="Quitar la parada"
                  className="shrink-0 rounded-[var(--radius-xs)] p-1 text-[var(--icon-muted)] hover:text-[var(--state-critical)]"
                >
                  <Trash2 strokeWidth={1.5} className="size-3" />
                </button>
              </div>
            ))}
          </div>

          {/* ── Añadir el hueco elegido ──────────────────────────────────────── */}
          {huecoElegido ? (
            <div className="flex flex-col gap-1">
              <span className="t-label text-[var(--text-faint)]">
                añadir {huecoElegido.code ?? 'el hueco elegido'}
              </span>
              <div className="flex flex-wrap gap-1">
                {(['salida', 'recoger', 'dejar', 'revisar', 'vuelta'] as Operacion[]).map(
                  (op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => anadirParada(op)}
                      disabled={guardar.isPending}
                      className="t-mono-xs rounded-[var(--radius-xs)] px-2 py-1 [background:var(--glass-2)] text-[var(--text-secondary)] hover:[background:var(--glass-3)] disabled:opacity-40"
                    >
                      {NOMBRE_DE_OPERACION[op]}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <span className="t-mono-xs text-[var(--text-faint)]">
              Elige un hueco en el plano para poder añadirlo como parada.
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              borrar.mutate(elegido);
              setElegido(null);
            }}
            className="t-mono-xs self-start text-[var(--text-faint)] hover:text-[var(--state-critical)]"
          >
            Borrar este recorrido
          </button>
        </div>
      )}
    </div>
  );
}
