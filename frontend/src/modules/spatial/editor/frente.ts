/**
 * HACIA DONDE APUNTA LA CARA DE UN RACK, PARA PODER ENSEÑARLO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE HACE FALTA TRADUCIR
 *
 * La cara se guarda como lado del marco LOCAL del rack —`1` o `-1`— y esa es la forma
 * correcta de guardarla: rotar el rack no la deja mintiendo, y el gemelo de un rack doble
 * sale con la cara contraria usando el mismo valor.
 *
 * Pero «menos uno» no le dice nada a quien está mirando un plano. Lo que esa persona
 * necesita saber es HACIA DONDE DA, sobre la imagen que tiene delante: si el frente de
 * `RCL21` apunta al pasillo o a la pared. Eso sí depende del giro, y es justo la cuenta que
 * nadie debería tener que hacer de cabeza para elegir entre dos botones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS EJES SON LOS DEL PLANO, NO LOS DE MATEMATICAS
 *
 * En el lienzo la `y` crece HACIA ABAJO, como en cualquier imagen. Así que un vector
 * `(0, +1)` apunta hacia abajo en la pantalla, no hacia arriba, y las flechas se eligen con
 * ese criterio. Confundirlo daría un indicador que apunta exactamente al revés — y un
 * indicador al revés es peor que ninguno, porque se cree—.
 */

/** Las ocho direcciones, empezando por la derecha y girando en el sentido de la pantalla. */
const FLECHAS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const;

/** Cómo se lee cada una en voz alta, para el `title` y los lectores de pantalla. */
const NOMBRES = [
  'a la derecha',
  'abajo a la derecha',
  'hacia abajo',
  'abajo a la izquierda',
  'a la izquierda',
  'arriba a la izquierda',
  'hacia arriba',
  'arriba a la derecha',
] as const;

export interface DireccionDeCara {
  /** Vector unitario en coordenadas del PLANO (`y` hacia abajo). */
  dx: number;
  dy: number;
  /** La flecha más cercana de las ocho, para poner en un botón. */
  flecha: string;
  /** Cómo se lee: «a la derecha», «hacia abajo»… */
  nombre: string;
}

/**
 * Hacia dónde da la cara `lado` de un rack girado `rotacion` grados.
 *
 * El ancho del rack va sobre su eje local X, así que la normal de la cara larga es ese
 * mismo eje: `(cos θ, sen θ)` para el lado `+1` y el contrario para el `-1`. Es la misma
 * cuenta con la que se colocan las placas de los huecos y el punto de una parada; escrita
 * aquí otra vez estaría condenada a separarse de ellas.
 */
export function direccionDeCara(rotacion: number, lado: 1 | -1): DireccionDeCara {
  const t = (rotacion * Math.PI) / 180;
  const dx = lado * Math.cos(t);
  const dy = lado * Math.sin(t);
  //  `atan2` con `y` de pantalla: crece en el sentido de las agujas del reloj visto por
  //  quien mira, que es el mismo sentido en el que están ordenadas las flechas.
  const octante = Math.round((Math.atan2(dy, dx) * 4) / Math.PI);
  //  El resto de un negativo en JavaScript es negativo: `-1 % 8` es `-1`, no `7`. Sin la
  //  segunda vuelta, cualquier rack girado más de 180° sacaría `undefined` como flecha.
  const i = ((octante % 8) + 8) % 8;
  return { dx, dy, flecha: FLECHAS[i]!, nombre: NOMBRES[i]! };
}
