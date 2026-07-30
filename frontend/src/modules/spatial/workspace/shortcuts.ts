/**
 * KEYBOARD SHORTCUTS — sistema centralizado.
 *
 * Todas las combinaciones viven aqui. Los componentes registran handlers
 * via el hook `useShortcuts`. No hay listeners dispersos.
 *
 * Convenciones:
 *   - Ctrl/Cmd se normaliza como 'mod'
 *   - Las teclas se definen como strings legibles
 *   - Cada shortcut tiene id, combo, label y categoria
 */

export interface Shortcut {
  id: string;
  /** Combinacion: 'mod+f', 'mod+shift+p', 'escape', 'f', 'delete' */
  combo: string;
  label: string;
  category: 'navigation' | 'view' | 'selection' | 'workspace' | 'command';
  /** Si requiere que no haya un input enfocado. */
  global?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  // Navigation
  { id: 'search', combo: 'mod+f', label: 'Buscar ubicacion', category: 'navigation' },
  { id: 'focus-selection', combo: 'f', label: 'Centrar en seleccion', category: 'navigation', global: true },

  // View
  { id: 'view-tree', combo: 'mod+1', label: 'Panel arbol', category: 'view' },
  { id: 'view-canvas', combo: 'mod+2', label: 'Vista canvas', category: 'view' },
  { id: 'view-inspector', combo: 'mod+3', label: 'Panel inspector', category: 'view' },
  { id: 'toggle-layers', combo: 'mod+l', label: 'Mostrar/ocultar capas', category: 'view' },
  { id: 'reset-zoom', combo: 'mod+0', label: 'Reset zoom', category: 'view' },
  { id: 'fit-all', combo: 'mod+shift+0', label: 'Encuadrar todo', category: 'view' },

  // Selection
  { id: 'clear-selection', combo: 'escape', label: 'Cerrar seleccion', category: 'selection', global: true },
  { id: 'delete-selection', combo: 'delete', label: 'Limpiar seleccion', category: 'selection', global: true },
  { id: 'select-all', combo: 'mod+a', label: 'Seleccionar todo', category: 'selection' },

  // Workspace
  { id: 'reset-workspace', combo: 'mod+shift+r', label: 'Reset workspace', category: 'workspace' },

  // Command
  { id: 'command-palette', combo: 'mod+shift+p', label: 'Command Palette', category: 'command' },
];

/** Parsea una combo string y matchea contra un KeyboardEvent. */
export function matchesCombo(combo: string, event: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const needsMod = parts.includes('mod');
  const needsShift = parts.includes('shift');
  const needsAlt = parts.includes('alt');
  const key = parts.filter((p) => p !== 'mod' && p !== 'shift' && p !== 'alt')[0] ?? '';

  // Mod = Cmd on Mac, Ctrl on others
  const modPressed = isMac ? event.metaKey : event.ctrlKey;

  if (needsMod && !modPressed) return false;
  if (!needsMod && modPressed) return false;
  if (needsShift && !event.shiftKey) return false;
  if (!needsShift && event.shiftKey && key !== '') return false;
  if (needsAlt && !event.altKey) return false;

  // Key matching
  const eventKey = event.key.toLowerCase();
  if (key === 'escape') return eventKey === 'escape';
  if (key === 'delete') return eventKey === 'delete' || eventKey === 'backspace';
  if (key === 'space') return eventKey === ' ';
  if (key === 'f') return eventKey === 'f';

  // Number keys
  if (/^\d$/.test(key)) return eventKey === key;

  return eventKey === key;
}

/** Formatea una combo para display en la UI. */
export function formatCombo(combo: string): string {
  const isMac = typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return combo
    .replace('mod', isMac ? '⌘' : 'Ctrl')
    .replace('shift', isMac ? '⇧' : 'Shift')
    .replace('alt', isMac ? '⌥' : 'Alt')
    .replace('escape', 'Esc')
    .replace('delete', 'Del')
    .replace('space', '␣')
    .split('+')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(isMac ? '' : '+');
}
