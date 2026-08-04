/**
 * ESTADOS DE ERROR Y DE AUSENCIA DE DATOS
 *
 * Cada situacion tiene un tratamiento distinto porque el operador necesita saber
 * QUE fallo y QUE puede hacer. «Algo salio mal» no es ninguna de las dos cosas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS FAMILIAS QUE NO SE MEZCLAN
 *
 *   ERRORES     — algo fallo. Puede tener sentido reintentar.
 *   AUSENCIAS   — nada fallo: el dato no existe todavia, y eso es correcto.
 *
 * Confundirlas produce las dos peores pantallas posibles: un «error» rojo cuando
 * simplemente no se ha configurado el plano, y un «no hay datos» tranquilizador
 * cuando en realidad el token expiro.
 *
 * Por eso `classifyError()` es una funcion aparte y `reintentable` es un campo
 * del catalogo, no una decision del que renderiza.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  AlertTriangle,
  Boxes,
  Clock,
  FileWarning,
  Lock,
  LogIn,
  Map as MapIcon,
  MapPinOff,
  Ruler,
  SearchX,
  WifiOff,
} from 'lucide-react';

import { Panel } from '../../../../design/foundation/Panel';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../../lib/apiErrors';
import { SpatialContractError } from '../../repositories/mappers';

export type SpatialErrorKind =
  // ── Errores ───────────────────────────────────────────────────────────────
  | 'session'
  | 'no-permission'
  | 'not-found'
  | 'timeout'
  | 'disconnected'
  | 'contract'
  | 'generic'
  // ── Ausencias ─────────────────────────────────────────────────────────────
  | 'empty'
  | 'no-results'
  | 'no-catalog'
  | 'no-layout'
  | 'no-geometry'
  | 'no-occupancy';

interface Config {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  color: string;
  /** Si ofrecer «Reintentar». Un 403 no mejora al segundo intento. */
  reintentable: boolean;
}

const CONFIG: Record<SpatialErrorKind, Config> = {
  // ── Errores ───────────────────────────────────────────────────────────────
  session: {
    icon: LogIn,
    title: 'Sesion expirada',
    description: 'Tu sesion ya no es valida. Vuelve a iniciar sesion para continuar.',
    color: 'var(--state-alert)',
    reintentable: false,
  },
  'no-permission': {
    icon: Lock,
    title: 'Sin acceso',
    description:
      'No tienes permiso para ver esta informacion. Contacta con el administrador de tu organizacion.',
    color: 'var(--state-alert)',
    reintentable: false,
  },
  'not-found': {
    icon: MapPinOff,
    title: 'No encontrado',
    description:
      'El almacen o la ubicacion no existe, o no esta disponible para tu usuario.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  timeout: {
    icon: Clock,
    title: 'La consulta tardo demasiado',
    description:
      'El servidor no respondio en el tiempo esperado. Puede ser una consulta pesada o una red lenta.',
    color: 'var(--state-alert)',
    reintentable: true,
  },
  disconnected: {
    icon: WifiOff,
    title: 'Sin conexion',
    description: 'No se puede contactar con el servidor. Verifica tu conexion de red.',
    color: 'var(--state-critical)',
    reintentable: true,
  },
  contract: {
    icon: FileWarning,
    title: 'Version incompatible',
    description:
      'El servidor devolvio datos que esta version de la interfaz no reconoce. ' +
      'Recarga la pagina; si persiste, hay un desajuste de versiones que debe revisar el equipo.',
    color: 'var(--state-critical)',
    // Reintentar devolveria exactamente el mismo dato: es un desajuste de
    // despliegue, no un fallo transitorio.
    reintentable: false,
  },
  generic: {
    icon: AlertTriangle,
    title: 'Error inesperado',
    description: 'Ocurrio un error al cargar los datos.',
    color: 'var(--state-alert)',
    reintentable: true,
  },

  // ── Ausencias ─────────────────────────────────────────────────────────────
  empty: {
    icon: MapPinOff,
    title: 'Sin ubicaciones',
    description: 'No hay ubicaciones registradas en este nivel.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  'no-results': {
    icon: SearchX,
    title: 'Sin resultados',
    description:
      'La busqueda no encontro coincidencias. Los codigos se buscan por PREFIJO: ' +
      '«MZ01» encuentra, «Z01» no.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  'no-catalog': {
    icon: Boxes,
    title: 'Almacen sin catalogo',
    description:
      'Este almacen existe, pero su catalogo espacial no se ha importado todavia.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  'no-layout': {
    icon: MapIcon,
    title: 'Sin plano visual',
    description: 'No se ha configurado el plano visual de este almacen.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  'no-geometry': {
    icon: Ruler,
    title: 'Sin levantamiento metrico',
    description:
      'El catalogo esta disponible, pero el levantamiento metrico aun no existe.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
  'no-occupancy': {
    icon: Boxes,
    title: 'Sin ocupacion en tiempo real',
    description:
      'La ocupacion que hay sale de la ultima foto del WMS, con su fecha. Seguirla ' +
      'en vivo necesita los movimientos a medida que ocurren, y eso aun no existe.',
    color: 'var(--text-faint)',
    reintentable: false,
  },
};

/**
 * Traduce un error cualquiera a su tratamiento.
 *
 * El orden importa: `SpatialContractError` se comprueba ANTES que `ApiError`
 * porque un contrato invalido puede llegar en una respuesta HTTP 200 —el
 * servidor respondio bien, lo que no encaja es el cuerpo— y caeria en `generic`,
 * que ofrece reintentar algo que nunca va a cambiar.
 */
export function classifyError(error: unknown): SpatialErrorKind {
  if (error instanceof SpatialContractError) return 'contract';

  if (error instanceof ApiError) {
    // NETWORK_ERROR llega con status 0: es el `fetch` que no salio.
    if (error.code === 'NETWORK_ERROR' || error.status === 0) return 'disconnected';
    if (error.status === 401) return 'session';
    // 403 cubre tanto FORBIDDEN como NO_ACTIVE_MEMBERSHIP y
    // WAREHOUSE_NOT_ACCESSIBLE. El mensaje del backend los distingue.
    if (error.status === 403) return 'no-permission';
    if (error.status === 404) return 'not-found';
    if (error.status === 408 || error.status === 504) return 'timeout';
    // Un `statement_timeout` del motor llega como 500 DATABASE_ERROR. Se trata
    // como timeout y no como error generico porque reintentar SI puede funcionar
    // y el mensaje orienta mejor. Es exactamente el fallo que tuvo el endpoint de
    // almacenes antes de la migracion 0060.
    if (error.status >= 500 && error.code === 'DATABASE_ERROR') return 'timeout';
    return 'generic';
  }

  // `AbortError` no es un error del que informar: es una cancelacion deliberada.
  // React Query no lo propaga como error, asi que llegar aqui seria un caso raro.
  if (error instanceof DOMException && error.name === 'AbortError') return 'generic';

  return 'generic';
}

/** El mensaje concreto del backend, si lo hay, mejor que el genérico del catalogo. */
function detalle(error: unknown, kind: SpatialErrorKind): string | undefined {
  if (error instanceof SpatialContractError) return error.message;
  if (error instanceof ApiError && kind !== 'generic') {
    const m = humanMessage(error);
    return m || undefined;
  }
  return undefined;
}

interface SpatialErrorProps {
  kind: SpatialErrorKind;
  /** Sobrescribe la descripcion del catalogo. */
  message?: string | undefined;
  /** Solo se muestra si la clase de error lo admite. */
  onRetry?: (() => void) | undefined;
  /** Para soporte: el backend lo devuelve en el cuerpo del error. */
  requestId?: string | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

export function SpatialError({
  kind,
  message,
  onRetry,
  requestId,
  compact = false,
  className,
}: SpatialErrorProps) {
  const config = CONFIG[kind];
  const Icon = config.icon;
  const mostrarRetry = Boolean(onRetry) && config.reintentable;

  if (compact) {
    return (
      <div
        className={cn('flex items-start gap-3 px-3 py-4', className)}
        role={config.reintentable ? 'alert' : 'status'}
      >
        <Icon strokeWidth={1.5} className="mt-0.5 size-4 shrink-0" style={{ color: config.color }} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[length:var(--text-xs)] text-[var(--text-primary)]">
            {config.title}
          </span>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {message ?? config.description}
          </span>
          {mostrarRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="self-start text-[length:var(--text-xs)] text-[var(--accent)] underline underline-offset-2"
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Panel level="work" radius="xl" pad="lg" className={cn('text-center', className)}>
      <div
        className="mx-auto flex flex-col items-center gap-5 py-6"
        role={config.reintentable ? 'alert' : 'status'}
      >
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
          <p className="t-body mx-auto max-w-[46ch] text-[var(--text-secondary)]">
            {message ?? config.description}
          </p>
        </div>
        {mostrarRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        )}
        {requestId && (
          <span className="t-mono-xs text-[var(--text-faint)]">
            Referencia para soporte: {requestId}
          </span>
        )}
      </div>
    </Panel>
  );
}

/**
 * Renderiza el error de una query, ya clasificado.
 *
 * Envuelve el trio classify → detalle → requestId para que ningun componente
 * tenga que acordarse de los tres.
 */
export function QueryError({
  error,
  onRetry,
  compact,
  className,
}: {
  error: unknown;
  onRetry?: (() => void) | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const kind = classifyError(error);
  return (
    <SpatialError
      kind={kind}
      message={detalle(error, kind)}
      onRetry={onRetry}
      requestId={error instanceof ApiError ? error.requestId : undefined}
      compact={compact ?? false}
      className={className}
    />
  );
}
