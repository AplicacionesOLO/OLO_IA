/**
 * HIT TESTER — determina que nodo esta bajo un punto de pantalla.
 *
 * Separado del renderer porque el hit testing se ejecuta en CADA movimiento
 * del cursor (60+ veces por segundo) y no debe recalcular el frame completo.
 * Usa una busqueda lineal con early-exit: con culling previo, el costo es O(visible).
 *
 * Para >10k nodos se reemplazaria con un spatial index (quadtree/R-tree).
 * Hoy con <300 nodos visibles simultaneamente es innecesario.
 */

import type { LayoutNode } from './LayoutEngine';
import type { Viewport } from './Viewport';
import type { LocationStatus } from '../types/index';

export class HitTester {
  private nodes: LayoutNode[] = [];
  private visibleStatuses: Set<LocationStatus> = new Set();

  /** Actualizar los nodos disponibles para hit testing. */
  setNodes(nodes: LayoutNode[], visibleStatuses: Set<LocationStatus>) {
    this.nodes = nodes;
    this.visibleStatuses = visibleStatuses;
  }

  /** Encontrar el nodo bajo un punto de pantalla. null si no hay ninguno. */
  hitTest(viewport: Viewport, screenX: number, screenY: number): LayoutNode | null {
    const world = viewport.screenToWorld(screenX, screenY);

    // Iterar en orden inverso: los nodos dibujados encima tienen prioridad.
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]!;
      if (!this.visibleStatuses.has(node.location.status)) continue;
      if (
        world.x >= node.x && world.x <= node.x + node.w &&
        world.y >= node.y && world.y <= node.y + node.h
      ) {
        return node;
      }
    }
    return null;
  }

  /** Encontrar todos los nodos dentro de un rectangulo de pantalla (marquee select). */
  hitTestRect(
    viewport: Viewport,
    sx1: number, sy1: number,
    sx2: number, sy2: number,
  ): LayoutNode[] {
    const tl = viewport.screenToWorld(Math.min(sx1, sx2), Math.min(sy1, sy2));
    const br = viewport.screenToWorld(Math.max(sx1, sx2), Math.max(sy1, sy2));

    const results: LayoutNode[] = [];
    for (const node of this.nodes) {
      if (!this.visibleStatuses.has(node.location.status)) continue;
      // Interseccion: el nodo se solapa con el rect
      if (
        node.x + node.w >= tl.x && node.x <= br.x &&
        node.y + node.h >= tl.y && node.y <= br.y
      ) {
        results.push(node);
      }
    }
    return results;
  }
}
