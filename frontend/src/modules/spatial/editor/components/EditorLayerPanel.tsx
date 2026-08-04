/**
 * EDITOR LAYER PANEL — control de capas del editor.
 *
 * ── POR QUE HAY CAPAS «prox.» Y NO SE BORRAN ──────────────────────────────
 *
 * Un interruptor que no hace nada es peor que no estar. Pero un hueco donde va a
 * haber algo, ROTULADO como tal, dice dos cosas ciertas: que se ha pensado, y que
 * hoy no hay dato detras. Por eso van deshabilitadas y con el motivo en el `title`,
 * no invisibles.
 *
 * La de mapa de calor dejo de ser una de esas el dia que el inventario entro: ahora
 * se enciende, y si no hay foto del WMS se explica en vez de pintar el almacen de
 * gris —que parece una averia del editor y no una ausencia de dato—.
 */

import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import { COLOR_SIN_OCUPACION, ESCALA_OCUPACION } from '../../cluster3d/escena';
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
  { key: 'heatmap', label: 'Ocupacion' },
  { key: 'inventory', label: 'Inventario', future: true },
  { key: 'sensors', label: 'Sensores', future: true },
  { key: 'routes', label: 'Rutas', future: true },
  { key: 'ai', label: 'IA', future: true },
];

export function EditorLayerPanel({
  /**
   * Cuantos racks traen ocupacion. `0` deshabilita la capa CON motivo, en vez de
   * dejar encenderla para pintar 347 racks del gris de «sin dato».
   */
  racksConOcupacion = 0,
}: {
  racksConOcupacion?: number;
}) {
  const { layers, toggleLayer } = useEditorStore();
  const sinOcupacion = racksConOcupacion === 0;

  return (
    <div className="flex flex-col gap-2">
      <span className="t-label">Capas</span>
      <div className="flex flex-col gap-0.5">
        {LAYER_META.map(({ key, label, future }) => {
          const active = layers[key];
          const bloqueada = Boolean(future) || (key === 'heatmap' && sinOcupacion);
          const motivo =
            key === 'heatmap'
              ? sinOcupacion
                ? 'Hace falta una foto del inventario del WMS: sin ella no hay ocupacion que pintar'
                : `Colorear cada rack por lo que tiene dentro · ${racksConOcupacion} racks con dato`
              : future
                ? 'Pendiente de datos reales'
                : undefined;
          return (
            <button
              key={key}
              type="button"
              onClick={() => !bloqueada && toggleLayer(key)}
              disabled={bloqueada}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1 transition-colors',
                'text-[length:var(--text-xs)]',
                bloqueada
                  ? 'cursor-not-allowed opacity-40'
                  : active
                    ? 'text-[var(--text-primary)] hover:[background:var(--glass-1)]'
                    : 'text-[var(--text-faint)] hover:[background:var(--glass-1)]',
              )}
              aria-pressed={active}
              {...(motivo ? { title: motivo } : {})}
            >
              {active ? (
                <Eye strokeWidth={1.5} className="size-3" />
              ) : (
                <EyeOff strokeWidth={1.5} className="size-3" />
              )}
              <span>{label}</span>
              {future && <span className="ml-auto t-mono-xs text-[var(--text-faint)]">prox.</span>}
              {key === 'heatmap' && !future && !sinOcupacion && (
                <span className="ml-auto t-mono-xs text-[var(--text-faint)]">
                  {racksConOcupacion}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── La escala, solo cuando se esta usando ──────────────────────────
          Una leyenda permanente de seis tonos ocupa la mitad del panel para
          explicar unos colores que no estan en pantalla. Encendida la capa, sin
          embargo, es imprescindible: los tonos no se adivinan. */}
      {layers.heatmap && !sinOcupacion && (
        <div className="flex flex-col gap-1 border-t border-[var(--hairline-strong)] pt-2">
          {ESCALA_OCUPACION.map((tramo) => (
            <div key={tramo.etiqueta} className="flex items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: tramo.color }}
              />
              <span className="t-mono-xs text-[var(--text-faint)]">{tramo.etiqueta}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: COLOR_SIN_OCUPACION }}
            />
            <span className="t-mono-xs text-[var(--text-faint)]">sin dato</span>
          </div>
          <p className="t-mono-xs text-[var(--text-faint)]">
            El borde mantiene el color de agrupacion: la familia del rack no se pierde
            al mirar la ocupacion.
          </p>
        </div>
      )}
    </div>
  );
}
