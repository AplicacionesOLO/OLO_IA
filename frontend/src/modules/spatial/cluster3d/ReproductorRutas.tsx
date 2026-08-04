/**
 * REPRODUCTOR DE RUTAS — recorrer el tiempo, no solo mirarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UN DESLIZADOR Y NO UNA LISTA
 *
 * La pregunta que se hace sobre un recorrido no es «¿qué observaciones hay?» —eso lo
 * contesta el historial— sino «¿por dónde iba a las 14:03?» y «¿en qué orden pasó?».
 * Las dos son temporales, y un deslizador es la única forma de contestarlas sin leer
 * 400 filas.
 *
 * ── EL TIEMPO ES EL DEL ALMACEN, NO EL DE LA REPRODUCCION ──────────────────
 *
 * El deslizador recorre la ventana OBSERVADA: del primer avistamiento al último. La
 * velocidad de reproducción multiplica el paso del tiempo del vuelo, así que ×8
 * sobre un vuelo de 20 minutos son 2,5 minutos de reloj. Se muestran las dos cosas
 * —la hora del almacén y el avance sobre el total— porque son preguntas distintas.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No inventa posición fuera de la ventana. Antes del primer avistamiento y después
 * del último el marcador desaparece: dejarlo clavado en el primer rack afirmaría que
 * la fuente estuvo ahí esperando.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import type { RutaPreparada } from './ruta';
import { interpolar, ventanaDe } from './ruta';

/** Multiplicadores del paso del tiempo. `1` es tiempo real del vuelo. */
const VELOCIDADES = [1, 4, 16, 64] as const;

interface Props {
  rutas: readonly RutaPreparada[];
  /** Instante actual en ms, o `null` para «ver el recorrido completo». */
  instante: number | null;
  onInstante: (ms: number | null) => void;
  className?: string | undefined;
}

export function ReproductorRutas({ rutas, instante, onInstante, className }: Props) {
  /**
   * `useMemo` y no una llamada directa: `ventanaDe` devuelve un OBJETO NUEVO cada
   * vez, y el bucle de reproducción lo tiene en sus dependencias. Sin memoizar, cada
   * render —y reproducir provoca uno por fotograma— desmontaba y remontaba el efecto,
   * `ultimoFrame` volvía a `null` y el delta se perdía SIEMPRE: medido, la
   * reproducción no avanzaba nada.
   *
   * Es el mismo defecto que el de tener `instante` en las dependencias, escondido en
   * una identidad de objeto en lugar de en un valor.
   */
  const ventana = useMemo(() => ventanaDe(rutas), [rutas]);
  const [velocidad, setVelocidad] = useState<number>(16);
  const [reproduciendo, setReproduciendo] = useState(false);

  /**
   * El bucle de reproducción.
   *
   * `requestAnimationFrame` y no `setInterval`: el navegador lo pausa cuando la
   * pestaña no está visible, así que volver media hora después no encuentra la
   * reproducción a mitad de un vuelo que ya terminó. Y el avance se calcula con el
   * DELTA real entre fotogramas, no con un incremento fijo: con incremento fijo la
   * velocidad depende de los fotogramas por segundo del equipo, y el mismo vuelo
   * duraría distinto en dos ordenadores.
   *
   * ── POR QUE EL INSTANTE VIVE EN UN `ref` Y NO EN LAS DEPENDENCIAS ─────────
   *
   * Porque cambia en CADA fotograma. Con `instante` en el array de dependencias, el
   * efecto se desmontaba y se volvía a montar sesenta veces por segundo, y en cada
   * remontaje `ultimoFrame` volvía a `null`: el primer fotograma de cada ciclo no
   * podía calcular delta y se perdía. Medido: pidiendo ×16 avanzaba a ~3×.
   *
   * Con el `ref`, el bucle se suscribe UNA vez por sesión de reproducción y lee el
   * instante actual sin depender de él.
   */
  const instanteRef = useRef<number | null>(instante);
  instanteRef.current = instante;

  const ultimoFrame = useRef<number | null>(null);
  useEffect(() => {
    if (!reproduciendo || !ventana) return;
    let id = 0;
    const paso = (ahora: number) => {
      const anterior = ultimoFrame.current;
      ultimoFrame.current = ahora;
      if (anterior != null) {
        const delta = (ahora - anterior) * velocidad;
        const siguiente = (instanteRef.current ?? ventana.desde) + delta;
        if (siguiente >= ventana.hasta) {
          onInstante(ventana.hasta);
          setReproduciendo(false);
          return;
        }
        // Se escribe el `ref` además de avisar hacia fuera: el estado del padre
        // llega en el render siguiente y el fotograma de en medio leería el valor
        // viejo, con lo que el avance se quedaría a la mitad.
        instanteRef.current = siguiente;
        onInstante(siguiente);
      }
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(id);
      ultimoFrame.current = null;
    };
  }, [reproduciendo, velocidad, ventana, onInstante]);

  const alternar = useCallback(() => {
    if (!ventana) return;
    // Reproducir desde el final vuelve a empezar: es lo que espera quien pulsa
    // «reproducir» sobre un vuelo que ya terminó.
    if (!reproduciendo && (instante == null || instante >= ventana.hasta)) {
      onInstante(ventana.desde);
    }
    setReproduciendo((v) => !v);
  }, [reproduciendo, instante, ventana, onInstante]);

  if (!ventana) {
    return (
      <div className={cn('flex items-center gap-2 px-2 py-1.5', className)}>
        <span className="t-mono-xs text-[var(--text-faint)]">
          Sin observaciones en este almacen: nadie ha registrado todavia por donde paso.
        </span>
      </div>
    );
  }

  const total = Math.max(1, ventana.hasta - ventana.desde);
  const actual = instante ?? ventana.hasta;
  const fraccion = Math.min(1, Math.max(0, (actual - ventana.desde) / total));

  /** Instante del avistamiento anterior o siguiente. Salta de dato en dato. */
  const saltar = (direccion: 1 | -1) => {
    const momentos = [...new Set(rutas.flatMap((r) => r.pasos.map((p) => p.ms)))].sort(
      (a, b) => a - b,
    );
    const siguiente =
      direccion === 1
        ? momentos.find((m) => m > actual + 1)
        : [...momentos].reverse().find((m) => m < actual - 1);
    if (siguiente != null) {
      setReproduciendo(false);
      onInstante(siguiente);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[var(--radius-xs)] px-2 py-1.5 [background:var(--glass-2)]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icono etiqueta="Avistamiento anterior" onClick={() => saltar(-1)}>
          <SkipBack strokeWidth={1.5} className="size-3.5" />
        </Icono>
        <Icono etiqueta={reproduciendo ? 'Pausar' : 'Reproducir el recorrido'} onClick={alternar}>
          {reproduciendo ? (
            <Pause strokeWidth={1.5} className="size-3.5" />
          ) : (
            <Play strokeWidth={1.5} className="size-3.5" />
          )}
        </Icono>
        <Icono etiqueta="Avistamiento siguiente" onClick={() => saltar(1)}>
          <SkipForward strokeWidth={1.5} className="size-3.5" />
        </Icono>

        <input
          type="range"
          min={ventana.desde}
          max={ventana.hasta}
          step={Math.max(1, Math.round(total / 2000))}
          value={actual}
          onChange={(e) => {
            setReproduciendo(false);
            onInstante(Number(e.target.value));
          }}
          aria-label="Instante del recorrido"
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full [background:var(--hairline-strong)] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)]"
        />

        <select
          value={velocidad}
          onChange={(e) => setVelocidad(Number(e.target.value))}
          aria-label="Velocidad de reproduccion"
          title="Multiplica el paso del tiempo del recorrido"
          className="t-mono-xs cursor-pointer border-none bg-transparent text-[var(--text-muted)] outline-none"
        >
          {VELOCIDADES.map((v) => (
            <option key={v} value={v}>
              ×{v}
            </option>
          ))}
        </select>

        {/* «Todo» apaga la reproduccion y muestra el recorrido completo. Es un estado
            distinto de «estoy al final»: al final el marcador esta en el ultimo
            avistamiento; en «todo» no hay marcador porque no hay instante. */}
        <button
          type="button"
          onClick={() => {
            setReproduciendo(false);
            onInstante(null);
          }}
          aria-pressed={instante == null}
          className={cn(
            't-mono-xs shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 transition-colors',
            instante == null
              ? 'text-[var(--text-primary)] [background:var(--glass-3)]'
              : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]',
          )}
        >
          todo
        </button>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="t-mono-xs text-[var(--text-muted)]">
          {instante == null ? 'recorrido completo' : hora(actual)}
          <span className="ml-2 text-[var(--text-faint)]">
            {instante == null
              ? `${duracion(total)} observados`
              : `${Math.round(fraccion * 100)}% · de ${duracion(total)}`}
          </span>
        </span>
        {/* Donde esta cada fuente AHORA. Es la respuesta a «por donde iba el dron». */}
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {rutas.map((r) => {
            const pos = instante == null ? null : interpolar(r, instante);
            return (
              <span key={r.ruta.source_id} className="t-mono-xs flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full" style={{ background: r.color }} />
                <span className="text-[var(--text-faint)]">{r.ruta.source_code}</span>
                <span className="text-[var(--text-muted)]">
                  {instante == null
                    ? `${r.ruta.point_count} avistamientos`
                    : pos
                      ? pos.ultimo.rack_code
                      : 'fuera de su ventana'}
                </span>
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

function Icono({
  etiqueta,
  onClick,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={etiqueta}
      aria-label={etiqueta}
      className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] transition-colors hover:text-[var(--icon-accent)] hover:[background:var(--glass-1)]"
    >
      {children}
    </button>
  );
}

/** Hora del ALMACEN, con segundos: un vuelo entero cabe en dos minutos. */
function hora(ms: number): string {
  try {
    return new Intl.DateTimeFormat('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ms));
  } catch {
    return String(ms);
  }
}

function duracion(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
