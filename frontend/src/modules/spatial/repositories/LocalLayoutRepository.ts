/**
 * LAYOUT LOCAL — `localStorage`, una clave por almacen.
 *
 * Implementa `LayoutRepository` sobre el mismo formato y la misma clave que ya
 * usaba el editor (`olo.spatial.layout-draft.v1.{warehouseId}`), asi que los
 * borradores existentes siguen abriendose. La diferencia es que ahora hay UN sitio
 * que sabe leer y escribir el layout, en lugar de esa logica dentro del store del
 * editor.
 *
 * Por que importa la separacion: `getStatus()` puede responder «este almacen no
 * tiene plano» sin cargar una imagen en base64 de varios megas. La pantalla
 * necesita esa respuesta antes de decidir que dibuja, y el store del editor no la
 * podia dar sin montarse entero.
 *
 * ⚠ Limite conocido y expuesto, no oculto: `localStorage` ronda los 5 MB, asi que
 * un plano grande guarda la geometria y NO la imagen. `LayoutStatus.imageStored`
 * lo dice, y la UI lo muestra, porque «el plano no aparece» sin explicacion es
 * peor que «la imagen no se pudo guardar: 8 MB excede el limite del navegador».
 */

import type { LayoutDraft } from '../editor/types';
import type {
  LayoutRepository,
  LayoutStatus,
  LayoutStorageKind,
} from './LayoutRepository';

/** Misma clave que usaba el editor: los borradores existentes siguen validos. */
const KEY_PREFIX = 'olo.spatial.layout-draft.v1.';

const VACIO: LayoutStatus = {
  kind: 'local',
  exists: false,
  updatedAt: null,
  imageStored: false,
  storageError: null,
  positionedRackCount: 0,
  calibrated: false,
};

export class LocalLayoutRepository implements LayoutRepository {
  readonly kind: LayoutStorageKind = 'local';

  private key(warehouseId: string): string {
    return KEY_PREFIX + warehouseId;
  }

  getStatus(warehouseId: string): LayoutStatus {
    const draft = this.load(warehouseId);
    if (!draft) return VACIO;
    return {
      kind: 'local',
      exists: true,
      updatedAt: draft.updatedAt,
      imageStored: draft.planPersistence?.imageStored ?? false,
      storageError: draft.planPersistence?.storageError ?? null,
      positionedRackCount: draft.racks?.length ?? 0,
      // Sin calibracion, las medidas del plano no son metros: son pixeles. Un
      // plano sin calibrar se puede mirar, pero no medir.
      //
      // ⚠ Se mira `points`, NO `pixelsPerMeter`. El store arranca con 50 px/m
      // como valor de dibujo, asi que `pixelsPerMeter > 0` era cierto SIEMPRE y
      // el panel anunciaba «calibrado: si» en un plano recien cargado que nadie
      // habia medido. Un valor por defecto no es una medicion; `points` solo
      // existe cuando el operador ha marcado dos puntos y dicho cuanto miden.
      //
      // `measured` gana cuando existe: un layout publicado por otra persona trae
      // la escala medida y NO los puntos, asi que `points != null` diria «sin
      // calibrar» sobre un plano que si lo esta.
      calibrated: draft.calibration?.measured ?? draft.calibration?.points != null,
    };
  }

  load(warehouseId: string): LayoutDraft | null {
    if (!warehouseId) return null;
    try {
      const raw = localStorage.getItem(this.key(warehouseId));
      if (!raw) return null;
      const draft = JSON.parse(raw) as LayoutDraft;
      // Una version futura se ignora en lugar de intentar leerse: un layout mal
      // interpretado dibuja racks en sitios equivocados, y eso es peor que no
      // dibujar nada.
      if (draft.version !== 1) return null;
      return draft;
    } catch {
      // JSON corrupto o `localStorage` inaccesible (modo privado en algunos
      // navegadores). Se trata como «no hay layout», que es cierto.
      return null;
    }
  }

  save(warehouseId: string, draft: LayoutDraft): LayoutStatus {
    const conFecha: LayoutDraft = { ...draft, warehouseId, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(this.key(warehouseId), JSON.stringify(conFecha));
      return this.getStatus(warehouseId);
    } catch (err) {
      // Reintento SIN la imagen. Perder la imagen y conservar las posiciones de
      // los racks es mucho mejor que perder las dos, y es el caso frecuente:
      // la geometria son kilobytes y la imagen, megas.
      const sinImagen: LayoutDraft = {
        ...conFecha,
        plan: conFecha.plan ? { ...conFecha.plan, dataUrl: null } : null,
        planPersistence: {
          metadataStored: Boolean(conFecha.plan),
          imageStored: false,
          imageStorage: 'not-stored',
          storageError:
            err instanceof Error ? err.message : 'Cuota de almacenamiento excedida',
        },
      };
      try {
        localStorage.setItem(this.key(warehouseId), JSON.stringify(sinImagen));
      } catch {
        // Almacenamiento realmente lleno o bloqueado: no hay nada mas que hacer,
        // y devolver el estado real es mas util que lanzar.
        return {
          ...VACIO,
          storageError: 'El navegador no permite guardar el plano.',
        };
      }
      return this.getStatus(warehouseId);
    }
  }

  discard(warehouseId: string): void {
    try {
      localStorage.removeItem(this.key(warehouseId));
    } catch {
      // Nada que hacer: si no se puede borrar, tampoco se pudo guardar.
    }
  }

  export(warehouseId: string): string | null {
    const draft = this.load(warehouseId);
    if (!draft) return null;
    // La imagen NO se exporta: un JSON con base64 de varios megas no se pega en
    // ningun sitio. Se exporta la geometria, que es lo que cuesta rehacer.
    const { plan, ...resto } = draft;
    return JSON.stringify(
      { ...resto, plan: plan ? { ...plan, dataUrl: null } : null },
      null,
      2,
    );
  }

  import(warehouseId: string, json: string): boolean {
    try {
      const draft = JSON.parse(json) as LayoutDraft;
      if (draft.version !== 1 || !Array.isArray(draft.racks)) return false;
      this.save(warehouseId, draft);
      return true;
    } catch {
      return false;
    }
  }
}
