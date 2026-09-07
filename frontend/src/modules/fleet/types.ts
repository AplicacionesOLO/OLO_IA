/**
 * Tipos de dominio de la flota — camelCase, lo que consumen las pantallas.
 * El mapeo desde `dto.ts` vive en `ApiFleetRepository`.
 */

export type DeviceKind = 'phone' | 'drone' | 'onboard_compute';
export type DeviceStatus = 'connected' | 'live' | 'offline' | 'out_of_service';

export interface FleetDevice {
  id: string;
  warehouseId: string;
  deviceKey: string;
  kind: DeviceKind;
  name: string;
  appVersion: string | null;
  deviceModel: string | null;
  registeredAt: string;
  lastSeenAt: string;
  currentJobId: string | null;
  status: DeviceStatus;
  retiredAt: string | null;
  retiredReason: string | null;
}

export interface FleetDeviceList {
  devices: FleetDevice[];
  online: number;
}
