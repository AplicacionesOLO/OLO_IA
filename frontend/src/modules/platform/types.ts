/**
 * DOMINIO PLATAFORMA — tipos
 *
 * Gobierno por encima de los tenants. Platform Owners, catalogo de frameworks
 * y arquitecturas, permisos de alcance plataforma.
 *
 * La mayor parte de esto ya existe en lib/aiTypes.ts (Framework, Architecture).
 * Aqui se reexporta el contrato de plataforma y se añade lo que falta.
 */

// Reexportar los tipos de AI que son de plataforma
export type {
  Architecture,
  Framework,
} from '../../lib/aiTypes';

/** Un Platform Owner registrado. */
export interface PlatformOwner {
  id: string;
  user_id: string;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  reason: string | null;
}

/** Permiso del catalogo con su scope. */
export interface Permission {
  code: string;
  module: string;
  action: string;
  description: string;
  is_privileged: boolean;
  scope: 'platform' | 'tenant';
}
