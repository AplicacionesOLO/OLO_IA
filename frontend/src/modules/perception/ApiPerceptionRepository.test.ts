/**
 * Pruebas de los MAPEOS de percepción.
 *
 * ── POR QUÉ ESTOS Y NO OTROS ────────────────────────────────────────────────
 *
 * Un mapeo DTO → modelo es donde un cambio de contrato rompe sin lanzar. Si el
 * backend renombra `media_available`, el campo llega `undefined`, TypeScript no se
 * queja —el DTO es un tipo, no una validación en tiempo de ejecución— y la pantalla
 * dibuja «no disponible» para todo. No hay error, solo una afirmación falsa.
 *
 * Se prueban las cuatro distinciones que la pantalla usa para DECIR algo, porque cada
 * una tiene un caso en el que confundirse cambia lo que el operador cree:
 *
 *   · `stored` frente a `mediaAvailable`  — «guardado» frente a «se puede ver ahora»
 *   · `state` de una detección            — `unmatched` no es lo mismo que descartada
 *   · el historial de estados             — viene de la base, no se reconstruye
 *   · los pipelines de un modelo          — uno desconocido no sirve para todo
 */

import { describe, expect, it } from 'vitest';

import { aDeteccion, aModelo, aTrabajo, pipelinesDe } from './ApiPerceptionRepository';
import type { DetectionDto, JobDto, PublishedModelDto } from './dto';

const TRABAJO: JobDto = {
  id: 'job-1',
  warehouse_id: 'wh-1',
  name: 'Vuelo del martes',
  status: 'uploaded',
  pipeline: 'detection-ocr',
  model_version_id: null,
  model_label: null,
  confidence_threshold: 0.4,
  frame_sampling_rate: 2,
  save_detected_frames: true,
  notes: null,
  frames_processed: 0,
  frames_total: 60,
  detection_count: 0,
  elapsed_ms: 0,
  error_message: null,
  queued_at: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-08-04T10:00:00Z',
  media_id: 'media-1',
  media_kind: 'video',
  media_filename: 'vuelo.mp4',
  media_content_type: 'video/mp4',
  media_bytes: 1024,
  media_sha256: 'a'.repeat(64),
  media_width: 1080,
  media_height: 1920,
  media_duration_ms: 30000,
  media_total_frames: 900,
  media_source: 'uploaded-file',
  media_available: false,
  event_count: 3,
  events: [
    { id: 1, from_status: null, to_status: 'draft', occurred_at: '2026-08-04T10:00:00Z', reason: null },
    { id: 2, from_status: 'draft', to_status: 'uploading', occurred_at: '2026-08-04T10:00:01Z', reason: null },
    { id: 3, from_status: 'uploading', to_status: 'uploaded', occurred_at: '2026-08-04T10:00:02Z', reason: null },
  ],
  class_counts: [],
  worker_available: false,
};

const DETECCION: DetectionDto = {
  id: 'det-1',
  job_id: 'job-1',
  observed_at: '2026-08-04T09:40:00Z',
  ingested_at: '2026-08-04T10:05:00Z',
  frame_number: 120,
  frame_ms: 60000,
  frame_ref: null,
  class_name: 'rack-label',
  ai_class_id: null,
  class_color: null,
  confidence: 0.87,
  bbox_x: 0.1,
  bbox_y: 0.2,
  bbox_width: 0.3,
  bbox_height: 0.4,
  bbox_format: 'normalized',
  text_value: 'RCL104',
  state: 'unmatched',
  rack_node_id: null,
  review_status: 'pending',
  reviewed_at: null,
  review_comment: null,
  supersedes_id: null,
  is_manual: false,
};

describe('aTrabajo', () => {
  it('sin bytes guardados y sin url local, el medio NO se puede ver', () => {
    const j = aTrabajo(TRABAJO, null);
    expect(j.media.stored).toBe(false);
    expect(j.media.url).toBeNull();
    expect(j.mediaAvailable).toBe(false);
  });

  it('con url local se PUEDE ver, y sigue sin estar guardado', () => {
    // Es la situación normal hoy: el archivo se eligió en esta pestaña. Las dos
    // afirmaciones son ciertas a la vez y la pantalla necesita distinguirlas: se
    // reproduce, pero nadie más lo ve y no sobrevive a recargar.
    const j = aTrabajo(TRABAJO, 'blob:http://localhost/abc');
    expect(j.mediaAvailable).toBe(true);
    expect(j.media.stored).toBe(false);
  });

  it('el historial viene de los eventos de la base, en orden', () => {
    const j = aTrabajo(TRABAJO);
    expect(j.statusHistory.map((h) => h.to)).toEqual(['draft', 'uploading', 'uploaded']);
    // El nacimiento no tiene origen: se representa con `from === to` para que la línea
    // de progreso no necesite un caso especial para un `from` nulo.
    expect(j.statusHistory[0]!.from).toBe('draft');
    expect(j.statusHistory[1]!.from).toBe('draft');
  });

  it('sin modelo, `modelLabel` es null y no una cadena inventada', () => {
    // La pantalla escribe «sin modelo» a partir de esto. Un `''` se pintaría como un
    // hueco y parecería un fallo de carga.
    expect(aTrabajo(TRABAJO).modelLabel).toBeNull();
  });

  it('no se estima el tiempo restante cuando no hay nada midiendo', () => {
    // Sin worker no hay velocidad de proceso: un «faltan 3 minutos» calculado de la
    // nada es una promesa que nadie va a cumplir.
    expect(aTrabajo(TRABAJO).estimatedRemainingMs).toBeNull();
  });

  it('conserva las dimensiones REALES del medio, incluido el vídeo vertical', () => {
    // El repositorio de desarrollo escribía 1920x1080 para cualquier archivo, así que
    // un vídeo de móvil se registraba en horizontal.
    const j = aTrabajo(TRABAJO);
    expect([j.media.width, j.media.height]).toEqual([1080, 1920]);
  });

  it('un trabajo sin eventos ni recuentos no rompe el mapeo', () => {
    // El listado no pide el historial: `events` llega ausente. Si el mapeo lo diera
    // por hecho, la lista entera caería por un campo que el listado no necesita.
    const sinExtras = { ...TRABAJO } as Partial<JobDto>;
    delete sinExtras.events;
    delete sinExtras.class_counts;
    const j = aTrabajo(sinExtras as JobDto);
    expect(j.statusHistory).toEqual([]);
    expect(j.classCounts).toEqual([]);
  });
});

describe('aDeteccion', () => {
  it('conserva el estado del ciclo de vida y el texto leído', () => {
    const d = aDeteccion(DETECCION);
    expect(d.state).toBe('unmatched');
    expect(d.textValue).toBe('RCL104');
    expect(d.rackNodeId).toBeNull();
  });

  it('`unmatched` no es `discarded`: una no se ha comprobado, la otra se descartó', () => {
    const sinResolver = aDeteccion(DETECCION);
    const descartada = aDeteccion({ ...DETECCION, state: 'discarded', review_status: 'rejected' });
    expect(sinResolver.state).not.toBe(descartada.state);
    expect(sinResolver.reviewStatus).toBe('pending');
    expect(descartada.reviewStatus).toBe('rejected');
  });

  it('el formato del recuadro viaja con los números', () => {
    // Un recuadro sin su formato es un recuadro que alguien dibuja mal exactamente
    // una vez: 0,3 normalizado y 0,3 píxeles no son lo mismo.
    expect(aDeteccion(DETECCION).bbox.format).toBe('normalized');
    expect(aDeteccion({ ...DETECCION, bbox_format: 'pixels' }).bbox.format).toBe('pixels');
  });

  it('un formato desconocido cae en `normalized`, no en `pixels`', () => {
    // Es la opción prudente: tratar por error un valor normalizado como píxeles pinta
    // un recuadro de menos de un píxel, invisible; al contrario, uno gigante que tapa
    // la imagen y se nota al instante.
    expect(aDeteccion({ ...DETECCION, bbox_format: 'raro' }).bbox.format).toBe('normalized');
  });

  it('sin miniatura devuelve null, no una ruta que no se puede abrir', () => {
    expect(aDeteccion(DETECCION).thumbnailUrl).toBeNull();
  });

  it('una clase sin color recibe el gris de «sin color asignado»', () => {
    const d = aDeteccion(DETECCION);
    expect(d.classColor).toMatch(/^#[0-9a-f]{6}$/i);
    // Y con color, se respeta el que venga.
    expect(aDeteccion({ ...DETECCION, class_color: '#22d9f5' }).classColor).toBe('#22d9f5');
  });
});

describe('pipelinesDe', () => {
  it('un modelo de detección sirve para detectar y para detectar+leer', () => {
    expect(pipelinesDe('detect')).toEqual(['object-detection', 'detection-ocr']);
  });

  it('un modelo de OCR sirve para leer', () => {
    expect(pipelinesDe('ocr')).toEqual(['ocr', 'detection-ocr']);
  });

  it('una tarea DESCONOCIDA no es compatible con nada', () => {
    // Es la afirmación que importa: suponer que sirve para todo pondría en el
    // desplegable un modelo que va a fallar al ejecutarse, y el operador lo
    // descubriría después de lanzar el análisis.
    expect(pipelinesDe('pose-estimation-3d')).toEqual([]);
    expect(pipelinesDe('')).toEqual([]);
  });

  it('no distingue mayúsculas: el vocabulario del catálogo no está normalizado', () => {
    expect(pipelinesDe('DETECT')).toEqual(pipelinesDe('detect'));
  });
});

describe('aModelo', () => {
  const MODELO: PublishedModelDto = {
    model_version_id: 'mv-1',
    model_id: 'm-1',
    version: 3,
    origin: 'trained',
    published_at: '2026-08-01T00:00:00Z',
    name: 'Etiquetas de rack',
    slug: 'rack-labels',
    task: 'ocr',
    input_type: 'image',
    architecture_code: 'yolov8n',
    architecture_name: 'YOLOv8 nano',
    framework_code: 'ultralytics',
    classes: [{ id: 'c1', name: 'label', index: 0, color: '#22d9f5' }],
  };

  it('lo ejecutable es la VERSION, y la etiqueta la lleva delante', () => {
    const m = aModelo(MODELO);
    expect(m.modelVersionId).toBe('mv-1');
    expect(m.version).toBe('v3');
  });

  it('sin arquitectura declarada lo dice, en lugar de dejar el hueco', () => {
    const m = aModelo({ ...MODELO, architecture_name: null, architecture_code: null });
    expect(m.architecture).toBe('sin arquitectura');
  });

  it('un modelo sin clases no rompe el desplegable', () => {
    const sinClases = { ...MODELO } as Partial<PublishedModelDto>;
    delete sinClases.classes;
    expect(aModelo(sinClases as PublishedModelDto).classes).toEqual([]);
  });
});


/*
  LA COPIA PARA VER.

  Un booleano que decide QUE ARCHIVO se le da al reproductor. Si llega mal, el sintoma es
  una pantalla en negro con el analisis hecho detras —el original es H.265 y Chrome no lo
  abre— o, al reves, un dataset entrenado con fotogramas de 720p sin que nadie lo note.
*/
describe('la copia para ver', () => {
  it('llega al medio como `hasPreview`', () => {
    expect(aTrabajo({ ...TRABAJO, media_has_preview: true }).media.hasPreview).toBe(true);
  });

  it('un backend que todavia no lo manda NO dice que hay copia', () => {
    //  El campo es opcional a proposito: el worker de una maquina sin ffmpeg no genera
    //  ninguna. `undefined` tiene que leerse como «no hay», nunca como «si».
    const { media_has_preview: _, ...sinCampo } = { ...TRABAJO, media_has_preview: true };
    expect(aTrabajo(sinCampo as JobDto).media.hasPreview).toBe(false);
  });
});
