/**
 * EXPANDIBLE — llevar un visor a pantalla completa sin perder sus controles.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * El lienzo del rack y el del plano viven en la columna central del area de
 * trabajo: con la barra lateral, la barra superior, el arbol y el inspector, al
 * dibujo le quedan unos 700 px de ancho. Para situar 347 racks o leer un alzado
 * de 27 cuerpos eso no da.
 *
 * ── DOS MECANISMOS A LA VEZ, Y NO ES REDUNDANCIA ────────────────────────────
 *
 * 1. Capa fija (`position: fixed`) que cubre la aplicacion. Funciona siempre.
 * 2. `requestFullscreen()` sobre el MISMO elemento, que ademas se come el marco
 *    del navegador y da la pantalla entera.
 *
 * Si la API nativa falla —la deniega el navegador, o es un iframe sin permiso—
 * la capa fija ya ha ampliado el visor: se degrada a menos espacio, no a nada.
 *
 * ── POR QUE NO UN PORTAL ────────────────────────────────────────────────────
 *
 * Mover el visor a otro nodo del arbol lo DESMONTA y lo vuelve a montar. Eso
 * destruye el contexto WebGL del visor 3D y vacia el historial de deshacer del
 * editor: expandir la pantalla perderia el trabajo. Con `fixed` sobre el mismo
 * elemento, React conserva el nodo y el estado no se entera.
 *
 * ── SALIR ───────────────────────────────────────────────────────────────────
 *
 * Escape sale en los dos modos: en pantalla completa nativa lo gestiona el
 * navegador y `fullscreenchange` sincroniza el estado; en la capa fija se escucha
 * la tecla. Sin esto, expandir seria una trampa sin salida evidente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { useShellStore } from '../../shell/shellStore';
import { cn } from '../utils/cn';

/** Clases del visor cuando esta expandido. Se aplican al MISMO elemento. */
export const CLASES_EXPANDIDO =
  'fixed inset-0 z-[70] m-0 flex flex-col gap-2 p-3 [background:var(--canvas)]';

export interface Expansion {
  // `RefObject<HTMLDivElement>` y no `<HTMLDivElement | null>`: con el union, los
  // tipos de React 18 rechazan el ref en la prop `ref` del elemento. El `current`
  // ya admite null por definicion del tipo.
  ref: React.RefObject<HTMLDivElement>;
  expandido: boolean;
  alternar: () => void;
}

export function useExpansion(): Expansion {
  const ref = useRef<HTMLDivElement>(null);
  const [expandido, setExpandido] = useState(false);
  const avisarAlShell = useShellStore((s) => s.setVisorExpandido);

  // El shell tiene que saberlo para elevar el contenido por encima de la barra
  // lateral: ver el comentario de `visorExpandido` en shellStore. Y hay que
  // bajarlo al desmontar, o navegar mientras esta expandido dejaria el shell
  // creyendo que sigue habiendo un visor a pantalla completa.
  useEffect(() => {
    avisarAlShell(expandido);
  }, [expandido, avisarAlShell]);

  useEffect(() => () => avisarAlShell(false), [avisarAlShell]);

  const alternar = useCallback(() => {
    const el = ref.current;
    if (!expandido) {
      setExpandido(true);
      // `catch` vacio a proposito: si el navegador no concede pantalla completa,
      // la capa fija ya esta puesta y el visor se ve grande igualmente.
      void el?.requestFullscreen?.().catch(() => {});
      return;
    }
    setExpandido(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [expandido]);

  // El navegador puede salir de pantalla completa por su cuenta (Escape, F11).
  // Sin escuchar el evento, el estado quedaria diciendo «expandido» con la
  // aplicacion ya restaurada.
  useEffect(() => {
    const alCambiar = () => {
      if (!document.fullscreenElement) setExpandido(false);
    };
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);

  // Escape cuando solo hay capa fija: en pantalla completa nativa la tecla la
  // consume el navegador y llega por `fullscreenchange`.
  useEffect(() => {
    if (!expandido) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setExpandido(false);
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [expandido]);

  return { ref, expandido, alternar };
}

/** Boton de expandir/restaurar. Va junto a los demas controles del visor. */
export function BotonExpandir({
  expandido,
  onClick,
  className,
}: {
  expandido: boolean;
  onClick: () => void;
  className?: string;
}) {
  const Icono = expandido ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={expandido}
      aria-label={expandido ? 'Salir de pantalla completa' : 'Ver a pantalla completa'}
      title={
        expandido
          ? 'Salir de pantalla completa · Escape'
          : 'Pantalla completa. Los controles siguen disponibles'
      }
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)]',
        'text-[var(--icon-muted)] transition-colors duration-200',
        'hover:text-[var(--icon-primary)] hover:[background:var(--glass-1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        expandido && '[background:var(--glass-2)] text-[var(--icon-primary)]',
        className,
      )}
    >
      <Icono strokeWidth={1.5} className="size-3.5" />
    </button>
  );
}
