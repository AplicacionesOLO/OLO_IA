/**
 * LA ESCALA DE UN MODELO AJENO.
 *
 * Es la única cuenta de este archivo y es la que evita el fallo que de verdad pasa: un
 * `.glb` exportado en milímetros subido como si fueran metros, que pone una persona de
 * 1.700 m al lado de un rack de 12 y hace inservible el plano.
 *
 * Se prueba que sugiera cuando el desajuste es de orden de magnitud y que NO sugiera cuando
 * la diferencia es de modelado: proponer «x 0,94» sobre un modelo que estaba bien invita a
 * estropearlo, y eso es peor que no ayudar.
 */

import { describe, expect, it } from 'vitest';

import {
  ALTO_TIPICO_M,
  CATEGORIAS_DE_FIGURA,
  NOMBRE_DE_CATEGORIA,
  RUTA_FIGURAS_DEL_PROYECTO,
  avisoDeEscala,
  escalaSugerida,
  tipoDeModelo,
  urlDeFigura,
} from './figuras';

describe('escalaSugerida', () => {
  it('detecta milimetros en una persona', () => {
    //  1.700 «unidades» que deberían ser 1,7 m.
    expect(escalaSugerida(1700, 'persona')).toBeCloseTo(0.001, 9);
  });

  it('detecta centimetros', () => {
    expect(escalaSugerida(170, 'persona')).toBeCloseTo(0.01, 9);
  });

  it('detecta un modelo demasiado PEQUENO, no solo grande', () => {
    //  Un dron exportado en unidades raras puede salir diminuto. El aviso vale igual.
    expect(escalaSugerida(0.001, 'dron')).toBeGreaterThan(2);
  });

  it('no sugiere nada cuando ya esta bien', () => {
    expect(escalaSugerida(1.8, 'persona')).toBeNull();
    expect(escalaSugerida(1.7, 'persona')).toBeNull();
    //  Justo en los bordes tampoco: la mitad y el doble siguen siendo modelado.
    expect(escalaSugerida(0.85, 'persona')).toBeNull();
    expect(escalaSugerida(3.4, 'persona')).toBeNull();
  });

  it('sin alto o sin referencia no sugiere', () => {
    expect(escalaSugerida(null, 'persona')).toBeNull();
    expect(escalaSugerida(undefined, 'persona')).toBeNull();
    expect(escalaSugerida(0, 'persona')).toBeNull();
    //  `otro` no tiene alto tipico, y darle uno seria inventar una referencia.
    expect(escalaSugerida(1700, 'otro')).toBeNull();
  });
});

describe('avisoDeEscala', () => {
  it('nombra la unidad probable, que es lo que permite decidir', () => {
    const aviso = avisoDeEscala(1700, 'persona');
    expect(aviso).toContain('milímetros');
    //  Y dice por cuánto multiplicar: «mide 1700» solo no sirve de nada.
    expect(aviso).toContain('0.001');
  });

  it('distingue centimetros de milimetros', () => {
    expect(avisoDeEscala(170, 'persona')).toContain('centímetros');
  });

  it('calla cuando no hay nada que avisar', () => {
    expect(avisoDeEscala(1.72, 'persona')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EL TIPO DE UN .glb, QUE NO SE PUEDE PREGUNTAR AL ARCHIVO
//
// `File.type` lo pone el sistema operativo, y Windows no tiene registrado el MIME de
// `.glb`. Un modelo exportado desde cualquier herramienta llega con `type: ''`, el
// navegador manda `application/octet-stream` y el bucket lo rechaza con
// «415 invalid_mime_type» — después de haber reservado la ruta—.
//
// Reportado con un `person_0.glb` de 2,6 MB hecho a mano. Por eso el tipo se decide por la
// EXTENSION, y por eso hay pruebas: es la clase de detalle que se vuelve a «simplificar»
// leyendo `file.type` porque parece lo natural.
// ═══════════════════════════════════════════════════════════════════════════════

describe('tipoDeModelo', () => {
  /** Un `File` de mentira: solo hacen falta el nombre y el tipo. */
  const archivo = (name: string, type = '') => ({ name, type }) as File;

  it('un .glb sin tipo del sistema se reconoce', () => {
    //  EL caso reportado.
    expect(tipoDeModelo(archivo('person_0.glb'))).toBe('model/gltf-binary');
  });

  it('un .glb que el sistema declara como binario tambien', () => {
    //  Algunos sistemas ponen `octet-stream`, que no dice nada. Manda la extensión.
    expect(tipoDeModelo(archivo('person_0.glb', 'application/octet-stream'))).toBe(
      'model/gltf-binary',
    );
  });

  it('un .gltf es el de texto, no el binario', () => {
    //  Confundirlos hace que el bucket acepte el archivo y el cargador no lo entienda.
    expect(tipoDeModelo(archivo('escena.gltf'))).toBe('model/gltf+json');
  });

  it('da igual como este escrita la extension', () => {
    expect(tipoDeModelo(archivo('PERSON.GLB'))).toBe('model/gltf-binary');
  });

  it('se respeta el tipo del sistema cuando ya es uno de los nuestros', () => {
    expect(tipoDeModelo(archivo('x.bin', 'model/gltf-binary'))).toBe('model/gltf-binary');
  });

  it('lo que no es glTF devuelve null, y la pantalla lo dice antes de subir', () => {
    expect(tipoDeModelo(archivo('modelo.obj'))).toBeNull();
    expect(tipoDeModelo(archivo('modelo.fbx'))).toBeNull();
    expect(tipoDeModelo(archivo('foto.png', 'image/png'))).toBeNull();
    //  Y un nombre que solo CONTIENE `.glb` sin terminar en él no cuela.
    expect(tipoDeModelo(archivo('modelo.glb.zip'))).toBeNull();
  });
});

describe('las categorias', () => {
  it('todas tienen nombre en pantalla', () => {
    //  Sin esto, una categoria nueva saldria como su codigo crudo en el selector.
    for (const c of CATEGORIAS_DE_FIGURA) {
      expect(NOMBRE_DE_CATEGORIA[c]).toBeTruthy();
    }
  });

  it('los altos tipicos son de categorias que existen, y `otro` no tiene', () => {
    for (const k of Object.keys(ALTO_TIPICO_M)) {
      expect(CATEGORIAS_DE_FIGURA).toContain(k);
    }
    expect(ALTO_TIPICO_M.otro).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DE DONDE SE BAJAN LOS BYTES DE UNA FIGURA
//
// Es la unica pieza que decide si un modelo se dibuja, y cuando falla el sintoma es «la
// figura esta en el selector y en el plano no se ve», que se lee como un archivo roto y no
// como una regla mal escrita.
//
// Hay dos origenes y solo uno por figura: el bucket —con una URL firmada de una hora— o el
// propio proyecto —con una clave y sin nada que firmar—. La regla vive en un solo sitio
// porque la usan tres consumidores: el visor WebGL, el selector del panel y el medidor de la
// subida.
// ═══════════════════════════════════════════════════════════════════════════════

describe('urlDeFigura', () => {
  it('una figura DEL PROYECTO se sirve del propio origen', () => {
    expect(urlDeFigura(null, 'palet_euro')).toBe(`${RUTA_FIGURAS_DEL_PROYECTO}/palet_euro.glb`);
  });

  it('una figura SUBIDA se sirve por su URL firmada', () => {
    const firmada = 'https://x.supabase.co/storage/v1/object/sign/spatial-assets/a/b.glb?token=k';
    expect(urlDeFigura(firmada, null)).toBe(firmada);
  });

  it('sin ninguno de los dos no hay de donde bajarla, y se dice con null', () => {
    //  `null` no es un detalle: la ficha lo usa para deshabilitar «poner en el plano» y
    //  avisar de que su archivo no está. Devolver una cadena vacía la dejaría colocable y el
    //  fallo saldría al dibujar.
    expect(urlDeFigura(null, null)).toBeNull();
    expect(urlDeFigura(undefined, undefined)).toBeNull();
  });

  it('con los dos MANDA la del proyecto', () => {
    /*
      El CHECK de 0098 impide esa fila en la base, así que esto solo puede llegar de una
      respuesta que no viene de nuestra API. Se elige la local a propósito: no caduca y no
      depende de que el bucket esté en pie, mientras una firma puede estar vencida.
    */
    expect(urlDeFigura('https://x/firmada.glb', 'carretilla_contrapesada')).toBe(
      `${RUTA_FIGURAS_DEL_PROYECTO}/carretilla_contrapesada.glb`,
    );
  });

  it('la ruta es RELATIVA al origen, no absoluta a un host', () => {
    //  Tiene que servirla la misma aplicación: con un host escrito a mano, la vista dejaría
    //  de funcionar en cuanto cambiara el dominio —y en desarrollo apuntaría a producción—.
    const url = urlDeFigura(null, 'pilar_acero')!;
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  it('las cinco claves del proyecto dan cinco rutas distintas', () => {
    //  Suena obvio y es la comprobación de que la clave entra en la ruta: una plantilla mal
    //  escrita daría la misma URL para todas y el plano se llenaría de palets.
    const claves = [
      'palet_euro',
      'pilar_acero',
      'tope_proteccion_rack',
      'cajon_demarcado',
      'carretilla_contrapesada',
    ];
    const rutas = claves.map((k) => urlDeFigura(null, k));
    expect(new Set(rutas).size).toBe(claves.length);
    for (const r of rutas) expect(r).toMatch(/\.glb$/);
  });
});
