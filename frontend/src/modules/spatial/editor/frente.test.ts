/**
 * HACIA DONDE APUNTA LA CARA, EN FLECHAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTO SE PRUEBA
 *
 * Porque es la única parte de la cara que se puede EQUIVOCAR SIN QUE SE NOTE. Si las placas
 * de los huecos salieran del lado que no es, se ve al primer vistazo: están dentro de la
 * pared. Pero una flecha invertida en un botón se lee como buena, y el operador declara la
 * cara contraria a la que quería — dejando el almacén mal modelado con un dato que él cree
 * haber comprobado—.
 *
 * Y el fallo es fácil: la `y` del plano crece HACIA ABAJO, como en cualquier imagen. Quien
 * escriba esto pensando en los ejes de matemáticas saca todas las flechas verticales al
 * revés, y las pruebas de las otras vistas no lo verían porque allí no hay flechas.
 */

import { describe, expect, it } from 'vitest';

import { direccionDeCara } from './frente';

describe('direccionDeCara', () => {
  it('un rack sin girar da a derecha e izquierda', () => {
    expect(direccionDeCara(0, 1).flecha).toBe('→');
    expect(direccionDeCara(0, -1).flecha).toBe('←');
  });

  it('la Y del PLANO crece hacia abajo', () => {
    //  El fallo que esto atrapa: pensarlo en ejes de matemáticas saca esta flecha «hacia
    //  arriba» y el operador declara la cara contraria creyendo que la comprobó.
    expect(direccionDeCara(90, 1).flecha).toBe('↓');
    expect(direccionDeCara(90, -1).flecha).toBe('↑');
  });

  it('las dos caras son SIEMPRE opuestas', () => {
    for (let g = 0; g < 360; g += 7) {
      const a = direccionDeCara(g, 1);
      const b = direccionDeCara(g, -1);
      expect(a.dx).toBeCloseTo(-b.dx, 9);
      expect(a.dy).toBeCloseTo(-b.dy, 9);
      expect(a.flecha).not.toBe(b.flecha);
    }
  });

  it('EL RACK DOBLE: el gemelo a 180 apunta al contrario con el mismo valor', () => {
    //  Es la propiedad que justifica guardar la cara en el marco local del rack. Si no se
    //  cumpliera, quien modela tendría que acordarse de poner una mitad al revés.
    for (let g = 0; g < 360; g += 15) {
      const rack = direccionDeCara(g, 1);
      const gemelo = direccionDeCara((g + 180) % 360, 1);
      expect(rack.dx).toBeCloseTo(-gemelo.dx, 9);
      expect(rack.dy).toBeCloseTo(-gemelo.dy, 9);
    }
  });

  it('siempre sale una flecha, en todo el circulo y mas alla', () => {
    /*
      `-1 % 8` es `-1` en JavaScript, no `7`. Sin corregirlo, cualquier rack girado más de
      180° sacaría `undefined` como flecha — un botón vacío—.

      Y se prueba fuera de [0,360) a propósito: el campo de rotación del inspector acepta de
      −360 a 360, así que un rack a −90° llega hasta aquí tal cual.
    */
    for (let g = -720; g <= 720; g += 3) {
      for (const lado of [1, -1] as const) {
        const d = direccionDeCara(g, lado);
        expect(d.flecha).toBeTruthy();
        expect(d.nombre).toBeTruthy();
        expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 9);
      }
    }
  });

  it('girar el rack gira la flecha, y una vuelta entera la devuelve', () => {
    expect(direccionDeCara(360, 1).flecha).toBe(direccionDeCara(0, 1).flecha);
    expect(direccionDeCara(-90, 1).flecha).toBe(direccionDeCara(270, 1).flecha);
  });
});
