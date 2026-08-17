/**
 * La vista WebGL, en su propia carpeta y detrás de una carga en diferido.
 *
 * `three` pesa unos 150 KB comprimidos, y el paquete de esta aplicacion ya avisa de que
 * pasa de 500 KB. Cargarlo al arrancar haria mas lenta la entrada a TODAS las pantallas
 * por una vista que se abre a proposito. Con `lazy`, quien no la abre no lo paga.
 */
export { Almacen3D } from './Almacen3D';
export type { Almacen3DProps } from './Almacen3D';
export {
  cajaDeRack,
  claveDeHueco,
  cuantasPlacas,
  encuadreDe,
  placasDeHuecos,
} from './mundo';
export type { CajaEnMundo, PlacaDeHueco } from './mundo';
