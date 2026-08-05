/**
 * OVERVIEW — la vista de mando.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * JERARQUIA EN TRES NIVELES
 *
 * El requisito era: "el usuario debe saber donde mirar en menos de un segundo".
 * Con doce paneles del mismo tamaño y el mismo peso eso es imposible, asi que la
 * composicion establece un orden explicito.
 *
 *   FOCO PRINCIPAL     El Digital Twin. Ocupa 8 de 12 columnas y 520px de alto,
 *                      es el unico panel con `level="hero"` y `aura="hero"`, el
 *                      unico con luz de suelo y el unico con blur. Emite mas luz
 *                      que todo lo demas junto.
 *
 *   FOCO SECUNDARIO    La columna derecha: cobertura de percepcion (un anillo
 *                      grande) y tres metricas con su tendencia. Nivel `work`.
 *                      Se lee inmediatamente despues del Twin.
 *
 *   APOYO              La fila inferior: ocupacion por zona y flujo de
 *                      actividad. Nivel `support`, apenas despegados del fondo,
 *                      tipografia mas pequeña. Se leen cuando se buscan.
 *
 * La proporcion no es decorativa: el area del Twin es aproximadamente 4 veces la
 * del panel secundario mayor, y unas 10 veces la de un panel de apoyo. Esa
 * diferencia es lo que el ojo resuelve en menos de un segundo.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * NOTA SOBRE LOS DATOS: en modo mock las cifras vienen de `demoData.ts` y la
 * TopBar muestra el aviso "Datos de demostracion". Cuando `env.demoData` es
 * false, los paneles declaran que esperan una fuente en lugar de inventar nada.
 */

import { ArrowDownRight, ArrowUpRight, Maximize2 } from 'lucide-react';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { TwinSlot } from '../../design/foundation/twin/TwinSlot';
import { AreaSpark, BarSeries, RingGauge } from '../../design/charts';
import { Badge, Button, StatusIndicator } from '../../design/primitives';
import { CanvasHost } from '../../shell/CanvasHost';
import { useSystemReducedMotion } from '../../design/motion/useMotionPreference';
import { cn } from '../../design/utils/cn';
import { env } from '../../lib/env';
import {
  demoActivity,
  demoMetrics,
  demoVitals,
  demoZones,
  type DemoActivity,
  type DemoMetric,
} from './demoData';

export function OverviewPage() {
  const reducedMotion = useSystemReducedMotion();
  const hasData = env.demoData;

  const metrics = hasData ? demoMetrics : [];
  const zones = hasData ? demoZones : [];
  const activity = hasData ? demoActivity : [];

  return (
    <CanvasHost mode="grid">
      <ViewIntro />

      {/* Reticula de 12 columnas. Sin ancho maximo: un centro de control usa
          todo el monitor. El gap es generoso — el aire entre paneles es lo que
          los hace flotar en lugar de encajar. */}
      <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
        {/* ══ FOCO PRINCIPAL ══════════════════════════════════════════════ */}
        <Panel
          level="hero"
          aura="hero"
          radius="2xl"
          pad="none"
          floorGlow
          className="col-span-12 min-h-[520px] xl:col-span-8"
        >
          {/* El encabezado FLOTA sobre el Twin en lugar de ocupar una banda
              propia con una linea debajo. Asi el Twin llega hasta el borde
              superior del panel y se lee como una ventana, no como una imagen
              dentro de una ficha. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-[var(--panel-pad)]">
            <div className="flex flex-col gap-2">
              <span className="t-label">Foco principal</span>
              <h2 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-none tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
                Consciencia del almacen
              </h2>
              <p className="t-panel-sub max-w-[38ch]">
                Representacion viva del estado percibido. La luz de cada bloque
                deriva de su ocupacion.
              </p>
            </div>

            <div className="pointer-events-auto flex items-center gap-2.5">
              <Badge tone="measured" size="sm" glow>
                <span className="olo-live-dot inline-block size-1.5 rounded-full bg-[var(--aqua-300)]" />
                En vivo
              </Badge>
              <Button variant="ghost" size="xs" iconOnly aria-label="Ampliar gemelo digital">
                <Maximize2 strokeWidth={1.5} className="size-4" />
              </Button>
            </div>
          </div>

          {/* El Twin ocupa TODO el panel, incluido el area del encabezado. */}
          <div className="absolute inset-0 z-0">
            <TwinSlot level="warehouse" reducedMotion={reducedMotion} />
          </div>

          {/* Instrumentacion al pie, sobre la escena. Tres cifras, no doce. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-end gap-x-[var(--space-10)] gap-y-4 p-[var(--panel-pad)]">
            <TwinStat label="Ubicaciones" value="12 480" nature="measured" />
            <TwinStat label="Cobertura" value="94.7" unit="%" nature="measured" />
            <TwinStat label="Anomalias inferidas" value="3" nature="inferred" />
            <span className="t-mono-xs ml-auto text-[var(--text-faint)]">
              Capa visual 1 · SVG isometrico
            </span>
          </div>
        </Panel>

        {/* ══ FOCO SECUNDARIO ═════════════════════════════════════════════ */}
        <div className="col-span-12 flex flex-col gap-[var(--panel-gap)] xl:col-span-4">
          <Panel level="work" radius="xl">
            <PanelHeader
              title="Cobertura de percepcion"
              subtitle="Proporcion del almacen observada en las ultimas 24 h"
              className="w-full"
            />
            <div className="flex flex-1 items-center justify-center py-[var(--space-6)]">
              {hasData ? (
                <RingGauge
                  value={demoVitals.coverage}
                  size={168}
                  thickness={7}
                  reducedMotion={reducedMotion}
                  ariaLabel={`Cobertura de percepcion: ${(demoVitals.coverage * 100).toFixed(1)} por ciento`}
                >
                  <span className="t-metric-sm">
                    {(demoVitals.coverage * 100).toFixed(1)}
                    <span className="ml-0.5 text-[length:var(--text-md)] text-[var(--text-muted)]">
                      %
                    </span>
                  </span>
                  <span className="t-label">Observado</span>
                </RingGauge>
              ) : (
                <AwaitingSource />
              )}
            </div>

            {hasData && (
              <div className="flex w-full items-center justify-between">
                <StatusIndicator
                  state="idle"
                  size="sm"
                  live
                  label={`Edge ${demoVitals.edgeOnline}/${demoVitals.edgeTotal}`}
                />
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {demoVitals.inferencesPerSecond.toFixed(1)} inf/s
                </span>
              </div>
            )}
          </Panel>

          {metrics.length > 0
            ? metrics.map((m) => <MetricPanel key={m.id} metric={m} reducedMotion={reducedMotion} />)
            : ['Precision', 'Throughput', 'Prevision'].map((label) => (
                <Panel key={label} level="work" radius="xl">
                  <PanelHeader title={label} />
                  <div className="flex flex-1 items-center justify-center py-[var(--space-6)]">
                    <AwaitingSource />
                  </div>
                </Panel>
              ))}
        </div>

        {/* ══ APOYO ═══════════════════════════════════════════════════════ */}
        <Panel level="support" radius="xl" className="col-span-12 min-h-[280px] xl:col-span-7">
          <PanelHeader
            title="Ocupacion por zona"
            subtitle="Porcentaje de ubicaciones ocupadas"
            trailing={
              <Badge tone="measured" size="xs">
                Medido
              </Badge>
            }
          />
          <div className="min-h-0 flex-1 pt-[var(--space-6)]">
            {zones.length > 0 ? (
              <BarSeries data={zones} nature="measured" max={100} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <AwaitingSource />
              </div>
            )}
          </div>
        </Panel>

        <Panel level="support" radius="xl" className="col-span-12 min-h-[280px] xl:col-span-5">
          <PanelHeader
            title="Actividad reciente"
            subtitle="Flujo de eventos del sistema"
            trailing={
              activity.length > 0 ? (
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {activity.length} eventos
                </span>
              ) : undefined
            }
          />
          <div className="min-h-0 flex-1 pt-[var(--space-5)]">
            {activity.length > 0 ? (
              <ul className="flex flex-col gap-[var(--space-1)]">
                {activity.map((e) => (
                  <ActivityRow key={e.id} event={e} />
                ))}
              </ul>
            ) : (
              <div className="flex h-full items-center justify-center">
                <AwaitingSource />
              </div>
            )}
          </div>
        </Panel>
      </div>
    </CanvasHost>
  );
}

/**
 * Encabezado de la vista.
 *
 * Vive FUERA de cualquier panel, directamente sobre el lienzo. Es lo que
 * establece que el contenido no esta encerrado: el titulo respira en el fondo y
 * los paneles cuelgan de el.
 */
function ViewIntro() {
  const now = new Date();

  return (
    <div className="flex flex-wrap items-end justify-between gap-6 pb-[var(--space-8)] pt-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <span className="t-label">Centro de mando</span>
        <h1 className="t-view-title">Estado general</h1>
      </div>
      <span className="t-mono-xs pb-1 text-[var(--text-faint)]">
        {now.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}
      </span>
    </div>
  );
}

/** Cifra sobre la escena del Twin. Sin panel propio: flota. */
function TwinStat({
  label,
  value,
  unit,
  nature,
}: {
  label: string;
  value: string;
  unit?: string;
  nature: 'measured' | 'inferred';
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="t-label">{label}</span>
      <span
        className={cn(
          'font-[family-name:var(--font-data)] text-[length:var(--text-xl)]',
          'font-[var(--weight-light)] leading-none [font-variant-numeric:tabular-nums]',
          // La regla de producto, aplicada: cian mide, violeta infiere.
          nature === 'inferred' ? 'text-[var(--text-inferred)]' : 'text-[var(--text-primary)]',
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Panel de metrica.
 *
 * El grafico va a SANGRE en la parte inferior del panel, sin margen y sin marco.
 * Es la diferencia entre "un grafico metido en una caja" y "un panel cuya base
 * es el grafico".
 */
function MetricPanel({
  metric,
  reducedMotion,
}: {
  metric: DemoMetric;
  reducedMotion: boolean;
}) {
  const positive = metric.delta >= 0;
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <Panel level="work" radius="xl" pad="none" className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-[var(--panel-pad)] pb-0">
        <div className="flex min-w-0 flex-col gap-3">
          <span className="t-label truncate">{metric.label}</span>
          <span className="t-metric-sm">
            {metric.value}
            {metric.unit && (
              <span className="ml-1 text-[length:var(--text-md)] font-[var(--weight-book)] text-[var(--text-muted)]">
                {metric.unit}
              </span>
            )}
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={metric.nature === 'inferred' ? 'inferred' : 'measured'} size="xs">
            {metric.nature === 'inferred' ? 'Inferido' : 'Medido'}
          </Badge>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              'font-[family-name:var(--font-data)] text-[length:var(--text-xs)]',
              '[font-variant-numeric:tabular-nums]',
              positive ? 'text-[var(--text-ok)]' : 'text-[var(--text-warn)]',
            )}
          >
            <DeltaIcon strokeWidth={2} className="size-3.5" />
            {Math.abs(metric.delta).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* A sangre: sin padding, pegado al borde inferior del panel. */}
      <div className="mt-auto h-[72px] w-full shrink-0">
        <AreaSpark
          values={metric.series}
          nature={metric.nature}
          reducedMotion={reducedMotion}
        />
      </div>
    </Panel>
  );
}

const ACTIVITY_TONE = {
  measured: 'var(--aqua-400)',
  inferred: 'var(--iris-400)',
  alert: 'var(--ember-400)',
} as const;

/**
 * Fila del flujo de actividad.
 *
 * Sin `border-b` entre filas. La separacion la hace el interlineado y un punto de
 * color a la izquierda; una lista con lineas horizontales es una tabla, y una
 * tabla en un panel de apoyo vuelve a introducir la reticula.
 */
function ActivityRow({ event }: { event: DemoActivity }) {
  const color = ACTIVITY_TONE[event.nature];
  const at = new Date(Date.now() - event.agoMin * 60_000);

  return (
    <li className="group flex items-start gap-3.5 rounded-[var(--radius-sm)] px-2 py-2.5 transition-colors duration-200 hover:[background:var(--glass-1)]">
      <span
        aria-hidden
        className="mt-[6px] size-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px 1px ${color}` }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[length:var(--text-sm)] text-[var(--text-body)]">
          {event.message}
        </span>
        <span className="t-mono-xs truncate text-[var(--text-faint)]">
          {at.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })}
          {' · '}
          {event.source}
        </span>
      </div>
    </li>
  );
}

/**
 * Estado sin fuente de datos.
 *
 * No es un "cargando" ni un cero: declara que el panel espera un endpoint. Es la
 * version honesta del hueco, y es lo que se ve cuando NO estamos en modo demo.
 */
function AwaitingSource() {
  return (
    <span className="t-label opacity-60">Sin fuente de datos</span>
  );
}
