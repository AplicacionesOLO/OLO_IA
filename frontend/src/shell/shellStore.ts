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
}));
