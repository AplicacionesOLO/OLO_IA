/**
 * ESTADO DE UNA OPERACIÓN — «Cargando…», «Guardando…», «Guardado», «Error: …».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTO Y NO alert() NI UN SPINNER
 *
 * `alert()` y `confirm()` **bloquean el hilo del navegador**: mientras están
 * abiertos no se repinta nada, las peticiones en vuelo no pueden actualizar la
 * pantalla, y en algunos navegadores no se pueden estilar ni cerrar con Escape. Y
 * sacan al operador de la tarea: el mensaje aparece en un sitio que no tiene
 * relación con lo que estaba tocando.
 *
 * Un spinner circular tampoco sirve: no dice QUÉ está pasando ni cuánto queda.
 * Gira igual para 200 ms que para 40 s.
 *
 * Aquí el estado vive JUNTO a la acción que lo produjo, dice qué operación es, y
 * cuando termina bien se retira solo — porque un «Guardado» permanente deja de
 * significar nada a los cinco minutos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ERROR NO SE RETIRA SOLO, Y ES LA REGLA MÁS IMPORTANTE
 *
 * El éxito se desvanece a los 2,4 s: ya no hay nada que hacer con esa información.
 * El error se queda hasta que otra operación lo reemplace, porque el operador tiene
 * que poder leerlo, entenderlo y decidir. Un error que se autodestruye a los tres
 * segundos es peor que no mostrarlo: deja la sensación de que algo falló sin decir
 * qué, y no se puede recuperar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL MOVIMIENTO ES INFORMACIÓN, NO ADORNO
 *
 *   · mientras trabaja  → barrido `ScanLine` sobre la propia fila + puntos que
 *                         laten. Comunica «esto sigue vivo», que es lo único
 *                         honesto cuando no se conoce la duración
 *   · al terminar bien  → la marca entra con `emerge` y el bloque se desvanece
 *   · al fallar         → entrada seca con `precise` y una sacudida de 6 px
 *
 * Con `prefers-reduced-motion` no hay barrido, ni latido, ni sacudida: solo el
 * cambio de color y de icono. La información se conserva entera.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';

import { duration } from '../motion/duration';
import { easing } from '../motion/easing';
import { useSystemReducedMotion } from '../motion/useMotionPreference';
import { ScanLine } from '../primitives/ScanLine';
import { cn } from '../utils/cn';

export type AsyncPhase = 'idle' | 'pending' | 'success' | 'error';

/** Milisegundos que permanece visible un éxito antes de retirarse. */
const RETIRO_EXITO = 2400;

interface AsyncStatusProps {
  phase: AsyncPhase;
  /** Qué se está haciendo. Verbo en gerundio: «Guardando el rack». */
  pendingLabel?: string;
  /** Qué se logró. En pasado: «Guardado». */
  successLabel?: string;
  /**
   * El fallo, ya en lenguaje del operador. Se muestra tal cual tras «Error: ».
   * Nunca un objeto de excepción: quien llama traduce.
   */
  errorLabel?: string | null;
  /** Acción de recuperación, si la hay. «Reintentar», «Recargar». */
  onRetry?: () => void;
  retryLabel?: string;
  /** `true` deja el éxito fijo. Para procesos largos que conviene poder confirmar. */
  keepSuccess?: boolean;
  className?: string;
}

export function AsyncStatus({
  phase,
  pendingLabel = 'Cargando…',
  successLabel = 'Hecho',
  errorLabel,
  onRetry,
  retryLabel = 'Reintentar',
  keepSuccess = false,
  className,
}: AsyncStatusProps) {
  const reducido = useSystemReducedMotion();

  // El éxito se retira solo. El temporizador se reinicia con cada éxito nuevo, así
  // que dos guardados seguidos no dejan el mensaje a medio desvanecer.
  const [exitoVisible, setExitoVisible] = useState(false);
  useEffect(() => {
    if (phase !== 'success') {
      setExitoVisible(false);
      return;
    }
    setExitoVisible(true);
    if (keepSuccess) return;
    const t = window.setTimeout(() => setExitoVisible(false), RETIRO_EXITO);
    return () => window.clearTimeout(t);
  }, [phase, keepSuccess, successLabel]);

  const visible =
    phase === 'pending' || phase === 'error' || (phase === 'success' && exitoVisible);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {visible && (
        <motion.div
          // La clave incluye la fase: sin ella, pasar de «Guardando» a «Error» reusa
          // el mismo nodo y el cambio ocurre sin transición, que se lee como un
          // parpadeo del texto en lugar de como un cambio de estado.
          key={phase}
          role="status"
          // `assertive` solo en el error: un lector de pantalla no debe interrumpir
          // al operador para decirle «Guardando…», pero sí para decirle que falló.
          aria-live={phase === 'error' ? 'assertive' : 'polite'}
          initial={{ opacity: 0, y: reducido ? 0 : -4 }}
          animate={
            phase === 'error' && !reducido
              ? { opacity: 1, y: 0, x: [0, -6, 5, -3, 0] }
              : { opacity: 1, y: 0, x: 0 }
          }
          exit={{ opacity: 0, y: reducido ? 0 : -4 }}
          transition={{
            duration: phase === 'error' ? duration.moderate : duration.base,
            ease: phase === 'error' ? easing.precise : easing.emerge,
          }}
          className={cn(
            'relative flex items-center gap-2 overflow-hidden rounded-[var(--radius-sm)] px-2.5 py-1.5',
            phase === 'error' ? '[background:var(--glass-2)]' : '[background:var(--glass-1)]',
            className,
          )}
        >
          {/* El barrido va sobre la fila entera: comunica «estoy trabajando en ESTO». */}
          {phase === 'pending' && !reducido && <ScanLine nature="inferred" />}

          <Icono phase={phase} reducido={reducido} />

          <span
            className={cn(
              't-mono-xs min-w-0',
              phase === 'error'
                ? 'text-[var(--state-alert)]'
                : phase === 'success'
                  ? 'text-[var(--state-confirmed)]'
                  : 'text-[var(--text-secondary)]',
            )}
          >
            {phase === 'pending' && <Puntos texto={pendingLabel} reducido={reducido} />}
            {phase === 'success' && successLabel}
            {phase === 'error' && `Error: ${errorLabel ?? 'no se pudo completar'}`}
          </span>

          {phase === 'error' && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="t-mono-xs shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[var(--text-primary)] [background:var(--glass-3)] hover:[background:var(--glass-2)]"
            >
              {retryLabel}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Icono({ phase, reducido }: { phase: AsyncPhase; reducido: boolean }) {
  if (phase === 'error') {
    return (
      <AlertTriangle
        strokeWidth={1.5}
        className="size-3.5 shrink-0 text-[var(--state-alert)]"
      />
    );
  }
  if (phase === 'success') {
    return (
      <motion.span
        initial={{ scale: reducido ? 1 : 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: duration.quick, ease: easing.emerge }}
        className="shrink-0"
      >
        <Check strokeWidth={2} className="size-3.5 text-[var(--state-confirmed)]" />
      </motion.span>
    );
  }
  return (
    <Loader2
      strokeWidth={1.5}
      className={cn(
        'size-3.5 shrink-0 text-[var(--icon-accent)]',
        // La rotación es CSS y no framer-motion: es un bucle infinito y no merece
        // un hilo de animación en JS.
        !reducido && 'animate-spin',
      )}
    />
  );
}

/**
 * Los tres puntos que laten, uno detrás de otro.
 *
 * Es la señal de «sigue vivo» más barata que existe, y la única honesta cuando no
 * se conoce la duración: una barra de progreso que avanza sin medir nada miente.
 *
 * Se anima con `opacity` y no con el texto —no se añaden ni quitan caracteres—
 * porque cambiar la longitud de la cadena mueve todo lo que va detrás.
 */
function Puntos({ texto, reducido }: { texto: string; reducido: boolean }) {
  const base = texto.replace(/…$/, '').replace(/\.{3}$/, '');
  if (reducido) return <>{base}…</>;
  return (
    <>
      {base}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.15,
            repeat: Infinity,
            ease: easing.breathe,
            delay: i * 0.18,
          }}
        >
          .
        </motion.span>
      ))}
    </>
  );
}

/**
 * Traduce el estado de una mutación de TanStack Query a una fase.
 *
 * Existe para que ninguna pantalla vuelva a escribir la misma cadena de ternarios,
 * que es donde se cuela el error clásico: mirar `isPending` antes de `isError` y
 * dejar el fallo invisible mientras se reintenta.
 */
export function fase(m: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}): AsyncPhase {
  if (m.isPending) return 'pending';
  if (m.isError) return 'error';
  if (m.isSuccess) return 'success';
  return 'idle';
}
