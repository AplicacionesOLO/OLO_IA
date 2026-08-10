/**
 * Acceso al registro de auditoría.
 *
 * ── SIN MUTACIONES, Y NO ES UN OLVIDO ────────────────────────────────────────
 *
 * No hay `useMutation` en este archivo porque no hay nada que mutar: `olo_app` no tiene
 * privilegio de INSERT sobre `audit.entries`. Un hook de escritura fallaría en el motor.
 *
 * ── NO SE CACHEA COMO EL INVENTARIO ──────────────────────────────────────────
 *
 * El inventario es una foto importada que no cambia hasta el siguiente import, así que
 * allí `staleTime` es de cinco minutos. Esto es lo contrario: crece con cada escritura
 * que hace cualquiera, y quien lo mira lo mira justamente para ver si acaba de pasar
 * algo. Con cinco minutos de caché, alguien concede un permiso, va al registro y no lo
 * ve — y concluye que no se registró.
 */

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import type { AuditEntry, AuditLog } from './types';

const K = {
  registro: (f: string) => ['audit', 'log', f] as const,
  historia: (s: string, t: string, r: string) => ['audit', 'history', s, t, r] as const,
};

export interface FiltroAuditoria {
  tabla?: string | null;
  operacion?: string | null;
  actor?: string | null;
  pagina?: number;
  porPagina?: number;
  /** Incluir las escrituras de la suite de tests. Fuera por defecto. */
  pruebas?: boolean;
}

export function useRegistro(filtro: FiltroAuditoria = {}) {
  const { api } = useAuth();
  const q = new URLSearchParams({
    page: String(filtro.pagina ?? 1),
    page_size: String(filtro.porPagina ?? 50),
  });
  if (filtro.tabla) q.set('table', filtro.tabla);
  if (filtro.operacion) q.set('operation', filtro.operacion);
  if (filtro.actor) q.set('actor', filtro.actor);
  if (filtro.pruebas) q.set('include_tests', 'true');
  const cadena = q.toString();

  return useQuery({
    queryKey: K.registro(cadena),
    retry: false,
    // Lo contrario que en inventario: aquí se viene a ver si acaba de pasar algo.
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Deja la página anterior en pantalla mientras llega la siguiente, para que la
    // tabla no se vacíe en cada salto.
    placeholderData: (previa) => previa,
    queryFn: () => api.get<AuditLog>(`/audit/log?${cadena}`),
  });
}

/**
 * Todo lo que le ha pasado a una fila, de lo más antiguo a lo más nuevo.
 *
 * Funciona con filas ya BORRADAS —el registro sobrevive a lo que registra— y devuelve
 * lista vacía, no error, cuando no hay historia: la fila puede ser anterior al registro
 * o de una tabla que no se audita.
 */
export function useHistoriaDeFila(
  schema: string | null,
  tabla: string | null,
  rowId: string | null,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.historia(schema ?? '', tabla ?? '', rowId ?? ''),
    retry: false,
    enabled: Boolean(schema && tabla && rowId),
    queryFn: () =>
      api.get<AuditEntry[]>(`/audit/history/${schema}/${tabla}/${rowId}`),
  });
}
