/**
 * LANDING PAGE DE MODULO
 *
 * Reemplaza al viejo `PlaceholderPage` generico. Cada modulo tiene contenido
 * propio: que hara, que capacidades trae, en que version llega, y que estado
 * tiene. Nunca mas "pendiente de implementacion" sin contexto.
 *
 * La pagina es un CONTRATO VISUAL: comunica al usuario (y al equipo) que se
 * esta construyendo, sin parecer una aplicacion rota.
 */

import { Check, Clock, Construction, FlaskConical, Lock, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Panel } from '../design/foundation/Panel';
import { PanelHeader } from '../design/foundation/PanelHeader';
import { Badge } from '../design/primitives/Badge';
import { CanvasHost } from '../shell/CanvasHost';
import {
  MODULE_STATUS_META,
  NAV_ITEMS,
  type ModuleStatus,
} from '../shell/navigation';

// ── Contenido por modulo ────────────────────────────────────────────────────

export interface ModuleCapability {
  label: string;
  ready: boolean;
  /**
   * DONDE ESTA YA, cuando la capacidad existe pero vive en otro modulo.
   *
   * Hace falta porque una landing que promete lo que el producto YA HACE es peor que una
   * vacia: ensena que la aplicacion puede menos de lo que puede, y —lo caro— invita a
   * construir una segunda copia de algo que ya funciona. El Digital Twin listaba seis
   * capacidades y cuatro estaban hechas en Spatial.
   */
  en?: { texto: string; ruta: string };
}

export interface ModuleLandingContent {
  /** Titulo grande de la landing. */
  headline: string;
  /** Descripcion de 1-3 lineas. */
  description: string;
  /** Capacidades que tendra el modulo. */
  capabilities: ModuleCapability[];
  /** Nota adicional. */
  note?: string;
}

/**
 * Registro de contenido por `navId`.
 *
 * ⚠ SOLO los modulos que NO existen todavia. El router manda aqui unicamente los
 * `planned`, `higher-layer` y `future`; los `available` y `beta` van a su pagina real.
 *
 * Habia cinco entradas mas —inventario, incidencias, vision, configuracion y auditoria—
 * inalcanzables desde que esos modulos se construyeron, y describian como PENDIENTE lo que
 * ya funcionaba: «Deteccion de objetos sobre video: no», con Vision detectando objetos
 * sobre video desde hace semanas. Nadie las veia, pero cualquiera que leyera este archivo
 * sacaba la conclusion contraria a la verdad.
 */
export const MODULE_CONTENT: Record<string, ModuleLandingContent> = {
  analytics: {
    headline: 'Analytics y Reportes',
    description:
      'Metricas operativas en tiempo real. Precision de inventario, throughput, ' +
      'tiempos de ciclo, ocupacion por zona y tendencias historicas.',
    capabilities: [
      { label: 'Dashboard de KPIs operativos', ready: false },
      { label: 'Precision de inventario (%) en el tiempo', ready: false },
      { label: 'Throughput de movimientos', ready: false },
      { label: 'Mapa de calor de ocupacion', ready: false },
      { label: 'Reportes exportables', ready: false },
      { label: 'Alertas configurables por umbral', ready: false },
    ],
  },
  twin: {
    headline: 'Digital Twin 3D',
    description:
      'La mayor parte de lo que este modulo prometia YA FUNCIONA, y esta en Spatial. ' +
      'Lo que queda por hacer es poco, y es lo que de verdad lo distinguiria: ver la ' +
      'flota moverse en vivo y entrar dentro del almacen.',
    capabilities: [
      {
        label: 'Modelo 3D del almacen',
        ready: true,
        en: { texto: 'Spatial · plano 3D y alzado por rack', ruta: '/spatial' },
      },
      {
        label: 'Ocupacion por ubicacion',
        ready: true,
        en: { texto: 'Spatial · capa Ocupacion, e Inventario', ruta: '/spatial' },
      },
      {
        label: 'Navegacion espacial interactiva',
        ready: true,
        en: { texto: 'Spatial · arbol, alzado y seleccion', ruta: '/spatial' },
      },
      {
        label: 'Layers de informacion configurables',
        ready: true,
        en: {
          texto: 'Spatial · Estado espacial, Situacion WMS e Inspeccion',
          ruta: '/spatial',
        },
      },
      {
        //  Existe en DIFERIDO: las rutas salen de las observaciones de un recorrido y se
        //  reproducen sobre el plano. No es lo mismo que verlo moverse ahora, y por eso
        //  esta linea y la siguiente son dos, no una.
        label: 'Recorrido del dron sobre el plano, reproducible',
        ready: true,
        en: { texto: 'Spatial · vista de plano, reproductor de rutas', ruta: '/spatial' },
      },
      { label: 'Posicion de AGVs y drones EN VIVO', ready: false },
      { label: 'Modo inmersivo (WebXR)', ready: false },
    ],
    note:
      'Lo que este modulo aportaria no es otra copia del visor: es la CAPA que junta lo ' +
      'observado con la flota en movimiento. Mientras eso no exista, todo lo de arriba se ' +
      'usa desde Spatial — y duplicarlo aqui seria mantener dos visores 3D con el mismo ' +
      'trabajo hecho dos veces.',
  },
  fleet: {
    headline: 'Gestion de Flota',
    description:
      'Control y monitoreo de drones autonomos y AGVs. Programacion de misiones, ' +
      'rutas optimizadas y estado de la flota en tiempo real.',
    capabilities: [
      { label: 'Inventario de dispositivos', ready: false },
      { label: 'Estado en tiempo real', ready: false },
      { label: 'Programacion de misiones', ready: false },
      { label: 'Rutas optimizadas por IA', ready: false },
      { label: 'Telemetria y logs de vuelo', ready: false },
      { label: 'Mantenimiento predictivo', ready: false },
    ],
  },
  vitals: {
    headline: 'Salud del Sistema',
    description:
      'Monitoreo en tiempo real de la plataforma. Latencia, disponibilidad de ' +
      'nodos edge, uso de GPU, estado de las integraciones y alertas operativas.',
    capabilities: [
      { label: 'Estado de servicios', ready: false },
      { label: 'Nodos edge online/offline', ready: false },
      { label: 'Latencia del Digital Twin', ready: false },
      { label: 'Uso de GPU para inferencia', ready: false },
      { label: 'Cola de entrenamiento', ready: false },
      { label: 'Alertas de degradacion', ready: false },
    ],
  },
  integration: {
    headline: 'Integraciones',
    description:
      'Conectores con sistemas externos: WMS, ERP, camaras IP, SCADA y APIs de ' +
      'terceros. Sincronizacion bidireccional con mapeo de campos configurable.',
    capabilities: [
      { label: 'Conector WMS generico', ready: false },
      { label: 'Sincronizacion bidireccional', ready: false },
      { label: 'Mapeo de campos visual', ready: false },
      { label: 'Cola de reintentos', ready: false },
      { label: 'Logs de sincronizacion', ready: false },
      { label: 'Webhooks salientes', ready: false },
    ],
  },
};

// ── Componente ──────────────────────────────────────────────────────────────

interface ModuleLandingPageProps {
  navId: string;
}

const STATUS_ICON: Record<ModuleStatus, typeof Check> = {
  available: Check,
  beta: FlaskConical,
  'in-development': Construction,
  planned: Clock,
  future: Sparkles,
  'admin-only': Lock,
  'higher-layer': Lock,
};

export function ModuleLandingPage({ navId }: ModuleLandingPageProps) {
  const item = NAV_ITEMS.find((i) => i.id === navId);
  const content = MODULE_CONTENT[navId];
  //  Cuantas capacidades estan HECHAS ya, aunque sea en otro modulo. Decide el rotulo:
  //  llamar «planificado» a lo que funciona es la clase de contradiccion que hace que
  //  nadie se crea el resto de la pagina.
  const hechas = (content?.capabilities ?? []).filter((c) => c.ready).length;
  const Icon = item?.icon;
  const meta = item ? MODULE_STATUS_META[item.moduleStatus] : null;

  if (!item || !content) {
    return (
      <CanvasHost mode="grid">
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="t-body text-[var(--text-faint)]">Modulo no encontrado</p>
        </div>
      </CanvasHost>
    );
  }

  return (
    <CanvasHost mode="grid">
      <div className="mx-auto flex max-w-[780px] flex-col gap-[var(--panel-gap)] py-[var(--space-10)]">
        {/* ── Cabecera ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-[var(--space-6)] text-center">
          {Icon && (
            <div
              className="flex size-16 items-center justify-center rounded-[var(--radius-xl)] [background:var(--glass-2)] shadow-[var(--rim-2)]"
              style={{ boxShadow: `var(--rim-2), 0 0 40px -12px ${meta?.color ?? 'transparent'}` }}
            >
              <Icon strokeWidth={1.25} className="size-7 text-[var(--icon-accent)]" />
            </div>
          )}

          <div className="flex flex-col gap-3">
            <h1 className="text-[length:var(--text-3xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              {content.headline}
            </h1>
            <p className="t-body mx-auto max-w-[56ch] text-[var(--text-secondary)]">
              {content.description}
            </p>
          </div>

          {/* Badge de estado */}
          <div className="flex items-center gap-3">
            <StatusBadge status={item.moduleStatus} />
            {item.targetVersion && (
              <span className="t-mono-xs text-[var(--text-faint)]">
                Version objetivo: {item.targetVersion}
              </span>
            )}
          </div>
        </div>

        {/* ── Capacidades ────────────────────────────────────────────── */}
        <Panel level="work" radius="xl" pad="lg">
          <PanelHeader
            /*
              El titulo depende de si algo esta HECHO. «Capacidades planificadas» encima de
              cinco lineas marcadas como funcionando se contradice a si mismo, y quien lo lee
              acaba sin saber a cual de las dos cosas creer.
            */
            title={hechas > 0 ? 'Capacidades' : 'Capacidades planificadas'}
            subtitle={
              hechas > 0
                ? `${hechas} de ${content.capabilities.length} ya funcionan, en otro modulo`
                : 'Lo que este modulo permitira hacer'
            }
          />
          <ul className="mt-[var(--space-6)] grid grid-cols-1 gap-3 sm:grid-cols-2">
            {content.capabilities.map((cap) => (
              <li key={cap.label} className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)]"
                  style={{
                    background: cap.ready
                      ? 'color-mix(in oklab, var(--state-confirmed) 18%, transparent)'
                      : 'var(--glass-1)',
                  }}
                >
                  {cap.ready ? (
                    <Check strokeWidth={2} className="size-3 text-[var(--text-ok)]" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-[var(--text-faint)] opacity-50" />
                  )}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span
                    className={
                      cap.ready
                        ? 'text-[length:var(--text-sm)] text-[var(--text-primary)]'
                        : 'text-[length:var(--text-sm)] text-[var(--text-secondary)]'
                    }
                  >
                    {cap.label}
                  </span>
                  {cap.en && (
                    <Link
                      to={cap.en.ruta}
                      className="t-mono-xs text-[var(--text-accent)] hover:underline"
                    >
                      ya funciona · {cap.en.texto}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* ── Nota adicional ─────────────────────────────────────────── */}
        {content.note && (
          <Panel level="support" radius="lg" pad="md">
            <p className="t-small text-[var(--text-faint)]">{content.note}</p>
          </Panel>
        )}

        {/* ── Contexto tecnico ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Detail label="Familia" value={item.family} />
          {item.permission && <Detail label="Permiso" value={item.permission} />}
          <Detail label="Grupo" value={item.group} />
          {item.availableFromLayer && (
            <Detail label="Capa minima" value={`${item.availableFromLayer}`} />
          )}
        </div>
      </div>
    </CanvasHost>
  );
}

function StatusBadge({ status }: { status: ModuleStatus }) {
  const meta = MODULE_STATUS_META[status];
  const Icon = STATUS_ICON[status];

  const toneMap: Record<ModuleStatus, 'measured' | 'inferred' | 'accent' | 'neutral' | 'alert'> = {
    available: 'measured',
    beta: 'measured',
    'in-development': 'inferred',
    planned: 'accent',
    future: 'neutral',
    'admin-only': 'alert',
    'higher-layer': 'neutral',
  };

  return (
    <Badge tone={toneMap[status]} size="md" glow={status === 'in-development'}>
      <Icon strokeWidth={1.5} className="size-3.5" />
      {meta.label}
    </Badge>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="t-label">{label}</span>
      <span className="t-mono-xs text-[var(--text-faint)]">{value}</span>
    </span>
  );
}
