/**
 * SKELETON TREE — placeholder durante carga de ubicaciones.
 */

import { cn } from '../../../../design/utils/cn';

export function SkeletonTree({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-3 [background:var(--glass-1)]"
        >
          <div className="size-2.5 shrink-0 animate-pulse rounded-full [background:var(--glass-2)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div
              className="h-3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]"
              style={{ width: `${50 + (i * 17) % 40}%` }}
            />
            <div className="h-2 w-20 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
          </div>
          <div className="h-5 w-14 animate-pulse rounded-[var(--radius-full)] [background:var(--glass-2)]" />
        </div>
      ))}
    </div>
  );
}
