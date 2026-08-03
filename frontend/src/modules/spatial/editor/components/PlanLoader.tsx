/**
 * PLAN LOADER — carga de imagen del plano.
 *
 * Acepta SVG, PNG, JPG. Muestra metadata y preview.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EL SELECTOR NO FILTRA POR EXTENSION
 *
 * Antes el `accept` era `.svg,.png,.jpg,.jpeg`, y el dialogo de Windows OCULTA lo
 * que no encaja: quien tenia su plano en DWG abria su carpeta y la veia **vacia**.
 * El sintoma que llega es «el subidor no detecta los archivos», y la causa
 * verdadera —este formato no se puede leer en el navegador— no aparecia en ningun
 * sitio.
 *
 * Ahora el dialogo muestra tambien DWG y DXF, y al elegir uno se explica por que
 * no sirve y que hacer. Un rechazo con motivo es informacion; un rechazo silencioso
 * es un fallo aparente de la aplicacion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, FileImage, Trash2, Upload } from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { useEditorStore } from '../store';
import type { PlanFile, PlanFileType } from '../types';

/** Se ofrecen tambien los CAD: aparecen en el dialogo y se rechazan CON MOTIVO. */
const ACCEPTED = '.svg,.png,.jpg,.jpeg,.dwg,.dxf';
const ACCEPTED_TYPES: PlanFileType[] = ['image/svg+xml', 'image/png', 'image/jpeg'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const CAD = /\.(dwg|dxf|bak)$/i;

export function PlanLoader() {
  const { plan, setPlan } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setRechazo(null);

    // El tipo se decide por extension y no solo por `file.type`: Windows deja el
    // MIME vacio para extensiones que no conoce, y un DWG llegaria como «tipo
    // desconocido» en lugar de como lo que es.
    if (CAD.test(file.name)) {
      setRechazo(
        `«${file.name}» es un archivo de AutoCAD. El navegador no puede dibujarlo: ` +
          'convierte el plano a SVG, PNG o JPG (exportar o imprimir a PDF y de ahi a ' +
          'imagen) y cargalo entonces.',
      );
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type as PlanFileType)) {
      setRechazo(
        `«${file.name}» no es una imagen que se pueda usar de plano. Formatos validos: ` +
          'SVG, PNG o JPG.',
      );
      return;
    }

    if (file.size > MAX_SIZE) {
      setRechazo(
        `«${file.name}» pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el limite son ` +
          '10 MB. Reduce la resolucion o recorta la zona del almacen.',
      );
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const dims = await getImageDimensions(objectUrl);

    // Convert to dataUrl for localStorage (only < 5MB)
    let dataUrl: string | null = null;
    if (file.size < 5 * 1024 * 1024) {
      dataUrl = await fileToDataUrl(file);
    }

    const planFile: PlanFile = {
      name: file.name,
      type: file.type as PlanFileType,
      objectUrl,
      width: dims.width,
      height: dims.height,
      bytes: file.size,
      dataUrl,
    };

    setPlan(planFile);
  }, [setPlan]);

  const removePlan = useCallback(() => {
    if (plan?.objectUrl) URL.revokeObjectURL(plan.objectUrl);
    setPlan(null);
    setRechazo(null);
  }, [plan, setPlan]);

  return (
    <div className="flex flex-col gap-3">
      <span className="t-label">Plano base</span>

      {!plan && (
        <div
          className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[color-mix(in_oklab,var(--accent)_25%,transparent)] p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
        >
          <FileImage strokeWidth={1.25} className="size-5 text-[var(--icon-accent)]" />
          <p className="t-mono-xs text-center text-[var(--text-faint)]">
            SVG, PNG o JPG · hasta 10 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
          />
          <Button variant="secondary" size="xs" onClick={() => inputRef.current?.click()}>
            <Upload strokeWidth={1.5} className="size-3.5" />
            Cargar plano
          </Button>
          <p className="t-mono-xs text-center text-[var(--text-faint)] opacity-60">
            DWG/DXF: hay que convertirlo antes; el navegador no lee CAD
          </p>
        </div>
      )}

      {rechazo && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] p-2.5 [background:var(--glass-1)]">
          <AlertTriangle
            strokeWidth={1.5}
            className="mt-0.5 size-3.5 shrink-0 text-[var(--state-alert)]"
          />
          <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{rechazo}</p>
        </div>
      )}

      {plan && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] p-3 [background:var(--glass-1)]">
          {/* Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-sm)] bg-black/50">
            <img src={plan.objectUrl} alt="Plano cargado" className="size-full object-contain" />
          </div>
          {/* Metadata */}
          <div className="flex flex-col gap-1">
            <span className="truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">{plan.name}</span>
            <span className="t-mono-xs text-[var(--text-faint)]">
              {plan.width}×{plan.height}px · {(plan.bytes / 1024).toFixed(0)} KB · {plan.type.split('/')[1]}
            </span>
          </div>
          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="ghost" size="xs" onClick={() => inputRef.current?.click()}>
              Reemplazar
            </Button>
            <Button variant="ghost" size="xs" onClick={removePlan}>
              <Trash2 strokeWidth={1.5} className="size-3" />
              Quitar
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
