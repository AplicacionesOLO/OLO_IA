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
import { Almacen3D } from './Almacen3D';

export function Almacen3DEditor({
  catalogo,
  slots,
  onAbrirHueco,
  className,
}: {
  catalogo: readonly FloorPlanCell[];
  slots?: ReadonlyMap<string, readonly SlotLeido[]> | undefined;
  onAbrirHueco?: ((slot: SlotLeido) => void) | undefined;
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

  return (
    <Almacen3D
      escena={escena}
      slots={slots}
      //  La selección es la MISMA que la del lienzo 2D y la del axonométrico: se señala un
      //  rack aquí y el inspector de la derecha muestra ese rack.
      onSeleccionar={(r) => selectRack(r?.layoutId ?? null)}
      onAbrirHueco={onAbrirHueco}
      className={className}
    />
  );
}
