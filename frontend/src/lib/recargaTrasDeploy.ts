/**
 * RECUPERARSE DE UN DEPLOY CON LA PESTAÑA ABIERTA.
 *
 * Cada deploy renombra los archivos de la app (llevan un hash en el nombre) y borra los
 * viejos. Una pestaña abierta desde ANTES del deploy sigue pidiendo los nombres viejos al
 * cargar algo bajo demanda —el 3D+, que es lo unico que se descarga al pulsarlo— y el
 * servidor ya no los tiene: el visor se quedaba esperando para siempre. Reportado el 27/11:
 * «el 3D+ no carga, ya esperé más de 10 minutos», tras varios deploys en el día.
 *
 * La solucion es recargar la pagina UNA vez: trae el indice nuevo con los nombres buenos.
 * La marca en `sessionStorage` evita un bucle de recargas si el fallo es otro (sin red).
 */
const MARCA = 'olo.recarga-tras-deploy';

export function recargarUnaVez(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(MARCA) ?? '0');
    //  Una recarga por minuto como mucho: si vuelve a fallar enseguida, no es un deploy.
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(MARCA, String(Date.now()));
  } catch {
    //  Sin sessionStorage (modo privado estricto) se recarga igual: peor seria no cargar.
  }
  window.location.reload();
  return true;
}

/** `import()` que, si el archivo ya no existe tras un deploy, recarga la pagina una vez. */
export function importarConRecarga<T>(cargar: () => Promise<T>): Promise<T> {
  return cargar().catch((err: unknown) => {
    if (recargarUnaVez()) {
      //  La pagina se va a recargar: una promesa que no se resuelve evita pintar un error.
      return new Promise<T>(() => {});
    }
    throw err;
  });
}

/** Vite avisa con este evento cuando falla la precarga de un archivo de la app. */
export function vigilarDeploys(): void {
  window.addEventListener('vite:preloadError', (e) => {
    if (recargarUnaVez()) e.preventDefault();
  });
}
