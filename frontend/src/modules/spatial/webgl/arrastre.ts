/**
 * ARRASTRAR EN PERSPECTIVA: contra QUE plano se corta el rayo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL PROBLEMA, QUE ES REAL Y NO DE IMPLEMENTACION
 *
 * En planta, mover es trivial: el cursor está sobre el suelo y el punto bajo el ratón es
 * uno. En perspectiva no: un píxel de pantalla es una RECTA en el mundo, y sobre esa recta
 * hay infinitos puntos. Sin decidir a qué altura queremos el punto, no hay respuesta.
 *
 * Por eso el visor axonométrico dejó la edición fuera de la vista 3D: no porque arrastrar
 * fuera difícil, sino porque no estaba dicho sobre qué plano.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA DECISION: DOS GESTOS, CADA UNO CON SU PLANO
 *
 *   arrastrar          plano HORIZONTAL a la altura actual de la figura  → mueve en el suelo
 *   Mayús + arrastrar  plano VERTICAL de cara a la cámara               → cambia la altura
 *
 * Los dos son inequívocos, y juntos cubren lo que hay que poder hacer: llevar un operario
 * por un pasillo, y subir un dron a la altura del cuarto nivel.
 *
 * El plano horizontal va a la altura QUE YA TIENE la figura, no a cero. Si fuera a cero, un
 * dron a seis metros caería al suelo en cuanto alguien lo tocara — y eso no es mover, es
 * perder el dato—.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTO ES UN MODULO APARTE
 *
 * Porque es aritmética y `vitest` no tiene WebGL. Las funciones de aquí reciben números y
 * devuelven números; quien renderiza los convierte en `Plane` y `Vector3`. Es la misma
 * razón por la que `mundo.ts` existe: unas cuentas que solo se pueden comprobar mirando la
 * pantalla es como estuvo semanas un eje girado 90°.
 */

/**
 * Lo más alto que se puede subir una figura arrastrando, en metros.
 *
 * Es el MISMO tope que el `CHECK` de `spatial.asset_instances` (0093). Escrito aquí y no
 * deducido: si divergieran, el gesto ofrecería una altura que la base rechaza y el error
 * saldría al guardar, después del gesto, por algo que se sabía antes de empezarlo.
 */
export const ALTURA_MAXIMA_M = 200;

/** Un punto en el mundo de three.js. Metros, `y` hacia arriba. */
export interface PuntoMundo {
  x: number;
  y: number;
  z: number;
}

/** Un plano, en la forma que espera `THREE.Plane`: normal y distancia al origen. */
export interface PlanoDeArrastre {
  normal: [x: number, y: number, z: number];
  /** La `constant` de `THREE.Plane`: la distancia con signo del origen al plano. */
  constante: number;
}

/**
 * El plano HORIZONTAL a la altura de la figura.
 *
 * `THREE.Plane` cumple `normal · punto + constant = 0`. Con normal (0,1,0), eso es
 * `y + constant = 0`, así que la constante es `-altura`. Escrito aquí y probado, porque el
 * signo es exactamente el tipo de detalle que se equivoca y produce una figura que se va al
 * infinito en cuanto se toca.
 */
export function planoHorizontal(alturaY: number): PlanoDeArrastre {
  return { normal: [0, 1, 0], constante: -alturaY };
}

/**
 * El plano VERTICAL que pasa por la figura y mira a la cámara.
 *
 * La normal es la dirección cámara → figura, APLANADA (sin componente vertical) y
 * normalizada: así el plano es vertical de verdad y queda de frente a quien mira, que es lo
 * que hace que subir el ratón suba la figura sin sorpresas.
 *
 * Si la cámara está justo encima de la figura, la dirección aplanada es cero y no hay plano
 * que valga: se devuelve `null` y quien llama no arrastra en vertical. Es honesto — mirando
 * desde arriba no se puede juzgar una altura—.
 */
export function planoVertical(
  camara: PuntoMundo,
  figura: PuntoMundo,
): PlanoDeArrastre | null {
  const dx = figura.x - camara.x;
  const dz = figura.z - camara.z;
  const largo = Math.hypot(dx, dz);
  //  Un umbral y no `=== 0`: a un centímetro de estar encima, el plano ya es tan rasante
  //  que un píxel de ratón movería la figura decenas de metros.
  if (largo < 1e-3) return null;
  const nx = dx / largo;
  const nz = dz / largo;
  //  `normal · figura + constant = 0`  →  constant = -(normal · figura)
  return { normal: [nx, 0, nz], constante: -(nx * figura.x + nz * figura.z) };
}

/**
 * Donde acaba la figura, dado el punto del plano bajo el cursor.
 *
 * ── POR QUE HAY UN DESFASE ────────────────────────────────────────────────────
 *
 * Porque se agarra la figura POR DONDE se pinchó. Sin desfase, tocar el pie de un operario
 * lo centraría de golpe bajo el cursor: la figura salta antes de moverse, y el salto se lee
 * como un fallo. Se guarda la diferencia entre el origen de la figura y el punto donde
 * empezó el arrastre, y se mantiene.
 *
 * En horizontal la altura NO se toca, y en vertical solo se toca la altura. Cada gesto
 * cambia lo suyo: un arrastre que moviera las tres cosas a la vez sería otra vez el
 * problema de los infinitos puntos, con más pasos.
 */
export function destinoDeArrastre(opciones: {
  puntoEnPlano: PuntoMundo;
  desfase: PuntoMundo;
  posicionActual: PuntoMundo;
  vertical: boolean;
}): PuntoMundo {
  const { puntoEnPlano: p, desfase: d, posicionActual: a, vertical } = opciones;
  if (vertical) {
    /*
      Solo la altura, y acotada a [0, ALTURA_MAXIMA_M].

      Abajo: una figura enterrada no se ve y no se puede volver a agarrar, así que el gesto
      se quedaría sin salida.

      Arriba: el tope es el MISMO que el `CHECK` de la base (0093). Sin él, el gesto puede
      producir una altura que la base rechaza — y con la cámara lejos se pasa fácil: medido
      en el navegador, 120 px de arrastre dieron 57 m, porque a esa distancia cada píxel son
      casi cincuenta centímetros—. Que la pantalla ofrezca lo que la base no acepta es un
      error al guardar por algo que se sabía antes.
    */
    return { x: a.x, y: Math.min(ALTURA_MAXIMA_M, Math.max(0, p.y + d.y)), z: a.z };
  }
  return { x: p.x + d.x, y: a.y, z: p.z + d.z };
}

/**
 * Del mundo de three.js al dominio: metros del plano.
 *
 * Es la inversa exacta de lo que hace `Almacen3D` al colocar una figura, y va junta con
 * ella en la cabeza aunque estén en dos archivos: `x → x`, `z → y`, `y → altura`. Tenerlas
 * escritas al revés en un sitio produciría figuras que se mueven en diagonal.
 */
export function aDominio(p: PuntoMundo): { xM: number; yM: number; zM: number } {
  return {
    //  Tres decimales: un milímetro. Más precisión en una figura decorativa solo llena la
    //  base de dígitos que nadie mira, y menos se nota al arrastrar despacio.
    xM: Number(p.x.toFixed(3)),
    yM: Number(p.z.toFixed(3)),
    zM: Number(p.y.toFixed(3)),
  };
}

/** Si el movimiento merece guardarse. Evita escribir por un temblor del ratón. */
export function movimientoApreciable(
  antes: { xM: number; yM: number; zM: number },
  despues: { xM: number; yM: number; zM: number },
): boolean {
  /*
    Un centímetro. Por debajo, guardar sería una escritura y una invalidación de consulta por
    nada — y con la invalidación, un repintado de la escena entera—.

    ── SE COMPARA EN MILIMETROS ENTEROS, Y NO ES UN CAPRICHO ────────────────────

    En coma flotante, `|10 − 10,01|` da 0,00999999999999979: MENOR que 0,01. Un movimiento de
    exactamente un centímetro no se guardaba, y el fallo aparecía solo en los valores donde
    la resta cae del lado malo del redondeo — imposible de reproducir a mano—.

    Los valores llegan ya redondeados al milímetro desde `aDominio`, así que multiplicar por
    mil y redondear da enteros exactos y la comparación deja de depender del azar binario.
  */
  const mm = (v: number) => Math.round(v * 1000);
  const UMBRAL_MM = 10;
  return (
    Math.abs(mm(antes.xM) - mm(despues.xM)) >= UMBRAL_MM ||
    Math.abs(mm(antes.yM) - mm(despues.yM)) >= UMBRAL_MM ||
    Math.abs(mm(antes.zM) - mm(despues.zM)) >= UMBRAL_MM
  );
}
