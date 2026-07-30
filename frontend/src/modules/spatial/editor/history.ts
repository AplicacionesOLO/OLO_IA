/**
 * UNDO/REDO HISTORY — max 50 acciones.
 *
 * Stack inmutable. Cada push descarta el futuro (redo).
 */

import type { HistoryAction } from './types';

const MAX_HISTORY = 50;

export interface HistoryState {
  past: HistoryAction[];
  future: HistoryAction[];
}

export const INITIAL_HISTORY: HistoryState = { past: [], future: [] };

export function pushAction(state: HistoryState, action: HistoryAction): HistoryState {
  const past = [...state.past, action].slice(-MAX_HISTORY);
  return { past, future: [] };
}

export function undo(state: HistoryState): { state: HistoryState; action: HistoryAction | null } {
  if (state.past.length === 0) return { state, action: null };
  const past = [...state.past];
  const action = past.pop()!;
  return { state: { past, future: [action, ...state.future] }, action };
}

export function redo(state: HistoryState): { state: HistoryState; action: HistoryAction | null } {
  if (state.future.length === 0) return { state, action: null };
  const future = [...state.future];
  const action = future.shift()!;
  return { state: { past: [...state.past, action], future }, action };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}
