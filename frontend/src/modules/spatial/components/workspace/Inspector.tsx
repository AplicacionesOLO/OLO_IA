/**
 * INSPECTOR — panel derecho del workspace.
 *
 * Cuando hay seleccion: muestra DetailTabs con la informacion del nodo.
 * Sin seleccion: muestra el panel de capas y las acciones disponibles.
 *
 * Es el patron de inspector de cualquier herramienta profesional (Figma,
 * Unity, Blue Yonder): el panel derecho siempre muestra algo contextual.
 */

import { Box, Layers, Package } from 'lucide-react';
import type { SpatialLocation } from '../../types/index';
import { LocationDetail } from '../LocationDetail';
import { DetailTabs, type DetailTab } from '../detail/DetailTabs';
import { LayerPanel, type LayerConfig } from '../LayerPanel';
import type { LocationStatus } from '../../types/index';
import { cn } from '../../../../design/utils/cn';

interface InspectorProps {
  /** Ubicacion seleccionada. null = sin seleccion. */
  selectedLocation: SpatialLocation | null;
  loading: boolean;
  layers: LayerConfig;
  onToggleLayer: (status: LocationStatus) => void;
  onClose: () => void;
  className?: string;
}

export function Inspector({
  selectedLocation,
  loading,
  layers,
  onToggleLayer,
  onClose,
  className,
}: InspectorProps) {
  if (!selectedLocation && !loading) {
    // Sin seleccion: muestra capas y ayuda
    return (
      <div className={cn('flex flex-col gap-6', className)}>
        <LayerPanel layers={layers} onToggle={onToggleLayer} />

        <div className="flex flex-col gap-3">
          <span className="t-label">Inspector</span>
          <p className="t-mono-xs text-[var(--text-faint)]">
            Selecciona una ubicacion en el mapa o en el arbol para ver su detalle.
          </p>
          <p className="t-mono-xs text-[var(--text-faint)]">
            Ctrl+click para seleccion multiple.
          </p>
        </div>
      </div>
    );
  }

  // Con seleccion: tabs del detalle
  const tabs = buildTabs(selectedLocation, onClose);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {loading ? (
        <div className="flex flex-col gap-3 py-4">
          <div className="h-4 w-2/3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
          <div className="h-3 w-1/2 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
        </div>
      ) : selectedLocation ? (
        <DetailTabs tabs={tabs} />
      ) : null}
    </div>
  );
}

function buildTabs(location: SpatialLocation | null, onClose: () => void): DetailTab[] {
  if (!location) return [];

  return [
    {
      id: 'general',
      label: 'General',
      content: (
        <LocationDetail
          location={location}
          loading={false}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'capacity',
      label: 'Capacidad',
      content: (
        <div className="flex flex-col gap-3 py-2">
          <DetailRow icon={<Package strokeWidth={1.5} className="size-3.5" />} label="Ocupacion" value={`${location.occupied} / ${location.capacity}`} />
          <DetailRow icon={<Box strokeWidth={1.5} className="size-3.5" />} label="Tipo" value={location.kind} />
          {location.dimensions && (
            <DetailRow icon={<Layers strokeWidth={1.5} className="size-3.5" />} label="Dimensiones" value={`${location.dimensions.width}×${location.dimensions.depth}×${location.dimensions.height}m`} />
          )}
        </div>
      ),
    },
    { id: 'inventory', label: 'Inventario', content: null, pending: true },
    { id: 'history', label: 'Historial', content: null, pending: true },
    { id: 'ai', label: 'IA', content: null, pending: true },
    { id: 'sensors', label: 'Sensores', content: null, pending: true },
    { id: 'photos', label: 'Fotos', content: null, pending: true },
    { id: 'docs', label: 'Docs', content: null, pending: true },
  ];
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[var(--text-muted)]">
        <span className="text-[var(--text-faint)]">{icon}</span>
        <span className="t-label">{label}</span>
      </span>
      <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
