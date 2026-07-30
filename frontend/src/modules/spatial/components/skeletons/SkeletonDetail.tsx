/**
 * SKELETON DETAIL — placeholder durante carga del panel lateral.
 */

import { Panel } from '../../../../design/foundation/Panel';
import { cn } from '../../../../design/utils/cn';

export function SkeletonDetail({ className }: { className?: string }) {
  return (
    <Panel level="work" radius="xl" pad="md" className={cn('col-span-12 xl:col-span-4', className)}>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="h-4 w-2/3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
          <div className="h-3 w-1/2 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
        </div>
        {/* Status */}
        <div className="flex items-center gap-3">
          <div className="size-3.5 animate-pulse rounded-full [background:var(--glass-2)]" />
          <div className="h-6 w-20 animate-pulse rounded-[var(--radius-full)] [background:var(--glass-2)]" />
        </div>
        {/* Bar */}
        <div className="flex flex-col gap-2">
          <div className="h-3 w-full animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
          <div className="h-2.5 w-full animate-pulse rounded-[var(--radius-full)] [background:var(--glass-1)]" />
        </div>
        {/* Details */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-baseline justify-between">
            <div className="h-3 w-16 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
            <div className="h-3 w-24 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
          </div>
        ))}
      </div>
    </Panel>
  );
}
