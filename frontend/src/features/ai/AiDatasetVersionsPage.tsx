/**
 * VERSIONES DE DATASET — congelar el material y exportarlo para entrenar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO LO QUE ESTA PANTALLA HACE ES IRREVERSIBLE
 *
 * Una version congelada es INMUTABLE: la base aborta UPDATE y DELETE con un trigger.
 * Por eso la pantalla se organiza al reves de lo habitual: primero se MUESTRA lo que
 * va a entrar —con `preview`, que no escribe nada— y solo despues se ofrece el boton.
 *
 * Y por eso la confirmacion es en linea y de tres vias, no un `confirm()`: el
 * operador tiene que poder leer los recuentos mientras decide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EL EXPORT NO ES UNA DESCARGA DIRECTA
 *
 * Los binarios viven en Storage y no pasan por el backend. El export es un
 * MANIFIESTO: `data.yaml`, el contenido de cada `.txt` y una URL firmada por imagen.
 * Un script corto lo materializa en disco.
 *
 * Las URLs caducan en 15 minutos, asi que la pantalla lo dice y no cachea el
 * manifiesto: servir uno viejo seria entregar enlaces muertos.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, Database, Download, Snowflake } from 'lucide-react';

import { useSessionStore } from '../../auth/sessionStore';
import { AsyncStatus, fase } from '../../design/foundation/AsyncStatus';
import { ConfirmBar } from '../../design/foundation/ConfirmBar';
import { Panel } from '../../design/foundation/Panel';
import { PanelHeader } from '../../design/foundation/PanelHeader';
import { Badge } from '../../design/primitives/Badge';
import { Button } from '../../design/primitives/Button';
import { cn } from '../../design/utils/cn';
import { CanvasHost } from '../../shell/CanvasHost';
import { ApiError } from '../../lib/apiErrors';
import type { DatasetVersion } from '../../lib/aiTypes';
import { NotOwnerNotice } from './NotOwnerNotice';
import { useProject } from './useAi';
import {
  useDatasetPreview,
  useDatasetVersions,
  useFreezeDataset,
  useYoloExport,
} from './useDatasets';

/** Semilla por omision. FIJA y no aleatoria: dos congelados del mismo conjunto deben coincidir. */
const SEMILLA_POR_OMISION = 42;

export function AiDatasetVersionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const esOwner = useSessionStore((s) => s.profile?.is_platform_owner ?? false);

  const proyecto = useProject(projectId);
  const previa = useDatasetPreview(projectId);
  const versiones = useDatasetVersions(projectId);
  const congelar = useFreezeDataset(projectId ?? '');

  const [nombre, setNombre] = useState('');
  const [semilla, setSemilla] = useState(SEMILLA_POR_OMISION);
  const [confirmando, setConfirmando] = useState(false);
  const [errorCongelar, setErrorCongelar] = useState<string | null>(null);

  if (!esOwner) return <NotOwnerNotice />;

  const p = previa.data;

  const lanzar = () => {
    setErrorCongelar(null);
    congelar.mutate(
      {
        ...(nombre.trim() ? { name: nombre.trim() } : {}),
        split_seed: semilla,
      },
      {
        onSuccess: () => {
          setConfirmando(false);
          setNombre('');
        },
        onError: (e) => {
          setConfirmando(false);
          // El backend explica el motivo en lenguaje de operador —«ninguna imagen
          // esta lista», «no hay clases activas»— asi que se muestra tal cual.
          setErrorCongelar(e instanceof Error ? e.message : 'no se pudo congelar');
        },
      },
    );
  };

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div>
          <Link
            to={`/ai/projects/${projectId}`}
            className="t-mono-xs text-[var(--text-faint)] hover:underline"
          >
            ← {proyecto.data?.name ?? 'Proyecto'}
          </Link>
          <h1 className="mt-1 text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight text-[var(--text-primary)]">
            Versiones de dataset
          </h1>
        </div>

        {/* ── Que entraria ahora ─────────────────────────────────────────── */}
        <Panel level="decision" radius="lg" pad="lg">
          <PanelHeader
            title="Congelar una version"
            subtitle="Una version es inmutable: fija el reparto para que dos entrenamientos sean comparables"
          />

          {previa.isLoading && (
            <div className="mt-4">
              <AsyncStatus phase="pending" pendingLabel="Calculando que entraria" />
            </div>
          )}

          {previa.isError && (
            <div className="mt-4">
              <AsyncStatus
                phase="error"
                errorLabel="no se pudo leer el estado del proyecto"
                onRetry={() => void previa.refetch()}
              />
            </div>
          )}

          {p && (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Cifra etiqueta="imagenes" valor={p.total_images} />
                <Cifra etiqueta="elegibles" valor={p.eligible} acento />
                <Cifra etiqueta="con cajas" valor={p.with_annotations} />
                <Cifra etiqueta="anotaciones" valor={p.annotations} />
                <Cifra etiqueta="clases activas" valor={p.active_classes} />
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="t-label">por estado</span>
                {Object.entries(p.by_status).map(([estado, n]) => (
                  <span key={estado} className="t-mono-xs text-[var(--text-muted)]">
                    {estado} <span className="text-[var(--text-primary)]">{n}</span>
                  </span>
                ))}
              </div>

              {/*
                Solo entran `annotated` y `validated`. Se dice explicitamente porque
                un operador con 3 imagenes en `pending` que no aparecen en el dataset
                pensaria que hay un fallo.
              */}
              <p className="t-mono-xs mt-3 text-[var(--text-faint)]">
                Entran las imagenes en «annotated» y «validated». Una «validated» sin
                cajas es un NEGATIVO valido —«aqui no hay nada»— y el modelo aprende de
                ella. Las «pending» quedan fuera: cero cajas ahi significa que nadie ha
                mirado, no que no haya nada.
              </p>

              {!p.can_freeze && (
                <p className="t-small mt-3 text-[var(--state-alert)]">
                  {p.active_classes === 0
                    ? 'No hay clases activas. Un dataset sin vocabulario no puede entrenar nada.'
                    : 'Ninguna imagen tiene anotaciones todavia. Anota alguna antes de congelar.'}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="t-label">nombre (opcional)</span>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    maxLength={120}
                    placeholder={`v${p.next_version}`}
                    className="h-8 w-52 rounded-[var(--radius-xs)] px-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none [background:var(--glass-2)]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="t-label">semilla del reparto</span>
                  <input
                    type="number"
                    value={semilla}
                    min={0}
                    max={2147483647}
                    onChange={(e) => setSemilla(Number(e.target.value) || 0)}
                    className="h-8 w-28 rounded-[var(--radius-xs)] px-2 t-mono-xs text-[var(--text-primary)] outline-none [background:var(--glass-2)]"
                  />
                </label>

                <Button
                  variant="primary"
                  size="sm"
                  disabled={!p.can_freeze || congelar.isPending || confirmando}
                  onClick={() => setConfirmando(true)}
                >
                  <Snowflake strokeWidth={1.5} className="mr-1.5 size-3.5" />
                  Congelar v{p.next_version}
                </Button>

                <AsyncStatus
                  phase={errorCongelar ? 'error' : fase(congelar)}
                  pendingLabel="Congelando"
                  successLabel="Version congelada"
                  errorLabel={errorCongelar}
                />
              </div>

              {/*
                La semilla se explica donde se usa. Es el campo que un operador
                cambiaria «por probar» sin saber que rompe la comparabilidad.
              */}
              <p className="t-mono-xs mt-2 text-[var(--text-faint)]">
                La semilla determina el reparto y se guarda para poder reproducirlo.
                Manten la misma entre versiones para que dos entrenamientos sean
                comparables; cambiala solo si quieres un reparto distinto a proposito.
              </p>

              <ConfirmBar
                className="mt-3"
                open={confirmando}
                message={
                  `Se congelaran ${p.eligible} imagenes con ${p.annotations} anotaciones ` +
                  `y ${p.active_classes} clases. Una version NO se puede editar ni borrar.`
                }
                onCancel={() => setConfirmando(false)}
                cancelLabel="Cancelar"
                actions={[
                  { label: `Congelar v${p.next_version}`, preferred: true, onClick: lanzar },
                ]}
              />
            </>
          )}
        </Panel>

        {/* ── Versiones existentes ───────────────────────────────────────── */}
        {versiones.isLoading && (
          <AsyncStatus phase="pending" pendingLabel="Cargando versiones" />
        )}

        {versiones.data?.length === 0 && !versiones.isLoading && (
          <Panel level="work" radius="lg" pad="lg">
            <p className="t-body text-[var(--text-secondary)]">
              Sin versiones todavia. Congela una para poder entrenar.
            </p>
          </Panel>
        )}

        {versiones.data?.map((v) => (
          <TarjetaVersion key={v.id} version={v} projectId={projectId!} />
        ))}
      </div>
    </CanvasHost>
  );
}

function Cifra({
  etiqueta,
  valor,
  acento = false,
}: {
  etiqueta: string;
  valor: number;
  acento?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-label">{etiqueta}</dt>
      <dd
        className={cn(
          'text-[length:var(--text-lg)] font-[var(--weight-light)] tabular-nums',
          acento ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]',
        )}
      >
        {valor.toLocaleString('es')}
      </dd>
    </div>
  );
}

function TarjetaVersion({
  version,
  projectId,
}: {
  version: DatasetVersion;
  projectId: string;
}) {
  const [pedirExport, setPedirExport] = useState(false);
  const exportar = useYoloExport(projectId, version.id, pedirExport);
  const [copiado, setCopiado] = useState<string | null>(null);

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      window.setTimeout(() => setCopiado(null), 2000);
    } catch {
      // `clipboard` falla sin HTTPS o sin permiso. No se oculta: el operador tiene
      // que saber que NO se copio, o pegara algo viejo sin darse cuenta.
      setCopiado('error');
    }
  };

  const e = exportar.data;

  return (
    <Panel level="work" radius="lg" pad="lg">
      <PanelHeader
        title={version.name ? `v${version.version} · ${version.name}` : `v${version.version}`}
        subtitle={`Congelada el ${new Date(version.frozen_at).toLocaleString('es')}`}
        trailing={<Badge tone="measured" size="xs">inmutable</Badge>}
      />

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <Dato k="imagenes" v={String(version.image_count)} />
        <Dato k="train" v={String(version.train_count)} />
        <Dato k="val" v={String(version.val_count)} />
        <Dato k="test" v={String(version.test_count)} />
        <Dato k="semilla" v={String(version.split_seed)} />
        <Dato k="clases" v={String(version.class_snapshot.length)} />
      </dl>

      {/*
        El vocabulario congelado, con SU indice del proyecto. No es el que veran los
        pesos: eso lo remapea el export. Se muestran los dos para que la diferencia
        sea visible antes de entrenar, no despues.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="t-label">vocabulario congelado</span>
        {version.class_snapshot
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((c) => (
            <span key={c.index} className="t-mono-xs text-[var(--text-muted)]">
              <span className="text-[var(--text-faint)]">{c.index}</span> {c.name}
            </span>
          ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPedirExport(true)}
          disabled={exportar.isFetching}
        >
          <Download strokeWidth={1.5} className="mr-1.5 size-3.5" />
          Preparar export YOLO
        </Button>

        <AsyncStatus
          phase={pedirExport ? fase(exportar) : 'idle'}
          pendingLabel="Firmando URLs y armando el manifiesto"
          successLabel="Manifiesto listo"
          errorLabel={
            exportar.error instanceof ApiError
              ? exportar.error.message
              : 'no se pudo preparar el export'
          }
          onRetry={() => void exportar.refetch()}
          keepSuccess
        />
      </div>

      {e && (
        <div className="mt-5 flex flex-col gap-4">
          {!e.signed && (
            <p className="t-small text-[var(--state-alert)]">
              Este conjunto tiene {e.image_count} imagenes y supera el techo de{' '}
              {e.sign_limit} firmas por export, asi que llegan las rutas pero no las
              URLs. El script tendra que firmarlas por su cuenta.
            </p>
          )}

          {/* El mapa de indices. Es lo mas importante del export. */}
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="t-label">mapa de indices · class_index → training_index</span>
            </div>
            <p className="t-mono-xs mt-1 text-[var(--text-faint)]">
              No son el mismo numero. `class_index` es inmutable y puede tener huecos;
              los frameworks exigen indices contiguos. Sin este mapa un modelo
              entrenado no se puede interpretar.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {e.class_map.map((c) => (
                <span key={c.training_index} className="t-mono-xs">
                  <span className="text-[var(--accent)]">{c.training_index}</span>
                  <span className="text-[var(--text-faint)]"> ← {c.class_index} </span>
                  <span className="text-[var(--text-primary)]">{c.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* data.yaml */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="t-label">data.yaml</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void copiar(e.data_yaml, 'yaml')}
              >
                <Copy strokeWidth={1.5} className="mr-1 size-3" />
                {copiado === 'yaml' ? 'copiado' : copiado === 'error' ? 'no se pudo copiar' : 'copiar'}
              </Button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] p-3 t-mono-xs text-[var(--text-secondary)] [background:var(--canvas-deep)]">
              {e.data_yaml}
            </pre>
          </div>

          {/* El comando. Es lo que el operador necesita de verdad. */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="t-label">materializar en disco</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  void copiar(comandoMaterializar(projectId, version.id), 'cmd')
                }
              >
                <Copy strokeWidth={1.5} className="mr-1 size-3" />
                {copiado === 'cmd' ? 'copiado' : 'copiar'}
              </Button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] p-3 t-mono-xs text-[var(--text-secondary)] [background:var(--canvas-deep)]">
              {comandoMaterializar(projectId, version.id)}
            </pre>
            <p className="t-mono-xs mt-1 text-[var(--text-faint)]">
              Las URLs firmadas caducan en {Math.round(e.signed_url_ttl / 60)} minutos:
              la descarga tiene que empezar ya. El entrenamiento corre FUERA del
              backend, en su propio entorno.
            </p>
          </div>

          {/* Reparto por split, con recuento de cajas */}
          <div>
            <span className="t-label">
              {e.items.length} imagenes · {e.items.reduce((a, i) => a + i.box_count, 0)} cajas
            </span>
            <div className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {e.items.map((i) => (
                <div key={i.image_id} className="flex items-center gap-3">
                  <Badge tone="neutral" size="xs">{i.split}</Badge>
                  <span className="t-mono-xs min-w-0 flex-1 truncate text-[var(--text-muted)]">
                    {i.filename}
                  </span>
                  <span
                    className={cn(
                      't-mono-xs tabular-nums',
                      i.box_count === 0
                        ? 'text-[var(--text-faint)]'
                        : 'text-[var(--text-primary)]',
                    )}
                    title={i.box_count === 0 ? 'negativo: imagen sin objetos' : undefined}
                  >
                    {i.box_count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!e && !exportar.isFetching && (
        <p className="t-mono-xs mt-4 flex items-center gap-1.5 text-[var(--text-faint)]">
          <Database strokeWidth={1.5} className="size-3" />
          El manifiesto no se pide solo: firma una URL por imagen contra Storage.
        </p>
      )}
    </Panel>
  );
}

function comandoMaterializar(projectId: string, versionId: string): string {
  return [
    'cd C:\\OLO_IA\\backend',
    'PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/materializar_dataset.py \\',
    '    --api http://127.0.0.1:8000/v1 \\',
    '    --token "<tu JWT de sesion>" \\',
    `    --project ${projectId} \\`,
    `    --version ${versionId} \\`,
    '    --destino C:\\datasets\\alturas',
  ].join('\n');
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-label">{k}</dt>
      <dd className="t-mono-xs tabular-nums text-[var(--text-primary)]">{v}</dd>
    </div>
  );
}
