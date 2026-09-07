package com.olo.edges21.camera

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import android.hardware.camera2.CaptureRequest

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
 * ── POR QUE UN "GRAB PERIODICO" DE `PreviewView.bitmap`, Y NO
 * `ImageAnalysis` ────────────────────────────────────────────────────────
 *
 * `ImageAnalysis` de CameraX (1.6.2, la version que usa este proyecto) NO
 * soporta pedir directamente el formato `RGBA_8888` -- solo entrega
 * `YUV_420_888` (por omision) o `NV21` (desde 1.5.0-alpha05). Convertir YUV
 * a RGB a mano es exactamente el trabajo que `RfDetrPreprocessor` YA evita
 * pidiendole `RGBA_8888` al MSDK (ver esa clase). En vez de escribir un
 * segundo conversor YUV->RGB solo para este camino de prueba, se aprovecha
 * que `PreviewView` ya renderiza el feed en pantalla y expone su ultimo
 * fotograma pintado como `Bitmap` a traves de `previewView.bitmap` -- un
 * `Handler` periodico lo toma al ritmo que el modelo aguanta (ver
 * `INTERVALO_MS`) y lo entrega tal cual a `onFrame`, que en MainActivity es
 * `frameProcessor.offerFrame(...)`, la MISMA cola de un hueco que usa el
 * feed del MSDK.
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
    private val handler = Handler(Looper.getMainLooper())
    private var corriendo = false
    var calidadActual: CalidadCamara = CalidadCamara.DEFAULT
        private set

    private val grabRunnable = object : Runnable {
        override fun run() {
            if (!corriendo) return
            previewView.bitmap?.let(onFrame)
            handler.postDelayed(this, INTERVALO_MS)
        }
    }

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
                handler.post(grabRunnable)
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
        val builder = Preview.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            calidad.resolucion,
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                        ),
                    )
                    .build(),
            )
        // FPS: no existe un `Preview.Builder().setTargetFrameRate()` en la API
        // publica de CameraX -- el camino soportado es Camera2Interop
        // directo sobre `CONTROL_AE_TARGET_FPS_RANGE` (ver la nota de clase:
        // valores reales medidos en este dispositivo). Un rango fijo
        // (min=max) en vez de uno automatico para que "elegir 15 fps" de
        // verdad fuerce 15 y no deje que el HAL suba a 30 si hay luz de sobra.
        Camera2Interop.Extender(builder).setCaptureRequestOption(
            CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
            Range(calidad.fps, calidad.fps),
        )
        val preview = builder.build().also { it.setSurfaceProvider(previewView.surfaceProvider) }

        provider.unbindAll()
        camera = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview)
    }

    fun stop() {
        corriendo = false
        handler.removeCallbacks(grabRunnable)
        cameraProvider?.unbindAll()
        cameraProvider = null
        camera = null
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
