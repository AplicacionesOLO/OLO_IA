/**
 * Aviso para quien no es Platform Owner.
 *
 * Dice explicitamente que NO es un permiso que un administrador de tenant pueda
 * conceder: el privilegio se otorga registrando al usuario en `platform.owners`.
 * Sin esa aclaracion, el usuario iria a pedirselo a alguien que no puede darselo.
 */

import { ShieldAlert } from 'lucide-react';

import { Panel } from '../../design/foundation/Panel';
import { CanvasHost } from '../../shell/CanvasHost';

export function NotOwnerNotice() {
  return (
    <CanvasHost mode="grid">
      <div className="flex min-h-[60vh] items-center justify-center">
        <Panel level="work" radius="2xl" pad="lg" className="max-w-[520px] text-center">
          <div className="mx-auto mb-[var(--space-6)] flex size-14 items-center justify-center rounded-[var(--radius-lg)] [background:var(--glass-3)] shadow-[var(--rim-2)]">
            <ShieldAlert strokeWidth={1.25} className="size-6 text-[var(--icon-accent)]" />
          </div>
          <h1 className="mb-[var(--space-3)] text-[length:var(--text-xl)] font-[var(--weight-light)] text-[var(--text-primary)]">
            Administracion de plataforma
          </h1>
          <p className="t-body mx-auto max-w-[42ch] text-[var(--text-secondary)]">
            Esta zona es de administracion de plataforma y esta por encima de las
            organizaciones. No es un permiso que un administrador de tu organizacion
            pueda concederte.
          </p>
        </Panel>
      </div>
    </CanvasHost>
  );
}
