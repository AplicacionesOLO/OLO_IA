/**
 * AGRUPAR RACKS: EL RACK DOBLE NO SE PARTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUE SE PRUEBA Y POR QUE
 *
 * Dos racks se ponen físicamente de espaldas para formar un rack doble, con los frentes
 * opuestos —`RCL21` y `RCL22`—. Mover uno sin el otro lo partiría por la mitad.
 *
 * La pieza que lo evita no está en el arrastre: está en la SELECCION. El lienzo ya mueve toda
 * la selección cuando se arrastra algo que está en ella, así que basta con que la selección
 * nunca contenga media pareja. Eso hace que funcione en las tres vistas, y también al
 * alinear, distribuir, pintar y borrar, sin tocar ninguna de esas acciones.
 *
 * Por eso lo que se prueba es la selección, no el movimiento: si la selección es correcta, lo
 * demás sale gratis. Y si alguien la «optimizara» para no expandir, la primera víctima sería
 * un rack doble partido, que en pantalla no se ve como un error — se ve como un almacén raro—.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from './store';
import { nuevoLayoutId } from './types';
import type { PositionedRack } from './types';

function rack(rackCode: string, x: number): PositionedRack {
  return {
    layoutId: nuevoLayoutId(rackCode),
    rackCode,
    x,
    y: 0,
    width: 1.1,
    length: 20,
    height: 8,
    rotation: 0,
    locked: false,
    linked: true,
  };
}

/** Deja el store con tres racks: dos que serán pareja y uno suelto. */
function preparar(): { a: PositionedRack; b: PositionedRack; suelto: PositionedRack } {
  const a = rack('RCL21', 0);
  const b = rack('RCL22', 1.2);
  const suelto = rack('RCL30', 40);
  useEditorStore.setState({
    racks: [a, b, suelto],
    selectedRackId: null,
    selectedRackIds: [],
  });
  return { a, b, suelto };
}

beforeEach(() => {
  useEditorStore.getState().resetEditor();
});

describe('agrupar', () => {
  it('hacen falta al menos DOS', () => {
    //  Un grupo de uno no es un grupo: dejaría una clave que no hace nada y que alguien
    //  tendría que limpiar después.
    const { a } = preparar();
    useEditorStore.getState().selectRack(a.layoutId);
    expect(useEditorStore.getState().agrupar()).toBeNull();
    expect(useEditorStore.getState().racks.every((r) => !r.grupoId)).toBe(true);
  });

  it('la clave sale de los codigos, asi que es estable y legible', () => {
    /*
      Estable: agrupar los mismos dos racks da la misma clave, en cualquier orden de
      selección. Legible: alguien que mire la base y vea `g-RCL21-RCL22` entiende por qué esos
      dos se movieron juntos, y un `uuid` no le diría nada.
    */
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([b.layoutId, a.layoutId]);
    expect(useEditorStore.getState().agrupar()).toBe('g-RCL21-RCL22');
  });

  it('la clave no se pasa de lo que la base admite', () => {
    //  `group_key` es `varchar(40)` en 0096. Con ocho racks agrupados el nombre se pasaría, y
    //  el insert fallaría al publicar — mucho después de agrupar, y sin relación aparente—.
    useEditorStore.setState({
      racks: Array.from({ length: 8 }, (_, i) => rack(`RCL${40 + i}`, i * 2)),
      selectedRackIds: [],
      selectedRackId: null,
    });
    const todos = useEditorStore.getState().racks.map((r) => r.layoutId);
    useEditorStore.getState().selectRacks(todos);
    const clave = useEditorStore.getState().agrupar()!;
    expect(clave.length).toBeLessThanOrEqual(40);
  });
});

describe('seleccionar un agrupado selecciona el grupo', () => {
  it('pinchar una mitad del rack doble entra la pareja entera', () => {
    //  ESTA es la prueba que impide partir el rack doble: el lienzo mueve toda la selección,
    //  así que con la pareja dentro, arrastrar una mitad mueve las dos.
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().selectRack(a.layoutId);
    const sel = useEditorStore.getState().selectedRackIds;
    expect(sel).toContain(a.layoutId);
    expect(sel).toContain(b.layoutId);
  });

  it('el rack tocado sigue siendo el PRINCIPAL', () => {
    //  El inspector lee el último de la lista. Si expandir cambiara cuál es, pinchar una
    //  mitad enseñaría los datos de la otra — y se editaría el rack equivocado—.
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().selectRack(b.layoutId);
    expect(useEditorStore.getState().selectedRackId).toBe(b.layoutId);
  });

  it('un rack suelto no arrastra a nadie', () => {
    const { a, b, suelto } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().selectRack(suelto.layoutId);
    expect(useEditorStore.getState().selectedRackIds).toEqual([suelto.layoutId]);
  });

  it('el MARCO de seleccion tambien expande', () => {
    //  Coger media pareja con un marco y moverla sería el mismo desastre por otra puerta.
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().selectRacks([a.layoutId]);
    expect(useEditorStore.getState().selectedRackIds).toHaveLength(2);
  });

  it('no se duplica nadie al expandir', () => {
    //  Seleccionar la pareja entera y expandir no puede meter a nadie dos veces: con
    //  duplicados, `removeSelected` intentaría borrar el mismo rack dos veces.
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    const sel = useEditorStore.getState().selectedRackIds;
    expect(new Set(sel).size).toBe(sel.length);
  });
});

describe('declarar la cara operativa', () => {
  /*
    La cara la declara quien modela porque no hay de dónde sacarla. Y «no declarada» es un
    estado con significado propio: el visor pinta los huecos por las DOS caras, que es lo que
    hacía antes de que el campo existiera.

    Por eso retirarla tiene que QUITAR la propiedad y no dejarla a `undefined`: el borrador se
    serializa a JSON, donde ausente y nulo se leen igual, pero en la base son distintas — y
    conviene que el JSON diga lo mismo que la fila—.
  */
  it('se declara sobre el rack que se toca y solo ese', () => {
    const { a, suelto } = preparar();
    useEditorStore.getState().declararFrente(a.layoutId, 1);
    const racks = useEditorStore.getState().racks;
    expect(racks.find((r) => r.layoutId === a.layoutId)?.frente).toBe(1);
    expect(racks.find((r) => r.layoutId === suelto.layoutId)?.frente).toBeUndefined();
  });

  it('se puede cambiar de una cara a la otra', () => {
    const { a } = preparar();
    useEditorStore.getState().declararFrente(a.layoutId, 1);
    useEditorStore.getState().declararFrente(a.layoutId, -1);
    expect(useEditorStore.getState().racks[0]?.frente).toBe(-1);
  });

  it('retirarla no deja rastro, ni una clave a undefined', () => {
    const { a } = preparar();
    useEditorStore.getState().declararFrente(a.layoutId, 1);
    useEditorStore.getState().declararFrente(a.layoutId, null);
    expect('frente' in useEditorStore.getState().racks[0]!).toBe(false);
  });

  it('la cara NO se contagia por el grupo', () => {
    //  Un rack doble son dos racks que se mueven juntos y miran a lados CONTRARIOS. Si
    //  declarar la cara de uno se la pusiera al otro, agrupar rompería justo lo que el rack
    //  doble tiene de característico.
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();
    useEditorStore.getState().declararFrente(a.layoutId, 1);
    const racks = useEditorStore.getState().racks;
    expect(racks.find((r) => r.layoutId === b.layoutId)?.frente).toBeUndefined();
  });
});

describe('desagrupar', () => {
  it('deja de moverlos juntos y no deja rastro', () => {
    const { a, b } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();

    useEditorStore.getState().desagrupar();
    const racks = useEditorStore.getState().racks;
    //  La propiedad se QUITA, no se deja a `undefined`: al serializar el borrador, ausente y
    //  nula se leen igual, pero en la base son distintas y conviene que el JSON diga lo mismo
    //  que la fila.
    expect(racks.every((r) => !('grupoId' in r))).toBe(true);

    useEditorStore.getState().selectRack(a.layoutId);
    expect(useEditorStore.getState().selectedRackIds).toEqual([a.layoutId]);
  });

  it('solo afecta a la seleccion', () => {
    const { a, b, suelto } = preparar();
    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().agrupar();
    //  Un segundo grupo con el suelto y uno de la pareja no tiene sentido fisico, pero sirve
    //  para comprobar que separar uno no separa el otro.
    useEditorStore.setState({
      racks: useEditorStore.getState().racks.map((r) =>
        r.layoutId === suelto.layoutId ? { ...r, grupoId: 'g-otro' } : r,
      ),
    });

    useEditorStore.getState().selectRacks([a.layoutId, b.layoutId]);
    useEditorStore.getState().desagrupar();
    const despues = useEditorStore.getState().racks;
    expect(despues.find((r) => r.layoutId === suelto.layoutId)?.grupoId).toBe('g-otro');
  });
});
