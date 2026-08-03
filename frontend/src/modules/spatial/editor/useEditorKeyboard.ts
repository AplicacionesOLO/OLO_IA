/**
 * EDITOR KEYBOARD — shortcuts del modo edicion.
 *
 * Solo activo cuando isEditing=true y el foco NO esta en un input.
 * Centralizado: un solo listener en el document.
 */

import { useEffect } from 'react';
import { useEditorStore } from './store';

const MOVE_STEP = 5; // pixels
const MOVE_STEP_LARGE = 20;
const ROTATE_STEP = 90;

export function useEditorKeyboard() {
  const {
    isEditing, selectedRackId, selectedRackIds, racks, updateRack, updateRacks,
    removeSelected, recordAction, performUndo, performRedo, selectRacks, calibration,
  } = useEditorStore();

  useEffect(() => {
    if (!isEditing) return;

    function onKeyDown(e: KeyboardEvent) {
      // Skip when typing
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      const mod = e.ctrlKey || e.metaKey;

      // Undo / Redo
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); performUndo(); return; }
      if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); performRedo(); return; }

      // Ctrl+A: todos los del plano. Es el atajo que ya espera cualquiera que haya
      // usado un editor, y sin el seleccionar 347 racks es imposible.
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectRacks(racks.map((r) => r.layoutId));
        return;
      }

      if (e.key === 'Escape') { selectRacks([]); return; }

      // Todo lo que sigue actua sobre la seleccion COMPLETA, no solo sobre el
      // principal: si las flechas movieran un rack de los ocho seleccionados,
      // el gesto seria distinto al del raton para la misma seleccion.
      const seleccion = racks.filter(
        (r) => selectedRackIds.includes(r.layoutId) && !r.locked,
      );
      if (seleccion.length === 0) return;

      const step = e.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
      const desplazar = (dx: number, dy: number) => {
        e.preventDefault();
        const movimientos = seleccion.map((r) => ({
          layoutId: r.layoutId,
          from: { x: r.x, y: r.y },
          to: { x: r.x + dx, y: r.y + dy },
        }));
        updateRacks(movimientos.map((m) => ({ layoutId: m.layoutId, updates: m.to })));
        if (movimientos.length === 1) recordAction({ type: 'move-rack', ...movimientos[0]! });
        else recordAction({ type: 'move-many', movimientos });
      };

      if (e.key === 'ArrowLeft') return desplazar(-step, 0);
      if (e.key === 'ArrowRight') return desplazar(step, 0);
      if (e.key === 'ArrowUp') return desplazar(0, -step);
      if (e.key === 'ArrowDown') return desplazar(0, step);

      // R: rotar 90°. Cada rack gira sobre SU centro, que es lo que se quiere al
      // enderezar una fila entera; girar la formacion completa es otra operacion.
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        for (const r of seleccion) {
          const hasta = (r.rotation + ROTATE_STEP) % 360;
          updateRack(r.layoutId, { rotation: hasta });
          recordAction({ type: 'rotate-rack', layoutId: r.layoutId, from: r.rotation, to: hasta });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
        return;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    isEditing, selectedRackId, selectedRackIds, racks, updateRack, updateRacks,
    removeSelected, recordAction, performUndo, performRedo, selectRacks, calibration,
  ]);
}
