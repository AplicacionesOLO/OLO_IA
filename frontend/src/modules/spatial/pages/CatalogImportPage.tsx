/**
 * IMPORT DEL CATÁLOGO — subir el xlsx del WMS desde la web.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA PANTALLA EXISTE
 *
 * Hasta ahora, cargar el catálogo espacial de un almacén (racks, cuerpos,
 * ubicaciones) solo se podía hacer corriendo `tools/import_spatial_catalog.py`
 * a mano, con acceso a un terminal y credenciales de superusuario de la base.
 * Eso excluye a cualquiera que no tenga esa terminal — que es la mayoría de
 * quienes dan de alta un almacén nuevo.
 *
 * Esta pantalla llama al MISMO importador (transaccional, auditado,
 * idempotente por `sha256`) a través de la API: sube un archivo, corre un
 * lote, nada de escrituras fila a fila. La lógica no cambia, solo quién puede
 * dispararla y con qué credenciales.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ HAY UN PERMISO PROPIO
 *
 * `catalog:import` (0106), no `areas:write`: esto reescribe la estructura
 * ENTERA del almacén de una tacada — 347 racks, 2.701 cuerpos, 29.310
 * ubicaciones en el almacén real — y una importación equivocada es mucho más
 * difícil de deshacer que mover un rack. Solo lo tiene `tenant_admin`.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FileSpreadsheet, History, UploadCloud } from 'lucide-react';

import { AsyncStatus } from '../../../design/foundation/AsyncStatus';
import { Badge } from '../../../design/primitives/Badge';
import { Button } from '../../../design/primitives/Button';
import { Panel } from '../../../design/foundation/Panel';
import { PanelHeader } from '../../../design/foundation/PanelHeader';
import { CanvasHost } from '../../../shell/CanvasHost';
import { cn } from '../../../design/utils/cn';
import { ApiError, humanMessage } from '../../../lib/apiErrors';
import { useResolvedWarehouse } from '../components/WarehousePicker';
import { useSessionStore } from '../../../auth/sessionStore';
import { useHistorialImportacion, useImportarCatalogo, useWarehouses } from '../services/useSpatial';
import type { CatalogImportBatch, CatalogImportResult } from '../types/index';

export function CatalogImportPage() {
  const persistido = useSessionStore((s) => s.activeWarehouseId);
  const setActivo = useSessionStore((s) => s.setActiveWarehouse);
  const warehouses = useWarehouses();
  const warehouseId = useResolvedWarehouse(warehouses.data, persistido, setActivo);
  const puedeImportar = useSessionStore((s) => s.hasPermission('catalog:import'));

  return (
    <CanvasHost mode="grid">
      <div className="flex flex-col gap-[var(--panel-gap)]">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/twin"
            className="t-mono-xs flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
          >
            <ArrowLeft strokeWidth={1.5} className="size-3.5" />
            Plano
          </Link>
          <h1 className="text-[length:var(--text-lg)] font-[var(--weight-medium)] text-[var(--text-primary)]">
            Catálogo espacial
          </h1>
        </div>

        <Panel level="support" radius="lg" pad="md">
          <p className="t-small max-w-[92ch] text-[var(--text-muted)]">
            Sube el <code className="t-mono-xs">ReporteUbicaciones.xlsx</code> del WMS para dar
            de alta —o poner al día— los racks, cuerpos y ubicaciones de un almacén. Es el
            mismo importador que antes solo corría por terminal: una fila mala no tumba el
            lote, se rechaza y se cuenta; reimportar el mismo archivo no duplica nada.
          </p>
        </Panel>

        {!warehouseId ? (
          <Panel level="support" radius="lg" pad="md">
            <p className="t-small text-[var(--text-faint)]">
              Elige un almacén en el plano para importar su catálogo.
            </p>
          </Panel>
        ) : !puedeImportar ? (
          <Panel level="support" radius="lg" pad="md" className="flex items-start gap-3">
            <AlertTriangle strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-[var(--text-warn)]" />
            <p className="t-small max-w-[80ch] text-[var(--text-muted)]">
              Importar el catálogo reescribe la estructura entera del almacén — no es una
              tarea diaria, y por eso solo la puede hacer un administrador del tenant. Pide
              que un administrador lo haga, o que te conceda el permiso <code className="t-mono-xs">catalog:import</code>.
            </p>
          </Panel>
        ) : (
          <FormularioImport warehouseId={warehouseId} />
        )}

        {warehouseId && <Historial warehouseId={warehouseId} />}
      </div>
    </CanvasHost>
  );
}

// ── El formulario ────────────────────────────────────────────────────────────

function FormularioImport({ warehouseId }: { warehouseId: string }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [force, setForce] = useState(false);
  const [resultado, setResultado] = useState<CatalogImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importar = useImportarCatalogo(warehouseId);

  const correr = async (dryRun: boolean) => {
    if (!archivo) return;
    setError(null);
    setResultado(null);
    try {
      const r = await importar.mutateAsync({ archivo, opciones: { dryRun, force } });
      setResultado(r);
    } catch (e) {
      setError(
        e instanceof ApiError ? humanMessage(e) : e instanceof Error ? e.message : 'No se pudo importar el archivo.',
      );
    }
  };

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-4">
      <PanelHeader title="Importar" subtitle="Un archivo, un lote, una transacción" />

      <label
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-lg)] p-8 text-center',
          '[background:var(--glass-1)] shadow-[var(--rim-1)] transition-colors',
          'hover:[background:var(--glass-2)]',
        )}
      >
        <input
          type="file"
          accept=".xlsx"
          className="sr-only"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setResultado(null);
            setError(null);
          }}
        />
        {archivo ? (
          <>
            <FileSpreadsheet strokeWidth={1.5} className="size-6 text-[var(--text-accent)]" />
            <span className="t-small text-[var(--text-primary)]">{archivo.name}</span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {(archivo.size / 1_048_576).toFixed(2)} MB — clic para cambiarlo
            </span>
          </>
        ) : (
          <>
            <UploadCloud strokeWidth={1.5} className="size-6 text-[var(--text-faint)]" />
            <span className="t-small text-[var(--text-secondary)]">
              Elige el ReporteUbicaciones.xlsx
            </span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              Los encabezados deben coincidir exactamente, en el mismo orden
            </span>
          </>
        )}
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
          className="mt-1 size-4"
        />
        <span className="t-small max-w-[80ch] text-[var(--text-muted)]">
          Reimportar aunque este archivo exacto ya se haya importado.
          <br />
          <span className="t-mono-xs text-[var(--text-faint)]">
            Sin marcar: subir el mismo archivo dos veces no hace nada la segunda vez — es lo
            que se espera si se sube por accidente. Solo hace falta marcarlo para forzar una
            reescritura sobre datos ya presentes.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!archivo}
          loading={importar.isPending && importar.variables?.opciones?.dryRun === true}
          onClick={() => void correr(true)}
        >
          Simular (no escribe nada)
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!archivo}
          loading={importar.isPending && importar.variables?.opciones?.dryRun !== true}
          onClick={() => void correr(false)}
        >
          Importar
        </Button>
      </div>

      {error && <AsyncStatus phase="error" errorLabel={error} />}
      {resultado && <ResultadoPanel resultado={resultado} />}
    </Panel>
  );
}

function ResultadoPanel({ resultado }: { resultado: CatalogImportResult }) {
  const { status, rejections } = resultado;
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] p-4 [background:var(--glass-1)]">
      <div className="flex items-center gap-2">
        <Badge
          tone={status === 'completed' ? 'confirmed' : status === 'dry_run' ? 'accent' : 'neutral'}
          size="sm"
        >
          {status === 'completed' ? 'Importado' : status === 'dry_run' ? 'Simulación' : 'Ya importado antes'}
        </Badge>
        <span className="t-mono-xs text-[var(--text-faint)]">sha256 {resultado.fileSha256.slice(0, 16)}…</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metrica etiqueta="Filas leídas" valor={resultado.rowsRead} />
        <Metrica etiqueta="Rechazadas" valor={resultado.rowsRejected} alerta={resultado.rowsRejected > 0} />
        <Metrica etiqueta="Racks" valor={resultado.racksCreated ?? resultado.racks} />
        <Metrica etiqueta="Cuerpos" valor={resultado.baysCreated ?? resultado.bays} />
        <Metrica etiqueta="Ubicaciones" valor={resultado.locationsCreated ?? resultado.locations} />
      </div>

      {status === 'skipped_duplicate' && (
        <p className="t-mono-xs text-[var(--text-faint)]">
          Este archivo exacto ya se había importado antes; no se escribió nada. Marca «Reimportar»
          si de verdad quieres reescribir sobre lo ya presente.
        </p>
      )}

      {resultado.rowsRejected > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="t-mono-xs text-[var(--text-secondary)]">Motivos de rechazo</span>
          {Object.entries(rejections.byReason).map(([motivo, n]) => (
            <div key={motivo} className="flex items-center justify-between gap-3">
              <span className="t-small text-[var(--text-muted)]">{motivo}</span>
              <span className="t-mono-xs font-[family-name:var(--font-data)] text-[var(--text-faint)]">{n}</span>
            </div>
          ))}
          {rejections.sample.length > 0 && (
            <details className="mt-1">
              <summary className="t-mono-xs cursor-pointer text-[var(--text-accent)]">
                ver primeras {rejections.sample.length} filas rechazadas
              </summary>
              <div className="mt-2 flex flex-col gap-1">
                {rejections.sample.map((r) => (
                  <div key={r.rowNumber} className="t-mono-xs text-[var(--text-faint)]">
                    fila {r.rowNumber}: {r.reason}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Metrica({ etiqueta, valor, alerta }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-mono-xs text-[var(--text-faint)]">{etiqueta}</span>
      <span
        className={cn(
          'font-[family-name:var(--font-data)] text-[length:var(--text-lg)] [font-variant-numeric:tabular-nums]',
          alerta ? 'text-[var(--text-warn)]' : 'text-[var(--text-primary)]',
        )}
      >
        {valor.toLocaleString('es')}
      </span>
    </div>
  );
}

// ── El historial ─────────────────────────────────────────────────────────────

function Historial({ warehouseId }: { warehouseId: string }) {
  const historial = useHistorialImportacion(warehouseId);

  return (
    <Panel level="work" radius="xl" pad="md" className="flex flex-col gap-3">
      <PanelHeader
        title="Historial"
        subtitle="Los últimos lotes de este almacén"
      />
      {historial.isLoading ? (
        <AsyncStatus phase="pending" pendingLabel="Leyendo el historial" />
      ) : !historial.data || historial.data.length === 0 ? (
        <div className="flex items-center gap-2 text-[var(--text-faint)]">
          <History strokeWidth={1.5} className="size-4" />
          <span className="t-small">Todavía no se ha importado nada en este almacén.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {historial.data.map((b) => (
            <FilaHistorial key={b.id} lote={b} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function FilaHistorial({ lote }: { lote: CatalogImportBatch }) {
  const tono = lote.status === 'completed' ? 'confirmed' : lote.status === 'failed' ? 'critical' : 'neutral';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] p-2.5 [background:var(--glass-1)]">
      <div className="flex items-center gap-2.5">
        <Badge tone={tono} size="xs">
          {lote.status === 'completed' ? 'completado' : lote.status === 'failed' ? 'reemplazado' : 'en curso'}
        </Badge>
        <span className="t-mono-xs text-[var(--text-faint)]">{lote.sourceName}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="t-mono-xs text-[var(--text-muted)]">
          {lote.locationsCreated ?? 0} ubicaciones · {lote.rowsRejected} rechazadas
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {new Date(lote.startedAt).toLocaleString('es')}
        </span>
      </div>
    </div>
  );
}
