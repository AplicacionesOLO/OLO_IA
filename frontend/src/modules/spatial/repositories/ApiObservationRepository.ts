/**
 * OBSERVACIONES Y RUTAS — el extremo receptor de la vision por computador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE ES UNA OBSERVACION Y QUE NO ES
 *
 * Es un hecho atomico: «la fuente DRONE-01 vio el rack MZ04 a las 14:03:22, con
 * confianza 0,91». Nada mas. En concreto NO es una posicion del dron: se sabe que
 * estuvo lo bastante cerca de un rack para verlo, y eso es otra cosa.
 *
 * La distincion no es pedante. La posicion del rack la conocemos con la precision
 * con la que alguien lo coloco sobre el plano; la del dron no la conocemos en
 * absoluto. Dibujar la polilinea por los centros de los racks observados es lo unico
 * que se puede afirmar, y por eso los puntos se llaman `x_m`/`y_m` del RACK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA RUTA NO SE GUARDA
 *
 * Se DERIVA: observaciones ordenadas por tiempo × colocacion en metros de los racks.
 * Por eso este modulo no existia antes de que el layout se publicara: sin la
 * colocacion, «vi MZ04» no dice donde estuvo nadie.
 *
 * Y por eso no hay metodo para «guardar una ruta»: guardarla seria duplicar un
 * calculo que puede cambiar —si alguien mueve un rack, la ruta de ayer pasa por
 * donde el rack esta hoy, y eso es correcto: describe el recorrido en el almacen
 * actual—.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INGERIR ES IDEMPOTENTE
 *
 * `ingerir()` se puede llamar dos veces con el mismo lote sin duplicar nada: la base
 * tiene unicidad `(fuente, rack, instante)`. Es lo que hace que un dispositivo que
 * pierde la conexion a medias pueda reintentar el vuelo COMPLETO sin miedo, que es
 * exactamente lo que hara. La respuesta dice cuantas eran nuevas.
 */

import type { ApiClient } from '../../../lib/apiClient';
import { ApiError } from '../../../lib/apiErrors';
import type {
  IngestResultDto,
  ObservationBatchDto,
  ObservationCoverageDto,
  ObservationDto,
  ObservationSourceDto,
  RoutesDto,
} from './dto';

/** SIN `/v1`: lo lleva ya `ApiClient.baseUrl`. Misma convencion que el resto. */
const BASE = (warehouseId: string): string => `/spatial/warehouses/${warehouseId}`;

export interface VentanaTemporal {
  /** ISO. Ambos opcionales: sin ventana se devuelve todo lo que quepa. */
  desde?: string | undefined;
  hasta?: string | undefined;
}

export class ApiObservationRepository {
  constructor(private readonly api: ApiClient) {}

  /** Dispositivos y recorridos registrados en el almacen. */
  fuentes(warehouseId: string, signal?: AbortSignal): Promise<ObservationSourceDto[]> {
    return this.api.get<ObservationSourceDto[]>(
      `${BASE(warehouseId)}/observation-sources`,
      undefined,
      signal,
    );
  }

  /**
   * Las rutas del almacen, UNA POR FUENTE.
   *
   * No se aplanan: unir el ultimo punto de un dron con el primero del siguiente
   * dibujaria un zigzag que nadie recorrio.
   */
  rutas(
    warehouseId: string,
    opciones: VentanaTemporal & { source?: string | undefined } = {},
    signal?: AbortSignal,
  ): Promise<RoutesDto> {
    return this.api.get<RoutesDto>(
      `${BASE(warehouseId)}/routes`,
      {
        ...(opciones.source ? { source: opciones.source } : {}),
        ...(opciones.desde ? { desde: opciones.desde } : {}),
        ...(opciones.hasta ? { hasta: opciones.hasta } : {}),
      },
      signal,
    );
  }

  /**
   * Historial, lo mas reciente primero.
   *
   * Incluye las observaciones de racks SIN colocar, que no salen en la ruta porque
   * no tienen punto. Es la unica forma de verlas: sin este historial desaparecerian
   * sin dejar rastro.
   */
  observaciones(
    warehouseId: string,
    opciones: { source?: string | undefined; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<ObservationDto[]> {
    return this.api.get<ObservationDto[]>(
      `${BASE(warehouseId)}/observations`,
      {
        ...(opciones.source ? { source: opciones.source } : {}),
        limit: opciones.limit ?? 200,
      },
      signal,
    );
  }

  /** Cuanto del almacen se ha visto, y cuando. */
  cobertura(warehouseId: string, signal?: AbortSignal): Promise<ObservationCoverageDto> {
    return this.api.get<ObservationCoverageDto>(
      `${BASE(warehouseId)}/observation-coverage`,
      undefined,
      signal,
    );
  }

  /**
   * Registra un lote. Se puede reintentar sin duplicar.
   *
   * Existe en el cliente web y no solo en el dispositivo porque el operador tambien
   * observa: recorre el pasillo con el movil, lee los codigos y los registra. Es la
   * fuente `phone`, y es la unica que va a existir hasta que haya un modelo en
   * produccion.
   */
  ingerir(warehouseId: string, lote: ObservationBatchDto): Promise<IngestResultDto> {
    return this.api.post<IngestResultDto>(`${BASE(warehouseId)}/observations`, lote);
  }

  /**
   * Borra las observaciones de UNA fuente. Ni la fuente ni los racks se tocan.
   *
   * Exige el codigo a proposito: no hay forma de vaciar el historial del almacen de
   * un tiron. Un 404 significa «esa fuente no existe», que para quien queria
   * borrarla es el resultado que buscaba.
   */
  async purgar(warehouseId: string, source: string): Promise<void> {
    try {
      // `request` y no `delete`: el atajo `delete()` no acepta query, y `source` va
      // en la query porque es un FILTRO de lo que se borra, no el recurso. Pegarlo a
      // mano en la ruta funcionaria y dejaria el escapado en manos de quien llame.
      await this.api.request<void>(`${BASE(warehouseId)}/observations`, {
        method: 'DELETE',
        query: { source },
      });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
}
