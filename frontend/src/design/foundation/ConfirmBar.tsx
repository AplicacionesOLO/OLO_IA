/**
 * CONFIRMACIÓN EN LÍNEA — sustituye a `confirm()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NO confirm()
 *
 * Bloquea el hilo del navegador: mientras está abierto no se repinta nada y una
 * respuesta en vuelo no puede actualizar la pantalla. Y sobre todo, **no se puede
 * ofrecer una tercera opción**: `confirm()` solo sabe decir sí o no.
 *
 * La pregunta real cuando hay trabajo sin guardar casi nunca es «¿seguro que
 * quieres perderlo?». Es «¿lo guardo antes?». Esa tercera vía —la que el operador
 * quiere el 90 % de las veces— no cabe en un `confirm()`, y por eso el diálogo del
 * navegador convierte una decisión de tres opciones en una amenaza de dos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APARECE DONDE OCURRIÓ
 *
 * No es un modal centrado: se despliega junto al control que disparó la duda, así
 * que el contexto sigue visible. El operador ve las cajas que va a perder mientras
 * decide si perderlas.
 *
 * El foco va a la acción PREFERIDA —normalmente «guardar»— y `Escape` cancela. Un
 * `confirm()` pone el foco en «Aceptar», que aquí sería la opción destructiva.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

import { duration } from '../motion/duration';
import { easing } from '../motion/easing';
import { useSystemReducedMotion } from '../motion/useMotionPreference';
import { cn } from '../utils/cn';

export interface ConfirmAction {
  label: string;
  onClick: () => void;
  /** La opción recomendada. Recibe el foco al abrir. Solo una. */
  preferred?: boolean;
  /** Pierde datos. Se pinta en tono de alerta y NUNCA recibe el foco. */
  destructive?: boolean;
}

interface ConfirmBarProps {
  open: boolean;
  message: string;
  actions: ConfirmAction[];
  onCancel: () => void;
  cancelLabel?: string;
  className?: string;
}

export function ConfirmBar({
  open,
  message,
  actions,
  onCancel,
  cancelLabel = 'Cancelar',
  className,
}: ConfirmBarProps) {
  const reducido = useSystemReducedMotion();
  const preferido = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Un `rAF` de margen: el nodo acaba de montarse y `AnimatePresence` todavía lo
    // tiene con opacidad 0, así que enfocarlo en el mismo tick no siempre prende.
    const raf = requestAnimationFrame(() => preferido.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          role="alertdialog"
          aria-label={message}
          initial={{ opacity: 0, height: 0, y: reducido ? 0 : -6 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: reducido ? 0 : -6 }}
          transition={{ duration: duration.base, ease: easing.emerge }}
          className={cn('overflow-hidden', className)}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] px-3 py-2 [background:var(--glass-2)] shadow-[var(--rim-2)]">
            <p className="t-mono-xs min-w-0 flex-1 text-[var(--text-secondary)]">{message}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  ref={a.preferred ? preferido : undefined}
                  onClick={a.onClick}
                  className={cn(
                    't-mono-xs rounded-[var(--radius-xs)] px-2 py-1 transition-colors',
                    a.destructive
                      ? 'text-[var(--state-alert)] hover:[background:color-mix(in_oklab,var(--state-alert)_14%,transparent)]'
                      : a.preferred
                        ? 'text-[var(--text-inverse)] [background:var(--accent)]'
                        : 'text-[var(--text-muted)] hover:[background:var(--glass-3)]',
                  )}
                >
                  {a.label}
                </button>
              ))}
              <button
                type="button"
                onClick={onCancel}
                className="t-mono-xs rounded-[var(--radius-xs)] px-2 py-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
