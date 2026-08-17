/**
 * LOS RECORRIDOS CONTRA LA API.
 *
 * ── LAS PARADAS SE GUARDAN ENTERAS, NO UNA A UNA ──────────────────────────────
 *
 * Lo que se edita es el ORDEN: se reordena, se mete una en medio, se quita otra. Con altas y
 * bajas sueltas, reordenar sería una secuencia de peticiones que puede quedarse a media —y
 * el índice único de `seq` la rechazaría a mitad, dejando el recorrido peor de como estaba—.
 *
 * El `seq` lo pone el SERVIDOR por la posición en la lista. Así no hay forma de mandar dos
 * paradas con el mismo orden ni huecos en la numeración.
 */

import type { ApiClient } from '../../../lib/apiClient';
import type { ParadaNueva, Recorrido, RecorridoResumen } from '../simulacion/tipos';
import { mapParada, mapRecorrido, mapRecorridoResumen } from './mappers';
import type { TripDto, TripListItemDto } from './dto';

export class ApiRecorridosRepository {
  constructor(private readonly api: ApiClient) {}

  async lista(warehouseId: string, signal?: AbortSignal): Promise<RecorridoResumen[]> {
    const filas = await this.api.get<TripListItemDto[]>(
      `/spatial/warehouses/${warehouseId}/trips`,
      undefined,
      signal,
    );
    return (filas ?? []).map(mapRecorridoResumen);
  }

  async uno(tripId: string, signal?: AbortSignal): Promise<Recorrido> {
    const d = await this.api.get<TripDto>(`/spatial/trips/${tripId}`, undefined, signal);
    return mapRecorrido(d);
  }

  async crear(
    warehouseId: string,
    datos: { name: string; speedMps?: number; modelId?: string | null },
  ): Promise<Recorrido> {
    const d = await this.api.post<TripDto>(`/spatial/warehouses/${warehouseId}/trips`, {
      name: datos.name,
      speed_mps: datos.speedMps ?? 1.2,
      model_id: datos.modelId ?? null,
    });
    return mapRecorrido(d);
  }

  /** PARCIAL: solo viaja lo que se tocó. */
  async actualizar(
    tripId: string,
    p: { name?: string; speedMps?: number; modelId?: string | null; notes?: string | null },
  ): Promise<Recorrido> {
    const cuerpo: Record<string, unknown> = {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.speedMps !== undefined ? { speed_mps: p.speedMps } : {}),
      ...(p.modelId !== undefined ? { model_id: p.modelId } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
    };
    const d = await this.api.patch<TripDto>(`/spatial/trips/${tripId}`, cuerpo);
    return mapRecorrido(d);
  }

  async guardarParadas(tripId: string, paradas: readonly ParadaNueva[]): Promise<Recorrido> {
    const d = await this.api.put<TripDto>(`/spatial/trips/${tripId}/stops`, {
      stops: paradas.map((p) => ({
        location_id: p.locationId,
        operation: p.operation,
        dwell_s: p.dwellS,
      })),
    });
    return mapRecorrido(d);
  }

  async borrar(tripId: string): Promise<void> {
    await this.api.delete(`/spatial/trips/${tripId}`);
  }
}

/** Los mapeadores viven en `mappers.ts`; esto es solo para no repetir el import. */
export { mapParada };
