/**
 * HOOKS DE REACT QUERY — Flota.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFleetRepo } from './FleetProvider';

const K = {
  devices: ['fleet', 'devices'] as const,
};

/**
 * La flota, sondeando cada 2 s por defecto -- mismo intervalo que el resto
 * de la app (ver `usePerceptionJob`/`useDetections`). `vivo=false` la
 * congela, para cuando la pantalla no esta en primer plano.
 *
 * A diferencia de un job de percepcion, la flota NUNCA "termina": siempre
 * puede haber un dispositivo que se conecte o se desconecte, asi que aqui no
 * hay una condicion de "parar de sondear" como `status !== 'running'`.
 */
export function useFleetDevices(vivo = true, warehouseId?: string) {
  const repo = useFleetRepo();
  return useQuery({
    queryKey: [...K.devices, warehouseId ?? ''],
    queryFn: () => repo.listDevices(warehouseId),
    refetchInterval: vivo ? 2000 : false,
  });
}

export function useRetireDevice() {
  const repo = useFleetRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, reason }: { deviceId: string; reason?: string }) =>
      repo.retireDevice(deviceId, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.devices }),
  });
}

export function useReactivateDevice() {
  const repo = useFleetRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => repo.reactivateDevice(deviceId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.devices }),
  });
}
