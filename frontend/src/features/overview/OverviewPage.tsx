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
 *
 * ⚠ Las TRES cifras del Twin NO seguian esa regla: eran literales fijos —«12 480»,
 *   «94.7 %», «3»— que se pintaban siempre, incluso en produccion, y marcados como
 *   `nature="measured"`, o sea afirmando que estaban medidos. El catalogo real tiene
 *   29.312 ubicaciones. Era lo primero que veia alguien al entrar, y era falso.
 *
 *   Ahora salen de `useWarehouses()`, sumadas sobre los almacenes que ese usuario
 *   puede ver, y sin datos se pinta un guion.
 */

import { Maximize2 } from 'lucide-react';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { TwinSlot } from '../../design/foundation/twin/TwinSlot';
import { BarSeries, RingGauge } from '../../design/charts';
import { Badge, Button } from '../../design/primitives';
import { CanvasHost } from '../../shell/CanvasHost';
import { useSystemReducedMotion } from '../../design/motion/useMotionPreference';
import { cn } from '../../design/utils/cn';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { env } from '../../lib/env';
import {
  demoActivity,
  demoZones,
  type DemoActivity,
} from './demoData';

/** Lo poco que el panel necesita de `/v1/spatial/warehouses`. */
interface AlmacenResumen {
  warehouse_id: string;
  location_count: number;
  rack_count: number;
  bay_count: number;
}

/** De `/v1/spatial/warehouses/{id}/inspection/coverage`. */
interface CoberturaDto {
  locations: number;
  inspected: number;
  racks_total: number;
  racks_inspected: number;
  last_seen_at: string | null;
}

/** De `/v1/incidents?warehouse_id=…`. */
interface BandejaDto {
  open_total: number;
  counts: Record<string, number>;
}

/** De `/v1/perception/jobs`. */
interface TrabajosDto {
  jobs: { status: string; detection_count: number; frames_processed: number }[];
}

/**
 * Los almacenes accesibles, por el cliente de la API y NO por `useWarehouses()` del
 * modulo espacial.
 *
 * Ese hook exige estar dentro de `<SpatialProvider>`, que solo envuelve las rutas de
 * /spatial. Usarlo aqui reventaba la pagina de inicio entera con «Los hooks de spatial
 * deben usarse dentro de <SpatialProvider>» — una pantalla de error en lugar del panel.
 * Lo caza el navegador, no el compilador: TypeScript no sabe de contextos de React.
 *
 * `retry: false` y sin recarga al volver a la pestaña: son tres cifras estructurales
 * que no cambian en horas, y un panel de inicio no debe castigar al pooler.
 */
function useAlmacenes() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['overview', 'almacenes'],
    queryFn: () => api.get<AlmacenResumen[]>('/spatial/warehouses'),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 300_000,
  });
}

/**
 * CUÁNTO SE HA MIRADO DEL ALMACÉN, sumado sobre los accesibles.
 *
 * ── POR QUÉ ESTE PANEL YA NO DICE «SIN FUENTE DE DATOS» ───────────────────────
 *
 * Porque desde hoy la tiene. Y porque el número que da —hoy 4 huecos de 29.310— es
 * exactamente lo que un panel de mando tiene que decir antes que cualquier otra cosa: sin
 * él, «cero discrepancias» significa «todo cuadra» y «no has mirado» a la vez.
 *
 * ── LO QUE **NO** SE ENSEÑA, Y ES DELIBERADO ──────────────────────────────────
 *
 * El subtítulo decía «en las últimas 24 h» y el dato no es ese: es «huecos del catálogo con
 * ALGUNA lectura, alguna vez». Se cambia el rótulo en vez de recortar el dato a 24 h, que
 * daría casi siempre cero y parecería una avería.
 *
 * Una petición por almacén. Son dos y la consulta agrega sobre 29.310 filas —2,9 s
 * medidos—, así que se cachea cinco minutos: es una cifra que cambia cuando alguien vuela,
 * no cada vez que se abre la pestaña.
 */
function useCobertura(almacenes: AlmacenResumen[] | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['overview', 'cobertura', (almacenes ?? []).map((a) => a.warehouse_id)],
    enabled: Boolean(almacenes && almacenes.length > 0),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 300_000,
    queryFn: async () => {
      const partes = await Promise.all(
        (almacenes ?? []).map((a) =>
          api.get<CoberturaDto>(`/spatial/warehouses/${a.warehouse_id}/inspection/coverage`),
        ),
      );
      const huecos = partes.reduce((n, c) => n + c.locations, 0);
      if (huecos === 0) return undefined;
      const fechas = partes.map((c) => c.last_seen_at).filter(Boolean) as string[];
      return {
        huecos,
        vistos: partes.reduce((n, c) => n + c.inspected, 0),
        racks: partes.reduce((n, c) => n + c.racks_total, 0),
        racksVistos: partes.reduce((n, c) => n + c.racks_inspected, 0),
        //  La más reciente de todos los almacenes: es «cuándo se miró por última vez», no
        //  una media, que aquí no querría decir nada.
        ultima: fechas.length ? fechas.sort().at(-1)! : null,
      };
    },
  });
}

/** Lo que hay abierto en la bandeja, sumado sobre los almacenes accesibles. */
function useDiscrepancias(almacenes: AlmacenResumen[] | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['overview', 'incidencias', (almacenes ?? []).map((a) => a.warehouse_id)],
    enabled: Boolean(almacenes && almacenes.length > 0),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const partes = await Promise.all(
        (almacenes ?? []).map((a) =>
          api.get<BandejaDto>('/incidents', { warehouse_id: a.warehouse_id }),
        ),
      );
      return {
        abiertas: partes.reduce((n, b) => n + b.open_total, 0),
        enCurso: partes.reduce((n, b) => n + (b.counts?.in_progress ?? 0), 0),
        cerradas: partes.reduce(
          (n, b) => n + (b.counts?.resolved ?? 0) + (b.counts?.dismissed ?? 0),
          0,
        ),
      };
    },
  });
}

/** Cuánto material se ha analizado, y cuánto de eso ha mirado una persona. */
function useMaterial() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['overview', 'material'],
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const d = await api.get<TrabajosDto>('/perception/jobs', { limit: 100 });
      const jobs = d.jobs ?? [];
      const hechos = jobs.filter((j) => j.status === 'completed');
      return {
        inspecciones: hechos.length,
        fotogramas: hechos.reduce((n, j) => n + (j.frames_processed ?? 0), 0),
        detecciones: hechos.reduce((n, j) => n + (j.detection_count ?? 0), 0),
      };
    },
  });
}

export function OverviewPage() {
  const reducedMotion = useSystemReducedMotion();
  const hasData = env.demoData;

  const zones = hasData ? demoZones : [];
  const activity = hasData ? demoActivity : [];

  /**
   * Las tres cifras del Twin, sumadas sobre los almacenes que ESTE usuario puede ver.
   *
   * Se suma en lugar de coger el primero: quien tiene acceso a dos almacenes espera
   * ver su operacion entera, y enseñarle solo uno seria otra cifra que engaña.
   *
   * ── POR QUE TRES RECUENTOS Y NO LA OCUPACION ────────────────────────────────
   *
   * La ocupacion seria mas interesante para un panel de mando, pero el unico dato
   * disponible es `wms_situation_counts`, que segun su propio DTO es «lo que declaro
   * el archivo de origen EN SU FECHA DE EXPORTACION, no ocupacion viva». Ponerlo aqui,
   * al lado del distintivo «En vivo», seria el mismo engaño que estas cifras tenian
   * antes, solo que mas dificil de detectar.
   *
   * Racks, posiciones y ubicaciones son hechos del edificio: no caducan.
   *
   * `undefined` mientras carga o si falla, y entonces se pinta un guion. Un 0 diria
   * «no hay ubicaciones», que es una afirmacion distinta de «todavia no lo se».
   */
  const { data: almacenes } = useAlmacenes();
  //  Los tres paneles que hasta hoy decían «sin fuente de datos» y ya la tienen.
  const cobertura = useCobertura(almacenes);
  const discrepancias = useDiscrepancias(almacenes);
  const material = useMaterial();
  const vitales = (() => {
    if (!almacenes || almacenes.length === 0) return undefined;
    const ubicaciones = almacenes.reduce((a, w) => a + w.location_count, 0);
    if (ubicaciones === 0) return undefined;
    return {
      ubicaciones,
      racks: almacenes.reduce((a, w) => a + w.rack_count, 0),
      posiciones: almacenes.reduce((a, w) => a + w.bay_count, 0),
    };
  })();

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
            {/*
              CIFRAS REALES, del catalogo espacial. Aqui habia tres literales
              inventados —«12 480», «94.7 %», «3»— marcados como `measured`, que es la
              peor combinacion posible: la etiqueta afirmaba que estaban medidos. El
              catalogo real tiene 29.312 ubicaciones, asi que la primera cifra que ve
              alguien al entrar era falsa y se presentaba como un hecho.

              Se rompia ademas la regla que este mismo archivo declara arriba: cuando
              no hay fuente, un panel «declara que espera una fuente en lugar de
              inventar nada». Por eso ahora, sin datos, va un guion.
            */}
            <TwinStat
              label="Ubicaciones"
              value={vitales ? vitales.ubicaciones.toLocaleString('es') : '—'}
              nature="measured"
            />
            <TwinStat
              label="Racks"
              value={vitales ? vitales.racks.toLocaleString('es') : '—'}
              nature="measured"
            />
            {/*
              Ninguna cifra `inferred` aqui, y es deliberado: el violeta significa «esto
              lo dedujo el sistema», y ahora mismo no hay ninguna inferencia sobre el
              almacen. Habra una cuando el modelo lea de verdad los codigos de hueco.
            */}
            <TwinStat
              label="Posiciones"
              value={vitales ? vitales.posiciones.toLocaleString('es') : '—'}
              nature="measured"
            />
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
              /*
                EL ROTULO DICE LO QUE EL DATO ES.

                Antes ponia «en las ultimas 24 h» y el dato no es ese: es «huecos del
                catalogo con ALGUNA lectura, alguna vez». Se corrige el rotulo en vez de
                recortar el dato a 24 h, que daria casi siempre cero y pareceria una averia.
              */
              subtitle="Huecos del catalogo con alguna lectura de camara"
              className="w-full"
            />
            {/*
              ── DOS CIFRAS DISTINTAS DE «UBICACIONES» EN LA MISMA PANTALLA ──────────

              Arriba pone 29.312 y aqui 29.310. La diferencia son las ubicaciones que NO
              cuelgan de un rack —codigo opaco, 2 en el catalogo real—: no aparecen en
              ningun alzado, asi que no se pueden filmar y no pueden formar parte de lo
              inspeccionable.

              Dos numeros que dicen lo mismo y no coinciden, uno al lado del otro, hacen
              dudar de los dos. Se explica en vez de igualarlos por la fuerza: meterlas en
              el denominador seria prometer una cobertura que nunca podra llegar al 100 %.
            */}
            <div
              className="flex flex-1 items-center justify-center py-[var(--space-6)]"
              title={
                cobertura.data && vitales && vitales.ubicaciones !== cobertura.data.huecos
                  ? `${(vitales.ubicaciones - cobertura.data.huecos).toLocaleString('es')} ubicacion(es) del catalogo no cuelgan de un rack —codigo opaco—, asi que no aparecen en un alzado y no se pueden inspeccionar con camara. Por eso el total de aqui es menor que el de arriba.`
                  : undefined
              }
            >
              {cobertura.data ? (
                <RingGauge
                  value={cobertura.data.vistos / cobertura.data.huecos}
                  size={168}
                  thickness={7}
                  reducedMotion={reducedMotion}
                  ariaLabel={`Cobertura: ${cobertura.data.vistos} de ${cobertura.data.huecos} huecos`}
                >
                  {/*
                    El numero de arriba es el RECUENTO, no el porcentaje. Con 4 de 29.310 el
                    porcentaje es 0,014 y un «0,0 %» enorme se lee como una averia; «4 / 29.310»
                    dice la verdad y ademas dice cual es la escala del trabajo que falta.
                  */}
                  <span className="t-metric-sm">
                    {cobertura.data.vistos.toLocaleString('es')}
                    <span className="ml-0.5 text-[length:var(--text-md)] text-[var(--text-muted)]">
                      {' / '}
                      {cobertura.data.huecos.toLocaleString('es')}
                    </span>
                  </span>
                  <span className="t-label">Huecos vistos</span>
                </RingGauge>
              ) : cobertura.isLoading ? (
                <span className="t-label animate-pulse opacity-60">Contando…</span>
              ) : (
                <AwaitingSource />
              )}
            </div>

            {cobertura.data && (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {cobertura.data.racksVistos} de {cobertura.data.racks} racks
                </span>
                <span className="t-mono-xs text-[var(--text-faint)]">
                  {cobertura.data.ultima
                    ? `ultimo recorrido ${new Date(cobertura.data.ultima).toLocaleDateString('es', { day: '2-digit', month: 'short' })}`
                    : 'sin recorridos'}
                </span>
              </div>
            )}
          </Panel>

          {/*
            DISCREPANCIAS ABIERTAS.

            Ocupa el sitio del panel «Precision», que no tenia fuente y ademas no la tiene:
            de 356 detecciones hay 0 revisadas, asi que no existe ninguna precision medida
            que ensenar. Un panel con el nombre de una metrica que nadie ha calculado invita
            a inventarla.

            Esto si es un hecho y ademas es lo accionable: cuantas contradicciones entre el
            WMS y lo que se vio estan esperando a alguien.
          */}
          <Panel level="work" radius="xl">
            <PanelHeader
              title="Discrepancias abiertas"
              subtitle="Lo que el WMS y la camara se contradicen, sin cerrar"
              className="w-full"
            />
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-[var(--space-6)]">
              {discrepancias.data ? (
                <>
                  <span
                    className="t-metric-sm"
                    style={{
                      color:
                        discrepancias.data.abiertas > 0
                          ? 'var(--state-critical)'
                          : 'var(--text-ok)',
                    }}
                  >
                    {discrepancias.data.abiertas.toLocaleString('es')}
                  </span>
                  <span className="t-mono-xs text-[var(--text-faint)]">
                    {discrepancias.data.enCurso > 0
                      ? `${discrepancias.data.enCurso} en curso · `
                      : ''}
                    {discrepancias.data.cerradas.toLocaleString('es')} cerradas
                  </span>
                </>
              ) : discrepancias.isLoading ? (
                <span className="t-label animate-pulse opacity-60">Contando…</span>
              ) : (
                <AwaitingSource />
              )}
            </div>
          </Panel>

          {/*
            MATERIAL ANALIZADO.

            Ocupa el sitio de «Throughput», que prometia un RITMO. El ritmo no se puede
            calcular: el worker no registra `elapsed_ms` —suma cero en los cinco trabajos
            hechos—, asi que dividir por un tiempo que no existe daria un infinito o un cero.
            Lo que si es cierto es el VOLUMEN, y eso es lo que dice.
          */}
          <Panel level="work" radius="xl">
            <PanelHeader
              title="Material analizado"
              subtitle="Inspecciones completadas y lo que produjeron"
              className="w-full"
            />
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-[var(--space-6)]">
              {material.data ? (
                <>
                  <span className="t-metric-sm">
                    {material.data.inspecciones.toLocaleString('es')}
                  </span>
                  <span className="t-mono-xs text-[var(--text-faint)]">
                    {material.data.fotogramas.toLocaleString('es')} fotogramas ·{' '}
                    {material.data.detecciones.toLocaleString('es')} detecciones
                  </span>
                </>
              ) : material.isLoading ? (
                <span className="t-label animate-pulse opacity-60">Contando…</span>
              ) : (
                <AwaitingSource />
              )}
            </div>
          </Panel>

          {/*
            PREVISION se queda SIN FUENTE, y esa es la respuesta correcta.

            No hay ningun modelo de prevision en el sistema: ni serie temporal, ni historico
            suficiente, ni nadie que lo haya pedido. Rellenarlo con una extrapolacion de
            cinco inspecciones seria volver al defecto que este panel ya tuvo una vez, cuando
            decia «94,7 % de cobertura» y estaba escrito a mano.
          */}
          <Panel level="work" radius="xl">
            <PanelHeader title="Prevision" />
            <div className="flex flex-1 items-center justify-center py-[var(--space-6)]">
              <AwaitingSource />
            </div>
          </Panel>
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
