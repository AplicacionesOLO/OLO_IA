package com.olo.edges21.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import android.hardware.camera2.CaptureRequest
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Camara PROPIA del telefono, usada SOLO para simular la camara del dron
 * mientras no hay hardware DJI conectado (ver ADR-015, Fase 1). No sustituye
 * a `DjiSdkManager` -- es una fuente de fotogramas alterna, que alimenta el
 * MISMO `FrameProcessor` que el feed del MSDK (ver MainActivity.kt). El
 * modelo no va a detectar nada util apuntando a una habitacion cualquiera
 * -- fue entrenado para etiquetas de almacen -- pero SI sirve para probar
 * de punta a punta que la camara -> preprocesado -> ONNX -> postproceso ->
 * cajas en pantalla -> FPS funciona con un feed de video REAL, sin esperar
 * a tener el dron.
 *
 * ── POR QUE `ImageAnalysis` + YUV->RGB, Y NO `PreviewView.bitmap` ──────────
 *
 * La primera version de esta clase tomaba `previewView.bitmap` -- una
 * captura de lo que YA esta pintado en el widget de preview -- para
 * ahorrarse escribir un conversor YUV->RGB (`ImageAnalysis` de CameraX,
 * 1.6.2, no entrega `RGBA_8888` directo, solo `YUV_420_888`). El costo real,
 * medido en vivo: el bitmap resultante queda acotado al tamano en PANTALLA
 * del widget, no al de `calidad.resolucion` que de verdad se le pide a la
 * camara -- un recorte "de maxima calidad" salia borroso porque en realidad
 * era una foto de un rectangulo de UI, no del sensor.
 *
 * Aqui `ImageAnalysis` recibe los fotogramas crudos del sensor a la
 * resolucion configurada, y `yuvToBitmap` los convierte a `Bitmap` ARGB_8888
 * (via NV21 + `YuvImage`, que ya sabe codificar eso a JPEG sin escribir la
 * aritmetica YUV a mano) y corrige la rotacion del sensor. El throttling a
 * `INTERVALO_MS` sigue igual -- el modelo no aguanta mas que eso -- solo que
 * ahora se aplica dentro del propio `Analyzer` en vez de con un `Handler`
 * periodico.
 *
 * ── CALIDAD (resolucion/FPS) ─────────────────────────────────────────────
 *
 * Ambas se piden sobre el stream de PREVIEW de la camara, que en Android NO
 * es el mismo catalogo de tamanos que las fotos fijas -- un sensor de 108 MP
 * igual limita su stream de video/preview a una lista corta (medido en este
 * S21 real via `adb shell dumpsys media.camera`, camara 0: hasta 2400x1080
 * de resolucion, 15/20/24/30 fps de frame rate). [CalidadCamara.PRESETS] son
 * justo esos valores reales, no inventados -- pedir una resolucion o un fps
 * que la camara no anuncia hace que CameraX elija el mas parecido en
 * silencio, y eso no es lo mismo que "elegir mala calidad a proposito" para
 * comparar de verdad contra la maxima.
 */
data class CalidadCamara(val resolucion: Size, val fps: Int) {
    override fun toString() = "${resolucion.width}x${resolucion.height} · ${fps} fps"

    companion object {
        // De mayor a menor -- ver la nota de clase sobre de donde salen estos
        // numeros. `2400x1080` es el techo real de esta camara, no 1920x1080.
        val PRESETS = listOf(
            CalidadCamara(Size(2400, 1080), 30),
            CalidadCamara(Size(1920, 1080), 30),
            CalidadCamara(Size(1280, 720), 24),
            CalidadCamara(Size(640, 480), 15),
        )
        val DEFAULT = PRESETS[0]
    }
}

class PhoneCameraSource(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val onFrame: (Bitmap) -> Unit,
) {
    companion object {
        private const val TAG = "PhoneCameraSource"

        // ~3 fps: el mismo techo que la Fase 0 midio para el modelo en CPU en
        // este telefono (ADR-015, Seccion 6bis) -- pedir mas rapido solo
        // acumularia fotogramas que `FrameProcessor` va a descartar de todas
        // formas (cola de un solo hueco). ADREDE independiente de la calidad
        // de captura de la camara (ver `CalidadCamara`): subir el fps de la
        // CAMARA hace el preview mas fluido/nitido en pantalla, pero no
        // acelera al modelo -- son dos cosas distintas y esta es la que ya
        // esta calibrada contra una medicion real.
        private const val INTERVALO_MS = 300L
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageAnalysis: ImageAnalysis? = null
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var corriendo = false
    // Mismo throttle que antes (`INTERVALO_MS`), ahora aplicado dentro del
    // propio Analyzer -- CameraX entrega fotogramas mas rapido de lo que el
    // modelo aguanta, y CADA ImageProxy hay que cerrarlo se procese o no.
    private var ultimoFrameEntregadoMs = 0L
    var calidadActual: CalidadCamara = CalidadCamara.DEFAULT
        private set

    /** Pide permiso de camara ANTES de llamar a esto (ver MainActivity). */
    fun start(calidad: CalidadCamara = CalidadCamara.DEFAULT) {
        calidadActual = calidad
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                cameraProvider = provider
                bindPreview(provider, calidad)
                corriendo = true
                Log.i(TAG, "camara del telefono iniciada (modo simulacion, $calidad)")
            } catch (e: Exception) {
                Log.e(TAG, "no se pudo iniciar la camara del telefono", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /**
     * Cambia resolucion/FPS EN VIVO, sin tocar el job del backend ni el
     * `FrameProcessor` -- la calidad de captura es ortogonal a si hay una
     * sesion de Fase 3 corriendo. Vuelve a pedir el provider en vez de
     * reusar el guardado por si `start()` nunca llego a terminar de
     * inicializar (protege contra un doble tap muy rapido en el selector).
     */
    fun reconfigurar(calidad: CalidadCamara) {
        if (!corriendo) return
        calidadActual = calidad
        val provider = cameraProvider ?: return
        try {
            bindPreview(provider, calidad)
            Log.i(TAG, "calidad de camara cambiada a $calidad")
        } catch (e: Exception) {
            Log.e(TAG, "no se pudo cambiar la calidad de la camara", e)
        }
    }

    // `ExperimentalCamera2Interop` no lleva `@RequiresOptIn` en esta version
    // de CameraX (1.5.3) -- el compilador avisa que un `@OptIn` no hace nada
    // aqui, asi que no se pone: es solo documentacion, no un gate real.
    private fun bindPreview(provider: ProcessCameraProvider, calidad: CalidadCamara) {
        val resolutionSelector = ResolutionSelector.Builder()
            .setResolutionStrategy(
                ResolutionStrategy(
                    calidad.resolucion,
                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                ),
            )
            .build()

        val previewBuilder = Preview.Builder().setResolutionSelector(resolutionSelector)
        // FPS: no existe un `Preview.Builder().setTargetFrameRate()` en la API
        // publica de CameraX -- el camino soportado es Camera2Interop
        // directo sobre `CONTROL_AE_TARGET_FPS_RANGE` (ver la nota de clase:
        // valores reales medidos en este dispositivo). Un rango fijo
        // (min=max) en vez de uno automatico para que "elegir 15 fps" de
        // verdad fuerce 15 y no deje que el HAL suba a 30 si hay luz de sobra.
        Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(
            CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
            Range(calidad.fps, calidad.fps),
        )
        val preview = previewBuilder.build().also { it.setSurfaceProvider(previewView.surfaceProvider) }

        // MISMA resolucion que el preview -- ver la cabecera de clase: esto es
        // lo que reemplaza a `previewView.bitmap` como fuente del fotograma
        // que de verdad se sube (ademas de alimentar al modelo).
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(resolutionSelector)
            // Solo el mas reciente -- si el Analyzer (y el modelo detras)
            // vienen lentos, CameraX descarta los intermedios en vez de
            // acumularlos. Mismo espiritu que la cola de un solo hueco de
            // FrameProcessor.
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
        analysis.setAnalyzer(analysisExecutor) { imageProxy ->
            try {
                val ahora = SystemClock.elapsedRealtime()
                if (ahora - ultimoFrameEntregadoMs >= INTERVALO_MS) {
                    ultimoFrameEntregadoMs = ahora
                    yuvToBitmap(imageProxy)?.let(onFrame)
                }
            } finally {
                // OBLIGATORIO: CameraX no entrega el siguiente fotograma hasta
                // que este se cierra -- olvidarlo aqui congelaria el feed
                // despues del primer descarte por throttle.
                imageProxy.close()
            }
        }
        imageAnalysis = analysis

        provider.unbindAll()
        camera = provider.bindToLifecycle(
            lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis,
        )
    }

    /**
     * `YUV_420_888` (formato nativo de `ImageAnalysis`) -> NV21 -> `Bitmap`
     * ARGB_8888, corrigiendo la rotacion del sensor.
     *
     * Se pasa por NV21 + `YuvImage.compressToJpeg` en vez de escribir la
     * aritmetica YUV->RGB a mano: `YuvImage` ya sabe hacerlo, esta en el
     * framework de Android, y a la cadencia de `INTERVALO_MS` (~3 fps) el
     * costo extra de un JPEG intermedio no es el cuello de botella de este
     * pipeline (el propio modelo tarda mas por fotograma, ver ADR-015
     * Seccion 6bis).
     */
    private fun yuvToBitmap(image: ImageProxy): Bitmap? {
        return try {
            val nv21 = yuv420ToNv21(image)
            val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
            val out = ByteArrayOutputStream()
            yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 95, out)
            val bytes = out.toByteArray()
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null

            val rotation = image.imageInfo.rotationDegrees
            if (rotation == 0) return bitmap
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Exception) {
            Log.w(TAG, "no se pudo convertir el fotograma YUV a bitmap (${e.message})")
            null
        }
    }

    /**
     * Copia los tres planos de un `ImageProxy` YUV_420_888 a un arreglo NV21
     * (Y entero, luego V/U intercalados) -- respetando `rowStride`/
     * `pixelStride` de cada plano porque NO estan garantizados iguales al
     * ancho/2 en todos los fabricantes (algunos rellenan filas o intercalan
     * U/V con otro paso). Copiar por bloque contiguo sin esto produce
     * colores corridos o una imagen inclinada en equipos donde el supuesto
     * no se cumple.
     */
    private fun yuv420ToNv21(image: ImageProxy): ByteArray {
        val width = image.width
        val height = image.height
        val ySize = width * height
        val nv21 = ByteArray(ySize + (width * height / 2))

        val yPlane = image.planes[0]
        val yBuffer = yPlane.buffer
        val yRowStride = yPlane.rowStride
        if (yRowStride == width) {
            yBuffer.get(nv21, 0, ySize)
        } else {
            val row = ByteArray(yRowStride)
            var destPos = 0
            for (r in 0 until height) {
                yBuffer.position(r * yRowStride)
                yBuffer.get(row, 0, yRowStride)
                System.arraycopy(row, 0, nv21, destPos, width)
                destPos += width
            }
        }

        val uPlane = image.planes[1]
        val vPlane = image.planes[2]
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer
        val chromaWidth = width / 2
        val chromaHeight = height / 2
        var uvPos = ySize
        for (r in 0 until chromaHeight) {
            for (c in 0 until chromaWidth) {
                val vIndex = r * vPlane.rowStride + c * vPlane.pixelStride
                val uIndex = r * uPlane.rowStride + c * uPlane.pixelStride
                // NV21 intercala V primero, luego U -- al reves que el orden
                // "YUV" del nombre sugiere.
                nv21[uvPos++] = vBuffer.get(vIndex)
                nv21[uvPos++] = uBuffer.get(uIndex)
            }
        }
        return nv21
    }

    fun stop() {
        corriendo = false
        cameraProvider?.unbindAll()
        cameraProvider = null
        camera = null
        imageAnalysis = null
        // Un `newSingleThreadExecutor()` no es daemon: sin este shutdown, el
        // hilo del Analyzer queda vivo para siempre aunque nadie mas lo use
        // -- una fuga real, no solo teorica, en una app que arranca/detiene
        // la simulacion muchas veces en la misma sesion.
        analysisExecutor.shutdown()
    }

    // ── Zoom ─────────────────────────────────────────────────────────────────
    // CameraX ya trae control de zoom optico/digital combinado -- no hace falta
    // reimplementar nada, solo exponerlo. `zoomRatio` es 1.0 = sin zoom, hasta
    // `maxZoomRatio` (varia por telefono; el S21 base ronda 8-10x digital sobre
    // el angular). Null si la camara todavia no arranco.

    val zoomRatioActual: Float
        get() = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f

    val zoomRatioMaximo: Float
        get() = camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 1f

    fun setZoomRatio(ratio: Float) {
        val cam = camera ?: return
        val max = cam.cameraInfo.zoomState.value?.maxZoomRatio ?: 1f
        val min = cam.cameraInfo.zoomState.value?.minZoomRatio ?: 1f
        cam.cameraControl.setZoomRatio(ratio.coerceIn(min, max))
    }

    /** Para el gesto de pellizcar: multiplica el zoom actual por `factor`. */
    fun aplicarFactorDeZoom(factor: Float) {
        setZoomRatio(zoomRatioActual * factor)
    }
}
