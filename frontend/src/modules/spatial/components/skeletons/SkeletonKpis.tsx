/**
 * SKELETON KPIs — placeholder durante carga de metricas.
 */

import { Panel } from '../../../../design/foundation/Panel';
import { cn } from '../../../../design/utils/cn';

export function SkeletonKpis({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5', className)}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Panel key={i} level="support" radius="lg" pad="sm">
          <div className="flex flex-col gap-2.5 px-1 py-0.5">
            <div className="h-3 w-12 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
            <div className="h-6 w-16 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
          </div>
        </Panel>
      ))}
    </div>
  );
}
