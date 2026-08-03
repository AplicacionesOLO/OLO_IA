/**
 * PREFERENCIAS DEL LIENZO — lo que el operador decide sobre su propia interfaz.
 *
 * Separado de `systemStore`: ahi vive el estado del SISTEMA (eventos, vitales,
 * incidencias) y aqui una preferencia de quien mira la pantalla. Mezclarlas haria
 * que un evento de inferencia y «tengo la barra fija» compartieran ciclo de vida.
 *
 * Se persiste en `localStorage` y no en la base: es una preferencia de este
 * navegador, no del usuario en toda la plataforma. Si mañana debe seguirle entre
 * equipos, se mueve a `/v1/auth/me` sin que ningun consumidor cambie.
 */

import { create } from 'zustand';

const CLAVE_ANCLADA = 'olo.sidebar.pinned';

/**
 * Por defecto ANCLADA.
 *
 * Una barra que se esconde sola es un cambio de comportamiento, y estrenarlo sin
 * avisar deja al operador buscando la navegacion que tenia. Quien la quiera oculta
 * lo dice una vez y se recuerda.
 */
function leerAnclada(): boolean {
  try {
    const v = localStorage.getItem(CLAVE_ANCLADA);
    return v === null ? true : v === 'true';
  } catch {
    // Modo privado en algunos navegadores: se asume el valor por defecto.
    return true;
  }
}

interface ShellStoreState {
  /** `true`: ocupa su sitio siempre. `false`: se recoge y aparece al acercar el cursor. */
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarPinned: () => void;

  /**
   * Hay un visor a pantalla completa dentro del contenido.
   *
   * No es cosmetico: el contenedor del contenido lleva `z-10` y eso CREA un
   * contexto de apilamiento, asi que un `z-70` puesto dentro solo compite con sus
   * hermanos — la barra lateral, con `z-30` en el contexto padre, se dibujaba por
   * encima del visor expandido. `position: fixed` escapa del flujo, no del
   * apilamiento. Con esta bandera, el shell eleva el contenido por encima de la
   * barra mientras dura la expansion.
   *
   * La alternativa era un portal a `body`, y desmontar el visor destruiria el
   * contexto WebGL del rack y el historial de deshacer del editor.
   */
  visorExpandido: boolean;
  setVisorExpandido: (v: boolean) => void;
}

export const useShellStore = create<ShellStoreState>((set, get) => ({
  sidebarPinned: leerAnclada(),

  setSidebarPinned: (sidebarPinned) => {
    try {
      localStorage.setItem(CLAVE_ANCLADA, String(sidebarPinned));
    } catch {
      // Si no se puede guardar, la preferencia vale para esta sesion y punto.
    }
    set({ sidebarPinned });
  },

  toggleSidebarPinned: () => get().setSidebarPinned(!get().sidebarPinned),

  visorExpandido: false,
  setVisorExpandido: (visorExpandido) => set({ visorExpandido }),
}));
