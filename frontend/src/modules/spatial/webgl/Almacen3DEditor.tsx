/**
 * LA VISTA WebGL, CONECTADA AL BORRADOR DEL EDITOR.
 *
 * Es el gemelo de `Cluster3DEditor`: lee los mismos valores del mismo store y compone la
 * escena con la misma función. La diferencia está una capa más abajo — cómo se dibuja—.
 *
 * ── POR QUE UN ENVOLTORIO Y NO EL STORE DENTRO DE `Almacen3D` ─────────────────
 *
 * Porque `Almacen3D` no debe saber que existe un editor: la vista tendrá dos consumidores,
 * este —el borrador de este navegador— y el explorador, que lee el layout PUBLICADO. Es la
 * misma razón por la que `Cluster3DView` tampoco lee ningún store.
 *
 * ── LO QUE AUN NO HACE, DICHO CLARO ──────────────────────────────────────────
 *
 * No se edita: no se arrastran racks ni se estiran. Se MIRA. Colocar en perspectiva pide
 * decidir sobre qué plano cae el cursor y eso no es una línea; el sitio para colocar sigue
 * siendo el plano 2D, y para comprobar una hilera está el axonométrico. Lo que esta vista
 * aporta hoy es profundidad real, oclusión y volumen — y es donde entrarán los modelos.
 */

import { useMemo } from 'react';

import { componerEscena } from '../cluster3d/escena';
import type { SlotLeido } from '../inspection';
import type { FloorPlanCell } from '../types/index';
import { useEditorStore } from '../editor/store';
import { useFigurasColocadas, useMoverFigura } from '../services/useSpatial';
import { Almacen3D } from './Almacen3D';

export function Almacen3DEditor({
  catalogo,
  slots,
  onAbrirHueco,
  warehouseId,
  onTocarFigura,
  className,
}: {
  catalogo: readonly FloorPlanCell[];
  slots?: ReadonlyMap<string, readonly SlotLeido[]> | undefined;
  onAbrirHueco?: ((slot: SlotLeido) => void) | undefined;
  /**
   * De qué almacén son las figuras. Se pide aparte y no se saca del store porque el store
   * es el BORRADOR de este navegador: las figuras están en la base y las ve todo el equipo.
   */
  warehouseId?: string | null | undefined;
  onTocarFigura?: ((instanceId: string) => void) | undefined;
  className?: string;
}) {
  const racks = useEditorStore((s) => s.racks);
  const calibration = useEditorStore((s) => s.calibration);
  const reference = useEditorStore((s) => s.reference);
  const selectRack = useEditorStore((s) => s.selectRack);

  //  La MISMA composición que las otras vistas. Si esto se calculara aparte, el mismo rack
  //  podría salir en dos sitios según la vista, que es el defecto que más cuesta ver.
  const escena = useMemo(
    () =>
      componerEscena(
        racks,
        calibration.pixelsPerMeter,
        reference.origin,
        catalogo,
        new Map(),
      ),
    [racks, calibration.pixelsPerMeter, reference.origin, catalogo],
  );

  //  Las figuras de la BASE, no del borrador: las ve todo el equipo y no se publican con el
  //  plano. Colocar una es un cambio inmediato, no un borrador que alguien guarda.
  const figuras = useFigurasColocadas(warehouseId ?? null);
  const mover = useMoverFigura(warehouseId ?? null);

  return (
    <Almacen3D
      escena={escena}
      slots={slots}
      figuras={figuras.data ?? []}
      onTocarFigura={onTocarFigura}
      /*
        Arrastrar SOLO si hay almacén: sin él no hay a qué plano guardar, y dejar mover algo
        que no se va a guardar es peor que no poder moverlo — la figura volvería a su sitio
        al recargar y nadie sabría por qué—.

        Se guarda al soltar, no en cada fotograma: un arrastre son cientos de posiciones
        intermedias y ninguna de ellas es una decisión.
      */
      onMoverFigura={
        warehouseId
          ? (instanceId, destino) => mover.mutate({ instanceId, ...destino })
          : undefined
      }
      //  La selección es la MISMA que la del lienzo 2D y la del axonométrico: se señala un
      //  rack aquí y el inspector de la derecha muestra ese rack.
      onSeleccionar={(r) => selectRack(r?.layoutId ?? null)}
      onAbrirHueco={onAbrirHueco}
      className={className}
    />
  );
}
