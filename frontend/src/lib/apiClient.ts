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

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.request<Envelope<T>>(path, { method: 'POST', body });
    return res.data;
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
