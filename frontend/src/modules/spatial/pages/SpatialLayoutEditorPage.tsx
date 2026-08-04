/**
 * EDITOR DE PLANO — donde se carga la imagen del almacen y se sitan los racks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE ESTA PAGINA
 *
 * El editor estaba construido —store con historial, calibracion, snap, canvas,
 * inspector, cargador de plano— y NO estaba montado en ninguna ruta. El panel del
 * explorador decia «se configura desde el editor de plano» y no habia forma de
 * llegar a el: los 347 racks del catalogo no se podian situar porque faltaba la
 * puerta, no el editor.
 *
 * ── QUE ES Y QUE NO ES ──────────────────────────────────────────────────────
 *
 * ES una base VISUAL, local a este navegador (`localStorage`, una clave por
 * almacen). Sirve para colocar los racks sobre una imagen y calibrar cuantos
 * pixeles son un metro.
 *
 * NO ES el levantamiento metrico. `world_position` sigue NULL en la base y el
 * backend seguira respondiendo `with_world_geometry: 0`: lo que se dibuja aqui no
 * se convierte en geometria del dominio ni lo ve otro usuario. Eso llegara con el
 * importador CAD. Decirlo en pantalla es parte del diseño, no un descargo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, HardDriveDownload, Info, Trash2 } from 'lucide-react';

import { useSessionStore } from '../../../auth/sessionStore';
import { Panel } from '../../../design/foundation/Panel';
import {
  BotonExpandir,
  CLASES_EXPANDIDO,
  useExpansion,
} from '../../../design/foundation/Expandible';
import { Modal } from '../../../design/foundation/Modal';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import { CanvasHost } from '../../../shell/CanvasHost';

import { WarehousePicker, useResolvedWarehouse } from '../components/WarehousePicker';
import { QueryError, SpatialError } from '../components/errors/SpatialError';
import {
  AlinearPanel,
  Cluster3DEditor,
  EditorLayerPanel,
  EditorToolbar,
  LayoutEditorCanvas,
  PanelPublicar,
  PlanLoader,
  RackInspector,
  UnpositionedRacks,
} from '../editor/components/index';
import { useEditorStore } from '../editor/store';
import { useEditorKeyboard } from '../editor/useEditorKeyboard';
import { useFloorPlanCompleto, useWarehouses } from '../services/useSpatial';
import { useLayoutRepo } from '../services/SpatialProvider';
import type { LayoutStatus } from '../repositories/LayoutRepository';

export function SpatialLayoutEditorPage() {
  const persistedWarehouseId = useSessionStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useSessionStore((s) => s.setActiveWarehouse);
  const layoutRepo = useLayoutRepo();

  const warehouses = useWarehouses();
  const warehouseId = useResolvedWarehouse(
    warehouses.data,
    persistedWarehouseId,
    setActiveWarehouse,
  );

  // El catalogo agregado COMPLETO: una fila por rack, todas las paginas. Con la
  // version paginada el editor solo conoceria 200 de los 348 y los otros 148 no
  // se podrian situar sin que la pantalla lo dijera.
  const floorPlan = useFloorPlanCompleto(warehouseId);

  const {
    loadDraft, saveDraft, discardDraft, exportJson, importJson, resetEditor,
    plan, racks, calibration, reference, layers, viewDimension,
  } = useEditorStore();
  useEditorKeyboard();

  const [estado, setEstado] = useState<LayoutStatus | null>(null);
  const [errorImport, setErrorImport] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Se expande el area de trabajo COMPLETA —barra de herramientas, plano, lienzo
  // e inspector—, no solo el lienzo. Situar racks a pantalla completa sin poder
  // rotar, ajustar medidas ni guardar no serviria de nada: lo que sobra es el
  // marco de la aplicacion, no los controles.
  const exp = useExpansion();

  // El borrador se carga UNA VEZ por almacen. `resetEditor` antes de cargar es
  // obligatorio: sin el, cambiar de almacen dejaria los racks del anterior sobre
  // el plano del nuevo, que es la forma mas silenciosa de mentir en esta pantalla.
  const cargadoDe = useRef<string | null>(null);
  useEffect(() => {
    if (!warehouseId || cargadoDe.current === warehouseId) return;
    resetEditor();
    loadDraft(warehouseId);
    cargadoDe.current = warehouseId;
    setEstado(layoutRepo.getStatus(warehouseId));
  }, [warehouseId, loadDraft, resetEditor, layoutRepo]);

  const guardar = useCallback(() => {
    if (!warehouseId) return;
    saveDraft(warehouseId);
    // Se relee el estado en lugar de asumir que guardo: `localStorage` ronda los
    // 5 MB y un plano grande guarda la geometria SIN la imagen. La pantalla tiene
    // que poder decirlo.
    setEstado(layoutRepo.getStatus(warehouseId));
  }, [warehouseId, saveDraft, layoutRepo]);

  const descartar = useCallback(() => {
    if (!warehouseId) return;
    discardDraft(warehouseId);
    setEstado(layoutRepo.getStatus(warehouseId));
  }, [warehouseId, discardDraft, layoutRepo]);

  const exportar = useCallback(() => {
    const json = exportJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `layout-${warehouseId ?? 'almacen'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportJson, warehouseId]);

  const importar = useCallback(
    async (file: File) => {
      if (!warehouseId) return;
      const ok = importJson(await file.text(), warehouseId);
      setEstado(layoutRepo.getStatus(warehouseId));
      // Modal del sistema y no `window.alert`: el del navegador bloquea el hilo
      // —congelando el lienzo— y en algunos navegadores se puede silenciar, con lo
      // que la importacion fallaria sin decir nada.
      if (!ok) setErrorImport(file.name);
    },
    [importJson, warehouseId, layoutRepo],
  );

  /**
   * GUARDADO AUTOMATICO.
   *
   * Antes solo se guardaba al pulsar «Guardar», y ese boton solo aparece en modo
   * edicion: se podia colocar veinte racks, cambiar de pantalla y perderlo todo
   * sin un solo aviso. Un editor que pierde trabajo por no haber pulsado un boton
   * esta roto, no incompleto.
   *
   * 900 ms de espera tras el ultimo cambio: arrastrar un rack dispara decenas de
   * actualizaciones por segundo y serializar el borrador —con la imagen en base64—
   * en cada una haria el arrastre a saltos.
   */
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (!warehouseId || cargadoDe.current !== warehouseId) return;
    setGuardando(true);
    const t = window.setTimeout(() => {
      saveDraft(warehouseId);
      setEstado(layoutRepo.getStatus(warehouseId));
      setGuardando(false);
    }, 900);
    return () => window.clearTimeout(t);
  }, [warehouseId, racks, plan, calibration, reference, layers, saveDraft, layoutRepo]);

  // ── Puertas ───────────────────────────────────────────────────────────────

  if (warehouses.isError) {
    return (
      <Marco>
        <QueryError error={warehouses.error} onRetry={() => void warehouses.refetch()} />
      </Marco>
    );
  }

  if (!warehouseId) {
    return (
      <Marco
        selector={
          <WarehousePicker
            warehouses={warehouses.data ?? []}
            activeId={null}
            onChange={(id) => setActiveWarehouse(id || null)}
            loading={warehouses.isLoading}
          />
        }
      >
        <Panel level="work" radius="lg" pad="lg" className="text-center">
          <p className="t-body py-8 text-[var(--text-secondary)]">
            Elige el almacen cuyo plano quieres configurar.
          </p>
        </Panel>
      </Marco>
    );
  }

  const almacen = warehouses.data?.find((w) => w.id === warehouseId);
  if (almacen && !almacen.hasCatalog) {
    return (
      <Marco
        selector={
          <WarehousePicker
            warehouses={warehouses.data ?? []}
            activeId={warehouseId}
            onChange={(id) => setActiveWarehouse(id || null)}
            loading={warehouses.isLoading}
          />
        }
      >
        <SpatialError
          kind="no-catalog"
          message={
            `El almacen ${almacen.code} no tiene catalogo espacial importado, asi que no ` +
            'hay racks que situar. Importa el catalogo antes de configurar el plano.'
          }
        />
      </Marco>
    );
  }

  return (
    <Marco
      selector={
        <WarehousePicker
          warehouses={warehouses.data ?? []}
          activeId={warehouseId}
          onChange={(id) => setActiveWarehouse(id || null)}
          loading={warehouses.isLoading}
        />
      }
    >
      <div
        ref={exp.ref}
        className={cn(
          exp.expandido ? CLASES_EXPANDIDO : 'flex min-h-0 flex-1 flex-col gap-3',
        )}
      >
        <div className="flex shrink-0 items-center gap-2">
          {/* `min-w-0 flex-1`: la barra tiene scroll horizontal propio y sin esto
              empujaria al boton fuera de la pantalla en lugar de desplazarse. */}
          <div className="min-w-0 flex-1">
            <EditorToolbar
              onSave={guardar}
              onExport={exportar}
              onImport={() => importRef.current?.click()}
            />
          </div>
          <BotonExpandir expandido={exp.expandido} onClick={exp.alternar} />
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importar(f);
            e.target.value = '';
          }}
        />

        <div className="flex min-h-0 flex-1 gap-3">
          {/* Izquierda: plano, capas y lo que falta por situar */}
          <div className="flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto">
            <PlanLoader />
            <EditorLayerPanel />
            {floorPlan.isError ? (
              <QueryError
                error={floorPlan.error}
                onRetry={() => void floorPlan.refetch()}
                compact
              />
            ) : (
              <>
                <UnpositionedRacks allRacks={floorPlan.data?.items ?? []} />
                {floorPlan.data?.truncado && (
                  <p className="t-mono-xs text-[var(--state-alert)]">
                    Se alcanzo el tope de 4.000 racks: la lista esta incompleta.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Centro: el lienzo. Uno o el otro, no los dos: son la misma escena
              mirada de dos maneras, y ponerlos lado a lado en el espacio que queda
              dejaria los dos demasiado pequeños para trabajar. El conmutador esta
              en la paleta, arriba a la izquierda. */}
          {viewDimension === '3d' ? (
            <Cluster3DEditor
              catalogo={floorPlan.data?.items ?? []}
              className="min-h-0 flex-1"
            />
          ) : (
            <LayoutEditorCanvas className="min-h-0 flex-1" />
          )}

          {/* Derecha: propiedades del rack y estado del borrador */}
          <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-y-auto">
            {/* Con dos o mas racks, este panel sustituye al inspector: son dos
                modos de trabajo distintos y mezclarlos confunde lo que se edita. */}
            <AlinearPanel />
            <RackInspector />
            <EstadoBorrador
              estado={estado}
              hayPlano={plan != null}
              racksSituados={racks.length}
              racksTotales={floorPlan.data?.total ?? null}
              guardando={guardando}
              onDescartar={descartar}
            />
            {/* Publicar va DEBAJO del borrador y no en la paleta a proposito: se
                lee «esto es mi borrador» y luego «esto es lo que ve el equipo»,
                que es el orden en el que ocurre. En la paleta, junto a guardar y
                exportar, los dos botones parecerian dos formas de lo mismo. */}
            <PanelPublicar
              warehouseId={warehouseId}
              warehouseCode={almacen?.code ?? warehouseId.slice(0, 8)}
              catalogo={floorPlan.data?.items ?? []}
              onAbrirPublicado={guardar}
            />
          </div>
        </div>

        <Modal
          abierto={errorImport !== null}
          titulo="No se pudo importar el layout"
          descripcion={
            errorImport
              ? `«${errorImport}» no es un layout de este editor. Se espera un JSON de version 1 con una lista de racks — el que produce el boton de exportar.`
              : undefined
          }
          onCerrar={() => setErrorImport(null)}
          acciones={
            <Button variant="secondary" size="xs" onClick={() => setErrorImport(null)}>
              Entendido
            </Button>
          }
        />
      </div>
    </Marco>
  );
}

/** Cabecera comun: titulo, vuelta al explorador y selector de almacen. */
function Marco({
  children,
  selector,
}: {
  children: React.ReactNode;
  selector?: React.ReactNode;
}) {
  return (
    <CanvasHost mode="immersive">
      <div className="flex h-[calc(100dvh-var(--topbar-height))] flex-col gap-3 px-[var(--canvas-pad-x)] pb-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/spatial"
              className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft strokeWidth={1.5} className="size-3.5" />
              Explorador
            </Link>
            <span aria-hidden className="h-4 w-px [background:var(--hairline)]" />
            <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
              Editor de plano
            </h1>
          </div>
          {selector}
        </div>
        {children}
      </div>
    </CanvasHost>
  );
}

/**
 * Estado del borrador, con sus limites a la vista.
 *
 * Los dos avisos importantes: que esto vive solo en este navegador, y que si la
 * imagen no cupo se guardo la geometria sin ella. Un plano que «desaparece» al
 * recargar sin explicacion es peor que un plano que avisa de que no se pudo
 * guardar.
 */
function EstadoBorrador({
  estado,
  hayPlano,
  racksSituados,
  racksTotales,
  guardando,
  onDescartar,
}: {
  estado: LayoutStatus | null;
  hayPlano: boolean;
  racksSituados: number;
  racksTotales: number | null;
  guardando: boolean;
  onDescartar: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline-strong)] pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Borrador</span>
        {/* Decirlo mientras pasa: un guardado silencioso es indistinguible de no
            guardar, y de eso venia la desconfianza. */}
        <span
          className={cn(
            't-mono-xs transition-opacity',
            guardando ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] opacity-70',
          )}
        >
          {guardando ? 'guardando…' : 'guardado automatico'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <Linea
          k="guardado"
          v={estado?.exists ? formatFecha(estado.updatedAt) : 'sin guardar'}
        />
        <Linea
          k="racks situados"
          v={racksTotales != null ? `${racksSituados} de ${racksTotales}` : String(racksSituados)}
        />
        <Linea k="calibrado" v={estado?.calibrated ? 'si' : 'no — las medidas son pixeles'} />
        <Linea
          k="imagen"
          v={!hayPlano ? 'sin plano' : estado?.imageStored ? 'guardada' : 'no guardada'}
        />
      </div>

      {estado?.storageError && (
        <p className="t-mono-xs text-[var(--text-warning,var(--text-faint))]">
          {estado.storageError}
        </p>
      )}

      <p className="t-mono-xs flex gap-1.5 text-[var(--text-faint)]">
        <Info strokeWidth={1.5} className="mt-0.5 size-3 shrink-0" />
        <span>
          Local a este navegador. No es el levantamiento metrico: el backend sigue sin
          coordenadas en metros y otro usuario no vera este plano.
        </span>
      </p>

      <div className="flex gap-2">
        <Button variant="ghost" size="xs" onClick={onDescartar} disabled={!estado?.exists}>
          <Trash2 strokeWidth={1.5} className="size-3" />
          Descartar
        </Button>
        {!hayPlano && (
          <span className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)]">
            <HardDriveDownload strokeWidth={1.5} className="size-3" />
            carga un SVG, PNG o JPG
          </span>
        )}
      </div>
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-mono-xs text-[var(--text-faint)]">{k}</span>
      <span className="t-mono-xs text-right text-[var(--text-muted)]">{v}</span>
    </div>
  );
}

function formatFecha(iso: string | null): string {
  if (!iso) return 'sin guardar';
  try {
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
