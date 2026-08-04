/**
 * INVENTARIO Y OCUPACION — que hay en cada hueco.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA, Y NO POR FALTA DE ENDPOINTS
 *
 * El WMS es el sistema de origen y esto es su espejo. La unica escritura del
 * inventario es importar una foto nueva, y eso se hace por fuera de la API con el
 * hash del archivo y todo en una transaccion.
 *
 * Por eso aqui no hay ningun metodo de escritura. Si lo hubiera, habria dos verdades
 * sobre lo que hay en un hueco y la de este lado seria la equivocada: el operario que
 * va al pasillo y cuenta lo que ve no esta corrigiendo el inventario, esta
 * OBSERVANDO, y eso tiene su propio sitio en las observaciones de la flota.
 *
 * ── LA OCUPACION SE DERIVA ────────────────────────────────────────────────
 *
 * Un hueco esta ocupado si la foto vigente tiene una linea de stock apuntando a el.
 * No hay campo `ocupado` en la base: guardarlo crearia un dato que hay que mantener
 * sincronizado con las lineas que lo justifican, y en cuanto llegara una foto nueva
 * habria que recorrer las 29.312 ubicaciones para actualizarlo.
 *
 * ── «SIN FOTO» NO ES CERO ─────────────────────────────────────────────────
 *
 * `occupancy_pct` viene `null` cuando nadie ha importado inventario. La pantalla tiene
 * que decir «nadie lo ha subido», no «0 %»: lo segundo es una afirmacion sobre el
 * almacen que nadie ha comprobado.
 */

import type { ApiClient } from '../../../lib/apiClient';
import type {
  FindDto,
  InventorySummaryDto,
  LocationContentDto,
  LocationOccupancyDto,
  MismatchReportDto,
  RackOccupancyListDto,
  SnapshotHistoryDto,
} from './dto';

/** SIN `/v1`: lo lleva ya `ApiClient.baseUrl`. Misma convencion que el resto. */
const BASE = (warehouseId: string): string => `/inventory/warehouses/${warehouseId}`;

export class ApiInventoryRepository {
  constructor(private readonly api: ApiClient) {}

  /** Cifras de ocupacion del almacen, con la foto de la que salen. */
  resumen(warehouseId: string, signal?: AbortSignal): Promise<InventorySummaryDto> {
    return this.api.get<InventorySummaryDto>(`${BASE(warehouseId)}/summary`, undefined, signal);
  }

  /**
   * Ocupacion de los 347 racks. Es lo que alimenta el mapa de calor.
   *
   * Sin paginar a proposito: el mapa los necesita TODOS para colorear, y uno a medias
   * pinta de «vacio» lo que aun no ha llegado. Son 347 filas agregadas en la base, no
   * las 29.312 ubicaciones.
   */
  porRack(warehouseId: string, signal?: AbortSignal): Promise<RackOccupancyListDto> {
    return this.api.get<RackOccupancyListDto>(
      `${BASE(warehouseId)}/rack-occupancy`,
      undefined,
      signal,
    );
  }

  /** Ocupacion hueco a hueco. Incluye los LIBRES, que son la mitad del dato. */
  porUbicacion(
    warehouseId: string,
    opciones: { rackId?: string | undefined; occupied?: boolean | undefined; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<LocationOccupancyDto[]> {
    return this.api.get<LocationOccupancyDto[]>(
      `${BASE(warehouseId)}/location-occupancy`,
      {
        ...(opciones.rackId ? { rack_id: opciones.rackId } : {}),
        ...(opciones.occupied !== undefined ? { occupied: opciones.occupied } : {}),
        limit: opciones.limit ?? 200,
      },
      signal,
    );
  }

  /** Que hay en un hueco. `lines: []` es vacio; un uuid inexistente da 404. */
  contenido(
    warehouseId: string,
    locationId: string,
    signal?: AbortSignal,
  ): Promise<LocationContentDto> {
    return this.api.get<LocationContentDto>(
      `${BASE(warehouseId)}/locations/${locationId}/content`,
      undefined,
      signal,
    );
  }

  /**
   * Buscar un pallet o un articulo. Es la consulta del pasillo.
   *
   * Uno de los dos, no los dos: el backend rechaza mandar ambos, porque «el pallet X
   * del articulo Y» es una interseccion que nadie pide.
   */
  buscar(
    warehouseId: string,
    termino: { pallet: string } | { sku: string },
    signal?: AbortSignal,
  ): Promise<FindDto> {
    return this.api.get<FindDto>(`${BASE(warehouseId)}/find`, { ...termino }, signal);
  }

  /**
   * Lo que el WMS no cuadra consigo mismo, y el stock que apunta a ningun sitio.
   *
   * Medido en el almacen real: 2.186 descuadres y 773 lineas huerfanas. Es el dato que
   * nadie mira hasta que algo no cuadra.
   */
  descuadres(warehouseId: string, signal?: AbortSignal): Promise<MismatchReportDto> {
    return this.api.get<MismatchReportDto>(
      `${BASE(warehouseId)}/mismatches`,
      undefined,
      signal,
    );
  }

  /** Historico de fotos, incluidas las que fallaron. */
  fotos(warehouseId: string, signal?: AbortSignal): Promise<SnapshotHistoryDto[]> {
    return this.api.get<SnapshotHistoryDto[]>(
      `${BASE(warehouseId)}/snapshots`,
      undefined,
      signal,
    );
  }
}
