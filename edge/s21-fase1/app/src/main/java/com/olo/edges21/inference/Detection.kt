package com.olo.edges21.inference

import org.json.JSONObject
import java.time.Instant

/**
 * Una deteccion tal como la app de borde la produce -- MISMO contrato que
 * `DetectionIn` en `backend/src/olo/api/v1/schemas.py` y que los campos que
 * ya arma `backend/tools/inferir.py::_procesar_directo` para un directo hoy.
 *
 * Por que importa que sea IDENTICO: es el punto central de la Seccion 4 del
 * ADR-015 -- "el borde es un PRODUCTOR nuevo del mismo contrato, no un
 * sistema nuevo". El resto del sistema (reconciliacion contra el WMS,
 * `es_codigo_de_ubicacion`, `inventory.readings`, incidencias) no deberia
 * tener que cambiar una linea el dia que esto suba datos de verdad -- por eso
 * esta clase copia nombre de campo por nombre de campo, no "traduce" nada.
 *
 * Diferencias deliberadas con el pipeline de servidor (documentadas, no
 * accidentales):
 *  - `text_value` siempre `null` en Fase 1: el respaldo de OCR/vision sigue
 *    viviendo en la nube (Seccion 4 del ADR) -- esta app no lo implementa.
 *  - `crop_path` siempre `null`: no hay bucket de `perception-media` al que
 *    subir el recorte desde el borde todavia -- eso es trabajo de Fase 3
 *    (sincronizacion), no de esta Fase 1 (arquitectura de software).
 *  - `bbox_x/y/width/height` salen YA normalizados 0-1 directo del
 *    postproceso (ver RfDetrPostprocessor) -- no hace falta reescalar por el
 *    tamano del fotograma porque RF-DETR ya decodifica cx/cy/w/h como
 *    fracciones de la imagen de entrada, resolucion-independientes.
 */
data class Detection(
    val observedAt: Instant,
    val frameNumber: Int,
    val frameMs: Int?,
    val className: String,
    val confidence: Float,
    val bboxX: Float,
    val bboxY: Float,
    val bboxWidth: Float,
    val bboxHeight: Float,
    val textValue: String? = null,
    val cropPath: String? = null,
    val isManual: Boolean = false,
) {
    /**
     * JSON con los MISMOS nombres de campo que `DetectionIn` espera en
     * `POST /v1/perception/jobs/{id}/detections` (ver schemas.py lineas
     * ~1546-1582). Fase 1 no llama a este endpoint todavia -- ver
     * `sync/DetectionBatch.kt` y el README, seccion "Que falta para Fase 3"
     * -- pero dejar el mapeo ya armado es lo que hace que conectar el
     * endpoint real sea copiar esta funcion, no reinventar el contrato.
     */
    fun toJson(): JSONObject = JSONObject().apply {
        put("observed_at", observedAt.toString()) // ISO-8601, lo que datetime de Pydantic espera
        put("frame_number", frameNumber)
        if (frameMs != null) put("frame_ms", frameMs) else put("frame_ms", JSONObject.NULL)
        put("class_name", className)
        put("confidence", confidence.toDouble())
        put("bbox_x", bboxX.toDouble())
        put("bbox_y", bboxY.toDouble())
        put("bbox_width", bboxWidth.toDouble())
        put("bbox_height", bboxHeight.toDouble())
        put("bbox_format", "normalized")
        put("text_value", textValue ?: JSONObject.NULL)
        put("crop_path", cropPath ?: JSONObject.NULL)
        put("is_manual", isManual)
    }
}
