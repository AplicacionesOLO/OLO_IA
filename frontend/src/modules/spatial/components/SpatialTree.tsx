/**
 * ARBOL ESPACIAL — agrupado por familia, con expansion perezosa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE HAY UN NIVEL DE AGRUPACION QUE NO ESTA EN LA BASE
 *
 * El almacen real tiene **348 nodos raiz**, y listarlos planos es una lista de 348
 * elementos que hay que recorrer con la rueda del raton para encontrar uno. No es
 * un arbol: es una lista larga con sangria.
 *
 * Agrupando por el PREFIJO ALFABETICO del codigo, esas 348 raices se convierten en
 * **43 familias**, y las dos mayores absorben la mitad del almacen:
 *
 *     RCL    209 racks        CHEQ     9        CANT    8
 *     PURT    38 racks        INTER    9        TRAN    8
 *     MZ      12 racks        CROSS    7        …y 35 familias mas
 *
 * ⚠ El cluster es un AGRUPAMIENTO DE PRESENTACION, no una entidad. No existe en la
 *   base, no tiene UUID, no se puede seleccionar y no abre detalle. Es exactamente
 *   lo contrario de inventar un nivel de jerarquia: la familia se deriva del codigo
 *   que ya existe, y si mañana el backend publica pasillos de verdad, los clusters
 *   desaparecen sin que nada mas cambie.
 *
 * ── LOS CUATRO NIVELES ──────────────────────────────────────────────────────
 *
 *     familia          derivada del prefijo · NO es un nodo
 *     └── rack         nodo real, del backend
 *         └── C001     cuerpo · nodo real (`node_type = 'bay'`)
 *             └── N01  nivel · derivado de las ubicaciones del cuerpo
 *                 └── ubicacion
 *
 * El nivel `N` tampoco es un nodo, y eso es deliberado (ADR-013): el nivel es un
 * ATRIBUTO de la ubicacion. Crearlo como nodo habria multiplicado el arbol por
 * 29.310/2.701 sin añadir nada que no este ya en el campo `level`.
 *
 * ── LA CARGA SIGUE SIENDO PEREZOSA ──────────────────────────────────────────
 *
 * Cada rama pide sus hijos AL EXPANDIRSE y monta su propio hook, asi que el
 * spinner sale en la rama que se abre y no en el workspace. Las familias no piden
 * nada: sus racks ya vinieron con las raices.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { memo, useMemo } from 'react';
import { Box, ChevronRight, Layers, Library, MapPin, Package } from 'lucide-react';

import { cn } from '../../../design/utils/cn';
import { useLocations, useNodeChildren } from '../services/useSpatial';
import type { SpatialLocation, SpatialNode } from '../types/index';
import { QueryError } from './errors/SpatialError';
import { STATUS_META } from './StatusLegend';

// ── Agrupacion por familia ──────────────────────────────────────────────────

export interface RackFamily {
  /** Prefijo alfabetico: `RCL`, `PURT`, `MZ`… */
  prefix: string;
  racks: SpatialNode[];
  locationCount: number;
}

/**
 * Agrupa las raices por su prefijo alfabetico inicial.
 *
 * `RCL01` → `RCL`, `CANT1A` → `CANT`, `ALM` → `ALM`. Un codigo sin letras
 * iniciales se agrupa bajo si mismo: no se fuerza a una familia inventada.
 *
 * El orden pone las familias grandes primero —donde esta el almacen— y dentro de
 * cada una ordena por codigo, que es como el operario las nombra.
 */
export function groupByFamily(nodes: SpatialNode[]): RackFamily[] {
  const mapa = new Map<string, SpatialNode[]>();
  for (const n of nodes) {
    const m = /^[A-Z]+/.exec(n.code);
    const prefijo = m ? m[0] : n.code;
    const lista = mapa.get(prefijo);
    if (lista) lista.push(n);
    else mapa.set(prefijo, [n]);
  }
  return [...mapa.entries()]
    .map(([prefix, racks]) => ({
      prefix,
      racks: [...racks].sort((a, b) => a.code.localeCompare(b.code)),
      locationCount: racks.reduce((s, r) => s + r.locationCount, 0),
    }))
    .sort((a, b) => b.racks.length - a.racks.length || a.prefix.localeCompare(b.prefix));
}

// ── Componente ──────────────────────────────────────────────────────────────

interface SpatialTreeProps {
  roots: SpatialNode[];
  /** Ids expandidos. Las familias usan la clave `fam:PREFIJO`. */
  expandedIds: string[];
  selectedNodeId: string | null;
  selectedLocationId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (node: SpatialNode) => void;
  onSelectLocation: (loc: SpatialLocation) => void;
  onOpenRack?: ((node: SpatialNode) => void) | undefined;
  className?: string;
}

export function SpatialTree({
  roots,
  expandedIds,
  selectedNodeId,
  selectedLocationId,
  onToggleExpand,
  onSelectNode,
  onSelectLocation,
  onOpenRack,
  className,
}: SpatialTreeProps) {
  const familias = useMemo(() => groupByFamily(roots), [roots]);
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);

  return (
    <div className={cn('flex flex-col', className)} role="tree" aria-label="Estructura del almacen">
      {familias.map((f) => (
        <FamilyBranch
          key={f.prefix}
          family={f}
          expanded={expanded}
          selectedNodeId={selectedNodeId}
          selectedLocationId={selectedLocationId}
          onToggleExpand={onToggleExpand}
          onSelectNode={onSelectNode}
          onSelectLocation={onSelectLocation}
          onOpenRack={onOpenRack}
        />
      ))}
    </div>
  );
}

// ── Nivel 1 · Familia ───────────────────────────────────────────────────────

function FamilyBranch({
  family,
  expanded,
  selectedNodeId,
  selectedLocationId,
  onToggleExpand,
  onSelectNode,
  onSelectLocation,
  onOpenRack,
}: {
  family: RackFamily;
  expanded: Set<string>;
  selectedNodeId: string | null;
  selectedLocationId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (n: SpatialNode) => void;
  onSelectLocation: (l: SpatialLocation) => void;
  onOpenRack?: ((n: SpatialNode) => void) | undefined;
}) {
  const clave = `fam:${family.prefix}`;
  const abierto = expanded.has(clave);
  // Una familia de un solo rack no aporta un nivel: se muestra el rack directo.
  const unica = family.racks.length === 1;

  if (unica) {
    return (
      <RackBranch
        node={family.racks[0]!}
        depth={0}
        expanded={expanded}
        selectedNodeId={selectedNodeId}
        selectedLocationId={selectedLocationId}
        onToggleExpand={onToggleExpand}
        onSelectNode={onSelectNode}
        onSelectLocation={onSelectLocation}
        onOpenRack={onOpenRack}
      />
    );
  }

  return (
    <div role="treeitem" aria-expanded={abierto}>
      <div
        className={cn(
          'group flex h-8 items-center gap-1.5 rounded-[var(--radius-xs)] pr-2',
          'hover:[background:var(--glass-1)]',
        )}
      >
        <button
          type="button"
          onClick={() => onToggleExpand(clave)}
          aria-label={abierto ? `Contraer familia ${family.prefix}` : `Expandir familia ${family.prefix}`}
          className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] hover:[background:var(--glass-2)]"
        >
          <ChevronRight
            strokeWidth={1.5}
            className={cn('size-3.5 transition-transform', abierto && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={() => onToggleExpand(clave)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`${family.racks.length} racks · ${family.locationCount.toLocaleString('es')} ubicaciones`}
        >
          <Library strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-accent)]" />
          <span className="truncate text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--text-primary)]">
            {family.prefix}
          </span>
          <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
            {family.racks.length} racks
          </span>
        </button>
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)] [font-variant-numeric:tabular-nums]">
          {family.locationCount.toLocaleString('es')}
        </span>
      </div>

      {abierto && (
        <div role="group">
          {family.racks.map((r) => (
            <RackBranch
              key={r.id}
              node={r}
              depth={1}
              expanded={expanded}
              selectedNodeId={selectedNodeId}
              selectedLocationId={selectedLocationId}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onSelectLocation={onSelectLocation}
              onOpenRack={onOpenRack}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Nivel 2 · Rack, y nivel 3 · Cuerpo ──────────────────────────────────────

/** `memo` no es adorno: con 348 racks, cada re-render evaluaria 348 ramas. */
const RackBranch = memo(function RackBranch({
  node,
  depth,
  expanded,
  selectedNodeId,
  selectedLocationId,
  onToggleExpand,
  onSelectNode,
  onSelectLocation,
  onOpenRack,
}: {
  node: SpatialNode;
  depth: number;
  expanded: Set<string>;
  selectedNodeId: string | null;
  selectedLocationId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (n: SpatialNode) => void;
  onSelectLocation: (l: SpatialLocation) => void;
  onOpenRack?: ((n: SpatialNode) => void) | undefined;
}) {
  const abierto = expanded.has(node.id);
  const puedeExpandir = node.childCount > 0 || node.locationCount > 0;
  const esCuerpo = node.nodeType === 'bay';

  // El hook se monta SIEMPRE (regla de hooks) y solo se habilita al abrir. Un
  // cuerpo no tiene hijos-nodo: sus «hijos» son niveles, derivados de sus
  // ubicaciones, asi que ahi no se pide el arbol.
  const hijos = useNodeChildren(node.id, abierto && !esCuerpo && node.childCount > 0);

  return (
    <div role="treeitem" aria-expanded={puedeExpandir ? abierto : undefined}>
      <NodeRow
        node={node}
        depth={depth}
        abierto={abierto}
        puedeExpandir={puedeExpandir}
        seleccionado={selectedNodeId === node.id}
        cargando={hijos.isLoading}
        onToggleExpand={() => onToggleExpand(node.id)}
        onSelect={() => onSelectNode(node)}
        onOpen={onOpenRack && !esCuerpo ? () => onOpenRack(node) : undefined}
      />

      {abierto && (
        <div role="group">
          {/* Un CUERPO se abre en niveles, no en nodos. */}
          {esCuerpo ? (
            <BayLevels
              bay={node}
              depth={depth + 1}
              expanded={expanded}
              selectedLocationId={selectedLocationId}
              onToggleExpand={onToggleExpand}
              onSelectLocation={onSelectLocation}
            />
          ) : (
            <>
              {hijos.isError && (
                <div style={{ paddingLeft: (depth + 1) * 14 + 8 }}>
                  <QueryError error={hijos.error} onRetry={() => void hijos.refetch()} compact />
                </div>
              )}
              {hijos.isSuccess && hijos.data.items.length === 0 && (
                <Vacio depth={depth + 1} texto="sin cuerpos" />
              )}
              {hijos.data?.items.map((h) => (
                <RackBranch
                  key={h.id}
                  node={h}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedNodeId={selectedNodeId}
                  selectedLocationId={selectedLocationId}
                  onToggleExpand={onToggleExpand}
                  onSelectNode={onSelectNode}
                  onSelectLocation={onSelectLocation}
                  onOpenRack={onOpenRack}
                />
              ))}
              {hijos.data?.nextCursor && (
                <Vacio
                  depth={depth + 1}
                  texto={`mostrando ${hijos.data.items.length}${
                    hijos.data.total != null ? ` de ${hijos.data.total}` : ''
                  } · hay mas`}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ── Nivel 4 · Niveles N de un cuerpo, y sus ubicaciones ─────────────────────

/**
 * Los niveles de un cuerpo, agrupados desde sus UBICACIONES.
 *
 * El nivel no es un nodo del backend: es el campo `level` de cada ubicacion. Se
 * pide el conjunto del cuerpo —como maximo 7 niveles x 9 posiciones = 63 filas—
 * y se agrupa aqui. Una peticion por cuerpo abierto, no una por nivel.
 *
 * Las ubicaciones SIN nivel van a su propio grupo: no se les asigna el 1.
 */
function BayLevels({
  bay,
  depth,
  expanded,
  selectedLocationId,
  onToggleExpand,
  onSelectLocation,
}: {
  bay: SpatialNode;
  depth: number;
  expanded: Set<string>;
  selectedLocationId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectLocation: (l: SpatialLocation) => void;
}) {
  const q = useLocations({
    warehouseId: null,
    bayId: bay.id,
    pageSize: 200,
  });

  const grupos = useMemo(() => {
    const porNivel = new Map<number, SpatialLocation[]>();
    const sinNivel: SpatialLocation[] = [];
    for (const l of q.data?.items ?? []) {
      if (l.logicalLevel == null) {
        sinNivel.push(l);
        continue;
      }
      const g = porNivel.get(l.logicalLevel);
      if (g) g.push(l);
      else porNivel.set(l.logicalLevel, [l]);
    }
    // De arriba abajo, como en el alzado: el nivel alto primero.
    const ordenados = [...porNivel.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([nivel, locs]) => ({
        nivel,
        locs: locs.sort((a, b) => (a.logicalPosition ?? 0) - (b.logicalPosition ?? 0)),
      }));
    return { ordenados, sinNivel };
  }, [q.data]);

  if (q.isLoading) return <Vacio depth={depth} texto="cargando niveles…" pulso />;
  if (q.isError) {
    return (
      <div style={{ paddingLeft: depth * 14 + 8 }}>
        <QueryError error={q.error} onRetry={() => void q.refetch()} compact />
      </div>
    );
  }
  if (grupos.ordenados.length === 0 && grupos.sinNivel.length === 0) {
    return <Vacio depth={depth} texto="sin ubicaciones" />;
  }

  return (
    <>
      {grupos.ordenados.map(({ nivel, locs }) => {
        const clave = `lvl:${bay.id}:${nivel}`;
        const abierto = expanded.has(clave);
        return (
          <div key={nivel} role="treeitem" aria-expanded={abierto}>
            <div
              className="group flex h-7 items-center gap-1.5 rounded-[var(--radius-xs)] pr-2 hover:[background:var(--glass-1)]"
              style={{ paddingLeft: depth * 14 + 2 }}
            >
              <button
                type="button"
                onClick={() => onToggleExpand(clave)}
                aria-label={`${abierto ? 'Contraer' : 'Expandir'} nivel ${nivel}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-muted)] hover:[background:var(--glass-2)]"
              >
                <ChevronRight
                  strokeWidth={1.5}
                  className={cn('size-3 transition-transform', abierto && 'rotate-90')}
                />
              </button>
              <button
                type="button"
                onClick={() => onToggleExpand(clave)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="t-mono-xs text-[var(--text-secondary)]">
                  N{String(nivel).padStart(2, '0')}
                </span>
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {locs.length} {locs.length === 1 ? 'posicion' : 'posiciones'}
                </span>
              </button>
            </div>

            {abierto && (
              <div role="group">
                {locs.map((l) => (
                  <LocationRow
                    key={l.id}
                    loc={l}
                    depth={depth + 1}
                    seleccionada={l.id === selectedLocationId}
                    onSelect={() => onSelectLocation(l)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {grupos.sinNivel.length > 0 && (
        <div role="treeitem">
          <div
            className="flex h-7 items-center gap-2 pr-2"
            style={{ paddingLeft: depth * 14 + 24 }}
            title="Su codigo no declara nivel. No se les asigna uno."
          >
            <span className="t-mono-xs text-[var(--text-faint)]">
              sin nivel · {grupos.sinNivel.length}
            </span>
          </div>
          {grupos.sinNivel.map((l) => (
            <LocationRow
              key={l.id}
              loc={l}
              depth={depth + 1}
              seleccionada={l.id === selectedLocationId}
              onSelect={() => onSelectLocation(l)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function LocationRow({
  loc,
  depth,
  seleccionada,
  onSelect,
}: {
  loc: SpatialLocation;
  depth: number;
  seleccionada: boolean;
  onSelect: () => void;
}) {
  const meta = STATUS_META[loc.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={seleccionada}
      title={`${loc.code} · ${meta.label}${loc.situation ? ` · WMS ${loc.situation}` : ''}`}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-[var(--radius-xs)] pr-2 text-left transition-colors',
        seleccionada ? '[background:var(--glass-2)]' : 'hover:[background:var(--glass-1)]',
      )}
      style={{ paddingLeft: depth * 14 + 24 }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: meta.color }}
      />
      <span
        className={cn(
          't-mono-xs truncate',
          seleccionada ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
        )}
      >
        {/* Solo la posicion: el resto de la direccion ya esta en las ramas padre. */}
        P{loc.logicalPosition ?? '—'}
      </span>
      {loc.situation && (
        <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">{loc.situation}</span>
      )}
    </button>
  );
}

// ── Fila de un nodo ─────────────────────────────────────────────────────────

function NodeRow({
  node,
  depth,
  abierto,
  puedeExpandir,
  seleccionado,
  cargando,
  onToggleExpand,
  onSelect,
  onOpen,
}: {
  node: SpatialNode;
  depth: number;
  abierto: boolean;
  puedeExpandir: boolean;
  seleccionado: boolean;
  cargando: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onOpen?: (() => void) | undefined;
}) {
  const Icono = iconoDe(node.nodeType);

  return (
    <div
      className={cn(
        'group flex h-8 items-center gap-1.5 rounded-[var(--radius-xs)] pr-2 transition-colors',
        seleccionado ? '[background:var(--glass-2)]' : 'hover:[background:var(--glass-1)]',
      )}
      style={{ paddingLeft: depth * 14 + 2 }}
    >
      {/* El triangulo ocupa sitio incluso deshabilitado, para alinear hermanos. */}
      <button
        type="button"
        onClick={onToggleExpand}
        disabled={!puedeExpandir}
        aria-label={abierto ? `Contraer ${node.code}` : `Expandir ${node.code}`}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)]',
          puedeExpandir
            ? 'text-[var(--icon-muted)] hover:[background:var(--glass-2)]'
            : 'pointer-events-none opacity-0',
        )}
      >
        {cargando ? (
          <span
            className="size-2.5 animate-pulse rounded-full [background:var(--accent)]"
            aria-label="Cargando"
          />
        ) : (
          <ChevronRight
            strokeWidth={1.5}
            className={cn('size-3.5 transition-transform', abierto && 'rotate-90')}
          />
        )}
      </button>

      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={etiquetaCompleta(node)}
      >
        <Icono strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
        <span
          className={cn(
            'truncate text-[length:var(--text-xs)]',
            seleccionado ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          )}
        >
          {node.code}
        </span>
        {node.functionLabel && node.nodeType !== 'bay' && (
          <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
            {node.functionLabel}
          </span>
        )}
      </button>

      {/*
        Boton EXPLICITO para abrir el rack en 3D.
        El doble clic se mantiene, pero no puede ser el unico camino: la vista del
        rack es la principal del producto y llegar a ella no puede depender de que
        alguien descubra un gesto que no esta escrito en ningun sitio.
      */}
      {onOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`Ver ${node.code} en 3D`}
          title={`Ver ${node.code} en 3D`}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)]',
            'text-[var(--icon-muted)] opacity-0 transition-opacity',
            'group-hover:opacity-100 focus-visible:opacity-100',
            'hover:[background:var(--glass-3)] hover:text-[var(--text-accent)]',
          )}
        >
          <Box strokeWidth={1.5} className="size-3.5" />
        </button>
      )}

      {node.locationCount > 0 && (
        <span
          className="t-mono-xs shrink-0 text-[var(--text-faint)] [font-variant-numeric:tabular-nums]"
          title={`${node.locationCount} ubicaciones`}
        >
          {node.locationCount.toLocaleString('es')}
        </span>
      )}
    </div>
  );
}

function Vacio({
  depth,
  texto,
  pulso,
}: {
  depth: number;
  texto: string;
  pulso?: boolean;
}) {
  return (
    <div className="py-1" style={{ paddingLeft: depth * 14 + 24 }}>
      <span className={cn('t-mono-xs text-[var(--text-faint)]', pulso && 'animate-pulse')}>
        {texto}
      </span>
    </div>
  );
}

// ── Auxiliares ──────────────────────────────────────────────────────────────

function iconoDe(nodeType: string) {
  switch (nodeType) {
    case 'rack':
      return Box;
    case 'bay':
      return Layers;
    case 'storage_area':
      return Package;
    default:
      return MapPin;
  }
}

function etiquetaCompleta(node: SpatialNode): string {
  const partes = [`${node.code} · ${node.nodeType}`];
  if (node.externalCode && node.externalCode !== node.code) {
    partes.push(`WMS: ${node.externalCode}`);
  }
  if (node.childCount > 0) partes.push(`${node.childCount} cuerpos`);
  if (node.locationCount > 0) partes.push(`${node.locationCount} ubicaciones`);
  if (node.nodeType === 'rack') partes.push('doble clic: ver alzado');
  return partes.join(' · ');
}
