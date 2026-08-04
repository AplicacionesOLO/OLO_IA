/**
 * EL CLUSTER 3D, CONECTADO AL BORRADOR DEL EDITOR.
 *
 * `Cluster3DView` no lee ningun store —lo explica su cabecera— porque tiene dos
 * consumidores con dos fuentes distintas: aqui el borrador de este navegador, y en
 * el explorador el layout publicado. Este envoltorio es la mitad del editor.
 *
 * Que la seleccion sea la MISMA que la del lienzo 2D no es un detalle: se coloca un
 * rack en 2D, se pasa a 3D para comprobar que la hilera cuadra, y al volver el rack
 * sigue seleccionado y el inspector sigue mostrandolo. Con dos selecciones se
 * editaria uno mirando otro.
 */

import { Cluster3DView } from '../../cluster3d/index';
import type { FloorPlanCell } from '../../types/index';
import { useEditorStore } from '../store';

export function Cluster3DEditor({
  catalogo,
  className,
}: {
  catalogo: readonly FloorPlanCell[];
  className?: string;
}) {
  const racks = useEditorStore((s) => s.racks);
  const calibration = useEditorStore((s) => s.calibration);
  const reference = useEditorStore((s) => s.reference);
  const plan = useEditorStore((s) => s.plan);
  const seleccion = useEditorStore((s) => s.selectedRackIds);
  const selectRack = useEditorStore((s) => s.selectRack);

  return (
    <Cluster3DView
      racks={racks}
      ppm={calibration.pixelsPerMeter}
      origen={reference.origin}
      calibrado={calibration.measured ?? calibration.points != null}
      plan={plan}
      catalogo={catalogo}
      seleccion={seleccion}
      onSeleccionar={(r) => selectRack(r?.layoutId ?? null)}
      className={className}
    />
  );
}
