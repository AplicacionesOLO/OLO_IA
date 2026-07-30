/**
 * COMMAND PALETTE — Ctrl+Shift+P.
 *
 * Overlay modal con busqueda fuzzy sobre todos los comandos registrados.
 * Se comporta igual que VSCode: abre rapido, busca por texto, ejecuta con
 * Enter, cierra con Escape.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { commandRegistry, type Command } from '../../workspace/commands';
import { formatCombo } from '../../workspace/shortcuts';
import { cn } from '../../../../design/utils/cn';
import { easing } from '../../../../design/motion/easing';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = commandRegistry.search(query);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keyboard navigation inside the palette
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = results[selectedIndex];
        if (cmd) {
          commandRegistry.execute(cmd.id);
          onClose();
        }
      }
    },
    [onClose, results, selectedIndex],
  );

  // Reset index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[200] bg-[rgb(0_0_0/0.5)]"
            onClick={onClose}
            aria-hidden
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.15, ease: easing.emerge }}
            className={cn(
              'fixed left-1/2 top-[20%] z-[201] w-[520px] max-w-[90vw] -translate-x-1/2',
              'overflow-hidden rounded-[var(--radius-lg)]',
              '[background:var(--glass-3)] shadow-[var(--rim-2),var(--drop-4)]',
              'backdrop-blur-[32px]',
            )}
            role="dialog"
            aria-label="Command Palette"
            onKeyDown={onKeyDown}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
              <Search strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Escribe un comando…"
                className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
                aria-label="Buscar comando"
              />
              <span className="t-mono-xs shrink-0 text-[var(--text-faint)]">
                Esc
              </span>
            </div>

            {/* Results */}
            <div className="max-h-[320px] overflow-y-auto py-1.5">
              {results.length === 0 && (
                <p className="px-4 py-6 text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
                  Sin comandos para "{query}"
                </p>
              )}
              {results.map((cmd, i) => (
                <CommandItem
                  key={cmd.id}
                  command={cmd}
                  selected={i === selectedIndex}
                  onExecute={() => {
                    commandRegistry.execute(cmd.id);
                    onClose();
                  }}
                  onHover={() => setSelectedIndex(i)}
                />
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CommandItem({
  command,
  selected,
  onExecute,
  onHover,
}: {
  command: Command;
  selected: boolean;
  onExecute: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExecute}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
        selected
          ? '[background:var(--glass-2)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:[background:var(--glass-1)]',
      )}
      role="option"
      aria-selected={selected}
    >
      <span className="flex-1 text-[length:var(--text-sm)]">{command.label}</span>
      <span className="t-mono-xs text-[var(--text-faint)]">{command.category}</span>
      {command.shortcut && (
        <span className="t-mono-xs text-[var(--text-faint)]">
          {formatCombo(command.shortcut)}
        </span>
      )}
    </button>
  );
}
