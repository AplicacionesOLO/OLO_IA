/**
 * CLIENTE HTTP
 *
 * Implementa el contrato REAL del backend, verificado en su codigo:
 *
 *   · Envoltorio  {data}  /  {data, pagination:{next_cursor, page_size}}
 *   · Error       {error:{code, message, details?, request_id?, correlation_id?}}
 *   · Paginacion  CURSOR (`cursor`, `limit`) — no offset
 *   · ETag/If-Match para optimistic locking → 412 / 428
 *   · X-Correlation-Id lo genera el cliente; X-Request-Id lo genera el servidor
 *   · X-Warehouse-Id como preferencia de filtrado, validada por el backend
 */

import { ApiError, shouldAttemptRefresh, type ApiErrorBody } from './apiErrors';

export interface Envelope<T> {
  data: T;
}

export interface PagedEnvelope<T> {
  data: T[];
  pagination: { next_cursor: string | null; page_size: number };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Version del recurso para If-Match. Sin esto, un PATCH recibe 428. */
  ifMatch?: string;
  signal?: AbortSignal;
  /** Interno: evita el bucle de refresco. */
  _isRetry?: boolean;
}

/** Dependencias que el cliente necesita del resto de la aplicacion. */
export interface ApiClientDeps {
  baseUrl: string;
  getAccessToken: () => string | null;
  /** Devuelve el token nuevo, o null si no se pudo refrescar. */
  onRefreshNeeded: () => Promise<string | null>;
  /** Se invoca cuando la sesion es irrecuperable. */
  onSessionLost: () => void;
  getWarehouseId: () => string | null;
  /**
   * La clave anonima del proyecto, que Storage exige como `apikey` ADEMAS del Bearer.
   *
   * Opcional para no romper a quien ya construye este cliente: sin ella, `subirBinario`
   * manda solo el Bearer y Storage responde 401. Es la unica operacion que la necesita.
   */
  getAnonKey?: () => string | null;
}

export class ApiClient {
  constructor(private deps: ApiClientDeps) {}

  /** Ultimo ETag por ruta, para poder enviar If-Match sin que el llamante lo gestione. */
  private etags = new Map<string, string>();

  getEtag(path: string): string | undefined {
    return this.etags.get(path);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, ifMatch, signal } = options;

    const url = new URL(`${this.deps.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      // El cliente genera la correlacion: es lo que permite encadenar una
      // operacion a traves de varios servicios. El request_id lo genera el
      // servidor y NUNCA se envia desde aqui.
      'X-Correlation-Id': crypto.randomUUID(),
    };

    const token = this.deps.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const warehouseId = this.deps.getWarehouseId();
    if (warehouseId) headers['X-Warehouse-Id'] = warehouseId;

    if (body !== undefined) headers['Content-Type'] = 'application/json';

    // If-Match explicito, o el ETag capturado del ultimo GET de esa ruta.
    const etag = ifMatch ?? this.etags.get(path);
    if (etag && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
      headers['If-Match'] = etag;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      // AbortError no es un fallo de red: es una cancelacion deliberada y debe
      // propagarse tal cual para que React Query la trate como tal.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError(0, 'NETWORK_ERROR', 'Sin conexion con el servidor');
    }

    // Se guarda el ETag del GET para el siguiente PATCH.
    const responseEtag = response.headers.get('ETag');
    if (responseEtag && method === 'GET') this.etags.set(path, responseEtag);

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const error = await this.toApiError(response);

      // ── El punto delicado del contrato ─────────────────────────────────
      // Solo 401 justifica refrescar. Un 403 NO_ACTIVE_MEMBERSHIP con
      // refresco produciria un bucle infinito: el token es valido, lo que
      // falta es la membresia.
      if (shouldAttemptRefresh(error) && !options._isRetry) {
        const fresh = await this.deps.onRefreshNeeded();
        if (fresh) {
          return this.request<T>(path, { ...options, _isRetry: true });
        }
        this.deps.onSessionLost();
      }

      throw error;
    }

    return (await response.json()) as T;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    try {
      const body = (await response.json()) as Partial<ApiErrorBody>;
      const e = body.error;
      if (e?.code) {
        return new ApiError(
          response.status,
          e.code,
          e.message ?? 'Error',
          e.details,
          e.request_id,
          e.correlation_id,
        );
      }
    } catch {
      // Cuerpo no JSON: un 502 de un proxy, por ejemplo.
    }
    return new ApiError(
      response.status,
      response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN',
      `HTTP ${response.status}`,
    );
  }

  // ── Atajos ───────────────────────────────────────────────────────────────

  async get<T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> {
    const res = await this.request<Envelope<T>>(path, {
      ...(query ? { query } : {}),
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** Coleccion paginada por cursor. Devuelve los items y el cursor siguiente. */
  async getPaged<T>(
    path: string,
    query?: RequestOptions['query'],
    signal?: AbortSignal,
  ): Promise<{ items: T[]; nextCursor: string | null }> {
    const res = await this.request<PagedEnvelope<T>>(path, {
      ...(query ? { query } : {}),
      ...(signal ? { signal } : {}),
    });
    return { items: res.data, nextCursor: res.pagination.next_cursor };
  }

  /**
   * POST. Devuelve el recurso si el backend lo manda, y nada si responde 204.
   *
   * ── EL 204 HAY QUE TOLERARLO, Y COSTO UN FALLO REAL ───────────────────────
   *
   * `request` traduce un 204 a `undefined`. Este atajo hacía `res.data` sobre eso, o
   * sea `undefined.data`, y reventaba con un TypeError **DESPUÉS** de que la escritura
   * hubiera ocurrido. Y el fallo era de los peores de diagnosticar: la operación
   * funcionaba en la base, la promesa se rechazaba, el `onSuccess` de la mutación no
   * llegaba a correr, y la pantalla se quedaba mostrando el estado anterior sin un
   * solo mensaje.
   *
   * Se detectó con los POST de archivar y desarchivar inspecciones, que responden 204:
   * la inspección SÍ se archivaba y el botón no cambiaba. Es exactamente el mismo
   * tropiezo que ya estaba corregido en `patch`, `put` y `delete`; `post` se quedó
   * fuera porque hasta ahora ningún POST del backend respondía sin cuerpo.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.request<Envelope<T> | undefined>(path, {
      method: 'POST',
      body,
    });
    return (res?.data ?? undefined) as T;
  }

  /**
   * Sube un binario a una URL ABSOLUTA de Storage, con el token del usuario.
   *
   * No pasa por `request()` y no puede: `request` construye la URL sobre `baseUrl`,
   * mete el envoltorio `{data}` y espera JSON de vuelta. Aquí la URL es absoluta —la
   * da `prepare`—, el cuerpo son bytes y la respuesta no es del contrato de la API.
   *
   * Tres detalles que cuestan un intento cada uno si se dan por hechos:
   *
   * · Es **POST**, no PUT. Lo que devuelve `upload_endpoint` es el endpoint de
   *   creación de objeto de Supabase Storage.
   * · Lleva **Authorization**. Sin ella Storage responde 401 y el paso siguiente
   *   falla diciendo «el objeto no existe», que es cierto y no explica por qué.
   * · Lleva **apikey**. Storage la exige además del Bearer, incluso con un JWT de
   *   usuario válido.
   *
   * El binario va DIRECTO: 400 MB por el proceso web solo para reenviarlos gastarían
   * memoria del servidor sin añadir nada.
   */
  async subirBinario(url: string, archivo: File | Blob): Promise<void> {
    const token = this.deps.getAccessToken();
    const cabeceras: Record<string, string> = {
      'Content-Type': archivo.type || 'application/octet-stream',
    };
    if (token) cabeceras.Authorization = `Bearer ${token}`;
    const anon = this.deps.getAnonKey?.();
    if (anon) cabeceras.apikey = anon;

    const res = await fetch(url, { method: 'POST', headers: cabeceras, body: archivo });
    if (!res.ok) {
      // El cuerpo de Storage se incluye recortado: sus mensajes son útiles
      // —«mime type not supported», «exceeded maximum size»— y sin ellos el operador
      // solo vería un número.
      const detalle = await res.text().catch(() => '');
      throw new ApiError(
        res.status,
        'STORAGE_UPLOAD_FAILED',
        `No se pudo subir el archivo (HTTP ${res.status}). ${detalle.slice(0, 200)}`,
      );
    }
  }

  /**
   * PATCH. Devuelve el recurso si el backend lo manda, y nada si responde 204.
   *
   * ── POR QUE ESTE `?.` NO ES DEFENSA POR SI ACASO ────────────────────────
   *
   * La mayoria de los PATCH del backend responden **204 sin cuerpo**: la escritura
   * no devuelve el recurso. `request` traduce eso a `undefined` (arriba, en el 204),
   * y este atajo hacia `res.data` sobre `undefined`.
   *
   * El resultado era el peor fallo posible: `TypeError: Cannot read properties of
   * undefined (reading 'data')` DESPUES de que la escritura ya hubiera ocurrido. La
   * fila se guardaba en la base y la pantalla decia «Error», asi que el operador
   * volvia a intentarlo sobre un dato que ya estaba cambiado.
   *
   * Lo padecian los seis editores de Configuracion y tambien el conmutador de la
   * matriz de permisos, que va por `put` contra un endpoint 204.
   */
  async patch<T>(path: string, body: unknown, ifMatch?: string): Promise<T> {
    const res = await this.request<Envelope<T> | undefined>(path, {
      method: 'PATCH',
      body,
      ...(ifMatch ? { ifMatch } : {}),
    });
    return res?.data as T;
  }

  /**
   * Reemplazo completo. Lo usa el vocabulario de un modelo, que no se parchea.
   *
   * Tolera el 204 sin cuerpo por lo mismo que `patch`. Ver la nota de ahi.
   */
  async put<T>(path: string, body: unknown, ifMatch?: string): Promise<T> {
    const res = await this.request<Envelope<T> | undefined>(path, {
      method: 'PUT',
      body,
      ...(ifMatch ? { ifMatch } : {}),
    });
    return res?.data as T;
  }

  /** 204 sin cuerpo. Exige If-Match igual que PATCH. */
  async delete(path: string, ifMatch?: string): Promise<void> {
    await this.request<void>(path, {
      method: 'DELETE',
      ...(ifMatch ? { ifMatch } : {}),
    });
  }

  /**
   * DELETE que SI devuelve cuerpo.
   *
   * Lo usa el borrado de assets: el metadato y el binario viven en sistemas
   * distintos y el segundo puede fallar sin revertir el primero, asi que la
   * respuesta dice que quedo. Un 204 afirmaria que se borro todo.
   */
  async deleteWith<T>(path: string, ifMatch?: string): Promise<T> {
    const res = await this.request<Envelope<T>>(path, {
      method: 'DELETE',
      ...(ifMatch ? { ifMatch } : {}),
    });
    return res.data;
  }
}
