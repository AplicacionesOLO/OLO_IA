/**
 * CONTRATO DEL REPOSITORIO DE FLOTA.
 *
 *   GET  /v1/fleet/devices                        listar (con su estado)
 *   POST /v1/fleet/devices/heartbeat              el extremo del DISPOSITIVO
 *   POST /v1/fleet/devices/{id}/retire             marcar fuera de uso
 *   POST /v1/fleet/devices/{id}/reactivate         reactivar
 *   POST /v1/fleet/devices/provision               dar de alta CON credencial propia
 *
 * `heartbeat` vive en el contrato aunque ninguna pantalla de este frontend lo
 * llame nunca: lo manda el propio dispositivo de borde (el S21 de la Fase 1
 * del ADR-015), no un navegador. Se documenta aqui de todos modos porque es
 * parte del contrato real de este modulo, igual que `ingest_detections` en
 * `perception/repository.ts` es "el extremo del worker" y no de la pantalla.
 */

import type { DeviceKind, FleetDevice, FleetDeviceList, FleetDeviceProvisioned } from './types';

export interface FleetRepository {
  listDevices(warehouseId?: string): Promise<FleetDeviceList>;
  retireDevice(deviceId: string, reason?: string): Promise<FleetDevice>;
  reactivateDevice(deviceId: string): Promise<FleetDevice>;
  /**
   * Da de alta un dispositivo con IDENTIDAD PROPIA -- distinto de que el
   * propio dispositivo llame a `heartbeat` con un `device_key` que el
   * genero: aqui el backend crea todo, incluida la credencial, y la
   * devuelve UNA sola vez (`refreshToken`).
   */
  provisionDevice(input: {
    warehouseId: string;
    kind: DeviceKind;
    name: string;
  }): Promise<FleetDeviceProvisioned>;
  /** Para el selector del formulario de alta -- mismo endpoint y forma que
   * `PerceptionRepository.listWarehouses`, repetido aqui para no acoplar
   * este modulo al de percepcion solo por esto. */
  listWarehouses(): Promise<{ id: string; code: string; name: string }[]>;
}
