/**
 * PLACEHOLDER DE MODULO
 *
 * Los modulos funcionales no son parte de esta entrega. Esta pantalla es honesta
 * sobre ello en lugar de mostrar datos falsos.
 *
 * Mantiene el lenguaje visual completo para que el shell se pueda evaluar en
 * cualquier ruta: un panel de cristal centrado, sin marco, con aire de sobra.
 */

import { Panel } from '../design/foundation/Panel';
import { CanvasHost } from '../shell/CanvasHost';
import { NAV_ITEMS } from '../shell/navigation';

interface PlaceholderPageProps {
  title: string;
  navId: string;
}

export function PlaceholderPage({ title, navId }: PlaceholderPageProps) {
  const item = NAV_ITEMS.find((i) => i.id === navId);
  const Icon = item?.icon;

  // El motivo concreto, no un «pendiente» genérico: cada caso lo resuelve una
  // persona distinta, y decirlo aqui evita que se pregunte por el canal
  // equivocado. Es la version larga de la señal que lleva el item en la sidebar.
  const layerNote = item?.availableFromLayer
    ? `Este modulo se activa con la capa visual ${item.availableFromLayer}. No depende de permisos.`
    : item?.inCatalog === false
      ? `La familia de permisos \`${item.family}\` todavia no existe en el backend. ` +
        'Requiere una migracion que la añada al catalogo, no un cambio de permisos.'
      : 'La pantalla esta pendiente de implementacion. Los permisos y el backend ya estan listos.';

  return (
    <CanvasHost mode="grid">
      <div className="flex min-h-[70vh] items-center justify-center">
        <Panel level="work" radius="2xl" pad="lg" className="max-w-[520px] text-center">
          {Icon && (
            <div className="mx-auto mb-[var(--space-7)] flex size-14 items-center justify-center rounded-[var(--radius-lg)] [background:var(--glass-3)] shadow-[var(--rim-2),var(--aura-idle)]">
              <Icon strokeWidth={1.25} className="size-6 text-[var(--icon-accent)]" />
            </div>
          )}

          <h1 className="mb-[var(--space-2)] text-[length:var(--text-2xl)] font-[var(--weight-light)] leading-tight tracking-[var(--tracking-tight)] text-[var(--text-primary)]">
            {title}
          </h1>

          {item && (
            <p className="t-mono-xs mb-[var(--space-5)] text-[var(--text-faint)]">
              familia {item.family}
              {item.permission && ` · permiso ${item.permission}`}
            </p>
          )}

          <p className="t-body mx-auto mb-[var(--space-3)] max-w-[42ch] text-[var(--text-secondary)]">
            {layerNote}
          </p>

          <p className="t-small mx-auto max-w-[42ch] text-[var(--text-faint)]">
            El shell, el sistema de diseño y el gemelo digital de capa 1 ya estan
            operativos.
          </p>
        </Panel>
      </div>
    </CanvasHost>
  );
}
