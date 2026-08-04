/**
 * ANCHO REAL DE UN CONTENEDOR, y el reparto de columnas laterales que cabe en él.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL DEFECTO QUE ESTO ARREGLA
 *
 * Las pantallas de trabajo tienen columnas laterales de ancho FIJO en píxeles y
 * `shrink-0`: 300 px de árbol, 320 o 340 de inspector. Con eso, el centro se queda
 * con lo que sobre, y cuando no sobra nada el centro se aplasta y la columna derecha
 * se sale del contenedor —que recorta— así que desaparece sin dejar rastro. No hay
 * desborde de página, así que nada avisa: medido, `scrollWidth == clientWidth` con
 * media columna invisible.
 *
 * Y no hacía falta una pantalla pequeña para verlo. Con el escalado de Windows al
 * 150 %, un portátil de 1.366 px físicos da **910 px CSS**, y un 1.920 da 1.280. Yo
 * probaba a 1.680 y 2.100, donde 620 px de columnas sobran; en 910 no queda ni un
 * tercio para el lienzo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE ARREGLA SOLO CON CSS
 *
 * Para las columnas del editor sí: `clamp()` y `minmax()` bastan. Pero el explorador
 * guarda el ancho de sus paneles en píxeles porque se pueden ARRASTRAR, y un ancho
 * elegido a mano en una pantalla grande viaja al `localStorage` y vuelve en una
 * pequeña. Ahí hace falta acotar el valor guardado contra el espacio que hay, y eso
 * es aritmética, no una consulta de medios.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 *
 * El CENTRO manda. Es donde está el trabajo —el plano, la tabla, el rack— y una
 * columna lateral completa junto a un centro de 240 px no sirve de nada. Así que:
 *
 *   1. Se reserva el mínimo del centro.
 *   2. Lo que queda se reparte entre las laterales, respetando lo que cada una
 *      pidió pero sin pasarse.
 *   3. Si aun así no cabe, se COLAPSAN por orden: primero la derecha —el inspector
 *      es contextual— y después la izquierda.
 *
 * Colapsar es mejor que encoger sin fondo: un panel de 90 px no es un panel, es una
 * columna de texto cortado. Colapsado deja su botón para volver a abrirlo, así que
 * la información sigue accesible en lugar de estar escondida.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Ancho en píxeles CSS del elemento, medido y actualizado al redimensionar.
 *
 * ── POR QUÉ UN `ref` DE CALLBACK Y NO UN `useRef` ──────────────────────────
 *
 * Porque las pantallas de este proyecto tienen PUERTAS: mientras no hay almacén
 * resuelto, o el catálogo no está importado, la página devuelve otra cosa. Con
 * `useRef` + `useEffect([])`, los dos efectos corrían UNA vez al montar —cuando lo
 * pintado es la puerta y el `ref` está vacío— y no volvían a correr nunca: el
 * `ResizeObserver` salía por el `return` temprano y el ancho se quedaba en 0 para
 * siempre.
 *
 * Con 0, `repartir` devuelve lo pedido sin tocar, así que el defecto quedaba
 * EXACTAMENTE igual que antes de arreglarlo. Medido: 224 px de lienzo en una ventana
 * de 1.024, los mismos que con las columnas fijas.
 *
 * Un `ref` de callback se dispara cuando el nodo aparece de verdad, sea en el primer
 * render o en el décimo.
 */
export function useAnchoDisponible<T extends HTMLElement>(): {
  ref: (nodo: T | null) => void;
  ancho: number;
} {
  const [nodo, setNodo] = useState<T | null>(null);
  const [ancho, setAncho] = useState(0);

  const ref = useCallback((n: T | null) => setNodo(n), []);

  useEffect(() => {
    if (!nodo) {
      setAncho(0);
      return;
    }
    // Medida inmediata además del observador: `ResizeObserver` avisa en el siguiente
    // cuadro y sin esto el primer render con el nodo puesto seguiría valiendo 0.
    setAncho(nodo.clientWidth);
    const ro = new ResizeObserver(() => setAncho(nodo.clientWidth));
    ro.observe(nodo);
    return () => ro.disconnect();
  }, [nodo]);

  return { ref, ancho };
}

export interface RepartoPedido {
  /** Ancho que la columna izquierda querría, en píxeles. `0` si no hay. */
  izquierda: number;
  /** Ancho que la columna derecha querría. `0` si no hay. */
  derecha: number;
  /** Lo mínimo que el centro necesita para servir de algo. */
  minCentro: number;
  /** Ancho de una columna colapsada: solo su botón. */
  anchoColapsado?: number;
  /** Huecos y separadores que no son columna pero ocupan. */
  extra?: number;
}

export interface Reparto {
  izquierda: number;
  derecha: number;
  /** `true` cuando no cabía y se ha colapsado por falta de espacio. */
  izquierdaForzada: boolean;
  derechaForzada: boolean;
  /** Lo que le queda al centro con este reparto. */
  centro: number;
}

/**
 * Reparte el ancho disponible entre las dos laterales y el centro.
 *
 * Con `ancho = 0` —antes de la primera medida— devuelve lo pedido sin tocar: es lo
 * que había antes de este módulo, así que en el peor caso el comportamiento es el de
 * siempre y no una pantalla en blanco.
 */
export function repartir(ancho: number, pedido: RepartoPedido): Reparto {
  const colapsado = pedido.anchoColapsado ?? 40;
  const extra = pedido.extra ?? 0;
  const hayIzq = pedido.izquierda > 0;
  const hayDer = pedido.derecha > 0;

  if (ancho <= 0) {
    return {
      izquierda: pedido.izquierda,
      derecha: pedido.derecha,
      izquierdaForzada: false,
      derechaForzada: false,
      centro: 0,
    };
  }

  const libre = ancho - extra;

  // ¿Cabe lo que se pidió?
  if (pedido.izquierda + pedido.derecha + pedido.minCentro <= libre) {
    return {
      izquierda: pedido.izquierda,
      derecha: pedido.derecha,
      izquierdaForzada: false,
      derechaForzada: false,
      centro: libre - pedido.izquierda - pedido.derecha,
    };
  }

  // No cabe: se encogen las laterales a la vez, en proporcion a lo que pidieron, con
  // un suelo. Encoger la mas ancha primero dejaria dos columnas del mismo tamaño y
  // perderia la jerarquia que el operador eligio al arrastrarlas.
  const SUELO = 200;
  const disponibleLaterales = libre - pedido.minCentro;
  const pedidoTotal = pedido.izquierda + pedido.derecha;

  if (disponibleLaterales >= (hayIzq ? SUELO : 0) + (hayDer ? SUELO : 0)) {
    const k = disponibleLaterales / pedidoTotal;
    let izq = hayIzq ? Math.max(SUELO, Math.floor(pedido.izquierda * k)) : 0;
    let der = hayDer ? Math.max(SUELO, Math.floor(pedido.derecha * k)) : 0;

    /**
     * El SUELO puede empujar la suma por encima de lo disponible.
     *
     * Con 400 px para repartir y dos columnas que piden 300 y 340, el reparto
     * proporcional da 187 y 212; al subir la primera a su suelo de 200 la suma pasa a
     * 412 y esos 12 px de exceso salen del centro, que era justo lo que no podia
     * pasar. Una prueba lo encontro: el centro se quedaba en 370 con un minimo de 380.
     *
     * El exceso lo cede quien tiene MARGEN sobre el suelo, en proporcion a ese margen.
     * La condicion de entrada garantiza que cabe: si hay sitio para los dos suelos, hay
     * un reparto valido, y este lo encuentra sin iterar.
     */
    const exceso = izq + der - disponibleLaterales;
    if (exceso > 0) {
      const margenIzq = izq - SUELO;
      const margenDer = der - SUELO;
      const margen = margenIzq + margenDer;
      if (margen > 0) {
        const cedeIzq = Math.min(margenIzq, Math.round((exceso * margenIzq) / margen));
        izq -= cedeIzq;
        der -= Math.min(margenDer, exceso - cedeIzq);
      }
    }

    return {
      izquierda: izq,
      derecha: der,
      izquierdaForzada: false,
      derechaForzada: false,
      centro: libre - izq - der,
    };
  }

  // Sigue sin caber: se colapsa la DERECHA. El inspector es contextual —describe lo
  // seleccionado— y sin el se puede seguir trabajando; sin el arbol de la izquierda
  // no hay por donde navegar.
  if (hayDer) {
    const restoIzq = libre - colapsado - pedido.minCentro;
    if (!hayIzq || restoIzq >= SUELO) {
      const izq = hayIzq ? Math.min(pedido.izquierda, restoIzq) : 0;
      return {
        izquierda: izq,
        derecha: 0,
        izquierdaForzada: false,
        derechaForzada: true,
        centro: libre - izq - colapsado,
      };
    }
  }

  // Y por ultimo las dos. El centro se queda con todo lo que hay, que es lo unico
  // que de verdad no se puede colapsar.
  return {
    izquierda: 0,
    derecha: 0,
    izquierdaForzada: hayIzq,
    derechaForzada: hayDer,
    centro: libre - (hayIzq ? colapsado : 0) - (hayDer ? colapsado : 0),
  };
}
