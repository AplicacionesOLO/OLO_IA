/**
 * Generacion procedural de la malla.
 *
 * Determinista: la misma semilla produce la misma malla. Es importante para que
 * la Mesh no "salte" entre renders y para que las capturas de pantalla sean
 * reproducibles.
 */

import { MESH_NODE_COUNT, type MeshDensity, type MeshEdge, type MeshNode } from './types';

/**
 * PRNG determinista (mulberry32). `Math.random()` no sirve: cambiaria la malla
 * en cada render y produciria un parpadeo estructural.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Distribucion por rejilla con jitter.
 *
 * Se usa rejilla y no posiciones aleatorias puras porque el azar produce
 * grumos y zonas vacias: una malla neuronal creible necesita distribucion
 * homogenea con irregularidad local, que es exactamente lo que da una rejilla
 * perturbada.
 */
export function generateMeshNodes(density: MeshDensity, seed = 20260728): MeshNode[] {
  const target = MESH_NODE_COUNT[density];
  const rand = mulberry32(seed);

  // Rejilla con relacion de aspecto ~16:9 para cubrir el viewport
  const cols = Math.ceil(Math.sqrt(target * 1.78));
  const rows = Math.ceil(target / cols);
  const nodes: MeshNode[] = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (nodes.length >= target) break;

      const jitterX = (rand() - 0.5) * 0.72;
      const jitterY = (rand() - 0.5) * 0.72;

      nodes.push({
        id: `n${r}-${c}`,
        x: clamp01(((c + 0.5 + jitterX) / cols) * 1.14 - 0.07),
        y: clamp01(((r + 0.5 + jitterY) / rows) * 1.14 - 0.07),
        depth: rand(),
        weight: rand() < 0.14 ? 1.7 : 1,
      });
    }
  }

  return nodes;
}

/**
 * Aristas por proximidad.
 *
 * Cada nodo se conecta con sus vecinos mas cercanos. Produce una topologia de
 * malla creible, a diferencia de conectar al azar, que produce un ovillo.
 */
export function generateMeshEdges(
  nodes: readonly MeshNode[],
  neighborsPerNode = 2,
  maxDistance = 0.24,
): MeshEdge[] {
  const edges: MeshEdge[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const neighbors = nodes
      .filter((other) => other.id !== node.id)
      .map((other) => ({ other, d: distance(node, other) }))
      .filter(({ d }) => d <= maxDistance)
      .sort((a, b) => a.d - b.d)
      .slice(0, neighborsPerNode);

    for (const { other, d } of neighbors) {
      // Clave canonica ordenada: evita duplicar A→B y B→A.
      const key = [node.id, other.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        id: key,
        from: node.id,
        to: other.id,
        // Mas cerca = vinculo mas fuerte
        strength: 1 - d / maxDistance,
      });
    }
  }

  return edges;
}

function distance(a: MeshNode, b: MeshNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export interface MeshGeometry {
  nodes: MeshNode[];
  edges: MeshEdge[];
}

export function buildMesh(density: MeshDensity, seed?: number): MeshGeometry {
  const nodes = generateMeshNodes(density, seed);
  return { nodes, edges: generateMeshEdges(nodes) };
}
