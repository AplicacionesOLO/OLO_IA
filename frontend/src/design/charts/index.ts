/**
 * GRAFICOS GENERICOS
 *
 * Ninguno conoce el dominio: reciben numeros y una `nature`. Cualquier modulo
 * futuro (Inventario, Flota, Conteos) los reutiliza sin adaptarlos.
 */

export { AreaSpark } from './AreaSpark';
export { RingGauge } from './RingGauge';
export { BarSeries, type BarDatum } from './BarSeries';
export { naturePaint, type ChartNature } from './nature';
