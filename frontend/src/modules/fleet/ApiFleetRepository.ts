/**
 * Implementación real del repositorio de flota — ver `repository.ts`.
 */

import type { ApiClient } from '../../lib/apiClient';
import type { DeviceDto, DeviceListDto } from './dto';
import type { FleetRepository } from './repository';
import type { FleetDevice, FleetDeviceList } from './types';

// SIN "/v1": `ApiClient.baseUrl` ya lo lleva incluido (ver AuthProvider.tsx,
// `baseUrl: ${env.apiUrl}/v1`) -- mismo criterio que `/perception` en
// `ApiPerceptionRepository.ts`. Ponerlo aqui tambien pedia "/v1/v1/fleet/..."
// y el backend respondia 404, porque esa ruta no existe.
const BASE = '/fleet';

function aDispositivo(d: DeviceDto): FleetDevice {
  return {
    id: d.id,
    warehouseId: d.warehouse_id,
    deviceKey: d.device_key,
    kind: d.kind,
    name: d.name,
    appVersion: d.app_version,
    deviceModel: d.device_model,
    registeredAt: d.registered_at,
    lastSeenAt: d.last_seen_at,
    currentJobId: d.current_job_id,
    status: d.status,
    retiredAt: d.retired_at,
    retiredReason: d.retired_reason,
  };
}

export class ApiFleetRepository implements FleetRepository {
  constructor(private readonly api: ApiClient) {}

  async listDevices(warehouseId?: string): Promise<FleetDeviceList> {
    const d = await this.api.get<DeviceListDto>(`${BASE}/devices`, {
      ...(warehouseId ? { warehouse_id: warehouseId } : {}),
    });
    return { devices: (d.devices ?? []).map(aDispositivo), online: d.online };
  }

  async retireDevice(deviceId: string, reason?: string): Promise<FleetDevice> {
    const d = await this.api.post<DeviceDto>(`${BASE}/devices/${deviceId}/retire`, {
      ...(reason ? { reason } : {}),
    });
    return aDispositivo(d);
  }

  async reactivateDevice(deviceId: string): Promise<FleetDevice> {
    const d = await this.api.post<DeviceDto>(`${BASE}/devices/${deviceId}/reactivate`);
    return aDispositivo(d);
  }
}
