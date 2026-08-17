/**
 * LAS FIGURAS 3D CONTRA LA API.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA SUBIDA VA EN TRES PASOS, Y EL DEL MEDIO NO PASA POR EL BACKEND
 *
 *   1. `prepare` reserva la ruta en el bucket y devuelve dónde subir
 *   2. el `.glb` va DIRECTO a Storage, con el token del propio usuario
 *   3. `POST /assets` registra la figura, y el servidor comprueba que el objeto está
 *
 * El binario no atraviesa el proceso web: 60 MB pasando por él solo para reenviarlos
 * gastarían memoria del servidor sin añadir nada. Mismo criterio que el vídeo de una
 * inspección.
 *
 * Y el orden importa: primero los bytes, después la fila. Al revés, una subida abandonada
 * dejaría una figura en el selector que no se puede descargar — y nadie sabría si el
 * problema es el modelo, la red o el permiso—.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL MODELO SE MIDE AQUI, Y POR ESO SE CARGA ANTES DE SUBIRLO
 *
 * Un `.glb` no declara su unidad. Se abre con `GLTFLoader`, se mide su caja envolvente y
 * las tres medidas viajan con el registro. Es el único momento en que el archivo ya está
 * descomprimido en memoria; en el servidor haría falta un intérprete de glTF que no hay.
 *
 * El cargador se importa en DIFERIDO dentro del método: quien solo lista el catálogo no
 * tiene por qué descargar el motor 3D.
 */

import type { ApiClient } from '../../../lib/apiClient';
import type { FiguraColocada, FiguraDelCatalogo, FiguraNueva, MedidasDelModelo } from '../figuras';
import { mapFiguraColocada, mapFiguraDelCatalogo } from './mappers';
import type { AssetInstanceDto, AssetModelDto } from './dto';

export class ApiFigurasRepository {
  constructor(private readonly api: ApiClient) {}

  async catalogo(signal?: AbortSignal): Promise<FiguraDelCatalogo[]> {
    const filas = await this.api.get<AssetModelDto[]>('/spatial/assets', undefined, signal);
    return (filas ?? []).map(mapFiguraDelCatalogo);
  }

  async colocadas(warehouseId: string, signal?: AbortSignal): Promise<FiguraColocada[]> {
    const filas = await this.api.get<AssetInstanceDto[]>(
      `/spatial/warehouses/${warehouseId}/assets`,
      undefined,
      signal,
    );
    return (filas ?? []).map(mapFiguraColocada);
  }

  /**
   * Sube y registra una figura. Los tres pasos, con la medición delante.
   *
   * Si medir falla, NO se aborta: las tres medidas son opcionales en el contrato y un
   * modelo que el navegador no sabe abrir puede seguir siendo válido para otra herramienta.
   * Lo que se pierde es la comprobación de escala, y eso se dice.
   */
  async subir(entrada: FiguraNueva): Promise<FiguraDelCatalogo> {
    const paso = entrada.onPaso ?? (() => {});

    paso('Midiendo el modelo…');
    const medidas = await medirGlb(entrada.file);

    paso('Reservando sitio…');
    const reserva = await this.api.post<{
      model_id: string;
      bucket: string;
      object_path: string;
      upload_url: string;
    }>('/spatial/assets/prepare', {
      original_filename: entrada.file.name,
      content_type: entrada.file.type || 'model/gltf-binary',
      bytes: entrada.file.size,
      for_platform: entrada.forPlatform ?? false,
    });

    paso(`Subiendo ${(entrada.file.size / 1e6).toFixed(1)} MB…`);
    await this.api.subirBinario(reserva.upload_url, entrada.file);

    paso('Registrando la figura…');
    const d = await this.api.post<AssetModelDto>('/spatial/assets', {
      model_id: reserva.model_id,
      original_filename: entrada.file.name,
      content_type: entrada.file.type || 'model/gltf-binary',
      name: entrada.name,
      kind: entrada.kind,
      license: entrada.license,
      attribution: entrada.attribution ?? null,
      source_url: entrada.sourceUrl ?? null,
      notes: entrada.notes ?? null,
      byte_count: entrada.file.size,
      //  `null` explícito y no omitido: el backend distingue «no se pudo medir» de «no
      //  mandado», y las dos cosas se tratan igual pero se leen distinto en la fila.
      size_x_m: medidas?.x ?? null,
      size_y_m: medidas?.y ?? null,
      size_z_m: medidas?.z ?? null,
      for_platform: entrada.forPlatform ?? false,
    });
    return mapFiguraDelCatalogo(d);
  }

  async colocar(
    warehouseId: string,
    datos: {
      modelId: string;
      xM: number;
      yM: number;
      zM?: number;
      rotationDeg?: number;
      scale?: number;
      label?: string | null;
    },
  ): Promise<FiguraColocada> {
    const d = await this.api.post<AssetInstanceDto>(
      `/spatial/warehouses/${warehouseId}/assets`,
      {
        model_id: datos.modelId,
        x_m: datos.xM,
        y_m: datos.yM,
        z_m: datos.zM ?? 0,
        rotation_deg: datos.rotationDeg ?? 0,
        scale: datos.scale ?? 1,
        label: datos.label ?? null,
      },
    );
    return mapFiguraColocada(d);
  }

  /** PARCIAL a propósito: solo viaja lo que se tocó. */
  async mover(
    instanceId: string,
    p: {
      xM?: number;
      yM?: number;
      zM?: number;
      rotationDeg?: number;
      scale?: number;
      label?: string | null;
    },
  ): Promise<FiguraColocada> {
    const cuerpo: Record<string, unknown> = {
      ...(p.xM !== undefined ? { x_m: p.xM } : {}),
      ...(p.yM !== undefined ? { y_m: p.yM } : {}),
      ...(p.zM !== undefined ? { z_m: p.zM } : {}),
      ...(p.rotationDeg !== undefined ? { rotation_deg: p.rotationDeg } : {}),
      ...(p.scale !== undefined ? { scale: p.scale } : {}),
      ...(p.label !== undefined ? { label: p.label } : {}),
    };
    const d = await this.api.patch<AssetInstanceDto>(
      `/spatial/assets/instances/${instanceId}`,
      cuerpo,
    );
    return mapFiguraColocada(d);
  }

  async quitar(instanceId: string): Promise<void> {
    await this.api.delete(`/spatial/assets/instances/${instanceId}`);
  }

  async retirarDelCatalogo(modelId: string): Promise<void> {
    await this.api.delete(`/spatial/assets/${modelId}`);
  }
}

/**
 * Mide la caja envolvente de un `.glb`. `null` si no se pudo abrir.
 *
 * ── POR QUE NO ES UN ERROR NO PODER MEDIR ─────────────────────────────────────
 *
 * Porque las tres medidas son opcionales, y un modelo que este cargador no abre puede ser
 * perfectamente válido — glTF admite extensiones, y un `.glb` con compresión Draco necesita
 * un decodificador aparte—. Bloquear la subida por no poder medir dejaría fuera modelos que
 * sí sirven; lo que se pierde es la comprobación de escala, y eso la pantalla lo dice.
 *
 * Con plazo, porque un cargador que no termina dejaría el botón girando para siempre. Es la
 * misma lección que el vídeo de 8K cuyo `onloadedmetadata` no llegaba nunca.
 */
export async function medirGlb(file: File): Promise<MedidasDelModelo | null> {
  try {
    //  En diferido: quien solo lista el catálogo no descarga el motor 3D.
    const [{ Box3, Vector3 }, { GLTFLoader }] = await Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ]);
    const buffer = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await Promise.race([
      new Promise<{ scene: object }>((resolve, reject) => {
        loader.parse(buffer, '', resolve, reject);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('el cargador no termino')), 20_000),
      ),
    ]);
    const caja = new Box3().setFromObject(gltf.scene as never);
    const tam = caja.getSize(new Vector3());
    if (!Number.isFinite(tam.x) || tam.x <= 0) return null;
    return { x: tam.x, y: tam.y, z: tam.z };
  } catch {
    return null;
  }
}
