/**
 * DETALLE DE UNA UBICACION — todo lo que el backend sabe, y nada mas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS DOS ARREGLOS QUE IMPORTAN
 *
 * 1. LA CAPACIDAD TIENE TRES ESTADOS, NO UN NUMERO.
 *
 *    Antes se mostraba `occupied / capacity` con una barra de porcentaje. De las
 *    29.310 ubicaciones del catalogo real:
 *      ·  2.341 tienen capacidad declarada
 *      · 26.244 el WMS declaro «sin limite» (con OCHO grafias del centinela)
 *      ·    727 el WMS no dijo nada
 *
 *    Con la version anterior, 26.971 ubicaciones mostraban «0 / 0» y una barra
 *    vacia. Un `0` donde el dato es «sin limite» dice justo lo contrario de lo
 *    que ocurre. Y `occupied` no existe en el modelo: la ocupacion es del
 *    inventario (SPA-11).
 *
 * 2. LA DIRECCION VIENE DESCOMPUESTA, NO SE PARSEA.
 *
 *    Cada componente es un campo (ADR-013). Y `externalCode` conserva la grafia
 *    original del WMS —`DAÑADO-C001-N01-1`— porque es lo que el operario lee en
 *    la etiqueta del estante.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AlertTriangle, Box, Hash, Infinity as InfinityIcon, Layers, Ruler, Tag, X } from 'lucide-react';

import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import type { LocationCapacity, SpatialLocation } from '../types/index';
import {
  STATUS_META,
  STATUS_TONE,
  situationDescription,
  situationLabel,
} from './StatusLegend';

interface LocationDetailProps {
  location: SpatialLocation | null;
  loading: boolean;
  onClose: () => void;
  /** Sin panel propio: el Inspector ya aporta el contenedor. */
  bare?: boolean;
}

export function LocationDetail({ location, loading, onClose, bare = false }: LocationDetailProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4 py-8">
        <div className="h-4 w-1/2 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" />
        <div className="h-3 w-3/4 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
        <div className="h-3 w-2/3 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-1)]" />
      </div>
    );
  }

  if (!location) return null;

  const meta = STATUS_META[location.status];
  // El propio WMS se contradice en 2.365 ubicaciones. Cuando esta es una de
  // ellas, se dice: es el dato que hay que ver antes de fiarse de cualquiera de
  // las dos columnas.
  const contradice = esContradictorio(location);

  const cuerpo = (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title={location.code}
        subtitle={location.functionLabel ?? location.nodeFunction ?? 'Ubicacion'}
        trailing={
          <Button variant="ghost" size="xs" iconOnly onClick={onClose} aria-label="Cerrar detalle">
            <X strokeWidth={1.5} className="size-4" />
          </Button>
        }
      />

      {/* ── Los dos ejes de estado, separados ─────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[location.status]}>{meta.label}</Badge>
          {location.situation && (
            <span
              className="rounded-[var(--radius-xs)] border border-[var(--text-faint)] px-2 py-0.5"
              title={situationDescription(location.situation)}
            >
              <span className="t-mono-xs text-[var(--text-muted)]">
                WMS: {situationLabel(location.situation)}
              </span>
            </span>
          )}
          {location.isBulkArea && (
            <span className="t-mono-xs text-[var(--text-faint)]">granel</span>
          )}
        </div>
        <span className="t-mono-xs text-[var(--text-faint)]">{meta.description}</span>

        {contradice && (
          <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 [background:var(--glass-1)]">
            <AlertTriangle
              strokeWidth={1.5}
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: 'var(--state-alert)' }}
            />
            <span className="t-mono-xs text-[var(--text-muted)]">
              El estado del espacio y la situacion del WMS no coinciden. El archivo de
              origen las trae asi; no es un error de importacion.
            </span>
          </div>
        )}
      </div>

      {/* ── Direccion, ya descompuesta ────────────────────────────────────── */}
      <Seccion titulo="Direccion">
        {location.codeForm === 'opaque' ? (
          <Fila
            icon={<Tag strokeWidth={1.5} className="size-3.5" />}
            label="Formato"
            value="Codigo opaco"
            hint="No sigue el patron estructurado, asi que no tiene nivel ni posicion."
          />
        ) : null}
        {location.rackCode && (
          <Fila icon={<Box strokeWidth={1.5} className="size-3.5" />} label="Rack" value={location.rackCode} />
        )}
        {location.bayCode && (
          <Fila
            icon={<Layers strokeWidth={1.5} className="size-3.5" />}
            label="Cuerpo"
            value={location.bayCode}
          />
        )}
        {location.logicalColumn != null && (
          <Fila label="Columna" value={String(location.logicalColumn)} />
        )}
        {location.logicalLevel != null && (
          <Fila label="Nivel" value={String(location.logicalLevel)} />
        )}
        {location.logicalPosition != null && (
          <Fila label="Posicion" value={String(location.logicalPosition)} />
        )}
        {location.aisleCode ? (
          <Fila label="Pasillo" value={location.aisleCode} />
        ) : (
          <Fila
            label="Pasillo"
            value="—"
            hint="El catalogo del WMS no declara pasillos y no se inventan."
          />
        )}
        {location.siteCode && <Fila label="Sitio" value={location.siteCode} />}
      </Seccion>

      {/* ── Identificadores ───────────────────────────────────────────────── */}
      <Seccion titulo="Identificadores">
        <Fila
          icon={<Hash strokeWidth={1.5} className="size-3.5" />}
          label="Codigo"
          value={location.code}
          mono
        />
        {location.externalCode && location.externalCode !== location.code && (
          <Fila
            label="Codigo del WMS"
            value={location.externalCode}
            mono
            hint="Valor original, con su grafia exacta. Es lo que dice la etiqueta del estante."
          />
        )}
        {location.externalLocationId && (
          <Fila label="Id del WMS" value={location.externalLocationId} mono />
        )}
        <Fila
          label="Procedencia"
          value={
            location.origin === 'catalog'
              ? 'Catalogo del WMS'
              : location.origin === 'inferred'
                ? 'Inferida'
                : 'Manual'
          }
        />
      </Seccion>

      {/* ── Capacidad: tres estados ───────────────────────────────────────── */}
      <Seccion titulo="Capacidad">
        <CapacidadDetalle capacity={location.capacity} />
      </Seccion>

      {/* ── Geometria: lo que hay y lo que no ─────────────────────────────── */}
      <Seccion titulo="Geometria">
        <Fila
          icon={<Ruler strokeWidth={1.5} className="size-3.5" />}
          label="Levantamiento metrico"
          value="No existe"
          hint="El catalogo esta disponible, pero el levantamiento metrico aun no existe."
        />
        {(location.logicalX != null || location.logicalY != null) && (
          <Fila
            label="Indices logicos"
            value={`x ${location.logicalX ?? '—'} · y ${location.logicalY ?? '—'} · z ${location.logicalZ ?? '—'}`}
            mono
            hint="Indices de rejilla, NO metros. No se convierten a distancias."
          />
        )}
      </Seccion>
    </div>
  );

  if (bare) return cuerpo;

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col">
      {cuerpo}
    </Panel>
  );
}

// ── Capacidad ───────────────────────────────────────────────────────────────

/**
 * Los tres estados, cada uno con su texto.
 *
 * Ninguno muestra un `0`: cuando no hay dato, lo que se dice es que no hay dato.
 */
export function CapacidadDetalle({ capacity }: { capacity: LocationCapacity }) {
  if (capacity.state === 'declared') {
    return (
      <>
        {capacity.maxWeightKg != null && (
          <Fila
            icon={<Box strokeWidth={1.5} className="size-3.5" />}
            label="Peso maximo"
            value={`${capacity.maxWeightKg.toLocaleString('es')} kg`}
          />
        )}
        {capacity.maxUnits != null && (
          <Fila label="Unidades maximas" value={capacity.maxUnits.toLocaleString('es')} />
        )}
      </>
    );
  }

  if (capacity.state === 'unlimited') {
    return (
      <Fila
        icon={<InfinityIcon strokeWidth={1.5} className="size-3.5" />}
        label="Peso maximo"
        value="Sin limite declarado por el WMS"
        hint="El origen escribio un valor centinela de «sin limite», no una capacidad."
      />
    );
  }

  return (
    <Fila
      label="Peso maximo"
      value="Capacidad no informada"
      hint="El WMS no declaro capacidad para esta ubicacion. Hay que medirla."
    />
  );
}

/** Version de una linea, para tablas y celdas. */
export function capacidadResumen(capacity: LocationCapacity): string {
  switch (capacity.state) {
    case 'declared':
      return capacity.maxWeightKg != null
        ? `${capacity.maxWeightKg.toLocaleString('es')} kg`
        : `${capacity.maxUnits?.toLocaleString('es') ?? '—'} ud`;
    case 'unlimited':
      return 'sin limite';
    case 'unknown':
      return 'sin dato';
  }
}

// ── Internos ────────────────────────────────────────────────────────────────

/**
 * Misma regla que el backend usa para contar `status_situation_conflicts`, para
 * que la ficha y el KPI no puedan discrepar.
 */
function esContradictorio(l: SpatialLocation): boolean {
  if (!l.situation) return false;
  if (l.situation.startsWith('BLOQ') && l.status !== 'blocked') return true;
  if (l.situation === 'DISP' && l.status !== 'available') return true;
  return false;
}

/**
 * Grupo del inspector.
 *
 * La separacion es una REGLA y una barra de acento en el titulo, no solo un hueco:
 * en un panel de instrumentacion los grupos se distinguen a golpe de vista, y con
 * solo `gap` las cinco secciones se leian como una lista continua de 18 filas.
 *
 * `first-of-type` quita la regla al primer grupo: una linea sobre el titulo inicial
 * lo separa de nada.
 */
function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--hairline-strong)] pt-4 first-of-type:border-0 first-of-type:pt-0">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3 w-px shrink-0"
          style={{ background: 'color-mix(in oklab, var(--accent) 55%, transparent)' }}
        />
        <span className="t-label">{titulo}</span>
      </span>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Fila({
  icon,
  label,
  value,
  hint,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[var(--text-muted)]">
          {icon && <span className="text-[var(--text-faint)]">{icon}</span>}
          <span className="t-label">{label}</span>
        </span>
        <span
          className={cn(
            'text-right text-[var(--text-primary)]',
            mono ? 't-mono-xs' : 'text-[length:var(--text-sm)]',
          )}
        >
          {value}
        </span>
      </div>
      {hint && <span className="t-mono-xs pl-0.5 text-[var(--text-faint)]">{hint}</span>}
    </div>
  );
}
