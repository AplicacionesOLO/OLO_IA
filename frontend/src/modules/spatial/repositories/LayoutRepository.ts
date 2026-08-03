/**
 * CONTRATO DEL REPOSITORIO DE LAYOUT — COMO SE VE, no QUE ES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA SEPARADO DE `SpatialRepository`
 *
 * El backend sabe que racks existen; no sabe donde estan dibujados. Eso no es
 * una laguna que haya que tapar: `world_position` esta al 100% NULL porque el
 * catalogo del WMS no trae geometria metrica, y fabricarla desde los indices
 * logicos produciria un plano geometricamente consistente y falso.
 *
 * Asi que el layout es una capa APARTE, con tres propiedades que la distinguen:
 *
 *   1. NO ES AUTORIDAD. Si el layout dice que existe el rack `XX99` y el backend
 *      no lo conoce, el rack no existe. La verdad del dominio esta en el
 *      backend; el layout solo dice donde pintar lo que el backend afirma.
 *
 *   2. ES DEL OPERADOR, NO DEL TENANT. Vive en `localStorage`, por almacen. Dos
 *      personas pueden tener planos distintos del mismo almacen sin que ninguna
 *      este equivocada, porque no es un dato compartido.
 *
 *   3. ES BORRADOR. Cuando exista el endpoint de persistencia, esta interfaz no
 *      cambia: cambia la implementacion. Por eso es una interfaz y no un store
 *      suelto — es el unico punto que habra que reescribir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { LayoutDraft } from '../editor/types';

/** Donde vive el layout. Se expone para que la UI pueda decirlo. */
export type LayoutStorageKind = 'local' | 'remote';

export interface LayoutStatus {
  kind: LayoutStorageKind;
  /** `false` cuando este almacen no tiene plano configurado todavia. */
  exists: boolean;
  /** ISO. `null` si no hay layout. */
  updatedAt: string | null;
  /**
   * Si la IMAGEN del plano se pudo guardar. `localStorage` tiene un limite de
   * unos 5 MB, asi que un plano grande deja la geometria guardada y la imagen no.
   * La UI debe poder decir exactamente eso en lugar de mostrar un plano vacio.
   */
  imageStored: boolean;
  /** Motivo del fallo de almacenamiento, si lo hubo. */
  storageError: string | null;
  /** Racks colocados en el plano. */
  positionedRackCount: number;
  /** Si hay calibracion: sin ella, las medidas del plano no son metros. */
  calibrated: boolean;
}

export interface LayoutRepository {
  /** Estado del layout de un almacen, sin cargarlo entero. */
  getStatus(warehouseId: string): LayoutStatus;

  /** El layout completo, o `null` si no existe. */
  load(warehouseId: string): LayoutDraft | null;

  save(warehouseId: string, draft: LayoutDraft): LayoutStatus;

  discard(warehouseId: string): void;

  /** Para exportar e importar entre navegadores mientras no haya endpoint. */
  export(warehouseId: string): string | null;
  import(warehouseId: string, json: string): boolean;
}
