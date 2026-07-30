/**
 * UNPOSITIONED RACKS — racks que no tienen coordenadas en el plano.
 *
 * El usuario arrastra de aqui al canvas para posicionar.
 */

import { GripHorizontal } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import { useEditorStore } from '../store';
import type { FloorPlanRackDto } from '../../repositories/dto';

interface UnpositionedRacksProps {
  /** Racks del catalogo (de useFloorPlan). */
  allRacks: FloorPlanRackDto[];
}

export function UnpositionedRacks({ allRacks }: UnpositionedRacksProps) {
  const { racks: positioned, addRack, setMode } = useEditorStore();
  const positionedCodes = new Set(positioned.map((r) => r.rackCode));
  const unpositioned = allRacks.filter((r) => !positionedCodes.has(r.rack_code));

  if (unpositioned.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="t-label">Racks sin posicionar</span>
        <p className="t-mono-xs text-[var(--text-faint)]">Todos posicionados</p>
      </div>
    );
  }

  const handlePlace = (rackDto: FloorPlanRackDto) => {
    addRack({
      layoutId: `layout-${rackDto.rack_code}-${Date.now()}`,
      rackCode: rackDto.rack_code,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: 1.1,
      length: 12.0,
      height: 8.5,
      rotation: 0,
      locked: false,
      linked: true,
    });
    setMode('select');
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="t-label">Racks sin posicionar ({unpositioned.length})</span>
      <div className="flex flex-col gap-1">
        {unpositioned.map((r) => (
          <button
            key={r.rack_code}
            type="button"
            onClick={() => handlePlace(r)}
            className={cn(
              'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left transition-colors',
              'hover:[background:var(--glass-2)]',
            )}
            title={`Colocar ${r.rack_code} en el plano`}
          >
            <GripHorizontal strokeWidth={1.5} className="size-3 shrink-0 text-[var(--text-faint)]" />
            <span className="flex-1 font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {r.rack_code}
            </span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {r.location_count} ubic
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
