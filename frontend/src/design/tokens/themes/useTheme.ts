/**
 * TEMAS: CLARO, OSCURO Y SISTEMA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL TEMA CLARO YA EXISTIA Y NADIE LO ENCENDIA
 *
 * `themes/daylight.css` son 115 lineas escritas con cuidado —las auras pasan a
 * sombras porque el glow no funciona sobre blanco, y el cristal pasa a casi opaco—
 * y estaban colgadas de un selector `[data-theme='daylight']` que NADA en la
 * aplicacion ponia nunca. El menu de la barra superior tenia una entrada «Temas»
 * cuya accion era cerrar el menu.
 *
 * O sea: el trabajo estaba hecho y el interruptor no existia. Esto es el interruptor.
 *
 * ── TRES OPCIONES, Y «SISTEMA» NO ES UN TERCER TEMA ─────────────────────────
 *
 * Lo que se guarda es la PREFERENCIA, y son tres:
 *
 *     'system'    seguir al sistema operativo, y CAMBIAR con el
 *     'dark'      oscuro siempre
 *     'daylight'  claro siempre
 *
 * `'system'` no es un tema: es la decision de no decidir. Por eso se guarda tal cual
 * en lugar de resolverlo a claro u oscuro al elegirlo: si se guardara resuelto, quien
 * pidiera «seguir al sistema» en un portatil que cambia a oscuro al atardecer se
 * quedaria clavado en el tema de la tarde. Se resuelve en cada render y se escucha el
 * cambio mientras la preferencia sea `'system'`.
 *
 * ── POR QUE SE FIJA TAMBIEN `color-scheme` ──────────────────────────────────
 *
 * Las barras de desplazamiento, los desplegables nativos y el rectangulo de foco los
 * pinta el NAVEGADOR, no nuestro CSS. Sin `color-scheme`, un tema claro sale con la
 * barra de desplazamiento oscura y los `<select>` negros: la mitad de la pantalla
 * cambia y la otra mitad no, que se ve peor que no haber cambiado nada.
 *
 * ── EL PRIMER PINTADO NO PARPADEA ───────────────────────────────────────────
 *
 * `index.html` aplica el tema guardado ANTES de que arranque React, en un guion
 * pequeño y sincrono. Sin eso, la pagina se pinta oscura y salta a clara cuando el
 * primer efecto corre: el famoso destello, que en una pantalla de almacen con luz
 * directa es especialmente molesto.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

/** Lo que el usuario ELIGE. `system` es una de las tres, no un caso especial. */
export type ThemePreference = 'system' | 'dark' | 'daylight';

/** Lo que acaba aplicado. `system` ya se resolvio. */
export type ThemeResolved = 'dark' | 'daylight';

/**
 * La clave de localStorage. La MISMA que lee el guion de `index.html`.
 *
 * Se exporta para que el guion y este modulo no puedan divergir en silencio: si
 * alguien renombrara una, el destello volveria y no habria ningun error.
 */
export const CLAVE_TEMA = 'olo.theme';

const CONSULTA_CLARO = '(prefers-color-scheme: light)';

function preferenciaGuardada(): ThemePreference {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    if (v === 'dark' || v === 'daylight' || v === 'system') return v;
  } catch {
    // Modo privado con almacenamiento bloqueado: se sigue con el sistema en lugar de
    // caer. Un tema no es motivo para que la aplicacion no arranque.
  }
  return 'system';
}

/** Que quiere el sistema operativo AHORA. */
export function temaDelSistema(): ThemeResolved {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia(CONSULTA_CLARO).matches ? 'daylight' : 'dark';
}

export function resolver(pref: ThemePreference): ThemeResolved {
  return pref === 'system' ? temaDelSistema() : pref;
}

/**
 * Nombre del tema oscuro en `data-theme`.
 *
 * ── UN ATRIBUTO QUE NO SELECCIONABA NADA ────────────────────────────────────
 *
 * `index.html` traia `data-theme="deep-space"` desde el principio y NINGUN selector
 * del CSS lo usa: los tokens del oscuro viven en `:root`, porque es el tema base. O
 * sea que el atributo parecia elegir un tema y no elegia ninguno —solo funcionaba por
 * no coincidir con `daylight`—.
 *
 * Se conserva el nombre en lugar de quitarlo, y ahora el atributo dice SIEMPRE qué
 * tema está puesto. Asi se puede leer desde una prueba, desde una captura o desde la
 * consola sin tener que saber que la ausencia significa oscuro.
 */
const NOMBRE_OSCURO = 'deep-space';

/**
 * El fondo del `<html>`, que se pinta antes de que cargue el CSS.
 *
 * `index.html` lo fija a mano para que no haya destello. Con dos temas hay dos
 * fondos, y si no se cambiara, elegir el claro daria un parpadeo oscuro en cada
 * recarga —justo en la pantalla que alguien eligio porque le da el sol—.
 */
export const FONDO: Record<ThemeResolved, string> = {
  dark: '#04070d',
  daylight: '#eef2f7',
};

/** Aplica el tema al documento. Exportada porque la usa el guion de arranque. */
export function aplicarTema(resuelto: ThemeResolved): void {
  const raiz = document.documentElement;
  raiz.setAttribute('data-theme', resuelto === 'daylight' ? 'daylight' : NOMBRE_OSCURO);
  // Para lo que pinta el NAVEGADOR y no nuestro CSS: barras de desplazamiento,
  // desplegables nativos, el rectangulo de foco.
  raiz.style.colorScheme = resuelto === 'daylight' ? 'light' : 'dark';
  raiz.style.background = FONDO[resuelto];
}

interface EstadoTema {
  preferencia: ThemePreference;
  /** El tema realmente aplicado. Derivado, pero se guarda para que la UI lo lea. */
  resuelto: ThemeResolved;
  elegir: (p: ThemePreference) => void;
  /** Lo llama el escuchador del sistema. No cambia la preferencia. */
  reevaluar: () => void;
}

export const useThemeStore = create<EstadoTema>((set, get) => ({
  preferencia: preferenciaGuardada(),
  resuelto: resolver(preferenciaGuardada()),
  elegir: (p) => {
    const resuelto = resolver(p);
    try {
      localStorage.setItem(CLAVE_TEMA, p);
    } catch {
      // Sin persistencia el tema dura la sesion. Sigue siendo mejor que no cambiar.
    }
    aplicarTema(resuelto);
    set({ preferencia: p, resuelto });
  },
  reevaluar: () => {
    // Solo si la preferencia es `system`: quien eligio claro no quiere que el
    // atardecer se lo cambie.
    if (get().preferencia !== 'system') return;
    const resuelto = temaDelSistema();
    if (resuelto === get().resuelto) return;
    aplicarTema(resuelto);
    set({ resuelto });
  },
}));

/**
 * Engancha el tema al documento y al sistema. Se monta UNA VEZ, en la raiz.
 *
 * ── POR QUE ESTA SEPARADO DE `useTheme` ─────────────────────────────────────
 *
 * Los dos vivian juntos y el escuchador del sistema acabo dentro del conmutador, que
 * solo existe MIENTRAS EL MENU ESTA ABIERTO. Consecuencia, medida: con «Seguir al
 * sistema» elegido y el menu cerrado, cambiar el tema del sistema operativo no hacia
 * nada; con el menu abierto, si. Un escuchador montado en un desplegable escucha
 * mientras el desplegable existe, y eso no es «seguir al sistema».
 *
 * Asi que ahora hay dos: esto, que se monta en la raiz y no dibuja nada, y `useTheme`,
 * que solo lee y no engancha nada. El componente que dibuja el conmutador no puede
 * volver a quedarse con la responsabilidad de escuchar.
 */
export function useThemeSync(): void {
  const resuelto = useThemeStore((s) => s.resuelto);
  const reevaluar = useThemeStore((s) => s.reevaluar);

  useEffect(() => {
    // Se aplica al montar: el guion de `index.html` ya lo hizo, pero esto cubre el
    // caso de que alguien lo quite y ademas hace que la aplicacion sea correcta por si
    // sola, sin depender de un guion en otro archivo.
    aplicarTema(resuelto);
  }, [resuelto]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(CONSULTA_CLARO);
    const alCambiar = () => reevaluar();
    // `addEventListener` y no `addListener`: el segundo esta obsoleto y en algunos
    // navegadores ya no existe, y el fallo seria silencioso —el tema simplemente no
    // seguiria al sistema—.
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [reevaluar]);
}

/**
 * Lo que necesita la interfaz para dibujar el conmutador. SOLO LEE.
 *
 * Sin efectos a proposito: ver la cabecera de `useThemeSync`. Si este hook volviera a
 * enganchar el escuchador, volveria a hacerlo desde donde se monte, y donde se monta
 * es un desplegable.
 */
export function useTheme(): {
  preferencia: ThemePreference;
  resuelto: ThemeResolved;
  elegir: (p: ThemePreference) => void;
} {
  return {
    preferencia: useThemeStore((s) => s.preferencia),
    resuelto: useThemeStore((s) => s.resuelto),
    elegir: useThemeStore((s) => s.elegir),
  };
}

/** Etiquetas para la interfaz. Aqui y no en el componente: se usan en dos sitios. */
export const ETIQUETA_TEMA: Record<ThemePreference, string> = {
  system: 'Seguir al sistema',
  dark: 'Oscuro',
  daylight: 'Claro',
};
