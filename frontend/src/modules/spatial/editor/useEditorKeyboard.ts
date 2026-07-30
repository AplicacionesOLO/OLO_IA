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
    isEditing, selectedRackId, racks, updateRack, removeRack, recordAction,
    performUndo, performRedo, calibration,
  } = useEditorStore();

  useEffect(() => {
    if (!isEditing) return;

    function onKeyDown(e: KeyboardEvent) {
      // Skip when typing
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      const rack = racks.find((r) => r.layoutId === selectedRackId);
      const mod = e.ctrlKey || e.metaKey;

      // Undo / Redo
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); performUndo(); return; }
      if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); performRedo(); return; }

      // Escape: deselect
      if (e.key === 'Escape') { useEditorStore.getState().selectRack(null); return; }

      if (!rack || rack.locked) return;

      const step = e.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;

      // Arrows: move
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const from = { x: rack.x, y: rack.y };
        updateRack(rack.layoutId, { x: rack.x - step });
        recordAction({ type: 'move-rack', layoutId: rack.layoutId, from, to: { x: rack.x - step, y: rack.y } });
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const from = { x: rack.x, y: rack.y };
        updateRack(rack.layoutId, { x: rack.x + step });
        recordAction({ type: 'move-rack', layoutId: rack.layoutId, from, to: { x: rack.x + step, y: rack.y } });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const from = { x: rack.x, y: rack.y };
        updateRack(rack.layoutId, { y: rack.y - step });
        recordAction({ type: 'move-rack', layoutId: rack.layoutId, from, to: { x: rack.x, y: rack.y - step } });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const from = { x: rack.x, y: rack.y };
        updateRack(rack.layoutId, { y: rack.y + step });
        recordAction({ type: 'move-rack', layoutId: rack.layoutId, from, to: { x: rack.x, y: rack.y + step } });
        return;
      }

      // R: rotate 90°
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        const fromRot = rack.rotation;
        const toRot = (rack.rotation + ROTATE_STEP) % 360;
        updateRack(rack.layoutId, { rotation: toRot });
        recordAction({ type: 'rotate-rack', layoutId: rack.layoutId, from: fromRot, to: toRot });
        return;
      }

      // Delete: remove from plan
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeRack(rack.layoutId);
        return;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isEditing, selectedRackId, racks, updateRack, removeRack, recordAction, performUndo, performRedo, calibration]);
}
