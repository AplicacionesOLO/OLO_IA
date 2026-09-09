/**
 * DTOs de la flota de dispositivos de borde — la forma EXACTA que devuelve la API.
 *
 * Snake_case, sin traducir. El mapeo a los tipos del módulo vive en el
 * repositorio, en un solo sitio — mismo criterio que `modules/perception/dto.ts`.
 *
 * Corresponde a `backend/src/olo/api/v1/fleet_schemas.py` (0110).
 */

export type DeviceKind = 'phone' | 'drone' | 'onboard_compute';
export type DeviceStatus = 'connected' | 'live' | 'offline' | 'out_of_service';

export interface DeviceDto {
  id: string;
  warehouse_id: string;
  device_key: string;
  kind: DeviceKind;
  name: string;
  app_version: string | null;
  device_model: string | null;
  registered_at: string;
  last_seen_at: string;
  current_job_id: string | null;
  status: DeviceStatus;
  retired_at: string | null;
  retired_reason: string | null;
}

export interface DeviceListDto {
  devices: DeviceDto[];
  online: number;
}

export interface DeviceProvisionDto {
  device: DeviceDto;
  refresh_token: string;
}
