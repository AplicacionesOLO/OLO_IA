/**
 * TREE PANEL — arbol jerarquico alimentado por useSpatialTree().
 *
 * Cada nivel se carga lazy al expandir. NO usa useLocations().
 * Muestra: node_type, code, location_count, occupancy_percent, has_children.
 */

import { ChevronRight, FolderOpen, MapPin, Search } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import type { SpatialTreeNodeDto } from '../../repositories/dto';
import type { BreadcrumbSegment } from '../Breadcrumb';
import { SpatialBreadcrumb } from '../Breadcrumb';

interface TreePanelProps {
  nodes: SpatialTreeNodeDto[];
  selectedId: string | null;
  breadcrumb: BreadcrumbSegment[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (nodeId: string) => void;
  onExpand: (nodeId: string, code: string) => void;
  onNavigateBreadcrumb: (idx: number) => void;
  loading: boolean;
  empty: boolean;
  className?: string;
}

export function TreePanel({
  nodes,
  selectedId,
  breadcrumb,
  search,
  onSearchChange,
  onSelect,
  onExpand,
  onNavigateBreadcrumb,
  loading,
  empty,
  className,
}: TreePanelProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Search */}
      <label className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 [background:var(--glass-2)]" data-spatial-search>
        <Search strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar ubicacion"
          className="w-full bg-transparent text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>

      {/* Breadcrumb */}
      {!search && <SpatialBreadcrumb segments={breadcrumb} onNavigate={onNavigateBreadcrumb} />}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-2 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-1">
              <div className="size-2 animate-pulse rounded-full [background:var(--glass-2)]" />
              <div className="h-2.5 flex-1 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" style={{ width: `${40 + (i * 13) % 50}%` }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && empty && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <MapPin strokeWidth={1.25} className="size-5 text-[var(--text-faint)]" />
          <span className="t-mono-xs text-[var(--text-faint)]">
            {search ? 'Sin resultados' : 'Sin nodos'}
          </span>
        </div>
      )}

      {/* Tree nodes */}
      {!loading && nodes.length > 0 && (
        <ul className="flex flex-col gap-0.5" role="tree">
          {nodes.map((node) => (
            <TreeNodeRow
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              onSelect={() => onSelect(node.id)}
              onExpand={() => onExpand(node.id, node.code)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeNodeRow({
  node,
  selected,
  onSelect,
  onExpand,
}: {
  node: SpatialTreeNodeDto;
  selected: boolean;
  onSelect: () => void;
  onExpand: () => void;
}) {
  const isExpandable = node.has_children;
  const isLeaf = !node.has_children;

  return (
    <li
      role="treeitem"
      aria-selected={selected}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5',
        'cursor-pointer transition-colors duration-100',
        selected
          ? '[background:var(--glass-3)] shadow-[var(--rim-1)]'
          : 'hover:[background:var(--glass-1)]',
      )}
      onClick={isExpandable ? onExpand : onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          isExpandable ? onExpand() : onSelect();
        }
      }}
      tabIndex={0}
    >
      {/* Icon */}
      {isExpandable ? (
        <FolderOpen strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
      ) : (
        <MapPin strokeWidth={1.5} className="size-3 shrink-0 text-[var(--text-faint)]" />
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">
          {node.code}
          {node.name && <span className="ml-1.5 text-[var(--text-faint)]">{node.name}</span>}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {node.node_type} · {node.location_count} ubic · {node.occupancy_percent}%
        </span>
      </div>

      {/* Expand arrow */}
      {isExpandable && (
        <ChevronRight strokeWidth={1.5} className="size-3 shrink-0 text-[var(--text-faint)]" />
      )}

      {/* Leaf indicator: occupancy mini bar */}
      {isLeaf && node.occupancy_percent > 0 && (
        <span className="flex h-1 w-6 overflow-hidden rounded-full bg-[var(--glass-1)]">
          <span
            className="h-full rounded-full bg-[var(--aqua-400)]"
            style={{ width: `${node.occupancy_percent}%` }}
          />
        </span>
      )}
    </li>
  );
}
