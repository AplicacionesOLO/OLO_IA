/**
 * APPSHELL — composicion del lienzo.
 *
 *   ┌──────────┬───────────────────────────────────────────┐
 *   │ marca    │ TOPBAR                             72px   │
 *   │──────────┤───────────────────────────────────────────┤
 *   │          │                                           │
 *   │ SIDEBAR  │              CONTENIDO                    │
 *   │  244px   │            (unica region                  │
 *   │          │             con scroll)                   │
 *   │          │                                           │
 *   └──────────┴───────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES
 *
 * · UN SOLO fondo para toda la aplicacion. La sidebar no tiene superficie
 *   propia ni borde: flota sobre el mismo lienzo que el contenido. Es lo que la
 *   hace sentirse integrada en lugar de atornillada al lado.
 *
 * · La luz ambiental se monta UNA vez, aqui, detras de todo. Si cada vista
 *   montara la suya, al navegar se veria un salto en la iluminacion.
 *
 * · Se elimina la `StreamBar` inferior. Una tercera barra fija dejaba el
 *   contenido encajonado por los cuatro lados, que es exactamente la sensacion
 *   que habia que quitar. El flujo de eventos pasa a ser un panel de apoyo
 *   dentro del dashboard, donde compite por atencion en igualdad de condiciones
 *   con el resto de la informacion.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `h-dvh` y no `h-screen`: en navegadores moviles `100vh` incluye la barra de
 * direcciones y produce un desbordamiento de scroll.
 */

import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useShellStore } from './shellStore';
import { AmbientLight } from '../design/foundation/AmbientLight';
import { cn } from '../design/utils/cn';

export function AppShell() {
  const visorExpandido = useShellStore((s) => s.visorExpandido);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[var(--canvas)]">
      {/* Z-0 — la luz del lienzo. Tres focos a la deriva mas vignette. */}
      <AmbientLight />

      <Sidebar />

      {/* `min-w-0` es imprescindible: sin el, un hijo con contenido ancho
          (una tabla) desborda el flex en lugar de hacer scroll.

          El z-index sube a 40 mientras un visor esta a pantalla completa. Este
          contenedor crea contexto de apilamiento, asi que la capa del visor no
          puede por si misma ganarle a la barra lateral (z-30): sin esto, los
          iconos de la barra se dibujan sobre el plano expandido. */}
      <div
        className={cn(
          'relative flex min-w-0 flex-1 flex-col',
          visorExpandido ? 'z-40' : 'z-10',
        )}
      >
        <TopBar />

        {/* La UNICA region con scroll de la aplicacion. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
