/**
 * INCIDENCIAS — un descuadre con nombre, dueño y estado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CERRAR UNA INCIDENCIA NO CORRIGE EL INVENTARIO
 *
 * Registra que una PERSONA fue al pasillo y decidió algo. El stock sigue siendo lo que
 * diga el WMS, que es el sistema de origen. Si el hueco estaba vacío, quien tiene que
 * corregirse es el WMS: esto recuerda que se comprobó, no sustituye la corrección.
 *
 * Es la distinción que evita que alguien cierre veinte incidencias creyendo que con eso
 * arregló el inventario.
 */

export type IncidentStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';

/** De dónde nace. Los tres comparten bandeja porque el trabajo es el mismo. */
export type IncidentKind = 'wms_mismatch' | 'reconciliation' | 'manual';

export interface Incident {
  id: string;
  warehouse_id: string;
  location_id: string | null;
  location_code: string | null;
  kind: IncidentKind | string;
  subkind: string | null;
  status: IncidentStatus;
  title: string;
  details: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Días que lleva —o llevó— abierta. Es lo que ordena el trabajo. */
  dias_abierta: number;
  assigned_to: string | null;
  assigned_to_name: string | null;
  opened_by_name: string | null;
  resolved_by_name: string | null;
  source_snapshot_id: string | null;
  /**
   * Cuándo se sacó del WMS la foto de la que salió esta incidencia.
   *
   * Importa más de lo que parece: una incidencia abierta desde un import de hace tres
   * semanas puede estar resuelta desde el día siguiente sin que nadie hiciera nada.
   */
  snapshot_taken_at: string | null;
}

export interface IncidentTray {
  items: Incident[];
  /** Por estado y sobre el TOTAL, no sobre lo listado. */
  counts: Record<string, number>;
  /** `open` + `in_progress`: lo pendiente. */
  open_total: number;
  truncated: boolean;
}

export interface IncidentEvent {
  id: number;
  from_status: string | null;
  to_status: string;
  note: string | null;
  occurred_at: string;
  actor_name: string | null;
}

/** Cómo se llama cada estado, y qué significa para quien lo lee. */
export const ESTADO_INFO: Record<IncidentStatus, { etiqueta: string; explica: string }> = {
  open: { etiqueta: 'Abierta', explica: 'Nadie la ha cogido todavía.' },
  in_progress: { etiqueta: 'En curso', explica: 'Alguien está comprobándola.' },
  resolved: { etiqueta: 'Resuelta', explica: 'Se comprobó y se hizo algo.' },
  dismissed: {
    etiqueta: 'Descartada',
    explica: 'Se miró y no había nada que hacer: no es lo mismo que resuelta.',
  },
};

/**
 * A qué estados se puede ir desde cada uno. Es el MISMO mapa que el servicio.
 *
 * Se repite aquí para no ofrecer un botón que va a recibir un 422 —el motor sigue
 * siendo la autoridad—, y en particular para que no exista el gesto de pasar de
 * «resuelta» a «en curso»: una incidencia cerrada que reaparece se REABRE, y esa
 * reapertura tiene que verse en el historial.
 */
export const TRANSICIONES: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['in_progress', 'resolved', 'dismissed'],
  in_progress: ['open', 'resolved', 'dismissed'],
  resolved: ['open'],
  dismissed: ['open'],
};

/** Los cierres exigen explicación. Lo pide el servicio y el CHECK del motor. */
export const CIERRAN: IncidentStatus[] = ['resolved', 'dismissed'];
