/**
 * RACK VIEW MODEL — transforma SpatialLocation[] en estructura visual.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CAPA DE VIEWMODEL REEMPLAZABLE
 *
 * Hoy parsea el codigo de ubicacion (string) para inferir la estructura.
 * Cuando el backend entregue campos explicitos:
 *   rack_code, bay_code, logical_level, logical_position
 * este parser deja de usarse y se consume el dato estructurado directamente.
 *
 * La interfaz de salida (RackGrouping, StructuredLocation, etc.) es estable.
 * Solo cambia la implementacion de `buildViewModel()`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLAS DEL PARSER:
 * - NO inventa pasillos: si el dato no trae aisle, agrupa como "Sin pasillo"
 * - NO inventa posiciones: renderiza solo las que existen
 * - Discrimina: structured | special | unrecognized
 * - Codigos especiales (DAÑADO, RETIRA, PISO1, etc.) se identifican y no se
 *   fuerzan dentro de un rack
 */

import type { LocationStatus, SpatialLocation } from '../types/index';

// ── Resultado discriminado del parser ───────────────────────────────────────

export type ParseResult =
  | { kind: 'structured'; rack: string; bay: string; level: number; position: number }
  | { kind: 'special'; externalCode: string; reason: string }
  | { kind: 'unrecognized'; rawCode: string };

/**
 * Codigos especiales conocidos. Se identifican por contenido, no por posicion.
 * Si un segmento del codigo contiene alguno de estos, es una ubicacion especial.
 */
const SPECIAL_PATTERNS = [
  'DAÑADO', 'DANADO', 'RETIRA', 'LAYOUT', 'PISO', 'SOBRA', 'TEMP',
  'CUARENTENA', 'RECEPCION', 'DESPACHO', 'PICKING', 'STAGING',
  'DOCK', 'BUFFER', 'DEVOLUCION', 'CROSS',
];

/**
 * Parsea un codigo de ubicacion.
 *
 * Formato estructurado esperado: RACK-BAY-NÍVEL-POSICIÓN
 *   Ejemplo real: RCL07-C018-N05-2
 *   Ejemplo: RCL07-C018-N05-1
 *
 * Si el codigo no encaja en 4 segmentos con nivel numerico y posicion 1-9,
 * se marca como unrecognized o special segun su contenido.
 */
export function parseLocationCode(code: string): ParseResult {
  if (!code || code.trim().length === 0) {
    return { kind: 'unrecognized', rawCode: code };
  }

  const upper = code.toUpperCase();

  // Detectar codigos especiales
  for (const pattern of SPECIAL_PATTERNS) {
    if (upper.includes(pattern)) {
      return { kind: 'special', externalCode: code, reason: pattern.toLowerCase() };
    }
  }

  const parts = code.split('-');

  // Formato esperado: 4 partes, ultima es posicion numerica
  if (parts.length === 4) {
    const posStr = parts[3]!;
    const posNum = parseInt(posStr, 10);

    // Level: debe contener un numero (N05 → 5, o directamente "5" o "05")
    const levelStr = parts[2]!;
    const levelMatch = levelStr.match(/(\d+)/);
    const levelNum = levelMatch ? parseInt(levelMatch[1]!, 10) : NaN;

    if (!isNaN(posNum) && posNum >= 1 && posNum <= 9 && !isNaN(levelNum) && levelNum >= 1) {
      return {
        kind: 'structured',
        rack: parts[0]!,
        bay: parts[1]!,
        level: levelNum,
        position: posNum,
      };
    }
  }

  // 3 partes: podria ser rack-bay-level sin posicion (contenedor)
  // No lo forzamos como structured: no es una ubicacion final
  return { kind: 'unrecognized', rawCode: code };
}

// ── Modelo visual de salida ─────────────────────────────────────────────────

export interface StructuredLocation {
  locationId: string;
  fullCode: string;
  rack: string;
  bay: string;
  level: number;
  position: number;
  status: LocationStatus;
  occupied: number;
  capacity: number;
}

export interface SpecialLocation {
  locationId: string;
  fullCode: string;
  externalCode: string;
  reason: string;
  status: LocationStatus;
  occupied: number;
  capacity: number;
}

export interface UnrecognizedLocation {
  locationId: string;
  fullCode: string;
  status: LocationStatus;
}

/** Un rack visual con sus bays y niveles. Solo contiene datos que EXISTEN. */
export interface RackVisual {
  code: string;
  bays: BayVisual[];
}

export interface BayVisual {
  code: string;
  levels: LevelVisual[];
}

export interface LevelVisual {
  levelNumber: number;
  /** Solo las posiciones que existen. Puede ser 1, 2 o mas. Nunca se inventan. */
  positions: PositionVisual[];
}

export interface PositionVisual {
  locationId: string;
  fullCode: string;
  positionNumber: number;
  status: LocationStatus;
  occupied: number;
  capacity: number;
}

/** Agrupacion sin asumir pasillo. Se agrupa por la zona del padre si existe. */
export interface RackGrouping {
  /** Identificador del grupo. Si el padre es un aisle, se usa su nombre. */
  groupId: string;
  groupLabel: string;
  racks: RackVisual[];
}

export interface ViewModel {
  /** Racks agrupados (por zona/padre). No se llaman "pasillos" si no lo son. */
  groups: RackGrouping[];
  /** Ubicaciones especiales fuera de la estructura de racks. */
  specials: SpecialLocation[];
  /** Ubicaciones no reconocidas. */
  unrecognized: UnrecognizedLocation[];
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Construye el view model a partir de ubicaciones planas.
 *
 * Solo procesa hojas (kind === 'location'). Los contenedores se usan para
 * inferir el nombre del grupo (zona/aisle), pero no se inventan relaciones.
 */
export function buildViewModel(
  locations: SpatialLocation[],
  allLocations?: SpatialLocation[],
): ViewModel {
  const leaves = locations.filter((l) => l.kind === 'location');

  // Index de contenedores para resolver nombres de grupo
  const parentMap = new Map<string, SpatialLocation>();
  const allItems = allLocations ?? locations;
  for (const loc of allItems) {
    if (loc.kind !== 'location') parentMap.set(loc.id, loc);
  }

  const structured: StructuredLocation[] = [];
  const specials: SpecialLocation[] = [];
  const unrecognized: UnrecognizedLocation[] = [];

  for (const loc of leaves) {
    const result = parseLocationCode(loc.code);

    switch (result.kind) {
      case 'structured':
        structured.push({
          locationId: loc.id,
          fullCode: loc.code,
          rack: result.rack,
          bay: result.bay,
          level: result.level,
          position: result.position,
          status: loc.status,
          occupied: loc.occupied,
          capacity: loc.capacity,
        });
        break;
      case 'special':
        specials.push({
          locationId: loc.id,
          fullCode: loc.code,
          externalCode: result.externalCode,
          reason: result.reason,
          status: loc.status,
          occupied: loc.occupied,
          capacity: loc.capacity,
        });
        break;
      case 'unrecognized':
        unrecognized.push({
          locationId: loc.id,
          fullCode: loc.code,
          status: loc.status,
        });
        break;
    }
  }

  // Agrupar structured por rack
  const byRack = new Map<string, StructuredLocation[]>();
  for (const s of structured) {
    const arr = byRack.get(s.rack) ?? [];
    arr.push(s);
    byRack.set(s.rack, arr);
  }

  // Construir RackVisual para cada rack
  const racksVisual: RackVisual[] = [];

  for (const [rackCode, items] of byRack) {
    // Agrupar por bay
    const byBay = new Map<string, StructuredLocation[]>();
    for (const item of items) {
      const arr = byBay.get(item.bay) ?? [];
      arr.push(item);
      byBay.set(item.bay, arr);
    }

    const bays: BayVisual[] = [];
    const bayCodes = [...byBay.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const bayCode of bayCodes) {
      const bayItems = byBay.get(bayCode)!;

      // Agrupar por level
      const byLevel = new Map<number, StructuredLocation[]>();
      for (const item of bayItems) {
        const arr = byLevel.get(item.level) ?? [];
        arr.push(item);
        byLevel.set(item.level, arr);
      }

      // Ordenar niveles de mayor a menor (arriba → abajo)
      const levelNums = [...byLevel.keys()].sort((a, b) => b - a);

      const levels: LevelVisual[] = levelNums.map((levelNum) => {
        const levelItems = byLevel.get(levelNum)!;
        // Solo las posiciones que EXISTEN. No se inventa la que falta.
        const positions: PositionVisual[] = levelItems
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            locationId: item.locationId,
            fullCode: item.fullCode,
            positionNumber: item.position,
            status: item.status,
            occupied: item.occupied,
            capacity: item.capacity,
          }));
        return { levelNumber: levelNum, positions };
      });

      bays.push({ code: bayCode, levels });
    }

    racksVisual.push({ code: rackCode, bays });
  }

  // Ordenar racks por codigo
  racksVisual.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Agrupar racks por zona del padre (NO inventar pasillos)
  // Si todos tienen el mismo padre, es un solo grupo.
  // Si no se puede determinar, van al grupo "Sin pasillo asignado".
  const groups: RackGrouping[] = [];

  if (racksVisual.length > 0) {
    // Intentar agrupar por la primera letra del rack (zona implícita)
    const byPrefix = new Map<string, RackVisual[]>();
    for (const rack of racksVisual) {
      // Extraer prefijo alfanumerico (ej: RCL → R, A01 → A)
      const prefix = rack.code.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '?';
      const arr = byPrefix.get(prefix) ?? [];
      arr.push(rack);
      byPrefix.set(prefix, arr);
    }

    if (byPrefix.size === 1) {
      // Todos mismo prefijo: un solo grupo sin asumir pasillo
      groups.push({
        groupId: 'all',
        groupLabel: 'Sin pasillo asignado',
        racks: racksVisual,
      });
    } else {
      // Multiples prefijos: agrupar por prefijo como zona aproximada
      for (const [prefix, racks] of byPrefix) {
        groups.push({
          groupId: `zone-${prefix}`,
          groupLabel: `Zona ${prefix}`,
          racks,
        });
      }
    }
  }

  return { groups, specials, unrecognized };
}

// ── Selection context (unchanged interface) ─────────────────────────────────

export interface SelectionContext {
  rackCode: string;
  bayCode: string;
  levelNumber: number;
  positionNumber: number;
  fullCode: string;
  groupLabel: string;
}

export function getSelectionContext(
  locationId: string,
  viewModel: ViewModel,
): SelectionContext | null {
  for (const group of viewModel.groups) {
    for (const rack of group.racks) {
      for (const bay of rack.bays) {
        for (const level of bay.levels) {
          for (const pos of level.positions) {
            if (pos.locationId === locationId) {
              return {
                rackCode: rack.code,
                bayCode: bay.code,
                levelNumber: level.levelNumber,
                positionNumber: pos.positionNumber,
                fullCode: pos.fullCode,
                groupLabel: group.groupLabel,
              };
            }
          }
        }
      }
    }
  }
  return null;
}
