package com.olo.edges21.inference

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer

/**
 * Envoltorio de ONNX Runtime para el modelo exportado en Fase 0
 * (`Detector de alturas v5`, RF-DETR Nano, 113 MB FP32).
 *
 * Deliberadamente usa SOLO `CPUExecutionProvider` (el default de
 * onnxruntime-android si no se pide otro explicitamente). Esto no es
 * pereza: es la conclusion MEDIDA de la Fase 0 (ADR-015, Seccion 6bis):
 *
 *   - NNAPI falla con `ANEURALNETWORKS_BAD_DATA` en este grafo (sospecha:
 *     la atencion deformable multi-escala de RF-DETR, poco comun fuera de
 *     arquitecturas tipo DETR).
 *   - XNNPACK CORRE pero es MAS LENTO que CPU simple en este modelo
 *     (1,27 FPS vs 3,33 FPS medidos en el propio S21).
 *
 * Si en el futuro se prueba una build de onnxruntime-android mas nueva, vale
 * la pena remedir antes de asumir que sigue igual -- pero no activarlos "por
 * las dudas": ya se gasto el tiempo de medirlo una vez con resultado negativo.
 */
class RfDetrEngine(context: Context, assetName: String = "rfdetr-nano.onnx") : AutoCloseable {

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val inputName: String

    init {
        val modelBytes = context.assets.open(assetName).use { it.readBytes() }
        val options = OrtSession.SessionOptions()
        // A proposito SIN addNnapi() / addXnnpack() -- ver comentario de clase.
        session = env.createSession(modelBytes, options)
        inputName = session.inputNames.iterator().next()
    }

    /**
     * Corre una inferencia sobre un tensor NCHW (1,3,384,384) ya preprocesado
     * (ver [RfDetrPreprocessor]).
     *
     * @return Par (dets, logits) SIN la dimension de batch: `dets[q] = [cx,cy,w,h]`,
     *         `logits[q] = [logit_clase_0, ..., logit_clase_4]`. Nombres de salida
     *         "dets" y "labels" tal como los referencia medir_s21.py
     *         (`por_nombre["dets"]`, `por_nombre["labels"]`) -- son los nombres
     *         reales del grafo exportado, no un alias nuestro.
     */
    fun run(inputTensor: FloatBuffer): Pair<Array<FloatArray>, Array<FloatArray>> {
        val shape = longArrayOf(1, 3, RfDetrPreprocessor.RESOLUTION.toLong(), RfDetrPreprocessor.RESOLUTION.toLong())
        OnnxTensor.createTensor(env, inputTensor, shape).use { tensor ->
            session.run(mapOf(inputName to tensor)).use { result ->
                @Suppress("UNCHECKED_CAST")
                val detsBatched = (result.get("dets").get().value) as Array<Array<FloatArray>>
                @Suppress("UNCHECKED_CAST")
                val logitsBatched = (result.get("labels").get().value) as Array<Array<FloatArray>>
                return Pair(detsBatched[0], logitsBatched[0])
            }
        }
    }

    override fun close() {
        session.close()
    }
}
