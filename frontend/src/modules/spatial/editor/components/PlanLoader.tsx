/**
 * PLAN LOADER — carga de imagen del plano.
 *
 * Acepta SVG, PNG, JPG. Muestra metadata y preview.
 * Para DWG/DXF muestra aviso de conversion pendiente.
 */

import { useCallback, useRef } from 'react';
import { FileImage, Trash2, Upload } from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { useEditorStore } from '../store';
import type { PlanFile, PlanFileType } from '../types';

const ACCEPTED = '.svg,.png,.jpg,.jpeg';
const ACCEPTED_TYPES: PlanFileType[] = ['image/svg+xml', 'image/png', 'image/jpeg'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function PlanLoader() {
  const { plan, setPlan } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type as PlanFileType)) return;
    if (file.size > MAX_SIZE) return;

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
            DWG/DXF: conversion a SVG pendiente del backend
          </p>
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
