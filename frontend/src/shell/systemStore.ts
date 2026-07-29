/**
 * ESTADO GLOBAL DEL SISTEMA
 *
 * Los tres estados cognitivos del ADN, mas offline. Cuando cambia, TODA la
 * aplicacion cambia de ritmo: el reloj ambiental acelera y el operador percibe
 * la urgencia corporalmente, antes de leer nada.
 *
 * En Capa 1 se alimenta de la conectividad del navegador y de eventos
 * simulados. Cuando exista Supabase Realtime, se alimentara de eventos reales
 * sin que ningun consumidor cambie.
 */

import { create } from 'zustand';
import type { SystemState } from '../design/tokens/tokens';

export interface StreamEvent {
  id: string;
  at: Date;
  /** Determina el icono y el color. */
  kind: 'detection' | 'anomaly' | 'sync' | 'mission' | 'system';
  severity: 'info' | 'alert' | 'critical';
  message: string;
  entity?: { type: string; id: string };
}

export interface SystemVitals {
  edgeNodesOnline: number;
  edgeNodesTotal: number;
  inferencesPerSecond: number;
  twinSynced: boolean;
  twinLatencyMs: number;
  gpuUtilization: number;
}

interface SystemStoreState {
  state: SystemState;
  vitals: SystemVitals;
  events: StreamEvent[];
  /** Numero de alertas abiertas. Alimenta el badge del Spine. */
  openIncidents: number;
  syncErrors: number;

  setState: (s: SystemState) => void;
  pushEvent: (e: Omit<StreamEvent, 'id' | 'at'>) => void;
  setVitals: (v: Partial<SystemVitals>) => void;
  setCounters: (c: { openIncidents?: number; syncErrors?: number }) => void;
}

/** Buffer acotado: sin limite, una sesion de 8 horas acumularia decenas de miles. */
const MAX_EVENTS = 60;

export const useSystemStore = create<SystemStoreState>((set) => ({
  // Estado inicial honesto: hasta que haya datos reales, el sistema no puede
  // afirmar que todo esta nominal. `idle` es "atento", no "verificado".
  state: 'idle',
  vitals: {
    edgeNodesOnline: 0,
    edgeNodesTotal: 0,
    inferencesPerSecond: 0,
    twinSynced: false,
    twinLatencyMs: 0,
    gpuUtilization: 0,
  },
  events: [],
  openIncidents: 0,
  syncErrors: 0,

  setState: (state) => set({ state }),

  pushEvent: (e) =>
    set((prev) => ({
      events: [
        { ...e, id: crypto.randomUUID(), at: new Date() },
        ...prev.events,
      ].slice(0, MAX_EVENTS),
    })),

  setVitals: (v) => set((prev) => ({ vitals: { ...prev.vitals, ...v } })),

  setCounters: (c) =>
    set((prev) => ({
      openIncidents: c.openIncidents ?? prev.openIncidents,
      syncErrors: c.syncErrors ?? prev.syncErrors,
    })),
}));
