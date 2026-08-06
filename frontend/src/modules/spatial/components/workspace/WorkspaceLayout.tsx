/**
 * WORKSPACE LAYOUT — shell del operador tipo IDE.
 *
 * Tres paneles con colapso y arrastre. El ancho lo recuerda el store del workspace.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ANCHO GUARDADO SE ACOTA AL ESPACIO QUE HAY
 *
 * Los paneles tenían su ancho en píxeles y `shrink-0`, sin comprobar si cabían. Con
 * 300 + 340 px de laterales y una ventana de 910 px CSS —un portátil de 1.366 con el
 * escalado de Windows al 150 %— el centro se aplastaba y el panel derecho se salía del
 * contenedor, que lo RECORTA: desaparecía sin que nada avisara, porque la página no
 * desborda. Medido: `scrollWidth == clientWidth` con media columna invisible.
 *
 * Y el ancho viaja en `localStorage`: uno elegido arrastrando en una pantalla grande
 * vuelve tal cual en una pequeña, así que no basta con elegir buenos valores por
 * defecto.
 *
 * Ahora se mide el contenedor y se reparte: el centro reserva su mínimo, las laterales
 * encogen a la vez y, si no hay sitio, se colapsan por orden —primero el inspector,
 * que es contextual—. Colapsado deja su botón; encogido a 90 px sería una columna de
 * texto cortado. Lo guardado NO se toca: se acota al pintar, así que al volver a una
 * pantalla grande el ancho que el operador eligió sigue ahí.
 */

import { useCallback, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import { repartir, useAnchoDisponible } from '../../../../design/utils/useAnchoDisponible';

/**
 * Lo mínimo que el centro necesita. Por debajo, la tabla no muestra una fila legible
 * y el lienzo del rack no cabe: es el umbral a partir del cual colapsar una lateral es
 * mejor que conservarla.
 */
const MIN_CENTRO = 380;

interface WorkspaceLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode | null;
  bottom: ReactNode;
  header: ReactNode;
  toolbar: ReactNode;
  // Controlled state
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onResizeLeft: (width: number) => void;
  onResizeRight: (width: number) => void;
  className?: string;
}

export function WorkspaceLayout({
  left,
  center,
  right,
  bottom,
  header,
  toolbar,
  leftCollapsed,
  rightCollapsed,
  leftWidth,
  rightWidth,
  onToggleLeft,
  onToggleRight,
  onResizeLeft,
  onResizeRight,
  className,
}: WorkspaceLayoutProps) {
  const { ref: filaRef, ancho } = useAnchoDisponible<HTMLDivElement>();

  // Los separadores de arrastre ocupan; contarlos evita que el reparto se pase por
  // unos pocos pixeles justo en el limite, que es donde mas se nota.
  const separadores = (leftCollapsed ? 0 : 6) + (right !== null && !rightCollapsed ? 6 : 0);
  const reparto = repartir(ancho, {
    izquierda: leftCollapsed ? 0 : leftWidth,
    derecha: right === null || rightCollapsed ? 0 : rightWidth,
    minCentro: MIN_CENTRO,
    anchoColapsado: 40,
    extra: separadores,
  });

  // Colapsado por decision del operador O por falta de sitio. Se distinguen: el boton
  // sigue abriendo el panel, y si no cabe se vuelve a acotar en el render siguiente.
  const izqCerrada = leftCollapsed || reparto.izquierdaForzada;
  const derCerrada = rightCollapsed || reparto.derechaForzada;

  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      {header}
      {toolbar}

      {/* Main workspace panels */}
      <div ref={filaRef} className="flex min-h-0 flex-1 gap-0">
        {/* Left panel */}
        <div
          className={cn(
            'relative flex shrink-0 flex-col overflow-hidden',
            'rounded-l-[var(--radius-lg)] [background:var(--glass-1)]',
            'transition-[width] duration-200 ease-out',
          )}
          style={{ width: izqCerrada ? 40 : reparto.izquierda }}
        >
          {!izqCerrada && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
              {left}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleLeft}
            className="absolute right-1 top-2 flex size-6 pointer-coarse:size-11 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-faint)] hover:[background:var(--glass-2)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={izqCerrada ? 'Expandir arbol' : 'Colapsar arbol'}
            title={
              reparto.izquierdaForzada
                ? 'Colapsado porque no cabe: la ventana es estrecha'
                : undefined
            }
          >
            {izqCerrada ? <ChevronRight strokeWidth={1.5} className="size-3.5" /> : <PanelLeftClose strokeWidth={1.5} className="size-3.5" />}
          </button>
        </div>

        {/* Left resize handle. Sin panel abierto no hay nada que arrastrar. */}
        {!izqCerrada && (
          <ResizeHandle onResize={onResizeLeft} currentWidth={reparto.izquierda} direction="left" />
        )}

        {/* Center */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden [background:var(--glass-1)]">
            {center}
          </div>
          <div className="h-8 shrink-0 border-t border-[var(--hairline)] [background:var(--glass-1)]">
            {bottom}
          </div>
        </div>

        {/* Right resize handle */}
        {right !== null && !derCerrada && (
          <ResizeHandle onResize={onResizeRight} currentWidth={reparto.derecha} direction="right" />
        )}

        {/* Right panel */}
        {right !== null && (
          <div
            className={cn(
              'relative flex shrink-0 flex-col overflow-hidden',
              'rounded-r-[var(--radius-lg)] [background:var(--glass-1)]',
              'transition-[width] duration-200 ease-out',
            )}
            style={{ width: derCerrada ? 40 : reparto.derecha }}
          >
            {!derCerrada && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {right}
              </div>
            )}
            <button
              type="button"
              onClick={onToggleRight}
              className="absolute left-1 top-2 flex size-6 pointer-coarse:size-11 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-faint)] hover:[background:var(--glass-2)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={derCerrada ? 'Expandir inspector' : 'Colapsar inspector'}
              title={
                reparto.derechaForzada
                  ? 'Colapsado porque no cabe: la ventana es estrecha'
                  : undefined
              }
            >
              {derCerrada ? <ChevronLeft strokeWidth={1.5} className="size-3.5" /> : <PanelRightClose strokeWidth={1.5} className="size-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Drag handle for resizing panels. */
function ResizeHandle({
  onResize,
  currentWidth,
  direction,
}: {
  onResize: (width: number) => void;
  currentWidth: number;
  direction: 'left' | 'right';
}) {
  const startRef = useRef({ x: 0, width: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, width: currentWidth };
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startRef.current.x;
        const newWidth = direction === 'left'
          ? startRef.current.width + delta
          : startRef.current.width - delta;
        onResize(newWidth);
      };

      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    },
    [currentWidth, direction, onResize],
  );

  return (
    <div
      className="group flex w-[6px] shrink-0 cursor-col-resize items-center justify-center hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] transition-colors"
      onPointerDown={onPointerDown}
      aria-hidden
    >
      <GripVertical strokeWidth={1} className="size-3 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
