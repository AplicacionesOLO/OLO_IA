/**
 * ERRORES DE DOMINIO COMPARTIDOS
 *
 * Todos los repositorios y servicios que aun no tienen implementacion lanzan
 * `NotImplementedError`. Es la señal explicita de que el contrato existe pero la
 * conexion con el backend todavia no.
 *
 * Cuando un repositorio se conecte, este error desaparece de ESE metodo sin que
 * ningun consumidor cambie: el contrato publico (la interfaz) sigue igual.
 */

export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED' as const;

  constructor(method: string) {
    super(`${method} no esta implementado. Requiere conexion con el backend del Bloque 3.`);
    this.name = 'NotImplementedError';
  }
}

/** Tipo base para toda entidad con ID y timestamps del servidor. */
export interface BaseEntity {
  id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Respuesta paginada por cursor (espejo del backend). */
export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}
