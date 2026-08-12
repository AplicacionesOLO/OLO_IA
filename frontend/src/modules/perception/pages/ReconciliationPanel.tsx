/**
 * RECONCILIACIÓN CONTRA EL WMS — lo que vio el drone frente a lo que el sistema declara.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ RESPONDE ESTA PANTALLA, Y POR QUÉ NO ES LO MISMO QUE LAS DETECCIONES
 *
 * Las detecciones dicen «vi un pallet con confianza 0,86». Eso es lo que el modelo
 * cree, y es la pantalla de arriba. Aquí se responde otra cosa:
 *
 *     «hay un pallet en A-01-02 y el WMS declara ese hueco VACÍO»
 *
 * Sale de `inventory.v_reconciliation` (migración 0064), que compara las lecturas
 * observadas contra el último corte del WMS. Es lo accionable: una detección no genera
 * trabajo, una discrepancia sí.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO ES IDEMPOTENTE, Y LA PANTALLA LO DICE ANTES DE PULSAR
 *
 * Cada reconciliación crea un RECORRIDO nuevo. Dos del mismo vuelo son dos recorridos
 * —quizá con otro corte del WMS de por medio— y eso es deliberado: machacar el anterior
 * perdería la comparación entre ambos.
 *
 * Pero significa que pulsar dos veces no es inocuo, así que el botón lo advierte en vez
 * de dejar que se descubra viendo dos recorridos donde debería haber uno.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS NUEVE ESTADOS SE AGRUPAN EN TRES, Y ESE ES EL TRABAJO DE ESTA PANTALLA
 *
 * 0064 clasifica cada lectura en nueve estados. Nueve columnas de colores es una tabla
 * que nadie lee. Lo que un operador necesita saber al abrir esto es una cosa:
 *
 *     CUADRA          el WMS y la realidad coinciden          → nada que hacer
 *     NO CUADRA       se contradicen                          → hay trabajo
 *     NO SE PUDO VER  el QR ilegible, el hueco tapado         → repetir la captura
 *
 * El tercero es tan importante como el segundo y se suele olvidar: si el 60 % de un
 * vuelo es «no se pudo ver», el resultado no dice que el almacén esté bien, dice que
 * hay que volver a volar. Agruparlo con «cuadra» sería mentir por omisión.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, MapPin, ScanSearch } from 'lucide-react';

import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../lib/apiErrors';
import type { ReconcileResult, ReconcileRow, ReconcileStatus } from '../types';
import { esUbicacionCompleta } from '../codigos';
import { useReconcile, useResolverHueco } from '../usePerception';

/**
 * IR AL HUECO EN EL MAPA, desde una fila de la reconciliación.
 *
 * ── POR QUE AQUI Y NO SOLO EN LAS DETECCIONES ─────────────────────────────────
 *
 * El botón ya existe en el inspector de detecciones, pero ahí se mira UNA caja que el modelo
 * dibujó. Esta pantalla es la que dice «en este hueco hay algo que no cuadra», y es desde
 * una discrepancia desde donde alguien quiere ir a mirar el sitio.
 *
 * Solo aparece con un código de hueco COMPLETO: sin los cuatro niveles no hay celda que
 * abrir, y un botón que lleva al rack entero prometería una precisión que la lectura no
 * tiene.
 */
function IrAlHueco({ codigo }: { codigo: string }) {
  const navigate = useNavigate();
  const resolver = useResolverHueco();
  const [buscando, setBuscando] = useState(false);
  const [noEsta, setNoEsta] = useState(false);

  const ir = async () => {
    setBuscando(true);
    setNoEsta(false);
    try {
      const hueco = await resolver(codigo);
      if (!hueco) {
        setNoEsta(true);
        return;
      }
      const p = new URLSearchParams({ view: 'rack', location: hueco.locationId });
      if (hueco.rackId) p.set('rack', hueco.rackId);
      navigate(`/spatial?${p.toString()}`);
    } catch {
      setNoEsta(true);
    } finally {
      setBuscando(false);
    }
  };

  if (noEsta) {
    //  Se dice que el catalogo no lo tiene, en vez de dejar el boton como si no hubiera
    //  pasado nada. La lectura es buena; lo que falta es la ubicacion en el catalogo.
    return (
      <span className="t-mono-xs text-[var(--text-warn)]" title={codigo}>
        no está en el catálogo
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={ir}
      disabled={buscando}
      data-mapa={codigo}
      className="t-mono-xs inline-flex items-center gap-1 text-[var(--text-accent)] hover:underline disabled:opacity-50"
      title={`Abrir el alzado del rack en ${codigo}`}
    >
      <MapPin strokeWidth={1.5} className="size-3" />
      {buscando ? 'buscando…' : 'ver'}
    </button>
  );
}


/** En cuál de los tres grupos cae cada estado de 0064, y cómo se dice en castellano. */
const ESTADOS: Record<
  ReconcileStatus,
  { grupo: 'cuadra' | 'discrepa' | 'sin_ver'; texto: string; explica: string }
> = {
  verified_empty: {
    grupo: 'cuadra',
    texto: 'vacío confirmado',
    explica: 'El hueco está vacío y el WMS tampoco esperaba nada.',
  },
  verified_match: {
    grupo: 'cuadra',
    texto: 'coincide',
    explica: 'El pallet que hay es el que el WMS declara.',
  },
  unexpected_empty: {
    grupo: 'discrepa',
    texto: 'vacío inesperado',
    explica: 'El WMS declara mercancía aquí y el hueco está vacío.',
  },
  unexpected_pallet: {
    grupo: 'discrepa',
    texto: 'pallet inesperado',
    //  Cubre los DOS casos que la vista mete aquí: que el WMS no declare nada, y que
    //  declare otro pallet distinto. La columna «el WMS declara» dice cuál de los dos es.
    explica: 'El pallet que hay no es el que el WMS declara en este hueco.',
  },
  /**
   * SE LEYÓ EL CÓDIGO Y EL CATÁLOGO NO LO TIENE (0090).
   *
   * Va en «no cuadra» y no en «no se pudo ver», y la diferencia no es cosmética: cada
   * grupo prescribe una acción. «No se pudo ver» dice VUELVE A GRABAR, y aquí grabar otra
   * vez no arregla nada — la etiqueta se leyó perfectamente, tres veces en el caso medido—.
   * Lo que hay que hacer es dar de alta esa ubicación o corregir la etiqueta del montante.
   *
   * Es, además, un hallazgo de los buenos: una etiqueta física que ningún sistema del
   * almacén conoce. Esconderlo entre los «repite la captura» lo perdería.
   */
  location_unknown: {
    grupo: 'discrepa',
    texto: 'hueco fuera del catálogo',
    explica:
      'El código del hueco se leyó bien, pero no existe en el catálogo del almacén. ' +
      'Repetir la grabación no cambia nada: o falta dar de alta esa ubicación, o la ' +
      'etiqueta está mal puesta.',
  },
  pallet_without_qr: {
    grupo: 'sin_ver',
    texto: 'sin identificar',
    explica: 'Hay bulto pero no se pudo leer su etiqueta, así que no se sabe cuál es.',
  },
  location_qr_unreadable: {
    grupo: 'sin_ver',
    texto: 'hueco no identificado',
    explica:
      'No se leyó el código del hueco, así que la lectura no se puede atribuir a ninguna ubicación.',
  },
  obstructed: {
    grupo: 'sin_ver',
    texto: 'tapado',
    explica: 'Algo bloqueaba la vista del hueco.',
  },
  not_scanned: {
    grupo: 'sin_ver',
    texto: 'sin revisar',
    explica: 'El modelo no se pronunció sobre el contenido de este hueco.',
  },
  manual_review: {
    grupo: 'sin_ver',
    texto: 'a revisar a mano',
    explica:
      'La combinación de lo observado no encaja en ningún caso claro. Lo decide una persona.',
  },
};

const GRUPOS = {
  cuadra: {
    titulo: 'Cuadra',
    color: 'var(--text-ok)',
    icono: CheckCircle2,
    ayuda: 'El WMS y lo observado coinciden. Nada que hacer.',
  },
  discrepa: {
    titulo: 'No cuadra',
    color: 'var(--state-critical)',
    icono: AlertTriangle,
    ayuda: 'Se contradicen. Aquí hay trabajo.',
  },
  sin_ver: {
    titulo: 'No se pudo ver',
    color: 'var(--text-warn)',
    icono: Eye,
    ayuda: 'No dice que esté bien: dice que hay que volver a capturar.',
  },
} as const;

type Grupo = keyof typeof GRUPOS;

function mensaje(e: unknown, porOmision: string): string {
  if (e instanceof ApiError) return humanMessage(e);
  if (e instanceof Error && e.message) return e.message;
  return porOmision;
}

/** Los tres recuentos, que es lo primero que se lee. */
function Recuentos({
  resultado,
  activo,
  onElegir,
}: {
  resultado: ReconcileResult;
  activo: Grupo | null;
  onElegir: (g: Grupo | null) => void;
}) {
  const porGrupo: Record<Grupo, number> = { cuadra: 0, discrepa: 0, sin_ver: 0 };
  for (const s of resultado.summary) {
    const meta = ESTADOS[s.status];
    if (meta) porGrupo[meta.grupo] += s.count;
  }
  const total = porGrupo.cuadra + porGrupo.discrepa + porGrupo.sin_ver;

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(GRUPOS) as Grupo[]).map((g) => {
        const meta = GRUPOS[g];
        const Icono = meta.icono;
        const n = porGrupo[g];
        const seleccionado = activo === g;
        return (
          <button
            key={g}
            type="button"
            // Filtrar por grupo, y volver a pulsar lo quita. Es la acción que sigue a
            // leer el recuento: «12 no cuadran» → «enséñame esas 12».
            onClick={() => onElegir(seleccionado ? null : g)}
            aria-pressed={seleccionado}
            title={meta.ayuda}
            className={cn(
              'flex min-w-[150px] flex-1 flex-col gap-1 rounded-[var(--radius-sm)] p-3 text-left',
              '[background:var(--glass-2)] shadow-[var(--rim-1)] transition-shadow',
              seleccionado && 'shadow-[var(--focus-ring)]',
              n === 0 && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-1.5">
              <Icono strokeWidth={1.5} className="size-3.5" style={{ color: meta.color }} />
              <span className="t-label text-[var(--text-secondary)]">{meta.titulo}</span>
            </span>
            <span
              className="text-[length:var(--text-2xl)] font-[var(--weight-light)] tabular-nums"
              style={{ color: n === 0 ? 'var(--text-faint)' : meta.color }}
            >
              {n}
            </span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {total > 0 ? `${Math.round((n / total) * 100)} % de ${total}` : 'sin lecturas'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Tabla({
  filas,
  sinCorte,
}: {
  filas: ReconcileRow[];
  /** No hay ningún corte del WMS importado. Distingue las dos causas de «sin dato». */
  sinCorte: boolean;
}) {
  if (filas.length === 0) {
    return (
      <p className="t-mono-xs text-[var(--text-faint)]">
        Ninguna lectura en este grupo.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['hueco', 'observado', 'pallet leído', 'el WMS declara', 'resultado', ''].map(
              (c, n) => (
                <th key={c || `col${n}`} className="t-label py-2 pr-4 text-left">
                  {c}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const meta = ESTADOS[f.status];
            const color = meta ? GRUPOS[meta.grupo].color : 'var(--text-faint)';
            return (
              <tr key={i} className="border-t border-[var(--hairline)]">
                <td
                  className={cn(
                    't-mono-xs py-1.5 pr-4',
                    f.locationCode
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-faint)]',
                  )}
                >
                  {/* Sin código no se inventa uno: la lectura existe y no se sabe de
                      dónde es. Ver la nota de `location_qr_unreadable`. */}
                  {f.locationCode ?? 'sin identificar'}
                </td>
                <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-secondary)]">
                  {f.content}
                </td>
                <td
                  className={cn(
                    't-mono-xs py-1.5 pr-4',
                    f.palletCodeObserved
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-faint)]',
                  )}
                >
                  {f.palletCodeObserved ?? '—'}
                </td>
                <td className="t-mono-xs py-1.5 pr-4 text-[var(--text-secondary)]">
                  {/*
                    `expectedRows` a `null` tiene DOS causas y decían lo mismo:

                      · no hay ningún corte del WMS importado
                      · sí lo hay, pero esta lectura no se pudo atribuir a un hueco,
                        así que no existe un «esperado» que buscar

                    La segunda es la frecuente y ponía «sin corte», que es FALSO cuando
                    el corte está ahí. Visto en pantalla con un corte importado y una
                    lectura sin código de hueco legible.
                  */}
                  {f.expectedRows !== null
                    ? f.wmsExpectsPallet
                      ? `${f.expectedRows} línea(s)${f.expectedPallet ? ` · ${f.expectedPallet}` : ''}`
                      : 'nada'
                    : sinCorte
                      ? 'sin corte del WMS'
                      : 'nada que comparar'}
                </td>
                <td className="t-mono-xs py-1.5 pr-4" title={meta?.explica}>
                  <span style={{ color }}>{meta?.texto ?? f.status}</span>
                </td>
                <td className="py-1.5">
                  {/*
                    Solo con un código de hueco COMPLETO: sin los cuatro niveles no hay celda
                    que abrir, y un botón que llevara al rack entero prometería una precisión
                    que la lectura no tiene.
                  */}
                  {esUbicacionCompleta(f.locationCode) && (
                    <IrAlHueco codigo={f.locationCode as string} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReconciliationPanel({
  jobId,
  puedeReconciliar,
}: {
  jobId: string;
  /** `false` mientras el trabajo no esté completado: sus detecciones pueden cambiar. */
  puedeReconciliar: boolean;
}) {
  const reconciliar = useReconcile(jobId);
  const [error, setError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo | null>(null);

  const resultado = reconciliar.data ?? null;
  const filas = resultado
    ? resultado.rows.filter((f) => {
        if (grupo === null) return true;
        return ESTADOS[f.status]?.grupo === grupo;
      })
    : [];

  return (
    <Panel>
      <PanelHeader
        title="Reconciliación con el WMS"
        subtitle="Lo observado frente a lo que el sistema declara"
      />

      <div className="flex flex-col gap-3 p-4 pt-0">
        {!resultado && (
          <>
            <p className="t-mono-xs text-[var(--text-faint)]">
              Convierte las detecciones en lecturas de inventario y las compara con el
              último corte del WMS. Cada reconciliación crea un{' '}
              <strong className="text-[var(--text-secondary)]">recorrido nuevo</strong>:
              hacerla dos veces no sustituye a la anterior, añade otra.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={!puedeReconciliar}
                loading={reconciliar.isPending}
                onClick={() => {
                  setError(null);
                  reconciliar
                    .mutateAsync('drone')
                    .catch((e: unknown) =>
                      setError(mensaje(e, 'No se pudo reconciliar.')),
                    );
                }}
              >
                <ScanSearch strokeWidth={1.5} className="mr-1.5 size-3.5" />
                Reconciliar contra el WMS
              </Button>
              {!puedeReconciliar && (
                // El motivo, no solo el botón apagado: un control muerto sin
                // explicación se lee como un fallo del producto.
                <span className="t-mono-xs text-[var(--text-faint)]">
                  Solo cuando la inspección esté completada: hasta entonces sus
                  detecciones todavía pueden cambiar.
                </span>
              )}
            </div>
          </>
        )}

        {error && <AsyncStatus phase="error" errorLabel={error} />}

        {resultado && (
          <>
            {/* El aviso del backend, tal cual. Sin corte del WMS las lecturas se
                guardan y no hay con qué compararlas, y una tabla vacía sin
                explicación se lee como «todo cuadra». */}
            {resultado.warning && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 [background:color-mix(in_oklab,var(--state-alert)_10%,transparent)]">
                <AlertTriangle
                  strokeWidth={1.5}
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--text-warn)]"
                />
                <span className="t-mono-xs text-[var(--text-warn)]">
                  {resultado.warning}
                </span>
              </div>
            )}

            <Recuentos resultado={resultado} activo={grupo} onElegir={setGrupo} />

            <p className="t-mono-xs text-[var(--text-faint)]">
              {resultado.detections} detecciones → {resultado.readings} lectura(s) de
              inventario
              {resultado.emptyFrames > 0 &&
                ` · ${resultado.emptyFrames} fotograma(s) sin nada que leer`}
              {grupo !== null && ` · filtrando: ${GRUPOS[grupo].titulo.toLowerCase()}`}
            </p>

            {/*
              ── EL RUIDO DE LECTURA, DICHO ────────────────────────────────────────

              Un texto que el OCR devolvió y no tiene forma de código —`1 1 W`, `2 2 7`, `5`—
              se descarta, porque antes entraba como código LEÍDO: de 80 lecturas de un
              recorrido real, unas 40 afirmaban haber leído un hueco inexistente.

              Se dice el número porque es un diagnóstico del RECORRIDO, no un detalle
              técnico: si son muchos, el problema no es que haya pocas etiquetas, es que no
              se están leyendo — y la respuesta es volver a grabar más cerca, no revisar
              filas una a una.
            */}
            {resultado.discardedTexts > 0 && (
              <p className="t-mono-xs max-w-[86ch] text-[var(--text-faint)]">
                Se descartaron <strong>{resultado.discardedTexts}</strong> texto(s) que no
                tienen forma de código de hueco ni de pallet: ruido del lector. No cuentan
                como lectura — un código inventado sería peor que ninguno.
                {resultado.discardedTexts >= resultado.readings && (
                  <>
                    {' '}
                    Y son tantos como lecturas buenas o más, así que esto es un problema de
                    captura: la etiqueta tiene que llegar más grande y más nítida.
                  </>
                )}
              </p>
            )}

            {/* Clases que el modelo detecta y el puente no sabe interpretar. Es un
                aviso y no un fallo: significa que el vocabulario del modelo y el del
                puente se han separado, y eso hay que verlo. */}
            {resultado.unknownClasses.length > 0 && (
              <p className="t-mono-xs text-[var(--text-warn)]">
                Clases que este puente no interpreta:{' '}
                {resultado.unknownClasses.join(', ')}. Sus detecciones no producen
                lectura.
              </p>
            )}

            <Tabla filas={filas} sinCorte={resultado.wmsSnapshotId === null} />
          </>
        )}
      </div>
    </Panel>
  );
}
