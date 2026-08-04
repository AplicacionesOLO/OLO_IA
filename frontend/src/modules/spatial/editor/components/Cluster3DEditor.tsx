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
 *
 * ── SE EDITA EN 3D, Y NO POR CAPRICHO ──────────────────────────────────────
 *
 * Mover un rack aqui es lo que permite ajustar una hilera MIRANDOLA: en planta dos
 * racks a distinta altura se dibujan igual, y el pasillo que queda entre dos hileras
 * solo se juzga viendolo. Lo que se arrastra es el suelo —`sueloEn` es la inversa
 * exacta de la proyeccion en z = 0— asi que el movimiento no es ambiguo.
 *
 * El historial y el ajuste a rejilla son los MISMOS que en 2D: un rack movido en 3D
 * se deshace con el mismo Ctrl+Z, y cae en la misma casilla. Dos historiales o dos
 * rejillas serian dos editores con la misma cara.
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
  const isEditing = useEditorStore((s) => s.isEditing);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridMeters = useEditorStore((s) => s.gridMeters);
  const updateRacks = useEditorStore((s) => s.updateRacks);
  const recordAction = useEditorStore((s) => s.recordAction);

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
      editable={isEditing}
      snapToGrid={snapToGrid}
      gridMeters={gridMeters}
      onMoverRacks={(cambios) =>
        updateRacks(cambios.map((c) => ({ layoutId: c.layoutId, updates: { x: c.x, y: c.y } })))
      }
      onMovimientoHecho={(movimientos) => {
        // Una entrada u otra segun cuantos: `move-rack` deshace un rack y
        // `move-many` un gesto entero. Son los mismos tipos que graba el lienzo 2D,
        // asi que el historial no distingue desde donde se movio.
        if (movimientos.length === 1) recordAction({ type: 'move-rack', ...movimientos[0]! });
        else recordAction({ type: 'move-many', movimientos });
      }}
      className={className}
    />
  );
}
