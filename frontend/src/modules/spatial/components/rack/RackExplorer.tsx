/**
 * RACK EXPLORER — combines floor plan + frontal view.
 *
 * Floor plan → click rack → frontal view. Back button returns to floor plan.
 * The transition between views is natural: the user drills into the rack.
 */

import { useMemo, useState } from 'react';
import type { SpatialLocation } from '../../types/index';
import { buildViewModel, type RackVisual } from '../../engine/RackModel';
import { RackFloorPlan } from './RackFloorPlan';
import { RackFrontal } from './RackFrontal';

interface RackExplorerProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelectPosition: (locationId: string) => void;
  className?: string | undefined;
}

export function RackExplorer({
  locations,
  selectedId,
  onSelectPosition,
  className,
}: RackExplorerProps) {
  const [focusedRack, setFocusedRack] = useState<string | null>(null);
  const viewModel = useMemo(() => buildViewModel(locations), [locations]);

  // Find the focused rack's visual data
  const rackData: RackVisual | null = useMemo(() => {
    if (!focusedRack) return null;
    for (const group of viewModel.groups) {
      const found = group.racks.find((r) => r.code === focusedRack);
      if (found) return found;
    }
    return null;
  }, [focusedRack, viewModel]);

  if (rackData) {
    return (
      <RackFrontal
        rack={rackData}
        selectedId={selectedId}
        onSelectPosition={onSelectPosition}
        onBack={() => setFocusedRack(null)}
        className={className}
      />
    );
  }

  return (
    <RackFloorPlan
      locations={locations}
      selectedId={selectedId}
      onSelectRack={setFocusedRack}
      onSelectPosition={onSelectPosition}
      className={className}
    />
  );
}
