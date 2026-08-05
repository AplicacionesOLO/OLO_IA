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
import { useThemeSync } from '../design/tokens/themes/useTheme';
import { OlobotPanel } from '../features/olobot/OlobotPanel';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useShellStore } from './shellStore';
import { AmbientLight } from '../design/foundation/AmbientLight';
import { cn } from '../design/utils/cn';

export function AppShell() {
  /*
    El tema, enganchado AQUI y no en el conmutador del menu.

    El escuchador de `prefers-color-scheme` tiene que vivir mientras viva la
    aplicacion: dentro del desplegable de usuario solo escuchaba con el menu abierto, y
    «seguir al sistema» dejaba de seguirlo al cerrarlo. Se midio emulando el cambio de
    tema del sistema con el menu cerrado: no pasaba nada.
  */
  useThemeSync();

  const visorExpandido = useShellStore((s) => s.visorExpandido);
  const olobotAbierto = useShellStore((s) => s.olobotAbierto);

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
          /*
            Con OLOBOT abierto, el contenido SE ESTRECHA en pantallas anchas en vez de
            quedar debajo del panel. Visto en pantalla: el panel tapaba la columna de
            acciones de las tablas de Configuracion, asi que el bot te llevaba a una
            pantalla y te ocultaba justo los botones de esa pantalla.

            La transicion acompana al panel: sin ella el contenido salta 420 px de
            golpe y se pierde donde estaba mirando.

            Por debajo de `lg` NO se estrecha: el panel ocupa el ancho completo y
            estrechar el contenido a cero no ayudaria a nadie. Ahi si es una capa
            encima, que es lo correcto cuando no hay sitio para las dos cosas.
          */
          'transition-[margin] duration-300 ease-out',
          olobotAbierto && 'lg:mr-[420px]',
        )}
      >
        <TopBar />

        {/* La UNICA region con scroll de la aplicacion. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/*
        OLOBOT, FUERA de <main> y a la altura del shell.

        Dentro de <main> lo desmontaria cada navegacion, y eso es exactamente lo que
        no puede pasar: el bot te lleva a una pantalla y la conversacion tiene que
        seguir abierta al lado para poder comentarla. Aqui sobrevive al cambio de ruta.
      */}
      <OlobotPanel />
    </div>
  );
}
