/**
 * INVENTARIO — lo que el WMS declara, y lo que no cuadra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA PANTALLA EMPIEZA POR LOS DESCUADRES, NO POR LA OCUPACIÓN
 *
 * Un porcentaje de ocupación es un dato que se mira; una lista de 2.186 huecos que se
 * contradicen es una lista de trabajo. Y esto último es lo que hace que alguien abra
 * esta pantalla dos veces al día en lugar de una vez al mes.
 *
 * Por eso el orden es: la foto de la que salen los datos → los descuadres → la
 * ocupación por rack → el buscador. De más accionable a más contemplativo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA FECHA DE LA FOTO ESTÁ ARRIBA DEL TODO, Y NO ES DECORACIÓN
 *
 * Todo lo de aquí sale de un import del WMS (`inventory.wms_snapshots`), no de un
 * directo. Un «54 % de ocupación» sin fecha invita a decidir sobre una foto de hace
 * tres semanas creyendo que es de hoy. Se muestran las DOS fechas —cuándo se sacó del
 * WMS y cuándo se importó— porque a veces se separan por días, y la que manda es la
 * primera.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, PackageSearch, Search } from 'lucide-react';

import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge, Button } from '../../../design/primitives';
import { cn } from '../../../design/utils/cn';
import { CanvasHost } from '../../../shell/CanvasHost';
import {
  useAlmacenActivo,
  useBuscar,
  useContenido,
  useDescuadres,
  useHistorial,
  useOcupacionPorRack,
  useResolviendoAlmacen,
  useResumenInventario,
} from '../useInventory';
import { MISMATCH_INFO, type Mismatch, type MismatchKind } from '../types';

const CLASES: MismatchKind[] = [
  'dice_libre_con_stock',
  'dice_ocupado_sin_stock',
  'bloqueado_con_stock',
];

export function InventoryPage() {
  const almacen = useAlmacenActivo();
  const resolviendo = useResolviendoAlmacen();
  const resumen = useResumenInventario();

  // El vacío NO se pinta mientras todavía se está resolviendo qué almacén toca: decirle
  // a alguien «no tienes acceso» durante medio segundo, y que luego aparezcan los datos,
  // es peor que no decir nada.
  if (!almacen) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="xl">
          {resolviendo ? (
            <AsyncStatus phase="pending" pendingLabel="Buscando tus almacenes" />
          ) : (
            <p className="t-mono-xs text-[var(--text-faint)]">
              No tienes ningún almacén asignado, así que no hay inventario que mostrar.
              Pídele acceso a quien administre el sistema.
            </p>
          )}
        </Panel>
      </CanvasHost>
    );
  }

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Inventario
          </h1>
          <p className="t-panel-sub mt-1 max-w-[62ch]">
            Lo que el WMS declara que hay dentro del almacén. El <strong>edificio</strong>{' '}
            —qué huecos existen y cómo están— está en el explorador espacial; aquí está la{' '}
            <strong>mercadería</strong>.
          </p>
        </div>

        <Foto
          cargando={resumen.isLoading}
          error={resumen.isError}
          snapshot={resumen.data?.snapshot ?? null}
          resumen={resumen.data ?? null}
        />

        <Descuadres />

        <div className="grid grid-cols-12 gap-[var(--panel-gap)]">
          <div className="col-span-12 xl:col-span-7">
            <Racks />
          </div>
          <div className="col-span-12 xl:col-span-5">
            <Buscador />
          </div>
        </div>

        <Historial />
      </div>
    </CanvasHost>
  );
}

// ── La foto y sus cifras ────────────────────────────────────────────────────

function Foto({
  cargando,
  error,
  snapshot,
  resumen,
}: {
  cargando: boolean;
  error: boolean;
  snapshot: { taken_at: string; received_at: string; source: string; row_count: number } | null;
  resumen: {
    locations: number;
    occupied: number;
    free: number;
    occupancy_pct: number | null;
    pallets: number | null;
  } | null;
}) {
  if (cargando) {
    return (
      <Panel level="work" radius="xl">
        <AsyncStatus phase="pending" pendingLabel="Leyendo la foto del WMS" />
      </Panel>
    );
  }
  if (error || !resumen) {
    return (
      <Panel level="work" radius="xl">
        <p className="t-mono-xs text-[var(--text-faint)]">
          No se pudo leer el inventario de este almacén.
        </p>
      </Panel>
    );
  }
  if (!snapshot) {
    return (
      <Panel level="work" radius="xl">
        <PanelHeader title="Sin ninguna foto del WMS" />
        <p className="t-mono-xs mt-2 max-w-[70ch] text-[var(--text-faint)]">
          Este almacén no tiene ningún inventario importado, así que no hay nada que
          comparar. Se importa con <code>tools/import_inventory_snapshot.py</code>, no
          desde la aplicación: el WMS es el sistema de origen y esto es su espejo.
        </p>
      </Panel>
    );
  }

  return (
    <Panel level="work" radius="xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PanelHeader
          title="La foto del WMS"
          subtitle={`${snapshot.row_count.toLocaleString('es')} líneas importadas desde ${snapshot.source}`}
        />
        {/*
          Las DOS fechas. Se separan por días con frecuencia —el Excel se exporta un día
          y se importa otro— y la que manda para decidir es cuándo se sacó del WMS.
        */}
        <div className="text-right">
          <div className="t-label">sacada del WMS</div>
          <div className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
            {fecha(snapshot.taken_at)}
          </div>
          {/*
            La antigüedad, en palabras y arriba del todo. «29 jul» obliga a restar
            mentalmente; «hace 8 días» no, y es lo que decide si fiarse de todo lo demás
            de esta pantalla. Se avisa en ámbar a partir de una semana: a partir de ahí,
            un almacén que mueve mercadería a diario ya no se parece a esta foto.
          */}
          <div
            className={cn(
              't-mono-xs mt-1',
              diasDesde(snapshot.taken_at) >= 7
                ? 'text-[var(--text-warn)]'
                : 'text-[var(--text-muted)]',
            )}
          >
            {antiguedad(snapshot.taken_at)}
          </div>
          <div className="t-mono-xs mt-1 text-[var(--text-faint)]">
            importada {fecha(snapshot.received_at)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-[var(--space-10)] gap-y-4">
        <Cifra etiqueta="Ubicaciones" valor={resumen.locations} />
        <Cifra etiqueta="Con stock" valor={resumen.occupied} />
        <Cifra etiqueta="Vacías" valor={resumen.free} />
        <Cifra
          etiqueta="Ocupación"
          valor={resumen.occupancy_pct}
          sufijo="%"
          decimales={1}
        />
        {resumen.pallets != null && <Cifra etiqueta="Pallets" valor={resumen.pallets} />}
      </div>
    </Panel>
  );
}

// ── El historial de importaciones ───────────────────────────────────────────

/**
 * De dónde salen estos datos, y cuándo.
 *
 * ── LO QUE ESTE PANEL RESUELVE HOY ──────────────────────────────────────────
 *
 * Con una sola importación no hay comparación posible, así que lo que aporta es otra
 * cosa y no es menor: **decir cuántos días tiene la foto**. Todo lo de esta pantalla
 * —ocupación, descuadres, contenido de un hueco— describe el almacén de ese día, no el
 * de hoy, y esa diferencia es la que hace que alguien vaya al pasillo esperando algo
 * que ya no está.
 *
 * ── POR QUÉ SALEN LAS IMPORTACIONES FALLIDAS ────────────────────────────────
 *
 * Porque alguien lo intentó y no salió. Esconderlas haría que repitiera el intento a
 * ciegas, sin saber que ya había fallado antes ni por qué.
 */
function Historial() {
  const { data, isLoading, isError } = useHistorial();

  return (
    <Panel level="support" radius="xl">
      <PanelHeader
        title="Importaciones"
        subtitle="De dónde salen estos datos. Las que fallaron también aparecen."
      />

      {isLoading && (
        <div className="mt-3">
          <AsyncStatus phase="pending" pendingLabel="Leyendo el historial" />
        </div>
      )}
      {isError && (
        <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
          No se pudo leer el historial de importaciones.
        </p>
      )}

      {data && data.length === 0 && (
        <p className="t-mono-xs mt-3 max-w-[74ch] text-[var(--text-faint)]">
          Nadie ha importado inventario en este almacén todavía. Se hace con{' '}
          <code>tools/import_inventory_snapshot.py</code>, fuera de la aplicación: el WMS
          es el sistema de origen y esto es su espejo.
        </p>
      )}

      {data && data.length > 0 && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['sacada del WMS', 'importada', 'antigüedad', 'origen', 'líneas', 'estado'].map(
                    (c) => (
                      <th key={c} className="t-label py-2 pr-4 text-left">
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((s, i) => (
                  <tr
                    key={s.snapshot_id}
                    className="border-t border-[var(--rule)] text-[length:var(--text-sm)]"
                  >
                    <td className="py-2 pr-4 text-[var(--text-primary)]">
                      {fecha(s.taken_at)}
                      {/* La vigente es la primera de la lista, que viene ordenada. */}
                      {i === 0 && s.status === 'ready' && (
                        <span className="t-mono-xs ml-2 text-[var(--text-muted)]">
                          · la que se está usando
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-muted)]">
                      {fecha(s.received_at)}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-muted)]">
                      {antiguedad(s.taken_at)}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-muted)]">{s.source}</td>
                    <td className="py-2 pr-4 text-[var(--text-muted)]">
                      {s.row_count.toLocaleString('es')}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={cn(
                          't-mono-xs',
                          s.status === 'failed'
                            ? 'text-[var(--text-warn)]'
                            : 'text-[var(--text-muted)]',
                        )}
                      >
                        {s.status === 'ready'
                          ? 'lista'
                          : s.status === 'failed'
                            ? 'falló'
                            : s.status === 'loading'
                              ? 'a medias'
                              : s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Con una sola foto no hay nada que comparar. En lugar de un panel muerto que
            diga «sin datos», se explica QUÉ va a mostrar y CÓMO conseguirlo: así el
            vacío es una instrucción y no una decepción.
          */}
          {data.filter((s) => s.status === 'ready').length < 2 && (
            <p className="t-mono-xs mt-3 max-w-[76ch] text-[var(--text-faint)]">
              Con una sola importación no se puede comparar nada. Cuando haya una
              segunda, aquí se podrá ver qué descuadres son nuevos, cuáles se
              resolvieron y cuáles llevan semanas sin tocarse — que es lo que dice si el
              trabajo del pasillo está sirviendo de algo. Se importa con{' '}
              <code>tools/import_inventory_snapshot.py</code>.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Los descuadres: el trabajo ──────────────────────────────────────────────

function Descuadres() {
  const [clase, setClase] = useState<MismatchKind | null>(null);
  /**
   * Qué fila está abierta. Solo una: dos huecos desplegados a la vez obligan a
   * desplazarse para comparar, que es justo lo que se quería evitar abriéndolos.
   *
   * Vive aquí y no en la fila porque el detalle se pinta en una fila APARTE —son dos
   * sitios del DOM que comparten un estado—. Mismo patrón que la tabla de Configuración.
   */
  const [abierta, setAbierta] = useState<string | null>(null);
  // El filtro lo aplica el SERVIDOR. Filtrar aquí sobre lo descargado daba cero
  // resultados para clases que el recuento decía tener cientos: la lista viene acotada
  // a 200 y ordenada por clase, así que salían todas de la primera por alfabeto.
  const { data, isLoading, isError, isFetching } = useDescuadres(clase);
  const filtradas = data?.listed ?? [];

  return (
    <Panel level="work" radius="xl">
      <PanelHeader
        title="Lo que no cuadra"
        subtitle="Huecos donde el WMS se contradice consigo mismo. Cada uno es una comprobación en el pasillo."
      />

      {isLoading && (
        <div className="mt-3">
          <AsyncStatus phase="pending" pendingLabel="Calculando descuadres" />
        </div>
      )}
      {isError && (
        <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
          No se pudieron calcular los descuadres.
        </p>
      )}

      {data && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip
              activo={clase === null}
              onClick={() => setClase(null)}
              etiqueta="Todos"
              cuenta={data.total}
            />
            {CLASES.map((c) => (
              <Chip
                key={c}
                activo={clase === c}
                onClick={() => setClase(clase === c ? null : c)}
                etiqueta={MISMATCH_INFO[c].etiqueta}
                cuenta={data.counts[c] ?? 0}
                urgente={c === 'dice_libre_con_stock'}
              />
            ))}
          </div>

          {clase && (
            <div className="mt-3 rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
              <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
                {MISMATCH_INFO[clase].explica}
              </p>
              <p className="t-mono-xs mt-1 text-[var(--text-muted)]">
                {MISMATCH_INFO[clase].accion}
              </p>
            </div>
          )}

          {isFetching && (
            <div className="mt-3">
              <AsyncStatus phase="pending" pendingLabel="Filtrando" />
            </div>
          )}

          {data.total === 0 ? (
            <p className="t-mono-xs mt-4 text-[var(--text-faint)]">
              El WMS no se contradice en ningún hueco. Es un buen día.
            </p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['ubicación', 'dice el WMS', 'dice el catálogo', 'líneas', 'unidades', 'descuadre'].map((c) => (
                        <th key={c} className="t-label py-2 pr-4 text-left">
                          {c}
                        </th>
                      ))}
                      {/* `w-0`: la columna de abrir no debe robar ancho a los datos. */}
                      <th className="t-label w-0 py-2 text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((m) => (
                      <FilaDescuadre
                        key={m.location_id}
                        m={m}
                        abierta={abierta === m.location_id}
                        onAlternar={() =>
                          setAbierta(abierta === m.location_id ? null : m.location_id)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/*
                Que la lista esté acotada se DICE. `counts` sale del total y `listed` no:
                sin este aviso, contar las filas de la tabla daría un número menor que el
                real y nadie lo notaría.
              */}
              {data.truncated && (
                <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
                  Se muestran {data.listed.length} de {data.total.toLocaleString('es')}.
                  Los recuentos de arriba son del total, no de lo que se ve.
                </p>
              )}
            </>
          )}

          {data.orphan_lines > 0 && <Huerfanos data={data} />}
        </>
      )}
    </Panel>
  );
}

/**
 * Una fila de descuadre, y el contenido del hueco cuando se abre.
 *
 * El detalle va en una fila APARTE con `colSpan`, no dentro de una celda: metido en la
 * celda, el panel decide el ancho de esa columna y desmonta la tabla entera.
 */
function FilaDescuadre({
  m,
  abierta,
  onAlternar,
}: {
  m: Mismatch;
  abierta: boolean;
  onAlternar: () => void;
}) {
  const info = MISMATCH_INFO[m.mismatch as MismatchKind];
  return (
    <>
      <tr className="border-t border-[var(--rule)] text-[length:var(--text-sm)]">
        <td className="py-2 pr-4 font-[family-name:var(--font-data)] text-[var(--text-primary)]">
          {m.location_code}
        </td>
        <td className="py-2 pr-4 text-[var(--text-muted)]">{m.wms_situation ?? '—'}</td>
        <td className="py-2 pr-4 text-[var(--text-muted)]">{m.spatial_status}</td>
        <td className="py-2 pr-4 text-[var(--text-muted)]">{m.lines}</td>
        <td className="py-2 pr-4 text-[var(--text-muted)]">
          {m.units != null ? m.units.toLocaleString('es') : '—'}
        </td>
        <td className="py-2 pr-4">
          <span className="t-mono-xs text-[var(--text-warn)]">
            {info?.etiqueta ?? m.mismatch}
          </span>
        </td>
        <td className="py-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={onAlternar}
            aria-expanded={abierta}
            aria-label={`Ver qué hay en ${m.location_code}`}
          >
            <ChevronDown
              strokeWidth={1.5}
              className={cn('size-3.5 transition-transform', abierta && 'rotate-180')}
            />
            {abierta ? 'Cerrar' : '¿Qué hay?'}
          </Button>
        </td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={7} className="pb-4">
            <Contenido m={m} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Qué hay dentro del hueco, según la misma foto del WMS.
 *
 * ── EL VACÍO NO ES «SIN DATOS»: ES LA CONFIRMACIÓN DEL DESCUADRE ────────────
 *
 * En un hueco `ocupado sin stock`, que no salga ninguna línea es exactamente lo que se
 * venía a comprobar. Un «no hay datos» genérico haría dudar de si falló la consulta,
 * cuando el vacío ES la respuesta. Por eso el mensaje depende de la clase.
 */
function Contenido({ m }: { m: Mismatch }) {
  const { data, isLoading, isError } = useContenido(m.location_id);
  const [todas, setTodas] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
        <AsyncStatus phase="pending" pendingLabel={`Leyendo ${m.location_code}`} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
        <p className="t-mono-xs text-[var(--text-faint)]">
          No se pudo leer el contenido de {m.location_code}.
        </p>
      </div>
    );
  }

  if (data.lines.length === 0) {
    const confirmado = m.mismatch === 'dice_ocupado_sin_stock';
    return (
      <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
        <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {confirmado
            ? `Confirmado: el WMS da ${m.location_code} por ocupado y no tiene ninguna línea de stock.`
            : `${m.location_code} no tiene ninguna línea de stock en esta foto.`}
        </p>
        {confirmado && (
          <p className="t-mono-xs mt-1 text-[var(--text-muted)]">
            Si en el pasillo está vacío, el hueco se puede liberar en el WMS: ahora mismo
            está reservado sin nada dentro.
          </p>
        )}
      </div>
    );
  }

  // 143 líneas en un solo hueco es un caso REAL —medido en CAAU59-C001-N01-1— y sin
  // tope empujaría la tabla de descuadres fuera de la pantalla.
  const visibles = todas ? data.lines : data.lines.slice(0, 15);

  return (
    <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="t-label">
          {data.lines.length.toLocaleString('es')} línea(s) en {data.location_code}
        </span>
        {m.mismatch === 'dice_libre_con_stock' && (
          <span className="t-mono-xs text-[var(--text-warn)]">
            El WMS lo da por libre: esto es lo que hay dentro de verdad.
          </span>
        )}
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['pallet', 'artículo', 'descripción', 'cantidad', 'lote', 'caduca'].map((c) => (
                <th key={c} className="t-label py-1.5 pr-4 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <tr key={l.id} className="text-[length:var(--text-sm)]">
                <td className="py-1.5 pr-4 font-[family-name:var(--font-data)] text-[var(--text-primary)]">
                  {l.pallet_code ?? '—'}
                </td>
                <td className="py-1.5 pr-4 text-[var(--text-muted)]">{l.sku ?? '—'}</td>
                <td className="py-1.5 pr-4 text-[var(--text-muted)]">
                  {l.description ?? '—'}
                </td>
                <td className="py-1.5 pr-4 text-[var(--text-muted)]">
                  {l.qty != null ? `${l.qty.toLocaleString('es')} ${l.uom ?? ''}` : '—'}
                </td>
                <td className="py-1.5 pr-4 text-[var(--text-faint)]">{l.lot ?? '—'}</td>
                <td className="py-1.5 pr-4 text-[var(--text-faint)]">
                  {l.expires_at ? fechaCorta(l.expires_at) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.lines.length > 15 && (
        <div className="mt-2">
          <Button variant="ghost" size="xs" onClick={() => setTodas(!todas)}>
            {todas
              ? 'Ver solo las 15 primeras'
              : `Ver las ${data.lines.length.toLocaleString('es')} líneas`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Stock en ubicaciones que el catálogo no tiene.
 *
 * Va aparte de los descuadres porque es un problema DISTINTO: no es que dos columnas
 * se contradigan, es que el WMS ubica mercadería en un sitio que el edificio no
 * conoce. O falta catálogo, o el código está mal escrito — y hasta saberlo, esa
 * mercadería no se puede ir a buscar.
 */
function Huerfanos({
  data,
}: {
  data: { orphan_lines: number; orphan_stock: { location_code: string; lines: number; pallets: number }[] };
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-5 border-t border-[var(--rule)] pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle strokeWidth={1.5} className="size-4 text-[var(--text-warn)]" />
        <span className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {data.orphan_lines.toLocaleString('es')} líneas de stock en ubicaciones que no
          existen en el catálogo
        </span>
        <Button variant="ghost" size="xs" onClick={() => setAbierto(!abierto)}>
          {abierto ? 'Ocultar' : 'Ver códigos'}
        </Button>
      </div>
      <p className="t-mono-xs mt-1 max-w-[76ch] text-[var(--text-faint)]">
        No es un descuadre entre columnas: el WMS ubica mercadería en huecos que el
        edificio no tiene. O el catálogo está incompleto, o el código está mal escrito en
        el WMS. Hasta saber cuál, esa mercadería no se puede encontrar.
      </p>
      {abierto && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.orphan_stock.map((o) => (
            <span
              key={o.location_code}
              className="t-mono-xs rounded-[var(--radius-xs)] px-2 py-1 text-[var(--text-muted)] [background:var(--glass-2)]"
            >
              {o.location_code} · {o.lines} línea(s)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ocupación por rack ──────────────────────────────────────────────────────

function Racks() {
  const { data, isLoading } = useOcupacionPorRack();
  const [todos, setTodos] = useState(false);

  // Los más llenos primero: un rack al 98 % es donde no va a caber lo siguiente, y
  // ordenar por código dejaría eso enterrado en la fila 200.
  const ordenados = useMemo(() => {
    if (!data) return [];
    return [...data.racks].sort((a, b) => (b.occupancy_pct ?? 0) - (a.occupancy_pct ?? 0));
  }, [data]);

  const visibles = todos ? ordenados : ordenados.slice(0, 12);

  return (
    <Panel level="support" radius="xl">
      <PanelHeader
        title="Ocupación por rack"
        subtitle="Los más llenos primero: es donde no va a caber lo siguiente"
      />
      {isLoading && (
        <div className="mt-3">
          <AsyncStatus phase="pending" pendingLabel="Calculando" />
        </div>
      )}
      {data && (
        <div className="mt-3 flex flex-col gap-1.5">
          {visibles.map((r) => (
            <div key={r.rack_id} className="flex items-center gap-3">
              <span className="t-mono-xs w-24 shrink-0 text-[var(--text-muted)]">
                {r.rack_code}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full [background:var(--glass-2)]">
                <div
                  className={cn(
                    'h-full rounded-full',
                    (r.occupancy_pct ?? 0) >= 90
                      ? 'bg-[var(--state-alert)]'
                      : 'bg-[var(--aqua-300)]',
                  )}
                  style={{ width: `${Math.min(100, r.occupancy_pct ?? 0)}%` }}
                />
              </div>
              <span className="t-mono-xs w-14 shrink-0 text-right text-[var(--text-muted)]">
                {r.occupancy_pct != null ? `${r.occupancy_pct.toFixed(0)}%` : '—'}
              </span>
              <span className="t-mono-xs w-20 shrink-0 text-right text-[var(--text-faint)]">
                {r.occupied}/{r.locations}
              </span>
            </div>
          ))}
          {ordenados.length > 12 && (
            <div className="mt-2">
              <Button variant="ghost" size="xs" onClick={() => setTodos(!todos)}>
                {todos ? 'Ver solo los 12 más llenos' : `Ver los ${ordenados.length} racks`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── El buscador del pasillo ─────────────────────────────────────────────────

/**
 * «¿Dónde está esto?» — la consulta que se hace de pie en el almacén, con el móvil.
 *
 * Por pallet O por artículo, nunca los dos: «el pallet X del artículo Y» es una
 * intersección que nadie pide, y aceptarla obligaría a decidir qué significa que no
 * coincidan.
 */
function Buscador() {
  const [por, setPor] = useState<'pallet' | 'sku'>('pallet');
  const [termino, setTermino] = useState('');
  const { data, isFetching } = useBuscar(por, termino);
  const corto = termino.trim().length > 0 && termino.trim().length < 2;

  return (
    <Panel level="support" radius="xl">
      <PanelHeader title="¿Dónde está?" subtitle="Busca un pallet o un artículo" />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['pallet', 'sku'] as const).map((p) => (
          <Chip
            key={p}
            activo={por === p}
            onClick={() => setPor(p)}
            etiqueta={p === 'pallet' ? 'Por pallet' : 'Por artículo'}
          />
        ))}
      </div>

      <label className="mt-3 flex h-10 items-center gap-2 rounded-[var(--radius-sm)] px-3 [background:var(--glass-2)] focus-within:shadow-[var(--focus-ring)]">
        <Search strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
        <input
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          placeholder={por === 'pallet' ? 'Código del pallet' : 'Código del artículo'}
          className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>

      {corto && (
        <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
          Escribe al menos dos caracteres.
        </p>
      )}
      {isFetching && (
        <div className="mt-3">
          <AsyncStatus phase="pending" pendingLabel="Buscando" />
        </div>
      )}

      {data && !isFetching && (
        <div className="mt-3">
          {data.hits.length === 0 ? (
            <p className="t-mono-xs text-[var(--text-faint)]">
              Nada con «{data.term}» en la foto del WMS. Ojo: si la mercadería entró
              después del último import, todavía no está aquí.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.hits.slice(0, 20).map((h, i) => (
                <div
                  key={`${h.location_code}-${h.pallet_code ?? i}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-xs)] p-2 [background:var(--glass-1)]"
                >
                  <PackageSearch
                    strokeWidth={1.5}
                    className="size-3.5 text-[var(--icon-muted)]"
                  />
                  <span className="font-[family-name:var(--font-data)] text-[length:var(--text-sm)] text-[var(--text-primary)]">
                    {h.location_code}
                  </span>
                  {h.pallet_code && (
                    <span className="t-mono-xs text-[var(--text-muted)]">{h.pallet_code}</span>
                  )}
                  {h.description && (
                    <span className="t-mono-xs text-[var(--text-faint)]">{h.description}</span>
                  )}
                  {h.qty != null && (
                    <span className="t-mono-xs ml-auto text-[var(--text-muted)]">
                      {h.qty.toLocaleString('es')} {h.uom ?? ''}
                    </span>
                  )}
                </div>
              ))}
              {data.hits.length > 20 && (
                <p className="t-mono-xs text-[var(--text-faint)]">
                  {data.hits.length - 20} resultado(s) más. Afina la búsqueda.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Chip({
  activo,
  onClick,
  etiqueta,
  cuenta,
  urgente,
}: {
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
  cuenta?: number;
  urgente?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'flex h-8 items-center gap-2 rounded-[var(--radius-xs)] px-3 text-[length:var(--text-xs)] transition-colors',
        // Igual que el resto de la aplicación: con un dedo, 44px.
        'pointer-coarse:min-h-11',
        activo
          ? '[background:var(--glass-3)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:[background:var(--glass-2)]',
      )}
    >
      {etiqueta}
      {cuenta != null && (
        <Badge tone={urgente && cuenta > 0 ? 'alert' : 'neutral'} size="sm">
          {cuenta.toLocaleString('es')}
        </Badge>
      )}
    </button>
  );
}

function Cifra({
  etiqueta,
  valor,
  sufijo,
  decimales = 0,
}: {
  etiqueta: string;
  valor: number | null;
  sufijo?: string;
  decimales?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="t-label">{etiqueta}</span>
      <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xl)] font-[var(--weight-light)] leading-none text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
        {valor != null ? valor.toLocaleString('es', { maximumFractionDigits: decimales }) : '—'}
        {valor != null && sufijo && (
          <span className="ml-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
            {sufijo}
          </span>
        )}
      </span>
    </div>
  );
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Cuántos días tiene la foto, en palabras.
 *
 * Es el dato que decide si fiarse: «29 jul» obliga a restar mentalmente, «hace 8 días»
 * no. Y lo que se cuenta es desde que se sacó del WMS, no desde que se importó — el
 * inventario describe el almacén del primer día, no del segundo.
 */
function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function antiguedad(iso: string): string {
  const dias = diasDesde(iso);
  if (dias < 0) return 'con fecha futura';
  if (dias === 0) return 'de hoy';
  if (dias === 1) return 'de ayer';
  if (dias < 31) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'hace más de un mes' : `hace ${meses} meses`;
}

/**
 * Solo la fecha, sin hora. La caducidad de un lote llega como `date`, no como instante:
 * añadirle una hora inventaría una precisión que el dato no tiene, y en zonas al oeste
 * de UTC `new Date('2026-08-06')` retrocede un día al pintarlo con hora local.
 */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
