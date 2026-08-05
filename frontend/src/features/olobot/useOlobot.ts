/**
 * Los hooks de OLOBOT.
 *
 * ── EL TURNO NO ES OPTIMISTA, Y NO DEBE SERLO ───────────────────────────────
 *
 * En la matriz de permisos la mutación SÍ es optimista, porque marcar una casilla es
 * un gesto de 50 ms contra 260 ms de latencia. Aquí es lo contrario: una pregunta al
 * bot tarda segundos —consulta la base varias veces antes de contestar— y adelantar
 * una respuesta que no existe sería inventarla, que es exactamente lo que el bot no
 * hace. Lo que se pinta mientras espera es que está pensando.
 *
 * ── LO QUE SÍ SE INVALIDA, Y POR QUÉ ────────────────────────────────────────
 *
 * Confirmar una acción del bot escribe en `core` o en `spatial`, así que invalida el
 * resumen de configuración: si no, la tabla de clientes seguiría enseñando el nombre
 * viejo después de que el bot lo cambiara, y el operador tendría dos versiones del
 * mismo dato en la misma pantalla.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type {
  AccesoLista,
  OlobotConversacion,
  OlobotEstado,
  OlobotMensaje,
  OlobotNivel,
  RespuestaTurno,
} from './olobotTypes';

const K = {
  estado: ['olobot', 'estado'] as const,
  conversaciones: ['olobot', 'conversaciones'] as const,
  historial: (id: string) => ['olobot', 'historial', id] as const,
  acciones: ['olobot', 'acciones'] as const,
  acceso: ['olobot', 'acceso'] as const,
  //  El resumen de admin, para invalidarlo cuando el bot escribe en él. La clave se
  //  repite aquí en vez de importarse de `useAdmin` para no atar el widget del chat
  //  —que se monta en TODA la aplicación— al módulo de configuración.
  adminOverview: ['admin', 'overview'] as const,
};

/**
 * Si hay bot para este usuario. Se pide una vez y se conserva.
 *
 * `staleTime` alto porque la respuesta solo cambia cuando un administrador toca el
 * nivel de alguien, y eso no pasa mientras se conversa.
 */
export function useOlobotEstado() {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.estado,
    queryFn: () => api.get<OlobotEstado>('/olobot/status'),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 300_000,
  });
}

export function useConversaciones(activo: boolean) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.conversaciones,
    queryFn: () =>
      api.get<{ conversations: OlobotConversacion[] }>('/olobot/conversations'),
    // Solo cuando el panel está abierto: es una lista que no se ve el 99 % del tiempo.
    enabled: activo,
    retry: false,
  });
}

export function useHistorial(id: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.historial(id ?? 'ninguna'),
    queryFn: () =>
      api.get<{ conversation: OlobotConversacion; messages: OlobotMensaje[] }>(
        `/olobot/conversations/${id}`,
      ),
    enabled: id !== null,
    retry: false,
  });
}

export interface TurnoArgs {
  message: string;
  conversation_id?: string | undefined;
  warehouse_id?: string | undefined;
}

/**
 * Un turno de conversación.
 *
 * Sin reintentos. Un turno cuesta dinero de verdad —llamadas al modelo— y reintentar
 * en silencio lo cobraría dos veces por un error que el usuario no ha visto. Si falla,
 * se le dice y decide él.
 */
export function useHablar() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TurnoArgs) => api.post<RespuestaTurno>('/olobot/messages', args),
    retry: false,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: K.conversaciones });
      void qc.invalidateQueries({ queryKey: K.historial(r.conversation_id) });
    },
  });
}

export function useRetirarConversacion() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/olobot/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.conversaciones }),
  });
}

/**
 * Confirma un cambio propuesto. AQUÍ es donde se escribe de verdad.
 *
 * Invalida el resumen de configuración porque el cambio pudo ocurrir ahí: ver la nota
 * de la cabecera. También el registro de acciones, que acaba de ganar una fila.
 */
export function useConfirmarAccion() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string; summary: string }>(`/olobot/actions/${id}/confirm`, {}),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.adminOverview });
      void qc.invalidateQueries({ queryKey: K.acciones });
    },
  });
}

/** Descarta una propuesta. No invalida nada: por definición no cambió nada. */
export function useRechazarAccion() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string }>(`/olobot/actions/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.acciones }),
  });
}

// ── Niveles ─────────────────────────────────────────────────────────────────

/** Quién tiene bot y con qué nivel. Exige `olobot:admin`. */
export function useOlobotAcceso(activo = true) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.acceso,
    queryFn: () => api.get<AccesoLista>('/olobot/access'),
    enabled: activo,
    retry: false,
    staleTime: 60_000,
  });
}

export function usePonerNivel() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      level,
      note,
    }: {
      userId: string;
      level: OlobotNivel;
      note?: string | undefined;
    }) => api.put(`/olobot/access/${userId}`, { level, ...(note ? { note } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.acceso });
      // Y el estado propio: si te acabas de conceder... no, no puedes. Pero si otro
      // administrador cambia el tuyo mientras miras esta pantalla, se refleja.
      void qc.invalidateQueries({ queryKey: K.estado });
    },
  });
}

export function useQuitarNivel() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/olobot/access/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.acceso });
      void qc.invalidateQueries({ queryKey: K.estado });
    },
  });
}
