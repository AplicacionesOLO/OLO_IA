/**
 * Configuracion de entorno, validada al arrancar.
 *
 * Se valida aqui y no en el punto de uso para que un despliegue mal configurado
 * falle de inmediato con un mensaje claro, en lugar de producir un error
 * incomprensible tres pantallas mas adelante.
 */

import { VisualLayer, type VisualLayerValue } from '../design/capability/types';

export type AuthMode = 'mock' | 'supabase';

export interface AppEnv {
  apiUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  authMode: AuthMode;
  visualLayer: VisualLayerValue;
  motionDebug: boolean;
  isProduction: boolean;
  /**
   * La interfaz esta mostrando datos de demostracion, no datos reales.
   *
   * Se deriva de `authMode === 'mock'`: sin backend no hay dato real posible.
   * Existe como bandera explicita para que la interfaz pueda DECIRLO en pantalla.
   * Un dashboard con cifras inventadas y sin aviso es peor que un hueco, porque
   * nadie sabe si lo que ve es real.
   */
  demoData: boolean;
}

function parseLayer(raw: string | undefined): VisualLayerValue {
  const n = Number(raw ?? '1');
  const valid = Object.values(VisualLayer) as number[];
  return valid.includes(n) ? (n as VisualLayerValue) : VisualLayer.SVG;
}

export function readEnv(): AppEnv {
  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') || null;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || null;
  const isProduction = import.meta.env.PROD;

  // Modo explicito, o inferido: si hay credenciales de Supabase se usa
  // Supabase; si no, mock. Asi el proyecto arranca sin configuracion.
  const explicit = import.meta.env.VITE_AUTH_MODE as AuthMode | undefined;
  const authMode: AuthMode =
    explicit === 'mock' || explicit === 'supabase'
      ? explicit
      : supabaseUrl && supabaseAnonKey
        ? 'supabase'
        : 'mock';

  // ── Barrera de seguridad ────────────────────────────────────────────────
  // El modo mock acepta cualquier credencial. En produccion seria un agujero
  // total, asi que el arranque falla en lugar de degradar en silencio.
  if (isProduction && authMode === 'mock') {
    throw new Error(
      '[OLO] Configuracion invalida: VITE_AUTH_MODE=mock en produccion. ' +
        'El modo mock acepta cualquier credencial. Configura VITE_SUPABASE_URL y ' +
        'VITE_SUPABASE_ANON_KEY.',
    );
  }

  if (authMode === 'supabase' && !(supabaseUrl && supabaseAnonKey)) {
    throw new Error(
      '[OLO] VITE_AUTH_MODE=supabase requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    );
  }

  return {
    apiUrl,
    supabaseUrl,
    supabaseAnonKey,
    authMode,
    visualLayer: parseLayer(import.meta.env.VITE_VISUAL_LAYER),
    motionDebug: import.meta.env.VITE_MOTION_DEBUG === 'true',
    isProduction,
    demoData: authMode === 'mock',
  };
}

export const env: AppEnv = readEnv();
