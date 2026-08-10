/**
 * AUDITORÍA — quién cambió qué, y cuándo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL REGISTRO SE LEE COMO FRASES, NO COMO UNA TABLA DE COLUMNAS
 *
 * `UPDATE · incidents.incidents · status: open→in_progress` es correcto y no se lee.
 * «Andrey Rojas cambió una incidencia · estado: abierta → en curso» sí. Quien audita
 * está reconstruyendo qué pasó, no consultando una base de datos.
 *
 * Por eso el nombre de la tabla se traduce (`TABLAS` en types.ts) y la operación se
 * convierte en verbo. El nombre real del esquema sigue estando, en pequeño, porque es
 * el que sirve para volver a consultar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LO QUE NO SE AUDITA SE DICE ARRIBA, NO EN UNA NOTA AL PIE
 *
 * El silencio de un registro de auditoría se lee como «no pasó nada». Y aquí hay cosas
 * que deliberadamente no se auditan: las 41.055 filas de stock de cada importación, las
 * 29.312 ubicaciones del catálogo, las imágenes del dataset.
 *
 * Sin decirlo, alguien mira un registro sin entradas de inventario y concluye que nadie
 * ha importado nada. Con decirlo, entiende que una importación es UNA decisión y que
 * está registrada como tal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO HAY NI UN BOTÓN QUE ESCRIBA
 *
 * Y no es que falten: `olo_app` no tiene privilegio de INSERT sobre `audit.entries`
 * (migración 0085). Escriben los triggers del motor. Un botón de «borrar entrada»
 * fallaría en la base — y si no fallara, este módulo no serviría para nada.
 */

import { useState } from 'react';
import { Eye, ShieldCheck, ShieldOff } from 'lucide-react';

import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { Badge, Button } from '../../../design/primitives';
import { cn } from '../../../design/utils/cn';
import { ApiError } from '../../../lib/apiErrors';
import { CanvasHost } from '../../../shell/CanvasHost';
import { useRegistro } from '../useAudit';
import {
  OPERACIONES,
  etiquetaTabla,
  type AuditEntry,
  type AuditOperation,
  type WatchedTable,
} from '../types';

const POR_PAGINA = 50;

/**
 * Campos de contabilidad, que se omiten al pintar una fila creada o borrada.
 *
 * Lista EXPLÍCITA y no `k.endsWith('_at')`, que era lo que había: esa regla escondía
 * `resolved_at`, `taken_at`, `expires_at` y `deleted_at`, que son datos de verdad. Y en
 * un borrado esa vista es lo **único** que queda de la fila en el sistema, así que
 * esconder de más ahí no es ruido menos: es información perdida.
 */
const CONTABILIDAD = new Set([
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'version',
  // El tenant es el mismo en todas las filas que esta persona puede ver: RLS ya lo
  // garantiza, así que repetirlo en cada entrada no añade nada.
  'tenant_id',
]);

export function AuditPage() {
  const [tabla, setTabla] = useState<string | null>(null);
  const [operacion, setOperacion] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<number | null>(null);
  // Las escrituras de la suite de tests, fuera por defecto: corre contra esta misma base
  // y deja ~150 entradas por ejecución. No se esconden en silencio — abajo se dice
  // cuántas son.
  const [pruebas, setPruebas] = useState(false);

  const { data, isLoading, isError, error, isFetching } = useRegistro({
    tabla,
    operacion,
    actor,
    pagina,
    porPagina: POR_PAGINA,
    pruebas,
  });

  // Cambiar de filtro vuelve a la página 1. Sin esto, quien esté en la página 8 y
  // filtre por algo con 12 entradas se queda mirando una tabla vacía sobre un recuento
  // que dice 12.
  const filtrar = (accion: () => void) => {
    accion();
    setPagina(1);
    setAbierta(null);
  };

  // 403 tiene su propia respuesta: no es un fallo, es que este registro no es para
  // cualquiera. Decir «no se pudo cargar» mandaría a alguien a buscar una avería.
  if (isError && error instanceof ApiError && error.status === 403) {
    return (
      <CanvasHost mode="grid">
        <Panel level="work" radius="xl">
          <PanelHeader
            title="Auditoría"
            subtitle="Quién cambió qué, y cuándo."
          />
          <p className="t-mono-xs mt-3 max-w-[76ch] text-[var(--text-faint)]">
            No tienes el permiso <code>audit:read</code>. El registro dice quién hizo qué,
            o sea que es información sobre las personas que trabajan aquí — por eso no se
            hereda de poder entrar al sistema. Lo tienen el administrador del tenant y el
            rol de auditor.
          </p>
        </Panel>
      </CanvasHost>
    );
  }

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Auditoría
          </h1>
          <p className="t-panel-sub mt-1 max-w-[68ch]">
            Quién cambió qué, y cuándo. Lo captura la <strong>base de datos</strong>, no
            la aplicación: un cambio hecho desde una herramienta o desde el panel de
            Supabase también deja rastro.
          </p>
        </div>

        {data && <Cobertura watched={data.watched} />}

        <Panel level="work" radius="xl">
          <PanelHeader
            title="El registro"
            subtitle="Lo más reciente primero. Cada fila se abre para ver qué cambió exactamente."
          />

          {isLoading && (
            <div className="mt-3">
              <AsyncStatus phase="pending" pendingLabel="Leyendo el registro" />
            </div>
          )}
          {isError && !(error instanceof ApiError && error.status === 403) && (
            <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
              No se pudo leer el registro.
            </p>
          )}

          {data && (
            <>
              {/* ── Filtros ────────────────────────────────────────────── */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Chip
                  activo={!operacion}
                  onClick={() => filtrar(() => setOperacion(null))}
                  etiqueta="Todo"
                  cuenta={data.total}
                />
                {(['INSERT', 'UPDATE', 'DELETE'] as AuditOperation[]).map((op) => (
                  <Chip
                    key={op}
                    activo={operacion === op}
                    onClick={() => filtrar(() => setOperacion(operacion === op ? null : op))}
                    etiqueta={OPERACIONES[op].verbo}
                    cuenta={data.summary
                      .filter((s) => s.operation === op)
                      .reduce((a, s) => a + s.n, 0)}
                    tono={OPERACIONES[op].tono}
                  />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="t-label flex items-center gap-2 text-[var(--text-muted)]">
                  qué
                  <select
                    value={tabla ?? ''}
                    onChange={(e) => filtrar(() => setTabla(e.target.value || null))}
                    className="h-8 max-w-[30ch] rounded-[var(--radius-xs)] px-2 text-[length:var(--text-xs)] text-[var(--text-primary)] [background:var(--glass-2)] pointer-coarse:min-h-11"
                  >
                    <option value="">Todo</option>
                    {/* Solo lo que TIENE entradas: un desplegable con 27 tablas de las
                        que 22 están vacías obliga a probarlas una a una. */}
                    {[...new Set(data.summary.map((s) => s.tabla))].map((t) => (
                      <option key={t} value={t}>
                        {etiquetaTabla(t.split('.')[0] ?? '', t.split('.')[1] ?? '')}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="t-label flex items-center gap-2 text-[var(--text-muted)]">
                  quién
                  <select
                    value={actor ?? ''}
                    onChange={(e) => filtrar(() => setActor(e.target.value || null))}
                    className="h-8 max-w-[30ch] rounded-[var(--radius-xs)] px-2 text-[length:var(--text-xs)] text-[var(--text-primary)] [background:var(--glass-2)] pointer-coarse:min-h-11"
                  >
                    <option value="">Cualquiera</option>
                    {data.actors
                      .filter((a) => a.actor_user_id)
                      .map((a) => (
                        <option key={a.actor_user_id} value={a.actor_user_id ?? ''}>
                          {a.actor_name ?? a.email} · {a.n}
                        </option>
                      ))}
                  </select>
                </label>

                {(tabla || operacion || actor) && (
                  <button
                    type="button"
                    onClick={() =>
                      filtrar(() => {
                        setTabla(null);
                        setOperacion(null);
                        setActor(null);
                      })
                    }
                    className="t-mono-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                  >
                    quitar filtros
                  </button>
                )}

                {isFetching && (
                  <span className="t-mono-xs text-[var(--text-faint)]">actualizando…</span>
                )}
              </div>

              {/*
                ── LO QUE SE DEJA FUERA, SE CUENTA ──────────────────────────
                La suite de tests escribe en esta misma base —hay una sola instancia de
                Supabase— y deja ~150 entradas por ejecución. Quitarlas sin decirlo sería
                lo mismo que perderlas: quien mira el registro no tendría forma de saber
                que había algo más.
              */}
              {data.test_total > 0 && (
                <label className="mt-3 flex flex-wrap items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={pruebas}
                    onChange={(e) => filtrar(() => setPruebas(e.target.checked))}
                    className="h-4 w-4 accent-[var(--accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                  />
                  {pruebas ? (
                    <>
                      Se están mostrando las{' '}
                      <strong>{data.test_total.toLocaleString('es')}</strong> entradas de la
                      suite de tests, mezcladas con las reales.
                    </>
                  ) : (
                    <>
                      <strong>{data.test_total.toLocaleString('es')}</strong> entradas
                      ocultas: son escrituras de la suite de tests, que corre contra esta
                      misma base. Están guardadas, no borradas.
                    </>
                  )}
                </label>
              )}

              {/* Las entradas sin persona detrás se cuentan aparte. Esconderlas daría
                  la impresión de que todo cambio tiene un responsable humano. */}
              {data.actors.some((a) => !a.actor_user_id) && (
                <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
                  {data.actors
                    .filter((a) => !a.actor_user_id)
                    .map((a) => `${a.n} entradas sin persona detrás (${a.db_role})`)
                    .join(' · ')}
                  {' '}— migraciones y herramientas de línea de comandos.
                </p>
              )}

              {data.entries.length === 0 ? (
                <p className="t-mono-xs mt-4 max-w-[76ch] text-[var(--text-faint)]">
                  {data.total === 0 && !tabla && !operacion && !actor
                    ? data.test_total > 0
                      ? `No hay ninguna escritura de operación todavía: las ${data.test_total.toLocaleString('es')} entradas que hay son de la suite de tests. Marca la casilla de arriba para verlas.`
                      : 'El registro está vacío. Se llena a partir de ahora: la captura se instaló con la migración 0085, así que lo que pasó antes no está — no se puede reconstruir lo que nadie guardó.'
                    : 'Con estos filtros no hay nada. Prueba a quitarlos.'}
                </p>
              ) : (
                <>
                  <div className="mt-4 flex flex-col">
                    {data.entries.map((e) => (
                      <Fila
                        key={e.id}
                        e={e}
                        abierta={abierta === e.id}
                        onAlternar={() => setAbierta(abierta === e.id ? null : e.id)}
                      />
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="t-mono-xs text-[var(--text-faint)]">
                      {((data.page - 1) * data.page_size + 1).toLocaleString('es')}–
                      {((data.page - 1) * data.page_size + data.entries.length).toLocaleString('es')}{' '}
                      de {data.total.toLocaleString('es')}
                    </p>
                    {data.pages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={data.page <= 1}
                          onClick={() => {
                            setPagina(data.page - 1);
                            setAbierta(null);
                          }}
                        >
                          Anterior
                        </Button>
                        <span className="t-mono-xs text-[var(--text-muted)]">
                          {data.page} / {data.pages}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={data.page >= data.pages}
                          onClick={() => {
                            setPagina(data.page + 1);
                            setAbierta(null);
                          }}
                        >
                          Siguiente
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </div>
    </CanvasHost>
  );
}

/**
 * Qué se vigila y qué no.
 *
 * Va ARRIBA del registro y no en una nota al pie, porque es lo que impide leer un
 * registro corto como «aquí no pasa nada». Y `activo` sale de `pg_trigger`: si alguien
 * desactiva un trigger, esto lo dice en vez de seguir prometiendo cobertura.
 */
function Cobertura({ watched }: { watched: WatchedTable[] }) {
  const [abierto, setAbierto] = useState(false);
  const caidos = watched.filter((w) => !w.activo);

  return (
    <Panel level="work" radius="xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {caidos.length === 0 ? (
            <ShieldCheck size={18} aria-hidden className="text-[var(--text-ok)]" />
          ) : (
            <ShieldOff size={18} aria-hidden className="text-[var(--crimson-400)]" />
          )}
          <div>
            <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
              {caidos.length === 0
                ? `${watched.length} tablas vigiladas`
                : `${caidos.length} de ${watched.length} tablas SIN vigilancia`}
            </p>
            <p className="t-mono-xs text-[var(--text-faint)]">
              {caidos.length === 0
                ? 'Cada INSERT, UPDATE y DELETE deja entrada, venga de la aplicación o de una herramienta.'
                : `Alguien desactivó el trigger en: ${caidos
                    .map((w) => `${w.schema_name}.${w.table_name}`)
                    .join(', ')}`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAbierto(!abierto)}>
          <Eye size={14} aria-hidden /> {abierto ? 'Ocultar' : 'Ver qué se audita'}
        </Button>
      </div>

      {abierto && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {watched.map((w) => (
              <span
                key={`${w.schema_name}.${w.table_name}`}
                className={cn(
                  'rounded-[var(--radius-xs)] px-2 py-1 text-[length:var(--text-xs)]',
                  w.activo
                    ? '[background:var(--glass-2)] text-[var(--text-secondary)]'
                    : 'bg-[color-mix(in_oklab,var(--state-critical)_20%,transparent)] text-[var(--crimson-400)]',
                )}
              >
                {etiquetaTabla(w.schema_name, w.table_name)}
              </span>
            ))}
          </div>

          {/*
            Y lo que NO se audita, con el motivo. Es la mitad importante: sin esto,
            alguien busca «quién importó el inventario» fila a fila y no lo encuentra.
          */}
          <div className="mt-4 rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
            <p className="t-label text-[var(--text-muted)]">lo que NO se audita</p>
            <p className="mt-1 max-w-[80ch] text-[length:var(--text-sm)] text-[var(--text-secondary)]">
              El stock (41.055 filas por importación), las 29.312 ubicaciones del
              catálogo, las imágenes y anotaciones del dataset, y las lecturas de los
              escaneos.
            </p>
            <p className="t-mono-xs mt-2 max-w-[80ch] text-[var(--text-faint)]">
              Y es deliberado: una importación del WMS es <strong>una</strong> decisión de
              una persona, ya registrada con su autor, su fichero y su hash. Auditarla
              fila a fila añadiría 41.055 entradas que dicen lo mismo y enterraría los
              cambios que sí importan —un permiso concedido, un almacén dado de alta—
              bajo un muro de ruido.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Una entrada, leída como una frase. Abierta, el diff completo. */
function Fila({
  e,
  abierta,
  onAlternar,
}: {
  e: AuditEntry;
  abierta: boolean;
  onAlternar: () => void;
}) {
  const op = OPERACIONES[e.operation as AuditOperation];
  const cuando = new Date(e.occurred_at);

  return (
    <div className="border-t border-[var(--rule)]">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:[background:var(--glass-1)]"
      >
        <span className="t-mono-xs w-[16ch] shrink-0 text-[var(--text-faint)]">
          {cuando.toLocaleString('es', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>

        <Badge tone={op?.tono ?? 'neutral'} size="sm">
          {op?.verbo ?? e.operation}
        </Badge>

        <span className="min-w-[18ch] flex-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {/*
            Quién, y cuando no hay persona se dice QUÉ fue en vez de «Sistema»:
            «una migración» y «una herramienta» son cosas distintas de «alguien que no
            puedo ver», y `db_role` es lo que las distingue.
          */}
          {e.actor_name ?? <span className="text-[var(--text-faint)]">sin persona</span>}
          <span className="t-mono-xs ml-2 text-[var(--text-muted)]">
            {etiquetaTabla(e.schema_name, e.table_name)}
          </span>
        </span>

        {/* El resumen del diff: hasta tres campos, y el resto contado. */}
        {e.diff.length > 0 && (
          <span className="t-mono-xs hidden text-[var(--text-muted)] md:inline">
            {e.diff.slice(0, 3).map((d) => d.field).join(', ')}
            {e.diff.length > 3 && ` +${e.diff.length - 3}`}
          </span>
        )}

        {/*
          La marca se ve en la fila, no solo en el interruptor: mezcladas con las reales,
          sin distintivo, alguien podria citar «Maria Rojas borro una colocacion de racks»
          como un hecho de operacion.
        */}
        {e.is_test && (
          <Badge tone="neutral" size="xs">
            prueba
          </Badge>
        )}

        {!e.actor_name && (
          <Badge tone="neutral" size="xs">
            {e.db_role}
          </Badge>
        )}
      </button>

      {abierta && <Detalle e={e} />}
    </div>
  );
}

function Detalle({ e }: { e: AuditEntry }) {
  return (
    <div className="pb-4">
      <div className="rounded-[var(--radius-sm)] p-3 [background:var(--glass-1)]">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Dato etiqueta="cuándo" valor={new Date(e.occurred_at).toLocaleString('es')} />
          <Dato etiqueta="tabla" valor={`${e.schema_name}.${e.table_name}`} />
          {e.row_id && <Dato etiqueta="fila" valor={e.row_id} />}
          <Dato etiqueta="rol de la base" valor={e.db_role} />
          {e.actor_email && <Dato etiqueta="correo" valor={e.actor_email} />}
        </div>

        {e.operation === 'UPDATE' && e.diff.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['campo', 'antes', 'después'].map((c) => (
                    <th key={c} className="t-label py-1 pr-4 text-left">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.diff.map((d) => (
                  <tr key={d.field} className="text-[length:var(--text-sm)]">
                    <td className="py-1 pr-4 font-[family-name:var(--font-data)] text-[var(--text-primary)]">
                      {d.field}
                    </td>
                    <td className="py-1 pr-4 text-[var(--text-muted)]">{valor(d.from)}</td>
                    <td className="py-1 pr-4 text-[var(--text-primary)]">{valor(d.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          En un INSERT o un DELETE no hay diff que enseñar: lo interesante es la fila
          entera. En el DELETE es además lo ÚNICO que queda de ella en el sistema.
        */}
        {e.operation !== 'UPDATE' && (
          <div className="mt-3">
            <p className="t-label text-[var(--text-muted)]">
              {e.operation === 'DELETE' ? 'lo que se borró' : 'lo que se creó'}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {Object.entries(e.before ?? e.after ?? {})
                .filter(([k]) => !CONTABILIDAD.has(k))
                .map(([k, v]) => (
                  <Dato key={k} etiqueta={k} valor={valor(v)} />
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <span className="t-mono-xs">
      <span className="text-[var(--text-faint)]">{etiqueta}</span>{' '}
      <span className="text-[var(--text-secondary)]">{valor}</span>
    </span>
  );
}

/**
 * Un valor de jsonb, en algo legible.
 *
 * `null` se pinta como «vacío» y no como la cadena `null`: en un diff, «de vacío a
 * Andrey» se entiende y «de null a Andrey» hace pensar en un fallo.
 */
function valor(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  // Un uuid completo ocupa una columna entera y no aporta: se recorta al trozo con el
  // que una persona lo reconoce al compararlo con otro.
  return s.length > 44 ? `${s.slice(0, 41)}…` : s;
}

function Chip({
  activo,
  onClick,
  etiqueta,
  cuenta,
  tono,
}: {
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
  cuenta?: number;
  tono?: 'confirmed' | 'alert' | 'critical';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'flex h-8 items-center gap-2 rounded-[var(--radius-xs)] px-3 text-[length:var(--text-xs)] transition-colors',
        'pointer-coarse:min-h-11',
        activo
          ? '[background:var(--glass-3)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:[background:var(--glass-2)]',
      )}
    >
      {etiqueta}
      {cuenta != null && (
        <Badge tone={tono ?? 'neutral'} size="xs">
          {cuenta.toLocaleString('es')}
        </Badge>
      )}
    </button>
  );
}
