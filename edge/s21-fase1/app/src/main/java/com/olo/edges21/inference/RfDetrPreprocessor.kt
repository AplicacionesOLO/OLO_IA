package com.olo.edges21.inference

import android.graphics.Bitmap
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.floor

/**
 * Puerto Kotlin, campo a campo, de `resize_bilineal_torch()` +
 * `preprocesar()` en el script de referencia VERIFICADO de la Fase 0:
 *
 *   .../scratchpad/entregable_s21/medir_s21.py
 *
 * Esa version en numpy fue comprobada con diferencia MAXIMA 0.000000 contra
 * `torchvision.transforms.functional.resize(..., antialias=False)` sobre una
 * imagen real -- es la formula que el servidor usa en produccion. Este
 * archivo replica esa misma aritmetica (bilineal, `align_corners=False`, sin
 * prefiltro/promediado) instruccion por instruccion. NO usar
 * `Bitmap.createScaledBitmap` ni ningun resize "de libreria" aqui: ya se
 * confirmo en Fase 0 que un resize distinto (el de PIL, en ese caso) cambia
 * que detecciones cruzan el umbral -- diferencia media ~0,03 en [0,1], que
 * alcanza para perder o inventar una deteccion.
 *
 * Si algun dia hay que tocar esta clase, hay que volver a comparar contra
 * `medir_s21.py` primero, no "arreglar a ojo".
 */
object RfDetrPreprocessor {

    /** Resolucion nativa del modelo (`m.model.resolution` en el export) -- ver ADR-015. */
    const val RESOLUTION = 384

    // ImageNet estandar, mismo orden R,G,B que usa el servidor.
    private val MEANS = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val STDS = floatArrayOf(0.229f, 0.224f, 0.225f)

    /**
     * Convierte un [Bitmap] (cualquier tamano, formato ARGB_8888) en el
     * tensor NCHW (1,3,384,384) float32 normalizado que espera la sesion de
     * ONNX Runtime.
     *
     * `bitmap` debe estar en ARGB_8888 -- es la config que usamos para
     * envolver los fotogramas RGBA_8888 que entrega el MSDK (ver
     * DjiSdkManager.kt para el porque de ese formato).
     */
    fun preprocess(bitmap: Bitmap): FloatBuffer {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        val out = RESOLUTION
        val plane = out * out
        // Mismo `escala_y, escala_x = alto_in / salida, ancho_in / salida` que
        // en medir_s21.py -- NO al reves, y sin +1/-1 de margen.
        val scaleY = h.toFloat() / out
        val scaleX = w.toFloat() / out

        val tensor = FloatArray(3 * plane)

        for (oy in 0 until out) {
            // ys = clip((oy + 0.5) * escala_y - 0.5, 0, alto_in - 1)
            val ys = (((oy + 0.5f) * scaleY) - 0.5f).coerceIn(0f, (h - 1).toFloat())
            val y0 = floor(ys).toInt()
            val y1 = (y0 + 1).coerceAtMost(h - 1)
            val wy = ys - y0

            for (ox in 0 until out) {
                val xs = (((ox + 0.5f) * scaleX) - 0.5f).coerceIn(0f, (w - 1).toFloat())
                val x0 = floor(xs).toInt()
                val x1 = (x0 + 1).coerceAtMost(w - 1)
                val wx = xs - x0

                val rowY0 = y0 * w
                val rowY1 = y1 * w
                val p00 = pixels[rowY0 + x0]
                val p01 = pixels[rowY0 + x1]
                val p10 = pixels[rowY1 + x0]
                val p11 = pixels[rowY1 + x1]

                val outIdx = oy * out + ox
                for (c in 0 until 3) {
                    val v00 = channel01(p00, c)
                    val v01 = channel01(p01, c)
                    val v10 = channel01(p10, c)
                    val v11 = channel01(p11, c)
                    // top = fila_y0[x0]*(1-wx) + fila_y0[x1]*wx ; bot = idem con y1
                    val top = v00 * (1 - wx) + v01 * wx
                    val bot = v10 * (1 - wx) + v11 * wx
                    val value = top * (1 - wy) + bot * wy
                    // Normalizacion ImageNet, MISMO orden de canal que MEDIAS/DESVIOS.
                    tensor[c * plane + outIdx] = (value - MEANS[c]) / STDS[c]
                }
            }
        }

        val buffer = ByteBuffer.allocateDirect(tensor.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
        buffer.put(tensor)
        buffer.rewind()
        return buffer
    }

    /** Extrae el canal `c` (0=R,1=G,2=B) de un int ARGB de Bitmap.getPixels, en [0,1]. */
    private fun channel01(argbPixel: Int, c: Int): Float {
        val byteVal = when (c) {
            0 -> (argbPixel shr 16) and 0xFF // R
            1 -> (argbPixel shr 8) and 0xFF  // G
            else -> argbPixel and 0xFF        // B
        }
        return byteVal / 255f
    }
}
