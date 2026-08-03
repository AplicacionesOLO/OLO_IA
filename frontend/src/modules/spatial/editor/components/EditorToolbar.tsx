/**
 * EDITOR TOOLBAR — barra de herramientas del modo edicion.
 */

import {
  Crosshair,
  Download,
  Grid3X3,
  Image,
  MousePointer,
  Move,
  Redo2,
  Ruler,
  Save,
  Undo2,
  Upload,
  Zap,
} from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';
import { useEditorStore } from '../store';

/**
 * Los tres botones de la derecha —guardar, exportar, importar— los cablea la
 * pagina, no la barra: la barra no sabe de que almacen es el borrador, y el
 * almacen es justo lo que decide donde se guarda. Sin handler quedan
 * deshabilitados en lugar de fingir que hacen algo.
 */
interface EditorToolbarProps {
  onSave?: (() => void) | undefined;
  onExport?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}

export function EditorToolbar({ onSave, onExport, onImport }: EditorToolbarProps = {}) {
  const {
    mode, setMode, isEditing, setEditing,
    visualMode, setVisualMode,
    viewDimension, setViewDimension,
    canUndo, canRedo, performUndo, performRedo,
    snapToGrid, setSnapToGrid, gridMeters, setGridMeters,
  } = useEditorStore();

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-[var(--radius-sm)] px-2 py-1.5 [background:var(--glass-1)]">
      {/* Edit toggle */}
      <Button
        variant={isEditing ? 'command' : 'secondary'}
        size="xs"
        onClick={() => setEditing(!isEditing)}
      >
        {isEditing ? 'Salir edicion' : 'Editar layout'}
      </Button>

      <Sep />

      {isEditing && (
        <>
          {/* Mode tools */}
          <ToolBtn icon={MousePointer} active={mode === 'select'} onClick={() => setMode('select')} label="Seleccionar" />
          <ToolBtn icon={Move} active={mode === 'pan'} onClick={() => setMode('pan')} label="Mover vista" />
          <ToolBtn icon={Ruler} active={mode === 'calibrate'} onClick={() => setMode('calibrate')} label="Calibrar escala" />
          <ToolBtn icon={Crosshair} active={mode === 'set-origin'} onClick={() => setMode('set-origin')} label="Definir origen" />
          <ToolBtn icon={Image} active={mode === 'place-rack'} onClick={() => setMode('place-rack')} label="Colocar rack" />

          <Sep />

          {/*
            Ajuste a rejilla, con su paso a la vista y en metros.

            El paso se muestra SIEMPRE, tambien apagado: saber a que se va a
            ajustar antes de encenderlo evita el «lo activo y el rack salta medio
            metro» que hacia inservible la herramienta.
          */}
          <ToolBtn
            icon={Grid3X3}
            active={snapToGrid}
            onClick={() => setSnapToGrid(!snapToGrid)}
            label={
              snapToGrid
                ? `Ajuste a rejilla activo · cada ${gridMeters} m · Alt lo desactiva mientras arrastras`
                : `Ajuste a rejilla inactivo · movimiento libre · Alt lo activa mientras arrastras`
            }
          />
          <select
            value={gridMeters}
            onChange={(e) => setGridMeters(Number.parseFloat(e.target.value))}
            aria-label="Paso de la rejilla en metros"
            title="Paso de la rejilla"
            className={cn(
              'h-6 shrink-0 rounded-[var(--radius-xs)] px-1 outline-none',
              'font-[family-name:var(--font-data)] text-[length:9px]',
              '[background:var(--glass-2)] focus:shadow-[var(--focus-ring)]',
              snapToGrid ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
            )}
          >
            {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((m) => (
              <option key={m} value={m}>
                {m < 1 ? `${m * 100} cm` : `${m} m`}
              </option>
            ))}
          </select>

          <Sep />

          {/* Undo/Redo */}
          <Button variant="ghost" size="xs" iconOnly disabled={!canUndo} onClick={performUndo} aria-label="Deshacer">
            <Undo2 strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button variant="ghost" size="xs" iconOnly disabled={!canRedo} onClick={performRedo} aria-label="Rehacer">
            <Redo2 strokeWidth={1.5} className="size-3.5" />
          </Button>

          <Sep />
        </>
      )}

      {/* Visual modes */}
      <ToolBtn
        icon={Zap}
        active={visualMode === 'holographic'}
        onClick={() => setVisualMode(visualMode === 'holographic' ? 'technical' : 'holographic')}
        label={visualMode === 'holographic' ? 'Modo holografico' : 'Modo tecnico'}
      />

      {/* 2D / 2.5D */}
      <button
        type="button"
        onClick={() => setViewDimension(viewDimension === '2d' ? '2.5d' : '2d')}
        className={cn(
          'rounded-[var(--radius-xs)] px-2 py-1 font-[family-name:var(--font-data)] text-[length:9px] transition-colors',
          viewDimension === '2.5d'
            ? '[background:var(--glass-3)] text-[var(--text-primary)]'
            : 'text-[var(--text-faint)] hover:text-[var(--text-primary)]',
        )}
        aria-label={`Vista ${viewDimension}`}
      >
        {viewDimension.toUpperCase()}
      </button>

      <div className="flex-1" />

      {/* Save / Export */}
      {isEditing && (
        <>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Importar JSON"
            disabled={!onImport}
            onClick={onImport}
          >
            <Upload strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Exportar JSON"
            disabled={!onExport}
            onClick={onExport}
          >
            <Download strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            aria-label="Guardar borrador"
            disabled={!onSave}
            onClick={onSave}
          >
            <Save strokeWidth={1.5} className="size-3.5" />
            Guardar
          </Button>
        </>
      )}
    </div>
  );
}

function ToolBtn({
  icon: Icon,
  active,
  onClick,
  label,
}: {
  icon: typeof MousePointer;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
        active ? '[background:var(--glass-3)] text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:[background:var(--glass-1)]',
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon strokeWidth={1.5} className="size-3.5" />
    </button>
  );
}

function Sep() {
  return <span className="h-4 w-px shrink-0 [background:var(--hairline)]" />;
}
