/**
 * WORKSPACE PROFILES — arquitectura para perfiles de operador.
 *
 * Cada perfil define que paneles son visibles, que layout usa, que vista
 * inicial tiene y que acciones estan disponibles. La logica de permisos
 * NO se implementa aqui: cuando el backend la entregue, se lee el perfil
 * del usuario y se aplica.
 *
 * Hoy todos los usuarios usan el perfil 'operator' por defecto.
 */

import type { SpatialViewMode } from '../components/SpatialToolbar';

export type WorkspaceProfileId = 'operator' | 'supervisor' | 'inventory' | 'auditor';

export interface WorkspaceProfile {
  id: WorkspaceProfileId;
  label: string;
  description: string;
  /** Paneles visibles por defecto. */
  panels: {
    tree: boolean;
    inspector: boolean;
    timeline: boolean;
  };
  /** Vista inicial. */
  defaultView: SpatialViewMode;
  /** Ancho inicial de los paneles. */
  panelWidths: { left: number; right: number };
}

export const WORKSPACE_PROFILES: Record<WorkspaceProfileId, WorkspaceProfile> = {
  operator: {
    id: 'operator',
    label: 'Operador',
    description: 'Vista completa con todas las herramientas',
    panels: { tree: true, inspector: true, timeline: true },
    defaultView: 'canvas',
    panelWidths: { left: 280, right: 320 },
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisor',
    description: 'Vista amplia con canvas dominante',
    panels: { tree: false, inspector: true, timeline: true },
    defaultView: 'canvas',
    panelWidths: { left: 240, right: 360 },
  },
  inventory: {
    id: 'inventory',
    label: 'Inventario',
    description: 'Vista de lista para conteos y verificacion',
    panels: { tree: true, inspector: true, timeline: true },
    defaultView: 'grid',
    panelWidths: { left: 320, right: 280 },
  },
  auditor: {
    id: 'auditor',
    label: 'Auditor',
    description: 'Vista de lectura con foco en historial',
    panels: { tree: true, inspector: true, timeline: true },
    defaultView: 'canvas',
    panelWidths: { left: 260, right: 380 },
  },
};
