/**
 * WORKSPACE LAYOUT — shell del operador tipo IDE.
 *
 * ┌─────────────┬──────────────────────────────┬──────────────┐
 * │  TREE       │       CANVAS / GRID          │  INSPECTOR   │
 * │  PANEL      │       (viewport)             │  (detalle)   │
 * │             │                              │              │
 * │  jerarquia  │                              │  tabs:       │
 * │  busqueda   │                              │  general     │
 * │  filtros    │                              │  capacidad   │
 * │             │                              │  historial   │
 * │             ├──────────────────────────────┤              │
 * │             │  TIMELINE / STATUS BAR       │              │
 * └─────────────┴──────────────────────────────┴──────────────┘
 *
 * Los paneles son colapsables. En mobile se convierten en tabs.
 */

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';

export interface WorkspacePanel {
  id: string;
  position: 'left' | 'center' | 'right' | 'bottom';
  defaultWidth?: number;
  minWidth?: number;
  collapsible?: boolean;
  content: ReactNode;
}

interface WorkspaceLayoutProps {
  /** Panel izquierdo: arbol + busqueda. */
  left: ReactNode;
  /** Panel central: canvas o grid. */
  center: ReactNode;
  /** Panel derecho: inspector. */
  right: ReactNode | null;
  /** Barra inferior: timeline + status. */
  bottom: ReactNode;
  /** KPIs superiores. */
  header: ReactNode;
  /** Toolbar. */
  toolbar: ReactNode;
  className?: string;
}

export function WorkspaceLayout({
  left,
  center,
  right,
  bottom,
  header,
  toolbar,
  className,
}: WorkspaceLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      {/* Header: KPIs */}
      {header}

      {/* Toolbar */}
      {toolbar}

      {/* Main workspace */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left panel: Tree */}
        <div
          className={cn(
            'relative flex shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)]',
            '[background:var(--glass-1)] shadow-[var(--rim-1)]',
            'transition-[width] duration-200 ease-out',
            leftCollapsed ? 'w-10' : 'w-[280px]',
          )}
        >
          {!leftCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
              {left}
            </div>
          )}
          <button
            type="button"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className={cn(
              'absolute right-1 top-2 flex size-6 items-center justify-center',
              'rounded-[var(--radius-xs)] text-[var(--text-faint)]',
              'hover:[background:var(--glass-2)] hover:text-[var(--text-primary)]',
              'transition-colors',
            )}
            aria-label={leftCollapsed ? 'Expandir arbol' : 'Colapsar arbol'}
          >
            {leftCollapsed ? (
              <ChevronRight strokeWidth={1.5} className="size-3.5" />
            ) : (
              <PanelLeftClose strokeWidth={1.5} className="size-3.5" />
            )}
          </button>
        </div>

        {/* Center: Canvas */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] [background:var(--glass-1)] shadow-[var(--rim-1)]">
            {center}
          </div>

          {/* Bottom: Timeline */}
          <div className="h-[72px] shrink-0 overflow-hidden rounded-[var(--radius-lg)] [background:var(--glass-1)] shadow-[var(--rim-1)]">
            {bottom}
          </div>
        </div>

        {/* Right panel: Inspector */}
        {right !== null && (
          <div
            className={cn(
              'relative flex shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)]',
              '[background:var(--glass-1)] shadow-[var(--rim-1)]',
              'transition-[width] duration-200 ease-out',
              rightCollapsed ? 'w-10' : 'w-[320px]',
            )}
          >
            {!rightCollapsed && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {right}
              </div>
            )}
            <button
              type="button"
              onClick={() => setRightCollapsed(!rightCollapsed)}
              className={cn(
                'absolute left-1 top-2 flex size-6 items-center justify-center',
                'rounded-[var(--radius-xs)] text-[var(--text-faint)]',
                'hover:[background:var(--glass-2)] hover:text-[var(--text-primary)]',
                'transition-colors',
              )}
              aria-label={rightCollapsed ? 'Expandir inspector' : 'Colapsar inspector'}
            >
              {rightCollapsed ? (
                <ChevronLeft strokeWidth={1.5} className="size-3.5" />
              ) : (
                <PanelRightClose strokeWidth={1.5} className="size-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
