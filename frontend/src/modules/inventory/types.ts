/**
 * INVENTARIO — lo que el WMS declara que hay dentro del almacén.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTARIO NO ES ESPACIAL, Y LA DIFERENCIA IMPORTA
 *
 *   espacial   el EDIFICIO: qué huecos existen, cómo están estructurados, si están
 *              disponibles o bloqueados. Es una propiedad del inmueble.
 *   inventario la MERCADERÍA: qué hay dentro de cada hueco, de quién es, cuánto,
 *              y qué no cuadra.
 *
 * Sin esa separación acaban existiendo dos pantallas que enseñan «ocupación» con
 * números que se separan, y nadie sabe cuál creer. El esquema ya la hace: `spatial.*`
 * describe el espacio, `inventory.*` describe el stock.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TODO ESTO ES UNA FOTO, NO UN DIRECTO
 *
 * El WMS es el sistema de origen y esto es su espejo. Los datos vienen de un import
 * (`inventory.wms_snapshots`), así que SIEMPRE hay que enseñar de cuándo son: un
 * porcentaje de ocupación sin fecha invita a tomar decisiones sobre una foto de hace
 * tres semanas creyendo que es de hoy.
 *
 * Por eso `SnapshotInfo` no es opcional en la interfaz aunque lo sea en el tipo.
 */

/** La foto del WMS de la que sale todo lo demás. */
export interface SnapshotInfo {
  snapshot_id: string;
  /** Cuándo se sacó del WMS. Es la fecha que importa. */
  taken_at: string;
  /** Cuándo se importó aquí. Distinta de la anterior, y a veces por días. */
  received_at: string;
  source: string;
  row_count: number;
  notes: string | null;
}

/**
 * Una entrada del historial de importaciones.
 *
 * Incluye las que FALLARON —`status: 'failed'`— y las que se quedaron a medias
 * (`loading`). Esconderlas haría que alguien repitiera un intento que ya falló, a
 * ciegas, sin saber por qué.
 */
export interface SnapshotHistory extends SnapshotInfo {
  status: 'ready' | 'loading' | 'failed' | string;
  /** El hash del archivo importado. Es lo que hace idempotente reimportar el mismo. */
  external_ref: string | null;
}

export interface InventorySummary {
  snapshot: SnapshotInfo | null;
  locations: number;
  occupied: number;
  free: number;
  occupancy_pct: number | null;
  units: number | null;
  pallets: number | null;
  taken_at: string | null;
  first_expiry: string | null;
}

/**
 * Un descuadre del WMS consigo mismo.
 *
 * `mismatch` es la CLASE de contradicción, y cada una significa un trabajo distinto
 * en el pasillo:
 *
 *   dice_ocupado_sin_stock  el hueco figura ocupado y no hay ninguna línea de stock.
 *                           Suele ser mercadería que salió y nadie descargó del WMS:
 *                           el hueco está libre y el sistema no deja usarlo.
 *   dice_libre_con_stock    figura libre y tiene stock dentro. Es el peligroso: el
 *                           WMS puede mandar a otro pallet al mismo hueco.
 *   bloqueado_con_stock     bloqueado pero con carga. Mercadería inmovilizada, quizá
 *                           sin que su dueño lo sepa.
 */
export type MismatchKind =
  | 'dice_ocupado_sin_stock'
  | 'dice_libre_con_stock'
  | 'bloqueado_con_stock';

export interface Mismatch {
  location_id: string;
  location_code: string;
  /** Lo que el WMS dice de la ubicación: OCUP, DISP, BLOQ… Vocabulario abierto. */
  wms_situation: string | null;
  /** Lo que dice el catálogo espacial. La contradicción está entre estos dos. */
  spatial_status: string;
  lines: number;
  units: number | null;
  mismatch: MismatchKind | string;
}

/**
 * Stock cuyo código de ubicación NO existe en el catálogo espacial.
 *
 * No es un descuadre entre columnas: es mercadería que el WMS ubica en un sitio que
 * el edificio no tiene. O el catálogo está incompleto, o el código está mal escrito
 * en el WMS — y hasta saber cuál, esa mercadería no se puede encontrar.
 */
export interface OrphanStock {
  location_code: string;
  lines: number;
  pallets: number;
  units: number | null;
}

export interface MismatchReport {
  /** Recuento por clase sobre el TOTAL, no sobre lo listado. */
  counts: Record<string, number>;
  total: number;
  listed: Mismatch[];
  /** `true` si `listed` está acotada: contar la lista daría un número menor. */
  truncated: boolean;
  orphan_stock: OrphanStock[];
  orphan_lines: number;
}

export interface RackOccupancy {
  rack_id: string;
  rack_code: string;
  node_function: string | null;
  locations: number;
  occupied: number;
  free: number;
  occupancy_pct: number | null;
  units: number | null;
  pallets: number | null;
  blocked: number;
  first_expiry: string | null;
}

export interface RackOccupancyList {
  snapshot: SnapshotInfo | null;
  racks: RackOccupancy[];
}

/**
 * Un hueco del rack, con lo que el WMS dice de él.
 *
 * `occupied` sale del STOCK —hay líneas o no las hay— mientras que `spatial_status` y
 * `wms_situation` son DECLARACIONES, del catálogo y del WMS respectivamente. Que los
 * tres no coincidan es justo lo que produce los descuadres.
 */
export interface LocationOccupancy {
  location_id: string;
  location_code: string;
  /** El nivel dentro del rack, de abajo arriba. `null` si el código no lo declara. */
  level: number | null;
  spatial_status: string;
  wms_situation: string | null;
  lines: number;
  occupied: boolean;
  pallets: number;
  skus: number;
  clients: number;
  units: number | null;
  first_expiry: string | null;
}

/** Una línea de stock dentro de un hueco. */
export interface StockLine {
  id: string;
  location_id: string | null;
  location_code: string;
  pallet_code: string | null;
  sku: string | null;
  description: string | null;
  qty: number | null;
  uom: string | null;
  client_id: string | null;
  lot: string | null;
  expires_at: string | null;
}

export interface LocationContent {
  location_id: string;
  location_code: string;
  lines: StockLine[];
  occupied: boolean;
}

export interface PalletHit {
  location_id: string | null;
  location_code: string;
  pallet_code: string | null;
  sku: string | null;
  description: string | null;
  qty: number | null;
  uom: string | null;
  lot: string | null;
  expires_at: string | null;
  taken_at: string;
}

export interface FindResult {
  by: 'pallet' | 'sku';
  term: string;
  hits: PalletHit[];
}

/** Etiquetas y explicación de cada clase de descuadre, en un solo sitio. */
export const MISMATCH_INFO: Record<
  MismatchKind,
  { etiqueta: string; explica: string; accion: string }
> = {
  dice_ocupado_sin_stock: {
    etiqueta: 'Ocupado sin stock',
    explica: 'El WMS marca el hueco como ocupado pero no tiene ninguna línea de stock.',
    accion: 'Verifica en el pasillo: si está vacío, hay que liberarlo en el WMS.',
  },
  dice_libre_con_stock: {
    etiqueta: 'Libre con stock',
    explica: 'El WMS lo da por libre y tiene mercadería dentro.',
    accion: 'Es el más urgente: el WMS puede mandar otro pallet al mismo hueco.',
  },
  bloqueado_con_stock: {
    etiqueta: 'Bloqueado con stock',
    explica: 'El hueco está bloqueado y tiene carga dentro.',
    accion: 'Comprueba por qué se bloqueó; puede haber mercadería inmovilizada.',
  },
};
