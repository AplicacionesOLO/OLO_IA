/**
 * RACK INSPECTOR — editor numerico de propiedades del rack seleccionado.
 */

import { Lock, Unlock } from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { useEditorStore } from '../store';

export function RackInspector() {
  const { racks, selectedRackId, updateRack, removeRack, calibration } = useEditorStore();
  const rack = racks.find((r) => r.layoutId === selectedRackId);

  if (!rack) {
    return (
      <div className="flex flex-col gap-2">
        <span className="t-label">Inspector</span>
        <p className="t-mono-xs text-[var(--text-faint)]">Selecciona un rack en el plano</p>
      </div>
    );
  }

  const ppm = calibration.pixelsPerMeter;
  const xm = (rack.x / ppm).toFixed(2);
  const ym = (rack.y / ppm).toFixed(2);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--text-primary)]">
          {rack.rackCode}
        </span>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          onClick={() => updateRack(rack.layoutId, { locked: !rack.locked })}
          aria-label={rack.locked ? 'Desbloquear' : 'Bloquear'}
        >
          {rack.locked ? <Lock strokeWidth={1.5} className="size-3.5" /> : <Unlock strokeWidth={1.5} className="size-3.5" />}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <NumField label="X" value={xm} unit="m" onChange={(v) => updateRack(rack.layoutId, { x: parseFloat(v) * ppm })} disabled={rack.locked} />
        <NumField label="Y" value={ym} unit="m" onChange={(v) => updateRack(rack.layoutId, { y: parseFloat(v) * ppm })} disabled={rack.locked} />
        <NumField label="Ancho" value={rack.width.toFixed(2)} unit="m" onChange={(v) => updateRack(rack.layoutId, { width: parseFloat(v) })} disabled={rack.locked} />
        <NumField label="Largo" value={rack.length.toFixed(2)} unit="m" onChange={(v) => updateRack(rack.layoutId, { length: parseFloat(v) })} disabled={rack.locked} />
        <NumField label="Alto" value={rack.height.toFixed(2)} unit="m" onChange={(v) => updateRack(rack.layoutId, { height: parseFloat(v) })} disabled={rack.locked} />
        <NumField label="Rotacion" value={rack.rotation.toFixed(0)} unit="°" onChange={(v) => updateRack(rack.layoutId, { rotation: parseFloat(v) % 360 })} disabled={rack.locked} />
      </div>

      {!rack.locked && (
        <Button variant="ghost" size="xs" onClick={() => removeRack(rack.layoutId)}>
          Quitar del plano
        </Button>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  unit: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-right font-[family-name:var(--font-data)] text-[length:9px] text-[var(--text-faint)]">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-6 w-full rounded-[2px] px-1.5 font-[family-name:var(--font-data)] text-[length:var(--text-xs)] text-[var(--text-primary)] [background:var(--glass-2)] outline-none focus:shadow-[var(--focus-ring)] disabled:opacity-40"
      />
      <span className="w-5 shrink-0 font-[family-name:var(--font-data)] text-[length:8px] text-[var(--text-faint)]">{unit}</span>
    </div>
  );
}
