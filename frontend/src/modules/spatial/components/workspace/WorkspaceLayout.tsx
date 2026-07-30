/**
 * WORKSPACE LAYOUT — shell del operador tipo IDE.
 *
 * Three-panel layout with controlled collapse and resize.
 * The panels remember their state via the parent (workspace store).
 */

import { useCallback, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';

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
  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      {header}
      {toolbar}

      {/* Main workspace panels */}
      <div className="flex min-h-0 flex-1 gap-0">
        {/* Left panel */}
        <div
          className={cn(
            'relative flex shrink-0 flex-col overflow-hidden',
            'rounded-l-[var(--radius-lg)] [background:var(--glass-1)]',
            'transition-[width] duration-200 ease-out',
          )}
          style={{ width: leftCollapsed ? 40 : leftWidth }}
        >
          {!leftCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
              {left}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleLeft}
            className="absolute right-1 top-2 flex size-6 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-faint)] hover:[background:var(--glass-2)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={leftCollapsed ? 'Expandir arbol' : 'Colapsar arbol'}
          >
            {leftCollapsed ? <ChevronRight strokeWidth={1.5} className="size-3.5" /> : <PanelLeftClose strokeWidth={1.5} className="size-3.5" />}
          </button>
        </div>

        {/* Left resize handle */}
        {!leftCollapsed && (
          <ResizeHandle onResize={onResizeLeft} currentWidth={leftWidth} direction="left" />
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
        {right !== null && !rightCollapsed && (
          <ResizeHandle onResize={onResizeRight} currentWidth={rightWidth} direction="right" />
        )}

        {/* Right panel */}
        {right !== null && (
          <div
            className={cn(
              'relative flex shrink-0 flex-col overflow-hidden',
              'rounded-r-[var(--radius-lg)] [background:var(--glass-1)]',
              'transition-[width] duration-200 ease-out',
            )}
            style={{ width: rightCollapsed ? 40 : rightWidth }}
          >
            {!rightCollapsed && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {right}
              </div>
            )}
            <button
              type="button"
              onClick={onToggleRight}
              className="absolute left-1 top-2 flex size-6 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-faint)] hover:[background:var(--glass-2)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={rightCollapsed ? 'Expandir inspector' : 'Colapsar inspector'}
            >
              {rightCollapsed ? <ChevronLeft strokeWidth={1.5} className="size-3.5" /> : <PanelRightClose strokeWidth={1.5} className="size-3.5" />}
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
