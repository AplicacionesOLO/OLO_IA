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
  avisoDeEscala,
  escalaSugerida,
  tipoDeModelo,
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
