/**
 * USE SHORTCUTS — hook que registra handlers para los atajos del workspace.
 *
 * Un solo listener en el document. Cada shortcut se resuelve por su id
 * contra un mapa de handlers. Los componentes pasan un Record<id, handler>.
 */

import { useEffect, useRef } from 'react';
import { matchesCombo, SHORTCUTS } from './shortcuts';

export type ShortcutHandlers = Partial<Record<string, () => void>>;

export function useShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Skip when typing in an input/textarea (unless global)
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      for (const shortcut of SHORTCUTS) {
        if (!matchesCombo(shortcut.combo, event)) continue;

        // Global shortcuts work even in inputs; others don't
        if (isInput && !shortcut.global) continue;

        const handler = handlersRef.current[shortcut.id];
        if (handler) {
          event.preventDefault();
          event.stopPropagation();
          handler();
          return;
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
