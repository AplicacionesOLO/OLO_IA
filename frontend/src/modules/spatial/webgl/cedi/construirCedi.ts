/**
 * CONSTRUIR EL CEDI — arma el gemelo completo en UN grupo raiz reflejado.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL ESPEJO
 *
 * El raiz tiene dos hijos: `mundo`, con `scale(-1, 1, 1)` (MIRROR_X), donde va toda la geometria
 * en coordenadas LOGICAS —un punto logico (xL, y, zL) cae en three en (−xL, y, zL), con la
 * entrada y la casetilla de despacho a la izquierda, como en el sitio real; los textos de cada
 * pieza van contra-reflejados (`scale.x = −1`)— y `etiquetas`, SIN reflejo, con los rotulos de
 * rack/columna en coordenadas de mundo (x logico negado), porque un sprite reflejado saldria al
 * reves (ver `etiquetas.ts`).
 *
 * Los racks del CATALOGO de OLO_IA NO entran aqui: vienen en el dominio y los pinta `Almacen3D`
 * fuera de este grupo. Por eso los racks propios del CEDI estan apagados cuando hay catalogo.
 *
 * Devuelve un objeto con el grupo, `actualizar(dt, camara)` para las animaciones y el LOD, un
 * `dispose()` que libera TODO (geometrias, materiales y texturas) y `setCutaway` para el modo
 * «sin techo».
 */

import * as THREE from 'three';

import { MIRROR_X } from './constantes';
import { construirPlano } from './plano';
import { disposeTexturas } from './texturas';
import type { ZonaCedi } from './comun';
import { construirSitio } from './sitio';
import { construirEdificio } from './edificio';
import { construirRacks } from './racks';
import { construirMezzanine } from './mezzanine';
import { construirOficinas } from './oficinas';
import { construirFrente } from './frente';
import { construirVecinos } from './vecinos';
import { construirActores } from './actores';
import { construirEtiquetas } from './etiquetas';

export interface CediOpciones {
  /**
   * Visibilidad inicial del acomodo de racks del CEDI (estructura doble fondo del «Mapa
   * mezzanine N2»). Se construye SIEMPRE; esto solo decide si arranca visible. Se enciende/apaga
   * con `setRacksVisible`.
   */
  conRacksPropios?: boolean;
  /**
   * Dibujar SOLO la estanteria (el acomodo del Excel), sin el resto del contexto del CEDI
   * —edificio, patio, mezzanine, oficinas, frente, vecinos—. Es lo que pide `/twin`: ver los
   * racks acomodados y nada mas.
   */
  soloRacks?: boolean;
  /** Visibilidad inicial de las etiquetas de rack/columna. Por defecto encendidas. */
  conEtiquetas?: boolean;
}

export interface Cedi {
  grupo: THREE.Group;
  actualizar: (dt: number, camara: THREE.Camera) => void;
  dispose: () => void;
  setCutaway: (on: boolean) => void;
  /** Mostrar u ocultar el acomodo de racks del CEDI sin reconstruir la escena. */
  setRacksVisible: (on: boolean) => void;
  /** Mostrar u ocultar las etiquetas de rack/columna. */
  setLabelsVisible: (on: boolean) => void;
}

export function construirCedi(opciones: CediOpciones = {}): Cedi {
  const plano = construirPlano();

  // El raiz NO se refleja; dentro va `mundo` con `scale(-1,1,1)` para la geometria en coordenadas
  // logicas, y las etiquetas van en el raiz (sin reflejo) para que el texto de los sprites no
  // salga invertido —ver `etiquetas.ts`—.
  const grupo = new THREE.Group();
  grupo.name = 'cedi:raiz';
  const mundo = new THREE.Group();
  mundo.name = 'cedi:mundo';
  mundo.scale.set(MIRROR_X, 1, 1);
  grupo.add(mundo);

  const zonas: ZonaCedi[] = [];
  let edificio: ReturnType<typeof construirEdificio> | null = null;

  // El resto del contexto del CEDI solo se arma si NO es modo «solo racks».
  if (!opciones.soloRacks) {
    edificio = construirEdificio(plano);
    zonas.push(construirSitio());
    zonas.push(edificio);
    zonas.push(construirMezzanine(plano));
    zonas.push(construirOficinas(plano));
    zonas.push(construirFrente(plano));
    zonas.push(construirVecinos());
    zonas.push(construirActores(plano));
  }

  // El acomodo de racks (estructura doble fondo del Excel) se construye SIEMPRE. Su visibilidad
  // arranca en `conRacksPropios` y se conmuta con `setRacksVisible`, sin reconstruir la escena.
  const racks = construirRacks(plano.racks);
  racks.grupo.visible = opciones.conRacksPropios ?? true;
  zonas.push(racks);

  for (const z of zonas) mundo.add(z.grupo);

  // Etiquetas de rack/columna: fuera del grupo espejo, en coordenadas de mundo.
  const etiquetas = construirEtiquetas(plano.racks);
  etiquetas.setVisible(opciones.conEtiquetas ?? true);
  grupo.add(etiquetas.grupo);

  const conActualizar = zonas.filter((z) => z.actualizar);

  return {
    grupo,
    actualizar: (dt, camara) => {
      for (const z of conActualizar) z.actualizar!(dt, camara);
      etiquetas.actualizar(camara);
    },
    dispose: () => {
      for (const z of zonas) z.dispose();
      etiquetas.dispose();
      disposeTexturas();
    },
    setCutaway: (on: boolean) => edificio?.setCutaway(on),
    setRacksVisible: (on: boolean) => {
      racks.grupo.visible = on;
    },
    setLabelsVisible: (on: boolean) => etiquetas.setVisible(on),
  };
}
