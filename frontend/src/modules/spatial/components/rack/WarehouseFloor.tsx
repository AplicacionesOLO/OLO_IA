/**
 * WAREHOUSE FLOOR — la planta completa del almacen con todos sus pasillos.
 *
 * Es la vista de "vuelo" que un supervisor ve al abrir el explorador.
 * Muestra todos los pasillos con sus racks de forma que un operador
 * reconoce inmediatamente la distribucion fisica real.
 */

import { useMemo } from 'react';
import { cn } from '../../../../design/utils/cn';
import type { SpatialLocation } from '../../types/index';
import { buildRackModel, getSelectionContext } from '../../engine/RackModel';
import { AisleView } from './AisleView';

interface WarehouseFloorProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelectPosition: (locationId: string) => void;
  className?: string;
}

export function WarehouseFloor({
  locations,
  selectedId,
  onSelectPosition,
  className,
}: WarehouseFloorProps) {
  const aisles = useMemo(() => buildRackModel(locations), [locations]);

  // Compute highlight context from selection
  const selContext = useMemo(() => {
    if (!selectedId) return null;
    return getSelectionContext(selectedId, aisles);
  }, [selectedId, aisles]);

  if (aisles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs text-[var(--text-faint)]">Sin estructura de racks</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6 overflow-auto p-4', className)}>
      {aisles.map((aisle) => (
        <AisleView
          key={aisle.id}
          aisle={aisle}
          selectedId={selectedId}
          highlightedRack={selContext?.rackCode ?? null}
          highlightedBody={selContext?.bodyCode ?? null}
          highlightedLevel={selContext?.levelCode ?? null}
          onSelectPosition={onSelectPosition}
        />
      ))}
    </div>
  );
}
