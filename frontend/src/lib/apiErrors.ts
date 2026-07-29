/**
 * MAPA DE ERRORES DEL BACKEND
 *
 * Extraido de `backend/src/olo/core/errors.py` y `api/errors.py`. Es el contrato
 * real, no una suposicion.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA TRAMPA CRITICA: NO_ACTIVE_MEMBERSHIP responde 403, NO 401.
 *
 * Si el interceptor tratara todo error de autorizacion como "refresca el token",
 * entraria en bucle infinito: el token es valido, lo que falta es la membresia.
 * Refrescarlo no cambia nada.
 *
 * Esta explicitamente documentado en el docstring de la excepcion del backend, y
 * `shouldAttemptRefresh` es la funcion que lo respeta.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Forma exacta del cuerpo de error del backend. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: {
      errors?: { field: string; message: string; type: string }[];
      [key: string]: unknown;
    };
    request_id?: string;
    correlation_id?: string;
  };
}

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'FORBIDDEN'
  | 'WAREHOUSE_NOT_ACCESSIBLE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'PRECONDITION_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'VALIDATION_ERROR'
  | 'BUSINESS_RULE_VIOLATION'
  | 'INSUFFICIENT_STOCK'
  | 'DUPLICATE_RESOURCE'
  | 'INVALID_REFERENCE'
  | 'CONSTRAINT_VIOLATION'
  | 'OPERATION_NOT_PERMITTED'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | string,
    message: string,
    readonly details?: ApiErrorBody['error']['details'],
    /** Copiable por el usuario para soporte. El backend lo pone en el cuerpo. */
    readonly requestId?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores de validacion mapeados a campos de formulario. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.details?.errors ?? []) {
      if (e.field) out[e.field] = e.message;
    }
    return out;
  }
}

/**
 * ¿Merece la pena intentar refrescar el token?
 *
 * SOLO para 401. Un 403 nunca: el token es correcto y refrescarlo produciria un
 * bucle. Es la regla que evita el fallo mas caro de este contrato.
 */
export function shouldAttemptRefresh(error: ApiError): boolean {
  if (error.status !== 401) return false;
  return error.code === 'UNAUTHENTICATED' || error.code === 'INVALID_TOKEN';
}

/** ¿Es un error del que no tiene sentido reintentar nunca? */
export function isTerminal(error: ApiError): boolean {
  return (
    error.status === 403 ||
    error.status === 404 ||
    error.status === 400 ||
    error.status === 422 ||
    error.status === 428
  );
}

/** Mensaje accionable para el operador, en su idioma. */
export function humanMessage(error: ApiError): string {
  switch (error.code) {
    case 'NO_ACTIVE_MEMBERSHIP':
      return 'Tu identidad es valida, pero no tienes una membresia activa en ninguna organizacion. Contacta con el administrador de tu tenant.';
    case 'FORBIDDEN':
      return 'No tienes permiso para esta operacion.';
    case 'WAREHOUSE_NOT_ACCESSIBLE':
      return 'No tienes acceso a ese almacen.';
    case 'NOT_FOUND':
      return 'El recurso no existe o no esta disponible.';
    case 'VERSION_CONFLICT':
      return 'Otra persona modifico este registro mientras lo editabas. Recarga y vuelve a intentarlo.';
    case 'PRECONDITION_REQUIRED':
      return 'Falta informacion de version en la peticion.';
    case 'VALIDATION_ERROR':
      return 'Revisa los campos marcados.';
    case 'DUPLICATE_RESOURCE':
      return 'Ya existe un registro con esa clave.';
    case 'INVALID_REFERENCE':
      return 'Uno de los elementos referenciados no existe o pertenece a otro ambito.';
    case 'RATE_LIMITED':
      return 'Demasiadas peticiones. Espera unos segundos.';
    case 'NETWORK_ERROR':
      return 'Sin conexion con el servidor.';
    default:
      return error.status >= 500
        ? 'Se produjo un error inesperado en el servidor.'
        : error.message;
  }
}
