package com.olo.edges21.inference

import kotlin.math.exp
import kotlin.math.min

/**
 * Puerto Kotlin, campo a campo, de `decodificar()` en el script de referencia
 * VERIFICADO de la Fase 0 (`.../scratchpad/entregable_s21/medir_s21.py`), que
 * a su vez replica la formula exacta de `rfdetr.models.postprocess.PostProcess`
 * leida del codigo fuente (no adivinada):
 *
 *   1. sigmoid sobre los logits (salida "labels" del ONNX)
 *   2. APLANAR (consulta, clase) en un solo vector
 *   3. top-K GLOBAL sobre ese vector aplanado -- 300, o menos si hay menos
 *      elementos -- NUNCA top-1 por consulta. Esto es facil de romper: si
 *      alguien "simplifica" a top-1-por-consulta, clases distintas de la
 *      misma consulta que ambas superan el umbral se pierden.
 *   4. decodificar el indice de consulta/clase con division/modulo sobre el
 *      numero de clases
 *   5. cxcywh -> xyxy
 *
 * Diferencia deliberada con medir_s21.py: ese script escala x1/y1/x2/y2 por
 * `ancho_o`/`alto_o` para dar PIXELES de la imagen original (asi lo necesitaba
 * para comparar contra el servidor). Esta version NO escala -- se queda en
 * cx/cy/w/h tal como salen del modelo, que YA son fracciones [0,1] de la
 * imagen de entrada, resolucion-independientes. Es exactamente
 * `bbox_format: "normalized"` del contrato del backend
 * (`DetectionIn.bbox_x/y/width/height` en schemas.py) -- no hay que
 * desnormalizar para volver a normalizar despues.
 */
object RfDetrPostprocessor {

    private const val TOP_K = 300

    /** `{0: qr_ubicacion, 1: qr_pallet, 2: pallet, 3: hueco_vacio, 4: etiqueta_ilegible}` -- ADR-015. */
    val CLASSES = mapOf(
        0 to "qr_ubicacion",
        1 to "qr_pallet",
        2 to "pallet",
        3 to "hueco_vacio",
        4 to "etiqueta_ilegible",
    )

    /** Una deteccion cruda, con la caja YA normalizada [0,1] respecto de la imagen de entrada. */
    data class RawDetection(
        val classId: Int,
        val className: String,
        val confidence: Float,
        val x1: Float,
        val y1: Float,
        val x2: Float,
        val y2: Float,
    )

    /**
     * @param dets   salida "dets" del modelo: `[numQueries][4]` (cx,cy,w,h), YA sin la
     *               dimension de batch (que siempre es 1 aqui).
     * @param logits salida "labels" del modelo: `[numQueries][numClasses]`, YA sin batch.
     */
    fun decode(dets: Array<FloatArray>, logits: Array<FloatArray>, threshold: Float): List<RawDetection> {
        val numQueries = logits.size
        if (numQueries == 0) return emptyList()
        val numClasses = logits[0].size
        val flatSize = numQueries * numClasses

        // Paso 1+2: sigmoid y aplanar (consulta, clase) -> vector unico.
        val scores = FloatArray(flatSize)
        for (q in 0 until numQueries) {
            val row = logits[q]
            val base = q * numClasses
            for (c in 0 until numClasses) {
                scores[base + c] = sigmoid(row[c])
            }
        }

        // Paso 3: top-K GLOBAL, ordenado descendente por score.
        val k = min(TOP_K, flatSize)
        val indices = (0 until flatSize).sortedByDescending { scores[it] }

        val out = ArrayList<RawDetection>(k)
        for (i in 0 until k) {
            val idx = indices[i]
            val score = scores[idx]
            // Los indices vienen ordenados desc: en cuanto cae bajo el umbral,
            // todo lo que sigue tambien -- se puede cortar aqui.
            if (score < threshold) break

            // Paso 4: decodificar consulta/clase con division/modulo.
            val q = idx / numClasses
            val c = idx % numClasses

            val box = dets[q] // cx, cy, w, h -- fracciones [0,1] de la imagen de entrada
            val cx = box[0]; val cy = box[1]; val bw = box[2]; val bh = box[3]

            // Paso 5: cxcywh -> xyxy, con clip a [0,1] (no a ancho/alto de pixeles:
            // ver nota de clase sobre por que NO se desnormaliza aqui).
            val x1 = (cx - bw / 2f).coerceIn(0f, 1f)
            val y1 = (cy - bh / 2f).coerceIn(0f, 1f)
            val x2 = (cx + bw / 2f).coerceIn(0f, 1f)
            val y2 = (cy + bh / 2f).coerceIn(0f, 1f)

            out.add(
                RawDetection(
                    classId = c,
                    className = CLASSES[c] ?: "clase_$c",
                    confidence = score,
                    x1 = x1, y1 = y1, x2 = x2, y2 = y2,
                )
            )
        }
        return out
    }

    private fun sigmoid(x: Float): Float = (1.0 / (1.0 + exp(-x.toDouble()))).toFloat()
}
