/**
 * HUD DE DIAGNOSTICO
 *
 * Las lineas tecnicas que aparecen sobre la escena. La ultima —"contexto de
 * organizacion: esperando identidad"— es la invitacion implicita a autenticarse:
 * comunica que todo el sistema esta listo y solo falta saber quien eres.
 *
 * Aqui SI es legitimo el aire de instrumentacion: estamos sobre la escena, no en
 * la interfaz de trabajo, y el contenido es literalmente el arranque del sistema.
 * Lo que se elimina son los puntos de relleno tipo terminal: la alineacion se
 * hace con una columna de ancho fijo.
 */

import { motion } from 'framer-motion';
import { DIAGNOSTIC_LINES, type SceneTiming } from './timeline';
import { stagger } from '../../design/motion/stagger';
import { easing } from '../../design/motion/easing';
import { cn } from '../../design/utils/cn';

interface DiagnosticHudProps {
  timing: SceneTiming;
  reducedMotion: boolean;
}

export function DiagnosticHud({ timing, reducedMotion }: DiagnosticHudProps) {
  return (
    <motion.ul
      aria-hidden="true"
      className="absolute bottom-[var(--space-12)] left-[var(--space-12)] hidden select-none flex-col gap-2.5 lg:flex"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            delayChildren: reducedMotion ? 0 : timing.hud,
            staggerChildren: reducedMotion ? 0 : stagger.scene,
          },
        },
      }}
    >
      {DIAGNOSTIC_LINES.map((line) => (
        <motion.li
          key={line.label}
          className="flex items-center gap-4"
          variants={{
            hidden: { opacity: 0, x: -14 },
            visible: {
              opacity: 1,
              x: 0,
              transition: { duration: reducedMotion ? 0.12 : 0.42, ease: easing.emerge },
            },
          }}
        >
          {/* Punto de estado: sustituye a los puntos de relleno de terminal. */}
          <span
            className={cn('size-1.5 shrink-0 rounded-full', !reducedMotion && 'olo-pulse')}
            style={{
              background: line.pending ? 'var(--state-alert)' : 'var(--aqua-400)',
              boxShadow: line.pending
                ? '0 0 8px 1px rgb(245 158 11 / 0.6)'
                : '0 0 8px 1px rgb(34 217 245 / 0.55)',
            }}
          />
          <span className="t-mono-xs w-[152px] text-[var(--text-faint)]">{line.label}</span>
          <span
            className={cn(
              't-mono-xs',
              line.pending ? 'text-[var(--ember-400)]' : 'text-[var(--aqua-300)]',
            )}
          >
            {line.value}
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
