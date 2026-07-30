/**
 * LAYOUT ENGINE — posiciona las ubicaciones en el espacio 2D del mundo.
 *
 * Convierte la lista plana de SpatialLocation en un layout con posiciones x,y
 * que el renderer puede dibujar. La geometria es independiente del renderer.
 *
 * Estrategia: grid por pasillo (x = bay, y = level), agrupado por zona.
 * Produce un layout denso que recuerda a la vista de estanteria de un WMS.
 */

import type { SpatialLocation } from '../types/index';

export interface LayoutNode {
  id: string;
  location: SpatialLocation;
  /** Posicion en coordenadas del mundo. */
  x: number;
  y: number;
  /** Tamaño en el mundo. */
  w: number;
  h: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  worldWidth: number;
  worldHeight: number;
}

/** Tamaño de una celda de posicion en unidades del mundo. */
const CELL_W = 48;
const CELL_H = 40;
const CELL_GAP = 4;
const AISLE_GAP = 24;
const ZONE_GAP = 60;

/**
 * Genera un layout de grid a partir de una lista de ubicaciones.
 * Solo posiciona las posiciones; los contenedores se omiten del mapa.
 */
export function computeLayout(locations: SpatialLocation[]): LayoutResult {
  const positions = locations.filter((l) => l.kind === 'position');

  if (positions.length === 0) {
    return { nodes: [], worldWidth: 0, worldHeight: 0 };
  }

  // Agrupar por parentId (bay)
  const byBay = new Map<string, SpatialLocation[]>();
  for (const p of positions) {
    const key = p.parentId ?? '__root__';
    const arr = byBay.get(key) ?? [];
    arr.push(p);
    byBay.set(key, arr);
  }

  // Extraer la jerarquia: zone > aisle > bay > position
  // Se infiere del codigo (A-01-03-2 → zone=A, aisle=01, bay=03, level=2)
  const parsed = positions.map((p) => {
    const parts = p.code.split('-');
    return {
      loc: p,
      zone: parts[0] ?? 'X',
      aisle: parseInt(parts[1] ?? '0', 10),
      bay: parseInt(parts[2] ?? '0', 10),
      level: parseInt(parts[3] ?? '0', 10),
    };
  });

  // Ordenar por zona, pasillo, bahia, nivel
  parsed.sort((a, b) => {
    if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
    if (a.aisle !== b.aisle) return a.aisle - b.aisle;
    if (a.bay !== b.bay) return a.bay - b.bay;
    return a.level - b.level;
  });

  // Encontrar rangos
  const zones = [...new Set(parsed.map((p) => p.zone))].sort();
  const nodes: LayoutNode[] = [];

  let offsetX = 0;

  for (const zone of zones) {
    const zoneItems = parsed.filter((p) => p.zone === zone);
    const aisles = [...new Set(zoneItems.map((p) => p.aisle))].sort((a, b) => a - b);

    let aisleOffsetX = offsetX;

    for (const aisle of aisles) {
      const aisleItems = zoneItems.filter((p) => p.aisle === aisle);
      const bays = [...new Set(aisleItems.map((p) => p.bay))].sort((a, b) => a - b);
      const levels = [...new Set(aisleItems.map((p) => p.level))].sort((a, b) => a - b);

      for (const item of aisleItems) {
        const bayIdx = bays.indexOf(item.bay);
        const levelIdx = levels.indexOf(item.level);

        const x = aisleOffsetX + bayIdx * (CELL_W + CELL_GAP);
        // Niveles de arriba a abajo: nivel mas alto arriba
        const y = (levels.length - 1 - levelIdx) * (CELL_H + CELL_GAP);

        nodes.push({
          id: item.loc.id,
          location: item.loc,
          x,
          y,
          w: CELL_W,
          h: CELL_H,
        });
      }

      aisleOffsetX += bays.length * (CELL_W + CELL_GAP) + AISLE_GAP;
    }

    offsetX = aisleOffsetX + ZONE_GAP;
  }

  // Calcular bounds
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }

  return { nodes, worldWidth: maxX, worldHeight: maxY };
}
