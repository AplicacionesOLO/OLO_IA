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
 * ── QUE SE PUEDE EDITAR AQUI, Y QUE NO ───────────────────────────────────────
 *
 * Las FIGURAS se arrastran: por el suelo, y en altura con Mayús. Los planos contra los que
 * se corta el rayo están decididos y probados en `arrastre.ts`.
 *
 * Los RACKS no. No es la misma decisión: un rack se coloca sobre el plano del almacén, con
 * su rejilla y su ajuste, y ahí el lienzo 2D es mejor herramienta — se ve la hilera entera
 * y las distancias se leen de un vistazo—. Para comprobar que una hilera cuadra está el
 * axonométrico. Esta vista aporta profundidad real, oclusión, volumen y las figuras.
 *
 * Los gestos de VISTA sí son los mismos que en las otras dos: la herramienta Mover, Mayús
 * y el botón central desplazan; los botones de encuadre funcionan.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../../design/utils/cn';
import { HuecoModal } from '../components/HuecoModal';
import { componerEscena } from '../cluster3d/escena';
import { mapOcupacionDeHuecos } from '../repositories/mappers';
import type { SlotLeido } from '../inspection';
import type { FloorPlanCell } from '../types/index';
import { useEditorStore } from '../editor/store';
import {
  useFigurasColocadas,
  useMoverFigura,
  useOcupacionPorHueco,
} from '../services/useSpatial';
import { Almacen3D } from './Almacen3D';

export function Almacen3DEditor({
  catalogo,
  slots,
  onAbrirHueco,
  warehouseId,
  onTocarFigura,
  posicionRecorrido,
  rumboRecorrido,
  figuraDelRecorrido,
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
  /** Donde va el recorrido que se esta reproduciendo. Lo calcula el panel. */
  posicionRecorrido?: { x: number; y: number } | null | undefined;
  rumboRecorrido?: number | null | undefined;
  figuraDelRecorrido?: { glbUrl: string; escala: number } | null | undefined;
  className?: string;
}) {
  const racks = useEditorStore((s) => s.racks);
  const calibration = useEditorStore((s) => s.calibration);
  const reference = useEditorStore((s) => s.reference);
  const selectRack = useEditorStore((s) => s.selectRack);
  //  La herramienta MOVER y las ordenes de encuadre son las MISMAS que en las otras dos
  //  vistas: un solo concepto de «mover la vista» y unos botones que funcionan en las tres.
  const mode = useEditorStore((s) => s.mode);
  const orden = useEditorStore((s) => s.orden3d);
  const figuraObjetivo = useEditorStore((s) => s.figuraObjetivo);
  //  A dónde lleva «ir a la selección». Es la misma marca que usan el lienzo 2D y el
  //  axonométrico, así que señalar un rack en cualquiera de las tres y pulsar el botón en
  //  3D+ lleva al mismo sitio.
  const seleccion = useEditorStore((s) => s.selectedRackIds);

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

  /*
    ── LA OCUPACION DEL WMS ──────────────────────────────────────────────────────

    Una peticion de unos 122 KB que pinta el almacen entero: sin ella el visor solo coloreaba
    los cinco huecos inspeccionados de 29.312, o sea era un modelo del espacio y no del stock.

    Va aqui y no dentro de `Almacen3D` porque la vista no debe pedir nada: tendra dos
    consumidores —este editor y el explorador— y cada uno decide de donde saca los datos. Es
    la misma razon por la que las figuras se piden aqui.
  */
  const ocupacion = useOcupacionPorHueco(warehouseId ?? null);
  //  MEMOIZADO: la escena de `Almacen3D` se reconstruye cuando esta prop cambia de identidad,
  //  y un objeto nuevo en cada render la reconstruiria sesenta veces por segundo — 40.000
  //  piezas de estanteria cada vez—.
  const ocupacionMapeada = useMemo(
    () => (ocupacion.data ? mapOcupacionDeHuecos(ocupacion.data) : null),
    [ocupacion.data],
  );

  /*
    ── EL HUECO ABIERTO ──────────────────────────────────────────────────────────

    Lo que el dron vio contra lo que dice el WMS, con las fotos. Estaba solo en el
    axonométrico: en 3D+ pinchar un hueco lo dejaba elegido como parada y no enseñaba nada,
    así que la vista donde mejor se ve el almacén era la única desde la que no se podía mirar
    una discrepancia. Había que cambiar de vista, buscar el mismo hueco y pincharlo otra vez.

    Vive AQUI y no en el store del editor por lo mismo que en `Cluster3DEditor`: no es parte
    del borrador —no se publica, no se deshace— y meterlo allí lo haría sobrevivir a un
    Ctrl+Z.

    Y NO sustituye a `onAbrirHueco`: el mismo clic sigue dejando el hueco elegido para
    añadirlo como parada. Son dos cosas que no se estorban —una abre una ventana, la otra
    prepara el panel de recorridos— y quitar la segunda para meter la primera habría
    arreglado esto rompiendo el puente entre el modelado y la simulación.
  */
  const [hueco, setHueco] = useState<SlotLeido | null>(null);
  const navegar = useNavigate();

  return (
    /*  El envoltorio existe para el modal: se pone SOBRE el lienzo, y para eso su padre
        tiene que estar posicionado. Sin él, la ventana se iría al principio de la página.
        Es el mismo montaje que el axonométrico. */
    <div className={cn('relative flex min-h-0', className)}>
    <Almacen3D
      escena={escena}
      slots={slots}
      figuras={figuras.data ?? []}
      onTocarFigura={onTocarFigura}
      modoPan={mode === 'pan'}
      orden={orden}
      figuraObjetivo={figuraObjetivo}
      seleccion={seleccion}
      ocupacion={ocupacionMapeada}
      posicionRecorrido={posicionRecorrido}
      rumboRecorrido={rumboRecorrido}
      figuraDelRecorrido={figuraDelRecorrido}
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
      onAbrirHueco={(s) => {
        setHueco(s);
        onAbrirHueco?.(s);
      }}
      className="min-h-0 flex-1"
    />

      {/*  Al cerrar, la camara sigue donde estaba: ese es todo el motivo de que sea un modal
           y no una navegacion. Acercarse a un hueco en 3D+ cuesta varios gestos, y perderlos
           por mirar una foto haria que nadie mirase la foto. */}
      <HuecoModal
        slot={hueco}
        onCerrar={() => setHueco(null)}
        onAbrirEnSpatial={(id) =>
          //  `layer=inspection` —el nombre que la pantalla lee— para que el hueco llegue
          //  pintado por lo que se vio y no por el estado del catalogo: quien viene desde
          //  aqui viene mirando una discrepancia.
          navegar(`/spatial?view=rack&location=${encodeURIComponent(id)}&layer=inspection`)
        }
      />
    </div>
  );
}
