/**
 * SKELETON CANVAS — placeholder durante carga del mapa.
 */

import { Panel } from '../../../../design/foundation/Panel';
import { cn } from '../../../../design/utils/cn';

export function SkeletonCanvas({ className }: { className?: string }) {
  return (
    <Panel level="work" radius="xl" pad="none" className={cn('overflow-hidden', className)}>
      <div className="relative h-[520px] w-full animate-pulse [background:var(--glass-1)]">
        {/* Simula la retícula */}
        <div className="absolute inset-0 opacity-30">
          {Array.from({ length: 6 }).map((_, row) => (
            <div key={row} className="flex gap-2 px-8 py-3">
              {Array.from({ length: 8 }).map((__, col) => (
                <div
                  key={col}
                  className="h-8 flex-1 rounded-[var(--radius-xs)] [background:var(--glass-2)]"
                />
              ))}
            </div>
          ))}
        </div>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="t-mono-xs text-[var(--text-faint)]">Cargando mapa…</span>
        </div>
      </div>
    </Panel>
  );
}
