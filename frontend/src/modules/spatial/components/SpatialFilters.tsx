/**
 * FILTROS DE UBICACIONES — todos los que el backend admite, y solo esos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES DETALLES QUE CAMBIAN EL COMPORTAMIENTO
 *
 * 1. LA BUSQUEDA ES POR PREFIJO, y se dice. `MZ01` encuentra; `Z01` no. No es una
 *    limitacion arbitraria: con un comodin por delante el indice no se usa y la
 *    consulta pasa de 22 ms a recorrer las 29.310 filas. Buscar por substring
 *    necesitaria un indice GIN con `pg_trgm`, que no esta instalado.
 *
 * 2. EL DEBOUNCE ES DEL COMPONENTE, no de la query. Cada pulsacion que llega al
 *    filtro es una peticion, y con 260 ms de latencia escribir «RCL01» serian
 *    cinco peticiones en vuelo cuyas respuestas pueden llegar desordenadas.
 *
 * 3. `withTotal` ES UNA CASILLA VISIBLE. El `count` exacto cuesta una consulta
 *    mas. Ocultar ese coste detras de un total que siempre aparece esta bien
 *    cuando son 20 filas; con 29.310 y una tabla que se navega, es trabajo que el
 *    operador no pidio. Se ofrece, no se impone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import { SPATIAL_CONFIG } from '../config';
import type { CodeForm, LocationStatus } from '../types/index';
import { STATUS_META } from './StatusLegend';

export interface FiltersValue {
  search: string;
  status: LocationStatus | undefined;
  situation: string | undefined;
  codeForm: CodeForm | undefined;
  level: number | undefined;
  withTotal: boolean;
}

interface SpatialFiltersProps {
  value: FiltersValue;
  onChange: (patch: Partial<FiltersValue>) => void;
  onClear: () => void;
  /** Situaciones PRESENTES en el almacen, del resumen. Vocabulario abierto. */
  situations: string[];
  /** Nivel maximo del almacen, para no ofrecer niveles que no existen. */
  maxLevel: number | null;
  /** Rack cuyo filtro esta activo, para poder quitarlo. */
  activeRackCode?: string | null | undefined;
  onClearRack?: (() => void) | undefined;
  className?: string;
}

export function SpatialFilters({
  value,
  onChange,
  onClear,
  situations,
  maxLevel,
  activeRackCode,
  onClearRack,
  className,
}: SpatialFiltersProps) {
  // Texto local + debounce: el store solo se toca cuando el usuario para de
  // escribir.
  const [texto, setTexto] = useState(value.search);

  useEffect(() => {
    // Sincroniza si el filtro cambia desde fuera (p. ej. `Limpiar`).
    setTexto(value.search);
  }, [value.search]);

  useEffect(() => {
    if (texto === value.search) return;
    const t = setTimeout(
      () => onChange({ search: texto }),
      SPATIAL_CONFIG.searchDebounceMs,
    );
    return () => clearTimeout(t);
  }, [texto, value.search, onChange]);

  const hayFiltros =
    Boolean(value.search) ||
    value.status != null ||
    value.situation != null ||
    value.codeForm != null ||
    value.level != null ||
    Boolean(activeRackCode);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* ── Busqueda ─────────────────────────────────────────────────────── */}
      <label
        className="flex h-9 min-w-[220px] flex-1 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] shadow-[var(--rim-1)] focus-within:shadow-[var(--focus-ring)]"
        data-spatial-search
      >
        <Search strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Codigo por prefijo: RCL01…"
          aria-label="Buscar ubicacion por prefijo de codigo"
          className="w-full bg-transparent text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        />
        {texto && (
          <button
            type="button"
            onClick={() => setTexto('')}
            aria-label="Limpiar busqueda"
            className="shrink-0 text-[var(--icon-muted)]"
          >
            <X strokeWidth={1.5} className="size-3.5" />
          </button>
        )}
      </label>

      {/* ── Estado del espacio: vocabulario cerrado, dos valores ─────────── */}
      <Selector
        label="Estado"
        value={value.status ?? ''}
        onChange={(v) => onChange({ status: (v || undefined) as LocationStatus | undefined })}
        options={[
          { value: '', label: 'Todos' },
          { value: 'available', label: STATUS_META.available.label },
          { value: 'blocked', label: STATUS_META.blocked.label },
        ]}
      />

      {/* ── Situacion del WMS: vocabulario abierto, se lista lo presente ─── */}
      {situations.length > 0 && (
        <Selector
          label="WMS"
          value={value.situation ?? ''}
          onChange={(v) => onChange({ situation: v || undefined })}
          options={[
            { value: '', label: 'Todas' },
            ...situations.map((s) => ({ value: s, label: s })),
          ]}
        />
      )}

      <Selector
        label="Forma"
        value={value.codeForm ?? ''}
        onChange={(v) => onChange({ codeForm: (v || undefined) as CodeForm | undefined })}
        options={[
          { value: '', label: 'Todas' },
          { value: 'structured', label: 'Estructurada' },
          { value: 'opaque', label: 'Opaca' },
        ]}
      />

      {maxLevel != null && maxLevel > 1 && (
        <Selector
          label="Nivel"
          value={value.level != null ? String(value.level) : ''}
          onChange={(v) => onChange({ level: v ? Number(v) : undefined })}
          options={[
            { value: '', label: 'Todos' },
            ...Array.from({ length: maxLevel }, (_, i) => ({
              value: String(i + 1),
              label: `N${String(i + 1).padStart(2, '0')}`,
            })),
          ]}
        />
      )}

      {/* Filtro por rack, cuando viene del arbol o del plano. */}
      {activeRackCode && onClearRack && (
        <button
          type="button"
          onClick={onClearRack}
          className="flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 [background:var(--glass-2)]"
          title="Quitar el filtro por rack"
        >
          <span className="t-mono-xs text-[var(--text-muted)]">rack {activeRackCode}</span>
          <X strokeWidth={1.5} className="size-3 text-[var(--icon-muted)]" />
        </button>
      )}

      {/* ── El total, como decision explicita ────────────────────────────── */}
      <label
        className="flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 [background:var(--glass-2)]"
        title="Contar el total exacto cuesta una consulta adicional al servidor."
      >
        <input
          type="checkbox"
          checked={value.withTotal}
          onChange={(e) => onChange({ withTotal: e.target.checked })}
          className="size-3 accent-[var(--accent)]"
        />
        <span className="t-mono-xs text-[var(--text-muted)]">contar total</span>
      </label>

      {hayFiltros && (
        <button
          type="button"
          onClick={onClear}
          className="h-9 px-2 text-[length:var(--text-xs)] text-[var(--accent)]"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 [background:var(--glass-2)] focus-within:shadow-[var(--focus-ring)]">
      <span className="t-label shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="bg-transparent text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
