/**
 * DATOS DE DEMOSTRACIÓN — fixtures realistas para el MODO PRESENTACIÓN.
 *
 * Todo lo que devuelve esto imita la forma EXACTA que sirve el backend (los `dto.ts`
 * de cada módulo), porque el modo demo intercepta en `ApiClient.request()` y entrega
 * el mismo envoltorio `{data}` que el repositorio luego mapea. Así ninguna pantalla,
 * hook ni repositorio sabe que está en demo: ven datos con la forma de siempre.
 *
 * Objetivo: una demo de ventas que SIEMPRE funciona —sin backend, sin worker, sin
 * dron—, con cifras coherentes entre sí y ancladas en la estructura real del CEDI
 * (los 76 racks del «Mapa mezzanine N2», vía `acomodo/modelo.ts`).
 *
 * Determinista a propósito: los mismos números en cada recarga, para que una
 * presentación sea repetible.
 */

import { modeloAcomodo } from '../../modules/spatial/acomodo/modelo';
import { MOCK_WAREHOUSE_IDS } from '../../auth/mockProfile';
import type { DeviceDto, DeviceListDto } from '../../modules/fleet/dto';
import type {
  ClassCountDto,
  DetectionDto,
  DetectionPageDto,
  JobDto,
  JobEventDto,
  JobListDto,
  ModelCatalogDto,
} from '../../modules/perception/dto';
import type {
  InspectionCoverageDto,
  InventorySummaryDto,
  LocationOccupancyDto,
  OccupancyDto,
  PlacementOutDto,
  PublishedLayoutDto,
  RackCeldasDto,
  RackOccupancyDto,
  RackOccupancyListDto,
  WarehouseLayoutDto,
  WarehouseSummaryDto,
} from '../../modules/spatial/repositories/dto';

// ── Identidad del almacén demo ───────────────────────────────────────────────

export const DEMO_WAREHOUSE_ID = MOCK_WAREHOUSE_IDS[0];
export const DEMO_WAREHOUSE_CODE = 'OLO-CR';
export const DEMO_WAREHOUSE_NAME = 'CEDI San José';

const ahora = () => new Date().toISOString();
const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const haceDias = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// ── Deterministas ────────────────────────────────────────────────────────────

/** Hash FNV-1a de 32 bits. Estable entre recargas. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hex determinista de longitud `len` a partir de una semilla. */
function hashHex(seed: string, len: number): string {
  let out = '';
  let n = 0;
  while (out.length < len) {
    out += hash32(`${seed}#${n}`).toString(16).padStart(8, '0');
    n += 1;
  }
  return out.slice(0, len);
}

/** UUID determinista y con forma válida a partir de una semilla (solo cliente). */
export function uuidDe(seed: string): string {
  const x = hashHex(seed, 32);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

/** Un número en [0,1) determinista por semilla. */
function r01(seed: string): number {
  return hash32(seed) / 0x100000000;
}

// ── Estructura base: los racks del acomodo real ──────────────────────────────

interface RackDemo {
  code: string;
  nodeId: string;
  bays: number;
  color: string;
  zonaFranca: boolean;
}

const NIVELES = 6;
const POSICIONES = 2;
const SITUACIONES = ['OCUP', 'DISP', 'BLOQ'] as const;

function codigoRCL(n: number): string {
  return `RCL${String(n).padStart(2, '0')}`;
}

/** Los 76 racks del doble fondo, con su número de catálogo y nº de cuerpos. */
let _racks: RackDemo[] | null = null;
function racksDemo(): RackDemo[] {
  if (_racks) return _racks;
  const m = modeloAcomodo();
  const racks: RackDemo[] = [];
  for (const f of m.filas) {
    const bays = Math.max(6, f.celdas.length);
    for (const num of f.racks) {
      const code = codigoRCL(num);
      // Zona Franca: RCL61…RCL72 (blancos en el render real).
      const zonaFranca = num >= 61 && num <= 72;
      racks.push({
        code,
        nodeId: uuidDe(`rack:${code}`),
        bays,
        color: f.fill,
        zonaFranca,
      });
    }
  }
  _racks = racks;
  return racks;
}

/** Situación observada de un hueco, determinista. ~53% OCUP · ~42% DISP · ~5% BLOQ. */
function situacionDe(code: string, cuerpo: number, nivel: number, pos: number): number {
  const r = r01(`${code}:${cuerpo}:${nivel}:${pos}`);
  if (r < 0.532) return 0; // OCUP
  if (r < 0.95) return 1; // DISP
  return 2; // BLOQ
}

// ── Totales agregados (coherentes en todas las pantallas) ────────────────────

interface Totales {
  ubicaciones: number;
  ocupadas: number;
  bloqueadas: number;
  libres: number;
  racks: number;
  cuerpos: number;
}

let _totales: Totales | null = null;
function totales(): Totales {
  if (_totales) return _totales;
  let ubicaciones = 0;
  let ocupadas = 0;
  let bloqueadas = 0;
  let cuerpos = 0;
  for (const rk of racksDemo()) {
    cuerpos += rk.bays;
    for (let c = 1; c <= rk.bays; c += 1) {
      for (let n = 1; n <= NIVELES; n += 1) {
        for (let p = 1; p <= POSICIONES; p += 1) {
          ubicaciones += 1;
          const s = situacionDe(rk.code, c, n, p);
          if (s === 0) ocupadas += 1;
          else if (s === 2) bloqueadas += 1;
        }
      }
    }
  }
  _totales = {
    ubicaciones,
    ocupadas,
    bloqueadas,
    libres: ubicaciones - ocupadas - bloqueadas,
    racks: racksDemo().length,
    cuerpos,
  };
  return _totales;
}

// ── 1 · Almacenes / resumen ──────────────────────────────────────────────────

export function demoWarehouseSummary(): WarehouseSummaryDto {
  const t = totales();
  return {
    warehouse_id: DEMO_WAREHOUSE_ID,
    warehouse_code: DEMO_WAREHOUSE_CODE,
    warehouse_name: DEMO_WAREHOUSE_NAME,
    site_count: 1,
    aisle_count: 0,
    rack_count: t.racks,
    bay_count: t.cuerpos,
    location_count: t.ubicaciones,
    available_count: t.ubicaciones - t.bloqueadas,
    blocked_count: t.bloqueadas,
    inferred_count: 0,
    opaque_count: 2,
    wms_situation_counts: { OCUP: t.ocupadas, DISP: t.libres, BLOQ: t.bloqueadas },
    status_situation_conflicts: 0,
    capacity_unlimited_count: t.ubicaciones,
    capacity_unknown_count: 0,
    with_world_geometry: 0,
    last_import_at: haceDias(2),
    total_rows_rejected: 0,
  };
}

export function demoWarehouses(): WarehouseSummaryDto[] {
  return [demoWarehouseSummary()];
}

// ── 2 · Layout publicado (gemelo 3D) ─────────────────────────────────────────

export function demoLayout(): PublishedLayoutDto {
  const m = modeloAcomodo();
  const placements: PlacementOutDto[] = [];

  m.filas.forEach((f, i) => {
    const mid = (f.x0 + f.x1) / 2;
    const yc = (f.y0 + f.y1) / 2;
    const largo = Math.abs(f.y1 - f.y0);
    const alto = m.alto;
    const grupo = `fila-${i}`;
    const lados: { num: number; x: number; facing: -1 | 1 }[] = [
      { num: f.racks[0], x: (f.x0 + mid) / 2, facing: -1 },
      { num: f.racks[1], x: (mid + f.x1) / 2, facing: 1 },
    ];
    for (const l of lados) {
      const code = codigoRCL(l.num);
      placements.push({
        id: uuidDe(`placement:${code}`),
        rack_node_id: uuidDe(`rack:${code}`),
        rack_code: code,
        node_type: 'rack',
        node_function: 'ALMREP',
        x_m: l.x,
        y_m: yc,
        rotation_deg: 0,
        width_m: Math.abs(mid - f.x0),
        length_m: largo,
        height_m: alto,
        color: f.fill,
        is_locked: false,
        group_key: grupo,
        facing: l.facing,
        updated_at: ahora(),
      });
    }
  });

  // Cantilevers (franjas finas, ámbar/zf), como el acomodo publicado real.
  m.cants.forEach((c) => {
    const code = c.code;
    placements.push({
      id: uuidDe(`placement:${code}`),
      rack_node_id: uuidDe(`rack:${code}`),
      rack_code: code,
      node_type: 'rack',
      node_function: 'ALMREP',
      x_m: (c.x0 + c.x1) / 2,
      y_m: (c.y0 + c.y1) / 2,
      rotation_deg: 0,
      width_m: Math.abs(c.x1 - c.x0),
      length_m: Math.abs(c.y1 - c.y0),
      height_m: m.alto,
      color: c.fill,
      is_locked: false,
      group_key: null,
      facing: null,
      updated_at: ahora(),
    });
  });

  const layout: WarehouseLayoutDto = {
    id: uuidDe('layout'),
    warehouse_id: DEMO_WAREHOUSE_ID,
    plan_name: 'Mapa mezzanine N2',
    plan_width_px: null,
    plan_height_px: null,
    pixels_per_meter: 50,
    origin_x_px: 0,
    origin_y_px: 0,
    is_calibrated: false,
    published_at: haceDias(7),
    published_by: null,
    updated_at: haceDias(7),
  };

  return {
    layout,
    placements,
    published: null,
    calibrated: null,
    derived_locations: null,
  };
}

// ── 3 · Ocupación por hueco (colorea el 3D) ──────────────────────────────────

export function demoOccupancy(): OccupancyDto {
  const racks: RackCeldasDto[] = [];
  const conflicts = 0;
  for (const rk of racksDemo()) {
    const cells: number[][] = [];
    for (let c = 1; c <= rk.bays; c += 1) {
      for (let n = 1; n <= NIVELES; n += 1) {
        for (let p = 1; p <= POSICIONES; p += 1) {
          cells.push([c, n, p, situacionDe(rk.code, c, n, p), 0]);
        }
      }
    }
    racks.push({ rack_node_id: rk.nodeId, cells });
  }
  const t = totales();
  return {
    imported_at: haceDias(2),
    situations: [...SITUACIONES],
    racks,
    cells: t.ubicaciones,
    conflicts,
    without_cell: 0,
  };
}

// ── 4 · Inventario (ocupación) ───────────────────────────────────────────────

function snapshotDemo() {
  return {
    snapshot_id: uuidDe('snapshot'),
    taken_at: haceDias(2),
    received_at: haceDias(2),
    source: 'WMS-CR',
    row_count: totales().ocupadas,
    notes: 'Corte de inventario del WMS',
  };
}

export function demoInventorySummary(): InventorySummaryDto {
  const t = totales();
  return {
    snapshot: snapshotDemo(),
    locations: t.ubicaciones,
    occupied: t.ocupadas,
    free: t.libres,
    occupancy_pct: Math.round((1000 * t.ocupadas) / t.ubicaciones) / 10,
    units: null,
    pallets: t.ocupadas,
    taken_at: haceDias(2),
    first_expiry: haceDias(-45).slice(0, 10),
  };
}

export function demoRackOccupancy(): RackOccupancyListDto {
  const racks: RackOccupancyDto[] = racksDemo().map((rk) => {
    let occ = 0;
    let blo = 0;
    const loc = rk.bays * NIVELES * POSICIONES;
    for (let c = 1; c <= rk.bays; c += 1)
      for (let n = 1; n <= NIVELES; n += 1)
        for (let p = 1; p <= POSICIONES; p += 1) {
          const s = situacionDe(rk.code, c, n, p);
          if (s === 0) occ += 1;
          else if (s === 2) blo += 1;
        }
    return {
      rack_id: rk.nodeId,
      rack_code: rk.code,
      node_function: 'ALMREP',
      locations: loc,
      occupied: occ,
      free: loc - occ - blo,
      occupancy_pct: Math.round((1000 * occ) / loc) / 10,
      units: null,
      pallets: occ,
      blocked: blo,
      first_expiry: null,
    };
  });
  return { snapshot: snapshotDemo(), racks };
}

export function demoLocationOccupancy(rackId?: string): LocationOccupancyDto[] {
  const racks = racksDemo();
  const objetivo = rackId ? racks.filter((r) => r.nodeId === rackId) : racks.slice(0, 2);
  const filas: LocationOccupancyDto[] = [];
  for (const rk of objetivo) {
    for (let c = 1; c <= rk.bays; c += 1)
      for (let n = 1; n <= NIVELES; n += 1)
        for (let p = 1; p <= POSICIONES; p += 1) {
          const s = situacionDe(rk.code, c, n, p);
          const ocupado = s === 0;
          filas.push({
            location_id: uuidDe(`loc:${rk.code}:${c}:${n}:${p}`),
            location_code: `${rk.code}-C${String(c).padStart(3, '0')}-N${String(n).padStart(2, '0')}-${p}`,
            level: n,
            spatial_status: s === 2 ? 'blocked' : 'available',
            wms_situation: SITUACIONES[s] ?? 'DISP',
            lines: ocupado ? 1 : 0,
            occupied: ocupado,
            pallets: ocupado ? 1 : 0,
            skus: ocupado ? 1 : 0,
            clients: ocupado ? 1 : 0,
            units: null,
            first_expiry: null,
          });
        }
  }
  return filas;
}

// ── 5 · Cobertura de inspección (dashboard + spatial) ────────────────────────

export function demoCoverage(): InspectionCoverageDto {
  const t = totales();
  const inspeccionadas = Math.round(t.ubicaciones * 0.62);
  const racksVistos = Math.round(t.racks * 0.7);
  return {
    warehouse_id: DEMO_WAREHOUSE_ID,
    locations: t.ubicaciones,
    inspected: inspeccionadas,
    racks_total: t.racks,
    racks_inspected: racksVistos,
    last_seen_at: haceMin(42),
    mismatched: 37,
    racks: racksDemo()
      .slice(0, racksVistos)
      .map((rk) => ({
        rack_id: rk.nodeId,
        rack_code: rk.code,
        locations: rk.bays * NIVELES * POSICIONES,
        inspected: Math.round(rk.bays * NIVELES * POSICIONES * 0.62),
        mismatched: Math.round(r01(`mm:${rk.code}`) * 3),
        last_seen_at: haceMin(42),
      })),
  };
}

// ── 6 · Flota (dron DJI en línea) ────────────────────────────────────────────

export function demoFleet(): DeviceListDto {
  const dron: DeviceDto = {
    id: uuidDe('device:dron'),
    warehouse_id: DEMO_WAREHOUSE_ID,
    device_key: 'dron-dji-mini4pro',
    kind: 'drone',
    name: 'DJI Mini 4 Pro',
    app_version: '1.6.0',
    device_model: 'DJI Mini 4 Pro',
    registered_at: haceDias(12),
    last_seen_at: haceMin(1),
    current_job_id: uuidDe('job:ubicaciones'),
    status: 'live',
    retired_at: null,
    retired_reason: null,
  };
  const telefono: DeviceDto = {
    id: uuidDe('device:phone'),
    warehouse_id: DEMO_WAREHOUSE_ID,
    device_key: 'tel-operador-01',
    kind: 'phone',
    name: 'Teléfono operador · Bodega',
    app_version: '2.3.1',
    device_model: 'Samsung Galaxy S24',
    registered_at: haceDias(30),
    last_seen_at: haceMin(8),
    current_job_id: null,
    status: 'connected',
    retired_at: null,
    retired_reason: null,
  };
  const onboard: DeviceDto = {
    id: uuidDe('device:edge'),
    warehouse_id: DEMO_WAREHOUSE_ID,
    device_key: 'edge-gpu-01',
    kind: 'onboard_compute',
    name: 'Nodo edge · GPU',
    app_version: '0.1.0',
    device_model: 'RTX 5070',
    registered_at: haceDias(20),
    last_seen_at: haceMin(1),
    current_job_id: uuidDe('job:ubicaciones'),
    status: 'live',
    retired_at: null,
    retired_reason: null,
  };
  return { devices: [dron, onboard, telefono], online: 3 };
}

// ── 7 · Percepción (inspecciones) ────────────────────────────────────────────

const CLASES = [
  { name: 'qr_ubicacion', color: '#22d3ee' },
  { name: 'hueco_vacio', color: '#f59e0b' },
  { name: 'pallet', color: '#64748b' },
  { name: 'qr_pallet', color: '#a78bfa' },
  { name: 'etiqueta_ilegible', color: '#ef4444' },
];

export function demoModels(): ModelCatalogDto {
  return {
    models: [
      {
        ai_project_id: null,
        model_version_id: uuidDe('model:v5'),
        model_id: uuidDe('model'),
        version: 5,
        origin: 'trained',
        published_at: haceDias(9),
        name: 'Detector de alturas',
        slug: 'detector-alturas',
        task: 'detection-ocr',
        input_type: 'video',
        architecture_code: 'rf-detr',
        architecture_name: 'RF-DETR',
        framework_code: 'pytorch',
        classes: CLASES.map((c, i) => ({
          id: uuidDe(`class:${c.name}`),
          name: c.name,
          index: i,
          color: c.color,
        })),
      },
    ],
    worker_available: true,
    max_upload_bytes: 2_147_483_648,
    accepted_types: ['video/mp4', 'image/jpeg', 'image/png'],
    unavailable_reason: null,
  };
}

interface PlantillaJob {
  key: string;
  name: string;
  pipeline: string;
  dias: number;
  frames: number;
  dets: number;
}

const JOBS: PlantillaJob[] = [
  { key: 'ubicaciones', name: 'Ubicaciones vacías — Pasillo A', pipeline: 'ubicaciones', dias: 0, frames: 127, dets: 418 },
  { key: 'reconcile', name: 'Conteo cíclico — Zona Franca', pipeline: 'detection-ocr', dias: 1, frames: 212, dets: 734 },
  { key: 'recepcion', name: 'Recepción muelle 3', pipeline: 'detection-ocr', dias: 3, frames: 96, dets: 305 },
  { key: 'alturas', name: 'Verificación de alturas — RCL40-48', pipeline: 'object-detection', dias: 6, frames: 158, dets: 512 },
];

function classCountsDe(dets: number, conTexto: boolean): ClassCountDto[] {
  const ub = Math.round(dets * 0.34);
  const hueco = Math.round(dets * 0.22);
  const pallet = dets - ub - hueco;
  return [
    { class_name: 'qr_ubicacion', n: ub, confianza_media: 0.91, casadas: conTexto ? Math.round(ub * 0.8) : 0 },
    { class_name: 'hueco_vacio', n: hueco, confianza_media: 0.88, casadas: 0 },
    { class_name: 'pallet', n: pallet, confianza_media: 0.84, casadas: 0 },
  ];
}

function jobDto(p: PlantillaJob): JobDto {
  const conTexto = p.pipeline === 'detection-ocr' || p.pipeline === 'ubicaciones';
  const completadoEn = haceDias(p.dias);
  const events: JobEventDto[] = [
    { id: 1, from_status: null, to_status: 'draft', occurred_at: completadoEn, reason: null },
    { id: 2, from_status: 'draft', to_status: 'queued', occurred_at: completadoEn, reason: null },
    { id: 3, from_status: 'queued', to_status: 'running', occurred_at: completadoEn, reason: null },
    { id: 4, from_status: 'running', to_status: 'completed', occurred_at: completadoEn, reason: null },
  ];
  return {
    id: uuidDe(`job:${p.key}`),
    warehouse_id: DEMO_WAREHOUSE_ID,
    name: p.name,
    status: 'completed',
    pipeline: p.pipeline,
    model_version_id: uuidDe('model:v5'),
    model_label: 'Detector de alturas v5',
    confidence_threshold: 0.3,
    frame_sampling_rate: 2,
    save_detected_frames: false,
    notes: null,
    frames_processed: p.frames,
    frames_total: p.frames,
    detection_count: p.dets,
    elapsed_ms: p.frames * 1800,
    error_message: null,
    queued_at: completadoEn,
    started_at: completadoEn,
    completed_at: completadoEn,
    created_at: completadoEn,
    media_id: uuidDe(`media:${p.key}`),
    media_kind: 'video',
    media_filename: `DJI_${p.key}.MP4`,
    media_content_type: 'video/mp4',
    media_bytes: 1_018_000_000,
    media_sha256: hashHex(`sha:${p.key}`, 64),
    media_width: 3840,
    media_height: 2160,
    media_duration_ms: p.frames * 500,
    media_total_frames: p.frames * 30,
    media_stream_url: null,
    media_source: 'uploaded-file',
    media_available: false,
    media_has_preview: false,
    archived_at: null,
    event_count: events.length,
    events,
    class_counts: classCountsDe(p.dets, conTexto),
    worker_available: true,
  };
}

export function demoJobList(): JobListDto {
  return { jobs: JOBS.map(jobDto), worker_available: true };
}

export function demoJob(id: string): JobDto | null {
  const p = JOBS.find((j) => uuidDe(`job:${j.key}`) === id);
  return p ? jobDto(p) : null;
}

/** Detecciones de un trabajo: códigos de ubicación leídos, huecos vacíos y pallets. */
export function demoDetections(jobId: string, page = 1, pageSize = 200): DetectionPageDto {
  const p = JOBS.find((j) => uuidDe(`job:${j.key}`) === jobId);
  if (!p) return { items: [], total: 0, page, page_size: pageSize };
  const conTexto = p.pipeline === 'detection-ocr' || p.pipeline === 'ubicaciones';
  const racks = racksDemo();
  const items: DetectionDto[] = [];
  const total = Math.min(p.dets, 180);
  for (let i = 0; i < total; i += 1) {
    const rk = racks[i % racks.length];
    if (!rk) continue;
    const cuerpo = (i % rk.bays) + 1;
    const nivel = (i % NIVELES) + 1;
    const pos = (i % POSICIONES) + 1;
    const code = `${rk.code}-C${String(cuerpo).padStart(3, '0')}-N${String(nivel).padStart(2, '0')}-${pos}`;
    const tipo = i % 5;
    const clase = tipo === 0 || tipo === 1 ? 'qr_ubicacion' : tipo === 2 ? 'hueco_vacio' : tipo === 3 ? 'pallet' : 'qr_pallet';
    const esUbic = clase === 'qr_ubicacion';
    const casada = conTexto && esUbic && i % 2 === 0;
    const colClase = CLASES.find((c) => c.name === clase);
    items.push({
      id: uuidDe(`det:${p.key}:${i}`),
      job_id: jobId,
      observed_at: haceDias(p.dias),
      ingested_at: haceDias(p.dias),
      frame_number: Math.floor(i / 3),
      frame_ms: i * 500,
      frame_ref: null,
      class_name: clase,
      ai_class_id: uuidDe(`class:${clase}`),
      class_color: colClase?.color ?? '#64748b',
      confidence: 0.7 + r01(`conf:${p.key}:${i}`) * 0.29,
      bbox_x: 0.1 + r01(`bx:${i}`) * 0.7,
      bbox_y: 0.1 + r01(`by:${i}`) * 0.7,
      bbox_width: 0.08 + r01(`bw:${i}`) * 0.12,
      bbox_height: 0.1 + r01(`bh:${i}`) * 0.15,
      bbox_format: 'normalized',
      text_value: esUbic && conTexto ? code : clase === 'qr_pallet' && conTexto ? `PAL-${hashHex(`pal:${i}`, 6).toUpperCase()}` : null,
      crop_path: null,
      state: casada ? 'matched' : 'unmatched',
      rack_node_id: casada ? rk.nodeId : null,
      review_status: 'pending',
      reviewed_at: null,
      review_comment: null,
      supersedes_id: null,
      is_manual: false,
    });
  }
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize };
}

// ── 8 · Incidencias (dashboard) ──────────────────────────────────────────────

export function demoIncidents() {
  return {
    open_total: 6,
    counts: { open: 4, in_progress: 2, resolved: 18, dismissed: 3 },
  };
}
