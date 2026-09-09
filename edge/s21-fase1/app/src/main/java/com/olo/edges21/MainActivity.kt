package com.olo.edges21

import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.view.PreviewView
import com.olo.edges21.camera.CalidadCamara
import com.olo.edges21.camera.PhoneCameraSource
import com.olo.edges21.dji.DjiSdkManager
import com.olo.edges21.inference.Detection
import com.olo.edges21.inference.FrameProcessor
import com.olo.edges21.inference.RfDetrEngine
import com.olo.edges21.recording.LocalRecorder
import com.olo.edges21.sync.DetectionBatcher
import com.olo.edges21.sync.FleetHeartbeat
import com.olo.edges21.sync.OloApiClient
import com.olo.edges21.sync.PerceptionUploader
import com.olo.edges21.ui.HudGridView
import com.olo.edges21.ui.OverlayView
import dji.v5.manager.interfaces.ICameraStreamManager
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * Fase 1 del ADR-015: pantalla unica.
 *
 *   MSDK (CameraFrameListener.onFrame, RGBA_8888)          ─┐
 *   o PhoneCameraSource (camara del telefono, simulacion)  ─┴─> Bitmap
 *     -> FrameProcessor (cola de 1 hueco, descarta fotogramas viejos)
 *         -> RfDetrPreprocessor -> RfDetrEngine (ONNX Runtime, CPU) -> RfDetrPostprocessor
 *     -> onResult (hilo de fondo) -> runOnUiThread -> pinta ImageView/PreviewView + OverlayView + FPS
 *
 * Dos fuentes de fotogramas alimentan el MISMO pipeline: el feed real del
 * MSDK, y -- mientras no hay dron/RC conectado -- la camara propia del
 * telefono via el boton "Simular con camara del telefono" (ver
 * camera/PhoneCameraSource.kt). Sirve para probar de punta a punta que
 * camara -> inferencia -> pantalla funciona con video real, sin esperar al
 * hardware de DJI.
 *
 * No implementa: subida al backend (Fase 3), respaldo de OCR/vision en la
 * nube (Seccion 4 del ADR -- sigue viviendo ahi, no aqui), ni control de
 * vuelo. Es, a proposito, solo la pata de "recibir video + inferir + pintar".
 */
class MainActivity : AppCompatActivity(), DjiSdkManager.Listener {

    companion object {
        // Centro de Distribucion San Jose -- el mismo almacen que se usa en
        // toda la prueba de esta fase (ver el comentario de `oloApi` sobre
        // por que esto sigue siendo un literal y no una eleccion en la UI).
        private const val WAREHOUSE_ID = "cae0859d-7dd8-4cfb-ae9d-422f00b5dc1a"

        // Mismo ritmo que LocalRecorder.INTERVALO_MS -- ver adjuntarFotogramaSiToca.
        private const val INTERVALO_SUBIDA_FOTOGRAMA_NS = 2_000_000_000L
    }

    private var ultimoFotogramaSubidoNs = 0L

    private lateinit var videoFrameView: ImageView
    private lateinit var cameraPreview: PreviewView
    private lateinit var overlayView: OverlayView
    private lateinit var statusText: TextView
    private lateinit var fpsText: TextView
    private lateinit var syncStatusText: TextView
    private lateinit var simulateCameraButton: TextView
    private lateinit var hudGridView: HudGridView
    private lateinit var gridToggleButton: TextView
    private lateinit var zoomOutButton: TextView
    private lateinit var zoomInButton: TextView
    private lateinit var zoomLabelText: TextView
    private lateinit var qualityButton: TextView
    private lateinit var recDot: android.view.View
    private lateinit var zoomGestureDetector: ScaleGestureDetector

    private var engine: RfDetrEngine? = null
    private var frameProcessor: FrameProcessor? = null

    // Fuente de fotogramas ALTERNA al feed del MSDK -- ver camera/PhoneCameraSource.kt.
    // Solo una de las dos fuentes esta activa a la vez; las dos llaman al mismo
    // `frameProcessor?.offerFrame(...)`, asi que el resto del pipeline no sabe
    // ni le importa de donde vino el fotograma.
    private var phoneCameraSource: PhoneCameraSource? = null
    private var simulandoConCamaraDelTelefono = false

    // Se recuerda entre sesiones de simulacion (apagar y prender de nuevo NO
    // vuelve a la maxima calidad) -- ver CalidadCamara en PhoneCameraSource.kt
    // para de donde salen estos 4 valores reales.
    private var calidadSeleccionada: CalidadCamara = CalidadCamara.DEFAULT

    // Ver recording/LocalRecorder.kt: guarda evidencia de la sesion en el
    // propio telefono (Download/olo_edge_sesiones/...) -- para poder probar
    // en el almacen SIN el telefono conectado a esta PC y tener algo que
    // revisar despues, ya que Fase 1 todavia no sube nada a un backend real.
    private val localRecorder by lazy { LocalRecorder(applicationContext.getExternalFilesDir(null)!!) }

    // Fase 3 del ADR-015: sube cada lote a un job en vivo real
    // (`POST /v1/perception/live` con origin=edge_device, ver PerceptionUploader.kt
    // y la migracion 0109) para que aparezca en la app web, no solo en el telefono.
    //
    // El almacen queda fijo en "Centro de Distribucion San Jose" -- el mismo que se
    // usa en toda la prueba de esta fase. Elegirlo desde la app (en vez de un
    // literal) es trabajo real de UI que no vale la pena antes de saber si esta
    // ruta de sincronizacion funciona con hardware real.
    // Si `DEVICE_REFRESH_TOKEN` viene configurado (provisionado desde Flota,
    // ver 0111), el cliente arranca con identidad PROPIA del dispositivo y
    // nunca toca OLO_API_EMAIL/PASSWORD -- ver el comentario de clase de
    // OloApiClient. Vacio = sigue el login humano de siempre, sin romper
    // ningun telefono que ya este en campo con la config vieja.
    private val oloApi by lazy {
        if (BuildConfig.DEVICE_REFRESH_TOKEN.isNotBlank()) {
            OloApiClient(
                baseUrl = BuildConfig.OLO_API_BASE,
                refreshTokenInicial = BuildConfig.DEVICE_REFRESH_TOKEN,
            )
        } else {
            OloApiClient(
                baseUrl = BuildConfig.OLO_API_BASE,
                email = BuildConfig.OLO_API_EMAIL,
                password = BuildConfig.OLO_API_PASSWORD,
            )
        }
    }

    // Modulo de Flota (backend 0110): a diferencia de perceptionUploader, este
    // corre SIEMPRE que la app esta abierta -- "el telefono esta conectado" es
    // una pregunta distinta de "el telefono esta mandando detecciones ahora
    // mismo". Ver FleetHeartbeat.kt.
    private val fleetHeartbeat by lazy {
        FleetHeartbeat(
            context = applicationContext,
            api = oloApi,
            warehouseId = WAREHOUSE_ID,
            nombre = "S21 Fase 1 (${android.os.Build.MODEL})",
        )
    }

    // Uno POR SESION de simulacion, no uno para toda la vida de la Activity: un job
    // en vivo se cierra al apagar la simulacion (ver toggleSimulacionConCamaraDelTelefono),
    // y una vez cerrado (`PerceptionUploader.cerrado = true`) no vuelve a aceptar
    // lotes -- la proxima vez que se prenda hace falta una instancia nueva, con un
    // job nuevo. Nulo cuando no hay sesion activa; `enviarLote` con `?.` es un no-op
    // seguro en ese caso (p.ej. si el DetectionBatcher vacia su cola justo al apagar).
    private var perceptionUploader: PerceptionUploader? = null

    // Ver sync/DetectionBatcher.kt: prueba la ARQUITECTURA de sincronizacion
    // (Seccion 4 del ADR-015). El `upload` hace TRES cosas con cada lote: sube al
    // backend real (Fase 3), graba localmente como respaldo (LocalRecorder --
    // sigue funcionando aunque no haya red), y loguea (solo sirve con
    // `adb logcat` conectado). Si la subida falla, las otras dos no se ven
    // afectadas -- ver el manejo de errores de PerceptionUploader.enviarLote.
    private val detectionBatcher = DetectionBatcher(upload = { lote ->
        Log.i("MainActivity", "lote listo (${lote.length()} detecciones)")
        perceptionUploader?.enviarLote(lote)
        localRecorder.grabarLote(lote)
    })

    // Contador de FPS REALES de fin-a-fin (fotograma entregado por el MSDK ->
    // resultado pintado en pantalla) -- no el FPS teorico del modelo solo.
    private val framesRendered = AtomicInteger(0)
    private var fpsWindowStart = 0L

    private val cameraFrameListener = object : ICameraStreamManager.CameraFrameListener {
        override fun onFrame(frameData: ByteArray, offset: Int, length: Int, width: Int, height: Int, format: ICameraStreamManager.FrameFormat) {
            // Se llama en el hilo interno del MSDK -- nunca tocar vistas aca.
            val bitmap = rgbaBytesToBitmap(frameData, offset, length, width, height) ?: return
            frameProcessor?.offerFrame(bitmap)
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no bloqueamos el flujo por resultado individual -- ver onCreate */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        activarPantallaCompleta()
        // Aparece en el modulo de Flota desde que la app abre, no solo
        // mientras hay una simulacion corriendo -- ver FleetHeartbeat.kt.
        fleetHeartbeat.iniciar()

        videoFrameView = findViewById(R.id.videoFrameView)
        cameraPreview = findViewById(R.id.cameraPreview)
        overlayView = findViewById(R.id.overlayView)
        hudGridView = findViewById(R.id.hudGridView)
        statusText = findViewById(R.id.statusText)
        fpsText = findViewById(R.id.fpsText)
        recDot = findViewById(R.id.recDot)
        recDot.visibility = android.view.View.INVISIBLE
        syncStatusText = findViewById(R.id.syncStatusText)
        simulateCameraButton = findViewById(R.id.simulateCameraButton)
        simulateCameraButton.setOnClickListener { toggleSimulacionConCamaraDelTelefono() }

        gridToggleButton = findViewById(R.id.gridToggleButton)
        gridToggleButton.setOnClickListener {
            hudGridView.mostrarCuadricula = !hudGridView.mostrarCuadricula
            gridToggleButton.alpha = if (hudGridView.mostrarCuadricula) 1f else 0.45f
        }

        zoomOutButton = findViewById(R.id.zoomOutButton)
        zoomInButton = findViewById(R.id.zoomInButton)
        zoomLabelText = findViewById(R.id.zoomLabelText)
        // Paso fijo por toque -- el gesto de pellizcar (mas natural) vive en
        // onZoomGesture/setupGestoDeZoom; estos botones son el respaldo para
        // cuando presentar con una mano sola es mas facil que pellizcar.
        zoomOutButton.setOnClickListener { aplicarZoom(factor = 1f / 1.3f) }
        zoomInButton.setOnClickListener { aplicarZoom(factor = 1.3f) }

        qualityButton = findViewById(R.id.qualityButton)
        qualityButton.text = calidadSeleccionada.toString()
        qualityButton.setOnClickListener { ciclarCalidad() }

        zoomGestureDetector = ScaleGestureDetector(
            this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    aplicarZoom(factor = detector.scaleFactor)
                    return true
                }
            },
        )
        cameraPreview.setOnTouchListener { _, event ->
            zoomGestureDetector.onTouchEvent(event)
            if (event.action == MotionEvent.ACTION_UP || event.action == MotionEvent.ACTION_CANCEL) {
                cameraPreview.performClick()
            }
            true
        }

        requestRuntimePermissions()

        statusText.text = "Cargando modelo..."
        // Cargar el modelo (113 MB desde assets) es lento -- no bloquear el
        // hilo principal. Ver README: en produccion esto se descarga del
        // catalogo del backend en el primer arranque, no vive en el APK.
        Thread {
            val loadedEngine = RfDetrEngine(applicationContext)
            val processor = FrameProcessor(loadedEngine, threshold = 0.3f, onResult = ::onInferenceResult)
            runOnUiThread {
                engine = loadedEngine
                frameProcessor = processor
                statusText.text = "Modelo listo. Esperando MSDK..."
                initDji()
            }
        }.start()
    }

    /**
     * Pantalla completa inmersiva -- sin esto, la barra de estado y la de
     * navegacion de Android se dibujan ENCIMA del HUD (medido: tapaban el
     * "FPS" y el borde derecho de la cuadricula). `systemUiVisibility` y no
     * `WindowInsetsController` porque `minSdk 24` de este proyecto es anterior
     * a la API 30 donde existe ese controlador -- esta es la forma que
     * funciona desde API 19.
     */
    private fun activarPantallaCompleta() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Un deslizamiento desde el borde vuelve a mostrar las barras del
        // sistema una vez -- al recuperar el foco (el usuario las cerro, o
        // volvio de otra app) se reimponen.
        if (hasFocus) activarPantallaCompleta()
    }

    private fun requestRuntimePermissions() {
        permissionLauncher.launch(
            arrayOf(
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.RECORD_AUDIO,
                android.Manifest.permission.CAMERA,
            )
        )
    }

    private fun initDji() {
        DjiSdkManager.init(applicationContext, this)
    }

    /**
     * Zoom optico/digital combinado de CameraX -- ver `PhoneCameraSource.
     * setZoomRatio`. No hace nada si la simulacion no esta corriendo (no hay
     * camara que ajustar), lo cual es el comportamiento correcto: los botones
     * de zoom y el gesto de pellizcar quedan inertes hasta que se presiona
     * "Simular", en vez de fallar o crashear.
     */
    private fun aplicarZoom(factor: Float) {
        val fuente = phoneCameraSource ?: return
        fuente.aplicarFactorDeZoom(factor)
        zoomLabelText.text = String.format(Locale.US, "%.1fx", fuente.zoomRatioActual)
    }

    /**
     * Un toque = la siguiente combinacion real de resolucion/fps (ver
     * CalidadCamara.PRESETS). Si la simulacion esta corriendo, se reconfigura
     * la camara EN VIVO -- sin cortar la sesion del backend, ver
     * PhoneCameraSource.reconfigurar. Si no esta corriendo, solo se guarda la
     * eleccion para la proxima vez que se presione "Simular".
     */
    private fun ciclarCalidad() {
        val presets = CalidadCamara.PRESETS
        val siguiente = presets[(presets.indexOf(calidadSeleccionada) + 1) % presets.size]
        calidadSeleccionada = siguiente
        qualityButton.text = siguiente.toString()
        phoneCameraSource?.reconfigurar(siguiente)
    }

    /**
     * Boton "Simular con camara del telefono": mientras no hay un dron/RC DJI
     * conectado (ver ADR-015, Fase 1), esto prueba el pipeline de inferencia
     * completo -- camara real -> preprocesado -> ONNX -> postproceso -> cajas
     * en pantalla -> FPS -- sin esperar al hardware. El modelo no va a
     * detectar nada util apuntando a un cuarto cualquiera (entrenado para
     * etiquetas de almacen), pero SI confirma que todo lo de despues del
     * "recibir un fotograma" funciona con video real, no solo con la app
     * cargando sin crashear.
     *
     * No se apaga la suscripcion al MSDK al activar esto -- si un dron/RC se
     * conecta mientras se esta simulando, sus fotogramas tambien llegarian a
     * `frameProcessor`, mezclados con los del telefono. Para un prototipo de
     * un solo boton eso es aceptable; apagar una fuente al prender la otra
     * es la mejora obvia si esto pasa a ser mas que una prueba manual.
     */
    private fun toggleSimulacionConCamaraDelTelefono() {
        if (simulandoConCamaraDelTelefono) {
            phoneCameraSource?.stop()
            phoneCameraSource = null
            cameraPreview.visibility = android.view.View.GONE
            videoFrameView.visibility = android.view.View.VISIBLE
            simulateCameraButton.text = "SIMULAR CON CAMARA DEL TELEFONO"
            simulateCameraButton.setBackgroundResource(R.drawable.bg_primary_button_idle)
            zoomLabelText.text = "1.0x"
            recDot.visibility = android.view.View.INVISIBLE
            simulandoConCamaraDelTelefono = false
            // Se desprende la referencia de inmediato (no tras cerrar/descartar,
            // que es asincrono) para que un lote que llegue justo ahora no se
            // mande a un job que ya se esta cerrando.
            val uploaderACerrar = perceptionUploader
            perceptionUploader = null
            preguntarQueHacerConLaSesion(uploaderACerrar)
            return
        }
        if (frameProcessor == null) {
            statusText.text = "Espera a que el modelo termine de cargar antes de simular"
            return
        }
        videoFrameView.visibility = android.view.View.GONE
        cameraPreview.visibility = android.view.View.VISIBLE
        phoneCameraSource = PhoneCameraSource(
            context = applicationContext,
            lifecycleOwner = this,
            previewView = cameraPreview,
        ) { bitmap -> frameProcessor?.offerFrame(bitmap) }
        phoneCameraSource?.start(calidadSeleccionada)
        // Job nuevo por cada sesion -- ver el comentario del campo `perceptionUploader`.
        perceptionUploader = PerceptionUploader(
            api = oloApi,
            warehouseId = WAREHOUSE_ID,
            nombre = "S21 Fase 1 -- ${SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())}",
            onEstado = ::actualizarEstadoSync,
            onJobId = { id ->
                fleetHeartbeat.currentJobId = id
                fleetHeartbeat.latirAhora()
            },
            supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY,
        )
        // Adelanta la creacion del job y el prefijo de recortes al arranque de
        // la sesion, no a la primera deteccion -- ver el comentario de
        // `iniciarEnFondo`. Sin esto, una sesion corta puede terminar sin
        // imagenes aunque si tenga detecciones.
        perceptionUploader?.iniciarEnFondo()
        simulateCameraButton.text = "DETENER SIMULACION"
        simulateCameraButton.setBackgroundResource(R.drawable.bg_primary_button_activo)
        recDot.visibility = android.view.View.VISIBLE
        simulandoConCamaraDelTelefono = true
        statusText.text = "Simulando con camara del telefono (sin dron real)"
        actualizarEstadoSync("☁ Backend: preparando sesion...")
    }

    /**
     * Al apagar la simulacion, la sesion pudo haber sido una prueba de manejo
     * (probar el zoom, la cuadricula, apuntar a lo que sea) o un intento real
     * de leer un rack -- y esta app no tiene forma de distinguir una de otra
     * por si sola. Preguntar en vez de asumir "esto cuenta como real" es lo
     * que evita que una prueba de manejo quede archivada en la app web como
     * si fuera un analisis de inventario de verdad.
     *
     * No pregunta nada si nunca se creo un job (la sesion no llego a mandar
     * ni una deteccion) -- no hay nada que guardar ni que descartar.
     */
    private fun preguntarQueHacerConLaSesion(uploader: PerceptionUploader?) {
        if (uploader == null || !uploader.hayJobCreado()) return
        val detecciones = uploader.totalDeteccionesEnviadas
        AlertDialog.Builder(this)
            .setTitle("¿Qué hacer con esta sesión?")
            .setMessage(
                "Se subieron $detecciones detecciones a OLO_IA durante esta sesión. " +
                    "¿Era una prueba, o quieres que cuente como un análisis real?",
            )
            .setCancelable(false)
            .setPositiveButton("Guardar como real") { _, _ ->
                actualizarEstadoSync("☁ Cerrando la sesion en OLO_IA...")
                Thread { uploader.cerrar() }.start()
            }
            .setNegativeButton("Era una prueba, descartar") { _, _ ->
                actualizarEstadoSync("☁ Descartando la sesion...")
                Thread {
                    uploader.descartar("Descartado desde la app: el usuario marco la sesion como prueba")
                }.start()
            }
            .show()
    }

    /**
     * Unica linea visible que responde "¿esto de verdad esta llegando al
     * backend, o solo se esta grabando en el telefono?" -- ver syncStatusText
     * en activity_main.xml y el comentario de esta funcion cuando se agrego.
     * [PerceptionUploader] llama a esto desde SU hilo de fondo, nunca desde la
     * UI -- por eso el salto a `runOnUiThread` vive aca y no alla.
     */
    private fun actualizarEstadoSync(mensaje: String) {
        runOnUiThread {
            syncStatusText.text = mensaje
            syncStatusText.setTextColor(
                if (mensaje.startsWith("⚠")) {
                    android.graphics.Color.parseColor("#FF6B6B")
                } else {
                    android.graphics.Color.parseColor("#7CFC98")
                },
            )
        }
    }

    // ── DjiSdkManager.Listener ──────────────────────────────────────────────

    override fun onRegisterSuccess() {
        runOnUiThread {
            statusText.text = "MSDK registrado. Esperando dron/RC..."
            // Suscribirse ya, aunque no haya producto conectado todavia --
            // el propio manager entrega fotogramas en cuanto haya feed.
            DjiSdkManager.subscribeToVideoFrames(cameraFrameListener)
        }
    }

    override fun onRegisterFailure(message: String) {
        runOnUiThread {
            statusText.text = "Registro MSDK FALLO: $message\n" +
                "Revisar App Key en gradle.properties y que el Package Name " +
                "registrado en developer.dji.com sea exactamente com.olo.edges21."
        }
    }

    override fun onProductConnect(productId: Int) {
        runOnUiThread { statusText.text = "Dron/RC conectado (id=$productId)" }
    }

    override fun onProductDisconnect(productId: Int) {
        runOnUiThread { statusText.text = "Dron/RC desconectado (id=$productId)" }
    }

    // ── Resultado de inferencia (llega en el hilo de FrameProcessor) ────────

    private fun onInferenceResult(frame: Bitmap, detections: List<Detection>, inferenceMs: Long) {
        detectionBatcher.add(adjuntarFotogramaSiToca(frame, detections))
        // Con throttling propio (ver LocalRecorder) -- no escribe un .jpg por
        // cada fotograma, asi que es seguro llamarlo aqui en cada resultado.
        localRecorder.talVezGrabarFotograma(frame, detections)
        runOnUiThread {
            videoFrameView.setImageBitmap(frame)
            overlayView.update(detections, frame.width, frame.height)
            updateFps()
        }
    }

    /**
     * Cada ~2 s (mismo ritmo que `LocalRecorder`, no cada fotograma -- a 3 fps
     * eso serian cientos de imagenes por minuto), sube el fotograma CRUDO (sin
     * cajas dibujadas encima -- esto es para entrenar el modelo despues, y una
     * caja pintada ensuciaria justo los pixeles que un entrenamiento necesita
     * limpios) y le pone esa misma ruta a TODAS las detecciones de este
     * resultado, para poder verlas y usarlas desde la app web (`crop_path` en
     * `DetectionOut`, `GET .../crop-url`).
     *
     * Si no hay detecciones no se sube nada: una imagen sin ninguna deteccion
     * que la referencie seria un archivo huerfano que la app web no tiene
     * como encontrar (no existe hoy un listado de Storage aparte de las
     * detecciones).
     */
    private fun adjuntarFotogramaSiToca(frame: Bitmap, detections: List<Detection>): List<Detection> {
        if (detections.isEmpty()) return detections
        val ahoraNs = System.nanoTime()
        if (ahoraNs - ultimoFotogramaSubidoNs < INTERVALO_SUBIDA_FOTOGRAMA_NS) return detections
        val ruta = perceptionUploader?.rutaParaNuevoFotograma() ?: return detections
        ultimoFotogramaSubidoNs = ahoraNs

        val bytes = java.io.ByteArrayOutputStream().use { salida ->
            frame.compress(Bitmap.CompressFormat.JPEG, 85, salida)
            salida.toByteArray()
        }
        perceptionUploader?.subirFotogramaEnFondo(bytes, ruta)
        return detections.map { it.copy(cropPath = ruta) }
    }

    private fun updateFps() {
        val now = SystemClock.elapsedRealtime()
        val count = framesRendered.incrementAndGet()
        if (fpsWindowStart == 0L) {
            fpsWindowStart = now
            return
        }
        val elapsed = now - fpsWindowStart
        if (elapsed >= 1000) {
            val fps = count * 1000f / elapsed
            fpsText.text = String.format("%.1f FPS", fps)
            framesRendered.set(0)
            fpsWindowStart = now
        }
    }

    /**
     * Envuelve el ByteArray RGBA_8888 que entrega el MSDK en un
     * `Bitmap.Config.ARGB_8888`. Es una copia directa de bytes, sin
     * conversion de color: Android almacena `ARGB_8888` en memoria como
     * R,G,B,A (a pesar del nombre) -- el mismo orden que `RGBA_8888` del
     * MSDK. Es un detalle de Android bien conocido, no una suposicion nueva
     * de este archivo, pero SI depende de que el enum `FrameFormat.RGBA_8888`
     * entregue bytes en ese orden -- confirmar con una imagen de prueba
     * (colores solidos conocidos) antes de confiar en los colores mostrados.
     */
    private fun rgbaBytesToBitmap(data: ByteArray, offset: Int, length: Int, width: Int, height: Int): Bitmap? {
        if (width <= 0 || height <= 0) return null
        val expected = width * height * 4
        if (length < expected) return null
        return try {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val buffer = ByteBuffer.wrap(data, offset, expected)
            bitmap.copyPixelsFromBuffer(buffer)
            bitmap
        } catch (e: Exception) {
            null
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        DjiSdkManager.unsubscribeFromVideoFrames(cameraFrameListener)
        phoneCameraSource?.stop()
        frameProcessor?.shutdown()
        engine?.close()
        detectionBatcher.shutdown()
        perceptionUploader?.let { u -> Thread { u.cerrar() }.start() } // I/O de red -- nunca en el hilo principal
        fleetHeartbeat.detener()
    }
}
