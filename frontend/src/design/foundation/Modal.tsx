/**
 * MODAL — dialogo del sistema, no del navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * El editor usaba `window.prompt()` para pedir la distancia de calibracion y
 * `window.alert()` para avisar de un JSON invalido. Eso rompe la aplicacion por
 * tres sitios a la vez: la tipografia y el color son del sistema operativo, el
 * dialogo bloquea el hilo —congelando el render del lienzo— y en algunos
 * navegadores se puede silenciar, con lo que la accion falla sin decir nada.
 *
 * Este modal usa las mismas superficies de cristal, radios y anillos de foco que
 * el resto, y no bloquea nada.
 *
 * ── DECISIONES ──────────────────────────────────────────────────────────────
 *
 * · Escape cierra y el fondo tambien: un dialogo del que no se sabe salir es peor
 *   que no tenerlo.
 * · El foco entra al abrir y NO se escapa mientras esta abierto —se cicla con
 *   Tab—, porque tabular hasta detras del velo deja al teclado navegando una
 *   interfaz que el raton no puede tocar.
 * · Se renderiza en su sitio del arbol, sin portal: el unico modal que hay va
 *   sobre lienzos a pantalla completa, y un portal a `body` quedaria DEBAJO del
 *   elemento promocionado por `requestFullscreen()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

import { cn } from '../utils/cn';

export interface ModalProps {
  abierto: boolean;
  titulo: string;
  /**
   * Frase corta que explica que se decide aqui.
   *
   * `| undefined` explicito: el proyecto compila con `exactOptionalPropertyTypes`,
   * y sin el no se puede pasar el resultado de una condicion.
   */
  descripcion?: string | undefined;
  onCerrar: () => void;
  children?: React.ReactNode;
  /** Botonera. Se alinea a la derecha. */
  acciones?: React.ReactNode;
  className?: string;
}

export function Modal({
  abierto,
  titulo,
  descripcion,
  onCerrar,
  children,
  acciones,
  className,
}: ModalProps) {
  const cajaRef = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  useEffect(() => {
    if (!abierto) return;
    const caja = cajaRef.current;
    // Primer campo o primer boton: lo que el usuario ha venido a hacer.
    const foco = caja?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-cerrar])',
    );
    foco?.focus();

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCerrar();
        return;
      }
      if (e.key !== 'Tab' || !caja) return;
      const focales = [
        ...caja.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focales.length === 0) return;
      const primero = focales[0]!;
      const ultimo = focales[focales.length - 1]!;
      if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      }
    };
    // `capture`: el lienzo y el editor tienen sus propios atajos con Escape, y sin
    // capturar antes el modal se cerraria a la vez que se deselecciona un rack.
    document.addEventListener('keydown', alPulsar, true);
    return () => document.removeEventListener('keydown', alPulsar, true);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center p-6"
      role="presentation"
    >
      {/* Velo. Oscurece y desenfoca lo de detras para que el ojo vaya al dialogo. */}
      <div
        aria-hidden
        onClick={onCerrar}
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--abyss-1000)_70%,transparent)] backdrop-blur-[6px]"
      />

      <div
        ref={cajaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        {...(descripcion ? { 'aria-describedby': idDescripcion } : {})}
        className={cn(
          'relative w-full max-w-[420px] rounded-[var(--radius-lg)] p-5',
          '[background:var(--glass-3)] shadow-[var(--rim-2),var(--drop-3)]',
          'backdrop-blur-[28px] [backdrop-saturate:1.5]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id={idTitulo}
              className="text-[length:var(--text-md)] font-[var(--weight-medium)] leading-tight text-[var(--text-primary)]"
            >
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDescripcion} className="t-body text-[var(--text-secondary)]">
                {descripcion}
              </p>
            )}
          </div>
          <button
            type="button"
            data-cerrar
            onClick={onCerrar}
            aria-label="Cerrar"
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)]',
              'text-[var(--icon-muted)] transition-colors',
              'hover:text-[var(--icon-primary)] hover:[background:var(--glass-1)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
            )}
          >
            <X strokeWidth={1.5} className="size-4" />
          </button>
        </div>

        {children && <div className="mt-4 flex flex-col gap-3">{children}</div>}

        {acciones && <div className="mt-5 flex items-center justify-end gap-2">{acciones}</div>}
      </div>
    </div>
  );
}
