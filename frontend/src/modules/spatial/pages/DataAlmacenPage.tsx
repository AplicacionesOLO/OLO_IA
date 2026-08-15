/**
 * DATA ALMACÉN — las medidas reales, con cinta métrica.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA PANTALLA EXISTE
 *
 * El visor 3D dibuja los racks con medidas INVENTADAS. Están declaradas y comentadas
 * —1,35 m por posición, 1,7 m por nivel, 1,1 m de fondo— y sirven para que las
 * proporciones entre racks sean correctas: uno con el triple de cuerpos se dibuja tres
 * veces más largo. Pero no son las de este almacén, porque nadie las ha medido.
 *
 * Eso pone techo a todo lo que viene detrás: sin metros reales no hay volumen de un hueco,
 * ni comprobar si una tarima cabe, ni simulación posible. El tiempo que tarda un dron en
 * subir del nivel 1 al 7 es aritmética simple SOBRE MEDIDAS CIERTAS, y basura sobre
 * medidas supuestas.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO GENERAL Y SUS EXCEPCIONES
 *
 * Las familias no miden igual. Medido en el catálogo real: `RCL` tiene 2 posiciones por
 * cuerpo y `MZ` tiene 1, así que un cuerpo de RCL es del orden del doble de ancho.
 *
 * Por eso hay un ámbito: **por defecto** son las medidas del almacén, y elegir una familia
 * las sustituye para esos racks. Con una medida única, la mitad se dibujarían mal — y peor:
 * los cálculos darían un número con aspecto de exacto.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * CADA LÍNEA CON SU ESQUEMA, Y POR QUÉ SON DIBUJOS Y NO FOTOS
 *
 * Medir «el ancho del cuerpo» significa cosas distintas según dónde pongas la cinta: entre
 * parales, o de eje a eje. El esquema quita esa duda, que es la que produce medidas
 * inservibles tomadas de buena fe.
 *
 * Se dibujan en SVG y no se suben como imágenes: escalan a cualquier tamaño, siguen el tema
 * claro u oscuro, y no se pueden perder ni caducar como una URL firmada.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Ruler } from 'lucide-react';

import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { CanvasHost } from '../../../shell/CanvasHost';
import { cn } from '../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../lib/apiErrors';
import { useResolvedWarehouse } from '../components/WarehousePicker';
import { useSessionStore } from '../../../auth/sessionStore';
import {
  useGuardarMedidas,
  useMedidas,
  useTreeRoots,
  useWarehouses,
} from '../services/useSpatial';
import type { WarehouseMetrics } from '../types/index';

/** Qué se mide, agrupado como se recorre un almacén con la cinta en la mano. */
const GRUPOS: {
  titulo: string;
  ayuda: string;
  campos: {
    clave: keyof WarehouseMetrics;
    etiqueta: string;
    esquema: Esquema;
    /** Dónde poner la cinta. Es lo que hace la medida comparable entre almacenes. */
    donde: string;
  }[];
}[] = [
  {
    titulo: 'La tarima',
    ayuda: 'La unidad de carga. De aquí sale si cabe en el hueco.',
    campos: [
      { clave: 'palletWidthM', etiqueta: 'Ancho', esquema: 'tarima-ancho', donde: 'El frente, de canto a canto de la madera.' },
      { clave: 'palletDepthM', etiqueta: 'Fondo', esquema: 'tarima-fondo', donde: 'De la cara delantera a la trasera.' },
      { clave: 'palletHeightM', etiqueta: 'Alto', esquema: 'tarima-alto', donde: 'Del suelo a lo más alto de la carga, no de la madera.' },
    ],
  },
  {
    titulo: 'El hueco',
    ayuda: 'El espacio de una tarima. Su volumen sale de estas tres.',
    campos: [
      { clave: 'slotWidthM', etiqueta: 'Ancho', esquema: 'hueco-ancho', donde: 'El espacio libre, entre paral y paral o entre tarimas.' },
      { clave: 'slotHeightM', etiqueta: 'Alto', esquema: 'hueco-alto', donde: 'Del larguero de abajo al de arriba, por dentro.' },
      { clave: 'slotDepthM', etiqueta: 'Fondo', esquema: 'hueco-fondo', donde: 'Del frente del rack al fondo. En doble fondo, el de UNA posición.' },
    ],
  },
  {
    titulo: 'La estructura',
    ayuda: 'Lo que el visor usa para dibujar cada rack a escala.',
    campos: [
      { clave: 'bayWidthM', etiqueta: 'Ancho del cuerpo', esquema: 'cuerpo', donde: 'De eje a eje de paral: es lo que se repite a lo largo del rack.' },
      { clave: 'levelHeightM', etiqueta: 'Alto del nivel', esquema: 'nivel', donde: 'De un larguero al siguiente, de eje a eje.' },
      { clave: 'rackHeightM', etiqueta: 'Alto del rack', esquema: 'rack-alto', donde: 'Del suelo a lo alto del último larguero.' },
      { clave: 'rackDepthM', etiqueta: 'Fondo del rack', esquema: 'rack-fondo', donde: 'El fondo total. En doble fondo, incluye las dos posiciones.' },
      { clave: 'uprightWidthM', etiqueta: 'Ancho del paral', esquema: 'paral', donde: 'El perfil vertical, visto de frente.' },
      { clave: 'beamHeightM', etiqueta: 'Alto del larguero', esquema: 'larguero', donde: 'El canto de la viga donde se posa la tarima.' },
    ],
  },
  {
    titulo: 'El entorno',
    ayuda: 'Lo que decide si un dron o un montacargas pasa, y cuánto recorre.',
    campos: [
      { clave: 'aisleWidthM', etiqueta: 'Ancho del pasillo', esquema: 'pasillo-ancho', donde: 'De frente de rack a frente de rack.' },
      { clave: 'aisleLengthM', etiqueta: 'Largo del pasillo', esquema: 'pasillo-largo', donde: 'De punta a punta de la hilera.' },
    ],
  },
];

const TOTAL_MEDIDAS = GRUPOS.reduce((n, g) => n + g.campos.length, 0);

export function DataAlmacenPage() {
  //  Igual que el editor: la seleccion persistida se VALIDA contra la lista, porque un
  //  almacen guardado al que se perdio el acceso produciria un 404 por cada consulta.
  const persistido = useSessionStore((s) => s.activeWarehouseId);
  const setActivo = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();
  const warehouseId = useResolvedWarehouse(warehouses.data, persistido, setActivo);
  const roots = useTreeRoots(warehouseId);
  const medidas = useMedidas(warehouseId);
  const guardar = useGuardarMedidas(warehouseId);
  const [familia, setFamilia] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  /*
    Las familias que EXISTEN en este almacén, sacadas de los códigos de rack. Ofrecer una
    lista fija —RCL, MZ, PURT— sería inventarse el almacén de otro: cada instalación tiene
    las suyas, y una familia que no existe es una fila de medidas que no se aplica a nada.
  */
  const familias = useMemo(() => {
    const s = new Set<string>();
    for (const n of roots.data ?? []) {
      const m = /^[A-Z]+/.exec(n.code ?? '');
      if (m) s.add(m[0]);
    }
    return [...s].sort();
  }, [roots.data]);

  const fila = (medidas.data ?? []).find((f) => (f.rackFamily ?? '') === familia);
  const porDefecto = (medidas.data ?? []).find((f) => f.rackFamily == null);

  const guardarCampo = async (clave: keyof WarehouseMetrics, valor: number | null) => {
    setError(null);
    try {
      await guardar.mutateAsync({
        rackFamily: familia || null,
        [clave]: valor,
      } as never);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? humanMessage(e)
          : e instanceof Error
            ? e.message
            : 'No se pudo guardar la medida.',
      );
    }
  };

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/twin"
              className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
            >
              <ArrowLeft strokeWidth={1.5} className="size-3.5" />
              Plano
            </Link>
            <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] text-[var(--text-primary)]">
              Data Almacén
            </h1>
          </div>
          <span className="t-mono-xs text-[var(--text-faint)]">
            {fila ? `${fila.medidasTomadas} de ${TOTAL_MEDIDAS} medidas` : `0 de ${TOTAL_MEDIDAS} medidas`}
          </span>
        </div>

        <Panel level="support" radius="lg" pad="md">
          <p className="t-small max-w-[92ch] text-[var(--text-muted)]">
            El visor dibuja los racks con medidas <strong>convencionales</strong> mientras
            esta tabla esté vacía: las proporciones entre racks son correctas, pero los
            metros no son los de este almacén. En cuanto midas, el modelo pasa a estar a
            escala — y con eso el volumen de un hueco y los tiempos de recorrido dejan de ser
            estimaciones.
          </p>
        </Panel>

        {/* ── El ámbito ─────────────────────────────────────────────────── */}
        <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
          <PanelHeader
            title="Ámbito"
            subtitle="Lo general, y las excepciones por familia de rack"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {[{ v: '', t: 'Por defecto' }, ...familias.map((f) => ({ v: f, t: f }))].map((o) => (
              <button
                key={o.v || 'defecto'}
                type="button"
                onClick={() => setFamilia(o.v)}
                aria-pressed={familia === o.v}
                className={cn(
                  'h-7 rounded-[var(--radius-xs)] px-2.5 text-[length:var(--text-xs)]',
                  familia === o.v
                    ? '[background:var(--glass-2)] text-[var(--text-primary)]'
                    : 'text-[var(--text-faint)] hover:[background:var(--glass-1)]',
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
          <p className="t-mono-xs max-w-[86ch] text-[var(--text-faint)]">
            {familia
              ? `Lo que midas aquí se aplica solo a los racks ${familia}. Lo que dejes vacío usa la medida por defecto.`
              : 'Estas son las medidas de todo el almacén. Si una familia mide distinto —RCL tiene 2 posiciones por cuerpo y MZ tiene 1— se corrige eligiéndola arriba.'}
          </p>
        </Panel>

        {error && <AsyncStatus phase="error" errorLabel={error} />}

        {/*
          El «cargando» se ata al almacen y no solo a la consulta. Sin almacen resuelto la
          consulta esta DESACTIVADA, y una consulta desactivada se queda pendiente para
          siempre: la pantalla decia «leyendo las medidas» sin leer nada y sin decir por que.
        */}
        {!warehouseId ? (
          <Panel level="support" radius="lg" pad="md">
            <p className="t-small text-[var(--text-faint)]">
              Elige un almacén en el plano para medirlo. Las medidas son de un almacén
              concreto: no hay unas «medidas del sistema».
            </p>
          </Panel>
        ) : medidas.isLoading ? (
          <AsyncStatus phase="pending" pendingLabel="Leyendo las medidas" />
        ) : (
          GRUPOS.map((g) => (
            <Panel key={g.titulo} level="work" radius="xl" pad="md" className="flex flex-col gap-3">
              <PanelHeader title={g.titulo} subtitle={g.ayuda} />
              <div className="flex flex-col gap-2">
                {g.campos.map((c) => (
                  <Linea
                    key={String(c.clave)}
                    etiqueta={c.etiqueta}
                    donde={c.donde}
                    esquema={c.esquema}
                    valor={(fila?.[c.clave] as number | null) ?? null}
                    heredado={
                      familia && fila?.[c.clave] == null
                        ? ((porDefecto?.[c.clave] as number | null) ?? null)
                        : null
                    }
                    onGuardar={(v) => void guardarCampo(c.clave, v)}
                  />
                ))}
              </div>

              {/* El volumen, donde tiene sentido enseñarlo. */}
              {g.titulo === 'El hueco' && fila?.slotVolumeM3 != null && (
                <p className="t-mono-xs text-[var(--text-secondary)]">
                  Volumen del hueco: <strong>{fila.slotVolumeM3} m³</strong> ={' '}
                  {(fila.slotVolumeM3 * 1_000_000).toLocaleString('es')} cm³
                </p>
              )}
              {g.titulo === 'La tarima' && fila?.palletVolumeM3 != null && (
                <p className="t-mono-xs text-[var(--text-secondary)]">
                  Volumen de la tarima: <strong>{fila.palletVolumeM3} m³</strong>
                </p>
              )}
            </Panel>
          ))
        )}

        {/* ── El doble fondo ────────────────────────────────────────────── */}
        <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
          <PanelHeader
            title="Doble fondo"
            subtitle="Hoy el sistema no lo usa, y aun así importa guardarlo"
          />
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={fila?.doubleDeep === true}
              onChange={(e) => void guardarCampo('doubleDeep' as never, e.target.checked as never)}
              className="mt-1 size-4"
            />
            <span className="t-small max-w-[86ch] text-[var(--text-muted)]">
              Estos racks guardan <strong>dos tarimas por hueco</strong>, una detrás de otra.
              <br />
              <span className="t-mono-xs text-[var(--text-faint)]">
                La cámara solo puede ver la de delante. Sin este dato, «vacío inesperado» es
                un falso positivo sistemático aquí: el frente puede estar vacío con carga
                detrás. Marcarlo no cambia nada todavía — permite que deje de mentir cuando
                se conecte.
              </span>
            </span>
          </label>
        </Panel>
      </div>
    </CanvasHost>
  );
}

// ── Una medida ──────────────────────────────────────────────────────────────

function Linea({
  etiqueta,
  donde,
  esquema,
  valor,
  heredado,
  onGuardar,
}: {
  etiqueta: string;
  donde: string;
  esquema: Esquema;
  valor: number | null;
  /** Lo que se usaría si esta queda vacía, cuando se está midiendo una familia. */
  heredado: number | null;
  onGuardar: (v: number | null) => void;
}) {
  /*
    El input es NO controlado por el estado remoto mientras se escribe: con el valor atado
    a la consulta, cada guardado devolvía el número normalizado y el cursor saltaba al
    final. Se sincroniza al llegar dato nuevo y se confirma al salir del campo.
  */
  const [texto, setTexto] = useState(valor == null ? '' : String(valor));
  useEffect(() => {
    setTexto(valor == null ? '' : String(valor));
  }, [valor]);

  const confirmar = () => {
    const limpio = texto.trim().replace(',', '.');
    if (limpio === '') {
      if (valor != null) onGuardar(null);
      return;
    }
    const n = Number(limpio);
    //  Un texto que no es número no borra la medida ni manda basura: se descarta y el
    //  campo vuelve a lo que había. Guardar `NaN` habría dejado la medida en un estado
    //  que el CHECK rechaza y el error saldría lejos de aquí.
    if (!Number.isFinite(n) || n <= 0) {
      setTexto(valor == null ? '' : String(valor));
      return;
    }
    if (n !== valor) onGuardar(n);
  };

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] p-2 [background:var(--glass-1)]">
      <Diagrama tipo={esquema} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {etiqueta}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">{donde}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          inputMode="decimal"
          placeholder={heredado != null ? String(heredado) : '—'}
          aria-label={`${etiqueta} en metros`}
          className={cn(
            'h-8 w-24 rounded-[var(--radius-xs)] px-2 text-right',
            'font-[family-name:var(--font-data)] text-[length:var(--text-sm)]',
            '[background:var(--glass-2)] text-[var(--text-primary)] outline-none',
            'focus:shadow-[var(--focus-ring)]',
          )}
        />
        <span className="t-mono-xs w-4 text-[var(--text-faint)]">m</span>
      </div>
    </div>
  );
}

// ── Los esquemas ────────────────────────────────────────────────────────────

type Esquema =
  | 'tarima-ancho' | 'tarima-fondo' | 'tarima-alto'
  | 'hueco-ancho' | 'hueco-alto' | 'hueco-fondo'
  | 'cuerpo' | 'nivel' | 'rack-alto' | 'rack-fondo' | 'paral' | 'larguero'
  | 'pasillo-ancho' | 'pasillo-largo';

/**
 * El dibujo que quita la duda de dónde poner la cinta.
 *
 * Medir «el ancho del cuerpo» significa cosas distintas según se mida entre parales o de
 * eje a eje, y esa ambigüedad produce medidas inservibles tomadas de buena fe. El esquema
 * marca la cota en rojo sobre la pieza en gris.
 *
 * SVG y no imágenes: escala, sigue el tema y no caduca.
 */
function Diagrama({ tipo }: { tipo: Esquema }) {
  const trazo = 'var(--text-faint)';
  const cota = 'var(--state-critical)';

  //  Cada esquema es la MISMA pieza vista de la misma manera; lo único que cambia es dónde
  //  cae la cota. Dibujarlas distintas haría comparar dibujos en vez de leer una medida.
  const piezas: Record<Esquema, JSX.Element> = {
    'tarima-ancho': (
      <>
        <rect x="8" y="26" width="40" height="10" fill="none" stroke={trazo} />
        <path d="M8 42 H48" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'tarima-fondo': (
      <>
        <path d="M8 26 L20 18 H48 L36 26 Z" fill="none" stroke={trazo} />
        <rect x="8" y="26" width="28" height="10" fill="none" stroke={trazo} />
        <path d="M40 30 L52 22" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'tarima-alto': (
      <>
        <rect x="12" y="30" width="32" height="8" fill="none" stroke={trazo} />
        <rect x="14" y="14" width="28" height="16" fill="none" stroke={trazo} strokeDasharray="2 2" />
        <path d="M50 14 V38" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'hueco-ancho': (
      <>
        <path d="M10 10 V44 M50 10 V44" stroke={trazo} />
        <path d="M10 40 H50" stroke={trazo} />
        <path d="M14 34 H46" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'hueco-alto': (
      <>
        <path d="M10 12 H50 M10 42 H50" stroke={trazo} />
        <path d="M30 16 V38" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'hueco-fondo': (
      <>
        <path d="M12 34 L26 22 H50 L36 34 Z" fill="none" stroke={trazo} />
        <path d="M20 30 L32 20" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    cuerpo: (
      <>
        <path d="M12 8 V46 M30 8 V46 M48 8 V46" stroke={trazo} />
        <path d="M12 44 H30" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    nivel: (
      <>
        <path d="M10 16 H50 M10 30 H50 M10 44 H50" stroke={trazo} />
        <path d="M22 17 V29" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'rack-alto': (
      <>
        <path d="M14 8 V46 M46 8 V46" stroke={trazo} />
        <path d="M14 16 H46 M14 28 H46 M14 40 H46" stroke={trazo} strokeWidth="0.8" />
        <path d="M52 8 V46" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'rack-fondo': (
      <>
        <path d="M12 36 L26 24 H50 L36 36 Z" fill="none" stroke={trazo} />
        <path d="M12 36 V16 M50 24 V6" stroke={trazo} strokeWidth="0.8" />
        <path d="M14 40 L28 28" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    paral: (
      <>
        <rect x="14" y="8" width="6" height="38" fill="none" stroke={trazo} />
        <rect x="40" y="8" width="6" height="38" fill="none" stroke={trazo} />
        <path d="M14 50 H20" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    larguero: (
      <>
        <rect x="10" y="24" width="40" height="6" fill="none" stroke={trazo} />
        <path d="M54 24 V30" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'pasillo-ancho': (
      <>
        <rect x="6" y="10" width="8" height="34" fill="none" stroke={trazo} />
        <rect x="46" y="10" width="8" height="34" fill="none" stroke={trazo} />
        <path d="M14 27 H46" stroke={cota} strokeWidth="1.5" />
      </>
    ),
    'pasillo-largo': (
      <>
        <rect x="8" y="12" width="44" height="8" fill="none" stroke={trazo} />
        <rect x="8" y="34" width="44" height="8" fill="none" stroke={trazo} />
        <path d="M8 27 H52" stroke={cota} strokeWidth="1.5" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 60 54"
      className="size-12 shrink-0 rounded-[var(--radius-xs)] [background:var(--glass-2)]"
      aria-hidden
    >
      <g fill="none" strokeWidth="1" strokeLinecap="round">
        {piezas[tipo]}
      </g>
    </svg>
  );
}

/** Icono para quien importe la página desde el menú. */
export const DataAlmacenIcon = Ruler;
