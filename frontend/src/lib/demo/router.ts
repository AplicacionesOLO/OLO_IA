/**
 * ROUTER DEL MODO DEMO.
 *
 * Traduce (método, ruta) → respuesta falsa con la forma del backend. Se invoca desde
 * `ApiClient.request()` ANTES de tocar la red: si `hit` es `true`, el valor se devuelve
 * tal cual (es el envoltorio `{data}` que el repositorio espera) y no hay petición HTTP.
 *
 * Solo intercepta GET: las escrituras en una demo no deben pretender que guardaron algo.
 * Una ruta no contemplada devuelve `{hit:false}` y sigue su camino normal.
 */

import * as D from './datos';

export interface RespuestaDemo {
  hit: boolean;
  value?: unknown;
}

const ok = (data: unknown): RespuestaDemo => ({ hit: true, value: { data } });
const NO: RespuestaDemo = { hit: false };

/** Primer grupo capturado de un patrón, o null. */
function cap(path: string, re: RegExp): string | null {
  const m = re.exec(path);
  return m ? (m[1] ?? '') : null;
}

export function resolveDemo(
  method: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): RespuestaDemo {
  if (method !== 'GET') return NO;

  // ── Identidad / almacenes ────────────────────────────────────────────────
  if (path === '/spatial/warehouses') return ok(D.demoWarehouses());
  if (path === '/warehouses')
    return ok([{ id: D.DEMO_WAREHOUSE_ID, code: D.DEMO_WAREHOUSE_CODE, name: D.DEMO_WAREHOUSE_NAME }]);

  // ── Espacial (gemelo 3D) ─────────────────────────────────────────────────
  if (/^\/spatial\/warehouses\/[^/]+\/summary$/.test(path)) return ok(D.demoWarehouseSummary());
  if (/^\/spatial\/warehouses\/[^/]+\/layout$/.test(path)) return ok(D.demoLayout());
  if (/^\/spatial\/warehouses\/[^/]+\/occupancy$/.test(path)) return ok(D.demoOccupancy());
  if (/^\/spatial\/warehouses\/[^/]+\/inspection\/coverage$/.test(path)) return ok(D.demoCoverage());
  // Extras del editor 3D: vacíos benignos para que la pantalla no muestre errores.
  if (path === '/spatial/assets') return ok([]);
  if (/^\/spatial\/warehouses\/[^/]+\/assets$/.test(path)) return ok([]);
  if (/^\/spatial\/warehouses\/[^/]+\/trips$/.test(path)) return ok([]);
  if (/^\/spatial\/warehouses\/[^/]+\/routes$/.test(path))
    return ok({ routes: [], truncated: false, max_points: 5000 });
  if (/^\/spatial\/warehouses\/[^/]+\/observation-sources$/.test(path)) return ok([]);
  if (/^\/spatial\/warehouses\/[^/]+\/observation-coverage$/.test(path))
    return ok({ total: 0, racks_vistos: 0, fuentes: 0, sin_colocar: 0, primera: null, ultima: null });

  // ── Inventario (ocupación) ───────────────────────────────────────────────
  if (/^\/inventory\/warehouses\/[^/]+\/summary$/.test(path)) return ok(D.demoInventorySummary());
  if (/^\/inventory\/warehouses\/[^/]+\/rack-occupancy$/.test(path)) return ok(D.demoRackOccupancy());
  if (/^\/inventory\/warehouses\/[^/]+\/location-occupancy$/.test(path))
    return ok(D.demoLocationOccupancy(query?.rack_id ? String(query.rack_id) : undefined));
  if (/^\/inventory\/warehouses\/[^/]+\/mismatches$/.test(path))
    return ok({ counts: {}, total: 0, listed: [], truncated: false, orphan_stock: [], orphan_lines: 0 });
  if (/^\/inventory\/warehouses\/[^/]+\/snapshots$/.test(path)) return ok([]);

  // ── Flota ────────────────────────────────────────────────────────────────
  if (path === '/fleet/devices') return ok(D.demoFleet());

  // ── Percepción (inspecciones) ────────────────────────────────────────────
  if (path === '/perception/models') return ok(D.demoModels());
  if (path === '/perception/jobs') return ok(D.demoJobList());
  {
    const id = cap(path, /^\/perception\/jobs\/([^/]+)\/detections$/);
    if (id) {
      const page = query?.page ? Number(query.page) : 1;
      const size = query?.page_size ? Number(query.page_size) : 200;
      return ok(D.demoDetections(id, page, size));
    }
  }
  {
    const id = cap(path, /^\/perception\/jobs\/([^/]+)$/);
    if (id) {
      const job = D.demoJob(id);
      return job ? ok(job) : ok(null);
    }
  }

  // ── Incidencias (dashboard) ──────────────────────────────────────────────
  if (path === '/incidents') return ok(D.demoIncidents());

  return NO;
}
