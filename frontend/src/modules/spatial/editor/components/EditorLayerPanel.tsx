/**
 * EDITOR LAYER PANEL — control de capas del editor.
 */

import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import { useEditorStore } from '../store';
import type { EditorLayers } from '../types';

const LAYER_META: { key: keyof EditorLayers; label: string; future?: boolean }[] = [
  { key: 'plan', label: 'Plano base' },
  { key: 'racks', label: 'Racks' },
  { key: 'labels', label: 'Etiquetas' },
  { key: 'grid', label: 'Grid' },
  { key: 'axes', label: 'Ejes' },
  { key: 'measurements', label: 'Medidas' },
  { key: 'zones', label: 'Zonas especiales' },
  { key: 'selection', label: 'Seleccion' },
  { key: 'heatmap', label: 'Heatmap', future: true },
  { key: 'inventory', label: 'Inventario', future: true },
  { key: 'sensors', label: 'Sensores', future: true },
  { key: 'routes', label: 'Rutas', future: true },
  { key: 'ai', label: 'IA', future: true },
];

export function EditorLayerPanel() {
  const { layers, toggleLayer } = useEditorStore();

  return (
    <div className="flex flex-col gap-2">
      <span className="t-label">Capas</span>
      <div className="flex flex-col gap-0.5">
        {LAYER_META.map(({ key, label, future }) => {
          const active = layers[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => !future && toggleLayer(key)}
              disabled={future}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1 transition-colors',
                'text-[length:var(--text-xs)]',
                future
                  ? 'cursor-not-allowed opacity-40'
                  : active
                    ? 'text-[var(--text-primary)] hover:[background:var(--glass-1)]'
                    : 'text-[var(--text-faint)] hover:[background:var(--glass-1)]',
              )}
              aria-pressed={active}
              title={future ? 'Pendiente de datos reales' : undefined}
            >
              {active ? <Eye strokeWidth={1.5} className="size-3" /> : <EyeOff strokeWidth={1.5} className="size-3" />}
              <span>{label}</span>
              {future && <span className="ml-auto t-mono-xs text-[var(--text-faint)]">prox.</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
