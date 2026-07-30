/**
 * CONTEXT MENU — marco de acciones contextuales.
 *
 * Se abre con click derecho o con un boton de acciones. Muestra opciones
 * disponibles para la ubicacion seleccionada. La logica de cada accion
 * vive fuera: este componente solo renderiza la estructura.
 *
 * Acciones preparadas (sin implementar logica):
 *   - Ver detalle
 *   - Editar (requiere backend)
 *   - Mover contenido (requiere backend)
 *   - Ver inventario (requiere backend)
 *   - Ver historial (requiere backend)
 *   - Centrar en mapa
 *   - Analisis IA (requiere backend)
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../../../design/utils/cn';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Accion deshabilitada: requiere backend o permiso. */
  disabled?: boolean;
  /** Separador antes de este item. */
  separator?: boolean;
  /** Atajo de teclado (solo display). */
  shortcut?: string;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onSelect: (itemId: string) => void;
  onClose: () => void;
}

export function ContextMenu({ items, position, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer click fuera o presionar Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-[100] min-w-[200px] py-1.5',
        'rounded-[var(--radius-md)] [background:var(--glass-3)]',
        'shadow-[var(--rim-2),var(--drop-3)] backdrop-blur-[28px]',
      )}
      style={{ left: position.x, top: position.y }}
      role="menu"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.id}>
            {item.separator && (
              <div className="mx-2 my-1 h-px [background:var(--hairline)]" />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  onSelect(item.id);
                  onClose();
                }
              }}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left text-[length:var(--text-sm)] transition-colors',
                item.disabled
                  ? 'text-[var(--text-faint)] cursor-not-allowed opacity-50'
                  : 'text-[var(--text-secondary)] hover:[background:var(--glass-1)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon strokeWidth={1.5} className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="t-mono-xs ml-4 text-[var(--text-faint)]">{item.shortcut}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
