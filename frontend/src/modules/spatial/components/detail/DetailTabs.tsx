/**
 * DETAIL TABS — estructura del panel lateral para expansion futura.
 *
 * Hoy muestra solo la pestaña "General" con la informacion que tenemos.
 * Preparado para añadir sin reescribir:
 *   - General (datos del nodo)
 *   - Capacidad (ocupacion, dimensiones, limites)
 *   - Inventario (SKUs en la ubicacion — requiere backend)
 *   - Historial (movimientos — requiere backend)
 *   - IA (inferencias sobre la ubicacion — requiere backend)
 *   - Sensores (temperatura, humedad — requiere backend)
 *   - Fotografias (evidencia visual — requiere backend)
 *   - Documentos (planos, instrucciones — requiere backend)
 */

import { useState, type ReactNode } from 'react';
import { cn } from '../../../../design/utils/cn';

export interface DetailTab {
  id: string;
  label: string;
  /** Contenido. null = pestaña deshabilitada (proxima version). */
  content: ReactNode | null;
  /** Si requiere backend para funcionar. Se muestra como "proximamente". */
  pending?: boolean;
}

interface DetailTabsProps {
  tabs: DetailTab[];
  className?: string;
}

export function DetailTabs({ tabs, className }: DetailTabsProps) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const active = tabs.find((t) => t.id === activeId);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            aria-disabled={tab.pending}
            onClick={() => !tab.pending && setActiveId(tab.id)}
            className={cn(
              'whitespace-nowrap rounded-[var(--radius-xs)] px-3 py-1.5 text-[length:var(--text-xs)] transition-colors',
              tab.id === activeId
                ? '[background:var(--glass-3)] text-[var(--text-primary)]'
                : tab.pending
                  ? 'text-[var(--text-faint)] opacity-50 cursor-not-allowed'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:[background:var(--glass-1)]',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel" aria-labelledby={activeId}>
        {active?.pending ? (
          <p className="t-mono-xs py-4 text-center text-[var(--text-faint)]">
            Disponible cuando el backend entregue este recurso.
          </p>
        ) : (
          active?.content
        )}
      </div>
    </div>
  );
}
