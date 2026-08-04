/**
 * LAYOUT REMOTO — el plano publicado, compartido por el tenant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NO IMPLEMENTA `LayoutRepository`
 *
 * `LayoutRepository` es SINCRONO —`getStatus()` devuelve un `LayoutStatus`, no una
 * promesa— porque describe `localStorage`. Su cabecera decia que al llegar el
 * endpoint cambiaria la implementacion y no la interfaz. Se cumplio a medias, y
 * conviene decir en que mitad:
 *
 *   · La FORMA del dato no cambio: `LayoutDraft` sigue siendo lo que se guarda y
 *     lo que se abre. Por eso este modulo traduce a `LayoutDraft` y no inventa
 *     otro tipo.
 *
 *   · El MOMENTO si. Un `getStatus()` sincrono sobre la red exigiria mantener una
 *     copia local del estado remoto y devolverla; eso es una cache, y una cache
 *     que la UI no sabe que existe miente en cuanto otra persona publica.
 *
 * Asi que no se fuerza: local y remoto no son dos backends del mismo almacenamiento,
 * son DOS COSAS DISTINTAS y el editor las usa a la vez.
 *
 *     localStorage → el BORRADOR. Cada 900 ms, sin preguntar, solo mio.
 *     el backend    → lo PUBLICADO. Cuando pulso «Publicar», para todo el tenant.
 *
 * Es la misma distincion que hay entre el archivo abierto y el archivo guardado, y
 * la razon de que exista es que colocar 347 racks son varias sesiones de trabajo:
 * autoguardar en el servidor cada 900 ms significaria que el plano a medias de una
 * persona es el plano oficial del almacen durante toda la tarde.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA TRADUCCION DE CODIGOS
 *
 * El borrador referencia racks por CODIGO (`MZ04`); la base, por UUID. La tabla de
 * traduccion sale de `/floor-plan`, que ya se pide para dibujar. `publicar()` la
 * recibe en lugar de pedirla: la pantalla ya la tiene, y volver a descargar 347
 * filas para publicar seria pagar dos veces la misma consulta.
 */

import type { ApiClient } from '../../../lib/apiClient';
import { ApiError } from '../../../lib/apiErrors';
import type { LayoutDraft } from '../editor/types';
import type { PublishedLayoutDto } from './dto';
import { prepararPublicacion, publicadoABorrador } from './publicacion';
import type { RackNoPublicable } from './publicacion';

export interface ResultadoPublicacion {
  /** Racks efectivamente guardados en la base. */
  guardados: number;
  /**
   * Ubicaciones a las que se les calculo la posicion metrica.
   *
   * Es el pago de publicar mas alla de guardar un dibujo: de aqui salen el visor
   * 3D y el seguimiento de la flota. `0` cuando se publico sin calibrar, porque
   * sin escala medida «metros» no significa nada.
   */
  ubicacionesDerivadas: number;
  /** El estado remoto ya resuelto, para no tener que volver a pedirlo. */
  estado: EstadoRemoto;
  /** Racks del borrador que se quedaron fuera, con el motivo de cada uno. */
  excluidos: RackNoPublicable[];
  /** `false` si se publico sin escala medida. Se publica, pero se declara. */
  calibrado: boolean;
  /** El layout tal como quedo, ya en forma de borrador para el editor. */
  borrador: LayoutDraft | null;
}

export interface EstadoRemoto {
  publicado: boolean;
  updatedAt: string | null;
  publishedAt: string | null;
  racksColocados: number;
  calibrado: boolean;
  planName: string | null;
}

/**
 * SIN `/v1`: lo lleva ya `ApiClient.baseUrl`.
 *
 * Con el prefijo, la peticion salia a `/v1/v1/spatial/...` y el backend respondia
 * 404. Y el 404 era interpretable —«este almacen no tiene layout»— asi que la
 * pantalla no mostraba un error de ruta sino un estado plausible y falso. Es la
 * misma convencion que `ApiSpatialRepository`, que pasa `/spatial/warehouses`.
 */
const RUTA = (warehouseId: string): string =>
  `/spatial/warehouses/${warehouseId}/layout`;

export class ApiLayoutRepository {
  constructor(private readonly api: ApiClient) {}

  /** Lo publicado, sin traducir. Para quien necesita los metros tal cual (3D). */
  leer(warehouseId: string, signal?: AbortSignal): Promise<PublishedLayoutDto> {
    return this.api.get<PublishedLayoutDto>(RUTA(warehouseId), undefined, signal);
  }

  /**
   * Resumen para la pantalla de entrada: ¿hay plano publicado y de cuando es?
   *
   * Es la misma peticion que `leer` —el backend no tiene un endpoint de cabecera—
   * pero devuelve lo poco que la pantalla necesita para decidir que ofrece, sin
   * que el llamante tenga que saber leer el DTO.
   */
  async estado(warehouseId: string, signal?: AbortSignal): Promise<EstadoRemoto> {
    return this.aEstado(await this.leer(warehouseId, signal));
  }

  /** Lo poco que la pantalla necesita, de un DTO ya leido. */
  private aEstado(d: PublishedLayoutDto): EstadoRemoto {
    if (!d.layout) {
      return {
        publicado: false,
        updatedAt: null,
        publishedAt: null,
        racksColocados: 0,
        calibrado: false,
        planName: null,
      };
    }
    return {
      publicado: true,
      updatedAt: d.layout.updated_at,
      publishedAt: d.layout.published_at,
      racksColocados: d.placements.length,
      calibrado: d.layout.is_calibrated,
      planName: d.layout.plan_name,
    };
  }

  /** Lo publicado, ya como borrador que el editor puede abrir. */
  async abrir(
    warehouseId: string,
    borradorLocal: LayoutDraft | null,
    signal?: AbortSignal,
  ): Promise<LayoutDraft | null> {
    const d = await this.leer(warehouseId, signal);
    return publicadoABorrador(d, warehouseId, borradorLocal);
  }

  /**
   * Publica el borrador. Reemplaza el layout ENTERO del almacen.
   *
   * Un rack que el borrador coloca y el backend no conoce NO cancela la
   * publicacion: se queda fuera y viene en `excluidos`. La alternativa —fallar
   * todo por un codigo huerfano— dejaria sin guardar 346 racks bien colocados por
   * uno que sobra, y el operador no tiene forma de arreglarlo sin perder trabajo.
   * Lo que no se hace es callarlo.
   */
  async publicar(
    warehouseId: string,
    draft: LayoutDraft,
    codigoARackId: ReadonlyMap<string, string>,
  ): Promise<ResultadoPublicacion> {
    const { cuerpo, excluidos, calibrado } = prepararPublicacion(draft, codigoARackId);
    const d = await this.api.put<PublishedLayoutDto>(RUTA(warehouseId), cuerpo);
    return {
      guardados: d.published ?? d.placements.length,
      ubicacionesDerivadas: d.derived_locations ?? 0,
      excluidos,
      calibrado: d.calibrated ?? calibrado,
      borrador: publicadoABorrador(d, warehouseId, draft),
      // El PUT ya devuelve el layout completo, asi que el estado sale de ahi. La
      // alternativa —invalidar y volver a pedirlo— es una peticion mas por cada
      // publicacion Y un hueco visible: entre publicar y que llegue la respuesta,
      // el panel seguia diciendo «sin publicar» sobre un layout ya guardado.
      estado: this.aEstado(d),
    };
  }

  /**
   * Retira el layout publicado. El catalogo de racks NO se toca: la colocacion es
   * una capa sobre el, no parte de el.
   *
   * Un 404 significa «no habia nada publicado», que para quien pulsa «retirar» es
   * el resultado que buscaba. Se traga; cualquier otro error sube.
   */
  async retirar(warehouseId: string): Promise<void> {
    try {
      await this.api.delete(RUTA(warehouseId));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
}
