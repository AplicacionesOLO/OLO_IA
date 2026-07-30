/**
 * ERROR STATES — cada error tiene un tratamiento visual distinto.
 *
 * No es un componente generico de "algo salio mal": el operador necesita saber
 * QUE fallo y QUE puede hacer al respecto.
 */

import { AlertTriangle, Lock, MapPinOff, SearchX, WifiOff } from 'lucide-react';
import { Panel } from '../../../../design/foundation/Panel';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';

export type SpatialErrorKind =
  | 'no-permission'
  | 'no-map'
  | 'empty'
  | 'no-results'
  | 'disconnected'
  | 'generic';

interface SpatialErrorProps {
  kind: SpatialErrorKind;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

const ERROR_CONFIG: Record<SpatialErrorKind, {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  color: string;
}> = {
  'no-permission': {
    icon: Lock,
    title: 'Sin acceso',
    description: 'No tienes permisos para ver las ubicaciones de este almacen. Contacta con tu administrador.',
    color: 'var(--state-alert)',
  },
  'no-map': {
    icon: MapPinOff,
    title: 'Almacen sin mapa',
    description: 'Este almacen no tiene una estructura espacial configurada todavia.',
    color: 'var(--text-faint)',
  },
  'empty': {
    icon: MapPinOff,
    title: 'Sin ubicaciones',
    description: 'No hay ubicaciones registradas en este nivel.',
    color: 'var(--text-faint)',
  },
  'no-results': {
    icon: SearchX,
    title: 'Sin resultados',
    description: 'La busqueda no encontro ubicaciones que coincidan con los criterios.',
    color: 'var(--text-faint)',
  },
  'disconnected': {
    icon: WifiOff,
    title: 'Sin conexion',
    description: 'No se puede conectar con el servidor. Verifica tu conexion de red.',
    color: 'var(--state-critical)',
  },
  'generic': {
    icon: AlertTriangle,
    title: 'Error',
    description: 'Ocurrio un error inesperado al cargar los datos.',
    color: 'var(--state-alert)',
  },
};

export function SpatialError({ kind, message, onRetry, className }: SpatialErrorProps) {
  const config = ERROR_CONFIG[kind];
  const Icon = config.icon;

  return (
    <Panel level="work" radius="xl" pad="lg" className={cn('text-center', className)}>
      <div className="mx-auto flex flex-col items-center gap-5 py-6">
        <div
          className="flex size-14 items-center justify-center rounded-[var(--radius-lg)] [background:var(--glass-2)]"
          style={{ boxShadow: `0 0 24px -8px ${config.color}` }}
        >
          <Icon strokeWidth={1.25} className="size-6" style={{ color: config.color }} />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-[length:var(--text-lg)] font-[var(--weight-light)] text-[var(--text-primary)]">
            {config.title}
          </h2>
          <p className="t-body mx-auto max-w-[42ch] text-[var(--text-secondary)]">
            {message ?? config.description}
          </p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    </Panel>
  );
}
