/**
 * IMPORT DEL CATALOGO ESPACIAL — subir el xlsx del WMS por la web.
 *
 * Hasta ahora esto solo lo podia hacer quien tuviera un terminal con acceso a la
 * base como superusuario (`tools/import_spatial_catalog.py`). El endpoint corre
 * exactamente el mismo importador, transaccional y auditado — este repositorio
 * solo sube el archivo y traduce la respuesta.
 *
 * Aparte de `ApiSpatialRepository` porque es una escritura RARA y de alto
 * impacto (reescribe la estructura entera de un almacen), no una lectura mas de
 * catalogo: mezclarlo en el mismo repositorio, que hoy es todo lectura, haria
 * mas dificil ver de un vistazo que este es el unico metodo que escribe.
 */

import type { ApiClient } from '../../../lib/apiClient';
import { mapCatalogImportBatch, mapCatalogImportResult } from './mappers';
import type { CatalogImportBatch, CatalogImportResult } from '../types/index';

const BASE = (warehouseId: string): string => `/spatial/warehouses/${warehouseId}/catalog-import`;

export class ApiCatalogImportRepository {
  constructor(private readonly api: ApiClient) {}

  /**
   * Sube el archivo y corre (o simula) el importador.
   *
   * `dryRun`: lee y valida, no escribe nada — para ver antes de comprometerse
   * cuantos racks, cuerpos y rechazos trae el archivo.
   *
   * `force`: reejecuta los upserts aunque este archivo exacto ya se hubiera
   * importado. Sin el, reimportar el mismo archivo responde `skipped_duplicate`
   * sin tocar nada — que es lo que se espera si alguien lo sube dos veces por
   * accidente.
   */
  async importar(
    warehouseId: string,
    archivo: File,
    opciones: { dryRun?: boolean; force?: boolean } = {},
  ): Promise<CatalogImportResult> {
    const form = new FormData();
    form.set('file', archivo, archivo.name);
    form.set('dry_run', String(opciones.dryRun ?? false));
    form.set('force', String(opciones.force ?? false));
    const datos = await this.api.postForm<Record<string, unknown>>(BASE(warehouseId), form);
    return mapCatalogImportResult(datos);
  }

  async historial(warehouseId: string, signal?: AbortSignal): Promise<CatalogImportBatch[]> {
    const filas = await this.api.get<Record<string, unknown>[]>(
      BASE(warehouseId),
      undefined,
      signal,
    );
    return filas.map(mapCatalogImportBatch);
  }
}
