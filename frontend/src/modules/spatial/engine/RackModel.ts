/**
 * RACK MODEL — transforma SpatialLocation[] en la estructura fisica del almacen.
 *
 * Parsea los codigos de ubicacion (ya sean del formato real RCL07-C018-N05-2
 * o del formato dev A-01-03-2) y construye un modelo jerarquico:
 *
 *   Warehouse → Aisle → Rack → Body → Level → Position(1,2)
 *
 * Este modelo es SOLO para visualizacion. No modifica el repositorio.
 * Funciona identicamente con DevSpatialRepository y ApiSpatialRepository.
 */

import type { LocationStatus, SpatialLocation } from '../types/index';

// ── Tipos del modelo visual ─────────────────────────────────────────────────

export interface WarehouseModel {
  id: string;
  name: string;
  aisles: AisleModel[];
}

export interface AisleModel {
  id: string;
  code: string;
  name: string;
  /** Racks a la izquierda del pasillo. */
  leftRacks: RackModel[];
  /** Racks a la derecha del pasillo. */
  rightRacks: RackModel[];
}

export interface RackModel {
  id: string;
  code: string;
  bodies: BodyModel[];
}

export interface BodyModel {
  id: string;
  code: string;
  levels: LevelModel[];
}

export interface LevelModel {
  code: string;
  /** Siempre 1 o 2 posiciones. */
  positions: PositionModel[];
}

export interface PositionModel {
  /** ID de la SpatialLocation original. */
  locationId: string;
  /** Codigo completo: RCL07-C018-N05-2 */
  fullCode: string;
  /** 1 o 2 */
  positionNumber: number;
  status: LocationStatus;
  occupied: number;
  capacity: number;
}

// ── Parser ──────────────────────────────────────────────────────────────────

interface ParsedCode {
  rack: string;
  body: string;
  level: string;
  position: number;
}

/**
 * Parsea un codigo de ubicacion.
 *
 * Soporta dos formatos:
 * - Real WMS: RCL07-C018-N05-2
 * - Dev data: A-01-03-2 (zone-aisle-bay-level, se mapea como rack-body-level-pos)
 */
function parseCode(code: string): ParsedCode | null {
  const parts = code.split('-');

  // Real format: RCL07-C018-N05-2 (4 parts where last is 1 or 2)
  if (parts.length === 4) {
    const posNum = parseInt(parts[3]!, 10);
    if (posNum >= 1 && posNum <= 2) {
      return {
        rack: parts[0]!,
        body: parts[1]!,
        level: parts[2]!,
        position: posNum,
      };
    }
  }

  // Dev format: A-01-03-2 (zone-aisle-bay-level → rack=zone+aisle, body=bay, level=lv, pos=1)
  if (parts.length === 4) {
    return {
      rack: `${parts[0]}${parts[1]}`,
      body: `C${parts[2]}`,
      level: `N${parts[3]}`,
      position: 1,
    };
  }

  // 3-part: zone-aisle-bay → container node, not a position
  return null;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Construye el modelo de racks a partir de las ubicaciones planas.
 *
 * Solo procesa ubicaciones con `kind === 'location'` (las hojas).
 * Los contenedores (zone, aisle, rack, storage_area) se infieren del codigo.
 */
export function buildRackModel(locations: SpatialLocation[]): AisleModel[] {
  const leaves = locations.filter((l) => l.kind === 'location');
  if (leaves.length === 0) return [];

  // Agrupar por rack
  const byRack = new Map<string, { parsed: ParsedCode; loc: SpatialLocation }[]>();

  for (const loc of leaves) {
    const parsed = parseCode(loc.code);
    if (!parsed) continue;
    const arr = byRack.get(parsed.rack) ?? [];
    arr.push({ parsed, loc });
    byRack.set(parsed.rack, arr);
  }

  // Construir racks
  const racks: RackModel[] = [];

  for (const [rackCode, items] of byRack) {
    // Agrupar por body
    const byBody = new Map<string, { parsed: ParsedCode; loc: SpatialLocation }[]>();
    for (const item of items) {
      const arr = byBody.get(item.parsed.body) ?? [];
      arr.push(item);
      byBody.set(item.parsed.body, arr);
    }

    const bodies: BodyModel[] = [];

    for (const [bodyCode, bodyItems] of byBody) {
      // Agrupar por level
      const byLevel = new Map<string, { parsed: ParsedCode; loc: SpatialLocation }[]>();
      for (const item of bodyItems) {
        const arr = byLevel.get(item.parsed.level) ?? [];
        arr.push(item);
        byLevel.set(item.parsed.level, arr);
      }

      // Ordenar niveles de mayor a menor (N07 arriba, N01 abajo)
      const levelCodes = [...byLevel.keys()].sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return nb - na;
      });

      const levels: LevelModel[] = levelCodes.map((levelCode) => {
        const levelItems = byLevel.get(levelCode)!;
        const positions: PositionModel[] = levelItems
          .sort((a, b) => a.parsed.position - b.parsed.position)
          .map((item) => ({
            locationId: item.loc.id,
            fullCode: item.loc.code,
            positionNumber: item.parsed.position,
            status: item.loc.status,
            occupied: item.loc.occupied,
            capacity: item.loc.capacity,
          }));
        return { code: levelCode, positions };
      });

      bodies.push({
        id: `body-${rackCode}-${bodyCode}`,
        code: bodyCode,
        levels,
      });
    }

    // Ordenar bodies por codigo numerico
    bodies.sort((a, b) => {
      const na = parseInt(a.code.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.code.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });

    racks.push({
      id: `rack-${rackCode}`,
      code: rackCode,
      bodies,
    });
  }

  // Ordenar racks por codigo
  racks.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Distribuir racks en pasillos (2 racks por fila, enfrentados)
  // Se agrupan de a pares: impares a la izquierda, pares a la derecha
  const aisles: AisleModel[] = [];
  const racksPerAisle = 6; // 3 a cada lado
  const aisleCount = Math.ceil(racks.length / racksPerAisle);

  for (let a = 0; a < aisleCount; a++) {
    const start = a * racksPerAisle;
    const aisleRacks = racks.slice(start, start + racksPerAisle);
    const half = Math.ceil(aisleRacks.length / 2);

    aisles.push({
      id: `aisle-${a + 1}`,
      code: `P${String(a + 1).padStart(2, '0')}`,
      name: `Pasillo ${a + 1}`,
      leftRacks: aisleRacks.slice(0, half),
      rightRacks: aisleRacks.slice(half),
    });
  }

  return aisles;
}

/**
 * Encuentra el contexto completo de una ubicacion seleccionada.
 */
export interface SelectionContext {
  rackCode: string;
  bodyCode: string;
  levelCode: string;
  positionNumber: number;
  fullCode: string;
  aisleCode: string;
}

export function getSelectionContext(
  locationId: string,
  aisles: AisleModel[],
): SelectionContext | null {
  for (const aisle of aisles) {
    for (const rack of [...aisle.leftRacks, ...aisle.rightRacks]) {
      for (const body of rack.bodies) {
        for (const level of body.levels) {
          for (const pos of level.positions) {
            if (pos.locationId === locationId) {
              return {
                rackCode: rack.code,
                bodyCode: body.code,
                levelCode: level.code,
                positionNumber: pos.positionNumber,
                fullCode: pos.fullCode,
                aisleCode: aisle.code,
              };
            }
          }
        }
      }
    }
  }
  return null;
}
