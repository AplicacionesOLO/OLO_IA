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

export function EditorToolbar() {
  const {
    mode, setMode, isEditing, setEditing,
    visualMode, setVisualMode,
    viewDimension, setViewDimension,
    canUndo, canRedo, performUndo, performRedo,
    snapToGrid, setSnapToGrid,
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

          {/* Snap */}
          <ToolBtn icon={Grid3X3} active={snapToGrid} onClick={() => setSnapToGrid(!snapToGrid)} label={snapToGrid ? 'Snap activo' : 'Snap inactivo'} />

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
          <Button variant="ghost" size="xs" iconOnly aria-label="Importar JSON">
            <Upload strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button variant="ghost" size="xs" iconOnly aria-label="Exportar JSON">
            <Download strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button variant="secondary" size="xs" aria-label="Guardar borrador">
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
