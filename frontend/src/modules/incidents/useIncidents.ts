/**
 * INCIDENCIAS — el trabajo que sale de los descuadres.
 *
 * ── AQUI SI SE INVALIDA, Y EN INVENTARIO NO ─────────────────────────────────
 *
 * Los datos del inventario son una foto importada: no cambian hasta el siguiente
 * import, así que allí se cachean cinco minutos y no se recargan solos.
 *
 * Las incidencias son lo contrario: las escribe la gente mientras trabaja, y dos
 * personas pueden estar mirando la misma bandeja. Por eso cada escritura invalida la
 * lista — ver una incidencia que otro cerró hace diez minutos es peor que una espera.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type { Incident, IncidentEvent, IncidentStatus, IncidentTray } from './types';

const K = {
  bandeja: (w: string, e: string) => ['incidents', 'tray', w, e] as const,
  abiertas: (w: string) => ['incidents', 'open-by-location', w] as const,
  eventos: (id: string) => ['incidents', 'events', id] as const,
};

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['incidents'] });
  };
}

export function useBandeja(warehouseId: string | null, estado: IncidentStatus | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.bandeja(warehouseId ?? '', estado ?? 'todas'),
    enabled: Boolean(warehouseId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      api.get<IncidentTray>(
        `/incidents?warehouse_id=${warehouseId}${estado ? `&status=${estado}` : ''}`,
      ),
  });
}

/**
 * `{codigo_de_hueco: id_de_incidencia}` de lo que ya está abierto.
 *
 * Lo usa la pantalla de inventario para NO ofrecer «abrir incidencia» donde ya la hay.
 * Sin esto, el botón invita a un clic que choca contra el índice único y devuelve un
 * 409 que nadie esperaba.
 */
export function useAbiertasPorUbicacion(warehouseId: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.abiertas(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      api.get<Record<string, string>>(`/incidents/open-by-location?warehouse_id=${warehouseId}`),
  });
}

export function useEventos(incidentId: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.eventos(incidentId ?? ''),
    enabled: Boolean(incidentId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => api.get<IncidentEvent[]>(`/incidents/${incidentId}/events`),
  });
}

export function useAbrirIncidencia() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string;
      kind?: string;
      subkind?: string | null;
      location_id?: string | null;
      location_code?: string | null;
      title: string;
      details?: string | null;
      source_snapshot_id?: string | null;
    }) => api.post<Incident>('/incidents', body),
    onSuccess: invalidar,
  });
}

export function useCambiarEstado() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, to, note }: { id: string; to: IncidentStatus; note?: string | undefined }) =>
      api.post<Incident>(`/incidents/${id}/status`, { to_status: to, note: note ?? null }),
    onSuccess: invalidar,
  });
}

export function useAsignar() {
  const { api } = useAuth();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) =>
      api.put<Incident>(`/incidents/${id}/assignee`, { user_id: userId }),
    onSuccess: invalidar,
  });
}
