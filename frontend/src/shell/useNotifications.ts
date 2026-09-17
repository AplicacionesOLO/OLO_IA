/**
 * Avisos (0104): la campana del shell.
 *
 * Sondeo cada 30s, siempre — a diferencia de `useTrainingRuns`/percepción, aquí no
 * hay un "terminó, deja de sondear": la bandeja de avisos está viva mientras la
 * sesión lo está, igual que el correo.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../auth/AuthProvider';
import type { NotificationList } from '../lib/notificationTypes';

const K = {
  notifications: ['notifications'] as const,
};

export function useNotifications() {
  const { api } = useAuth();
  return useQuery({
    queryKey: K.notifications,
    queryFn: () => api.get<NotificationList>('/notifications', { limit: 30 }),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ marked: number }>('/notifications/read-all'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.notifications }),
  });
}

export function useDismissNotification() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.notifications }),
  });
}
