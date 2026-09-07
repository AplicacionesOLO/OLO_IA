package com.olo.edges21.dji

import android.content.Context
import android.util.Log
import dji.sdk.keyvalue.value.common.ComponentIndexType
import dji.v5.common.error.IDJIError
import dji.v5.common.register.DJISDKInitEvent
import dji.v5.manager.SDKManager
import dji.v5.manager.datacenter.MediaDataCenter
import dji.v5.manager.interfaces.SDKManagerCallback
import dji.v5.manager.interfaces.ICameraStreamManager

/**
 * Puente delgado hacia el Mobile SDK v5 de DJI: registro de la app y
 * suscripcion al feed de video decodificado.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * FUENTES Y NIVEL DE CONFIANZA (ver README.md para el detalle completo) --
 * esta maquina no tiene Android Studio/Gradle, asi que NADA de esto se pudo
 * compilar ni probar. Antes de dar por buena esta clase, ábrela en Android
 * Studio con el SDK descargado y deja que el autocompletado/compilador
 * confirme cada firma marcada como "VERIFICAR" abajo.
 *
 * ALTA confianza -- ACTUALIZADO 2026-09-03 tras compilar de verdad:
 *   - `SDKManagerCallback` (paquete `dji.v5.manager.interfaces`) declara
 *     7 metodos, NO 5. La pagina de referencia oficial citada como fuente
 *     original solo listaba estos 5 (y por eso la primera version de esta
 *     clase se quedo corta):
 *       onInitProcess(DJISDKInitEvent, int)
 *       onRegisterSuccess()
 *       onRegisterFailure(IDJIError)
 *       onProductDisconnect(int)
 *       onProductConnect(int)
 *     Los otros 2 -- que SI hacen falta implementar, confirmado por el
 *     compilador de Kotlin contra el .jar real (ver
 *     `dji-sdk-v5-aircraft-provided-5.18.0.jar`, inspeccionado con `javap`):
 *       onProductChanged(int)
 *       onDatabaseDownloadProgress(long, long)
 *     Moraleja para el resto de este archivo: una pagina de referencia
 *     "oficial" puede estar incompleta. Lo unico que no miente es compilar
 *     contra el artefacto real.
 *   - Flujo de registro: `registerApp()` se llama DESPUES de que
 *     `onInitProcess` entregue el evento `INITIALIZE_COMPLETE` -- documentado
 *     explicitamente asi por DJI.
 *   - `ICameraStreamManager.addFrameListener(ComponentIndexType, FrameFormat,
 *     CameraFrameListener)` / `removeFrameListener(CameraFrameListener)` --
 *     confirmado en la pagina de referencia oficial de `ICameraStreamManager`.
 *   - `MediaDataCenter.getInstance().cameraStreamManager` como forma de
 *     llegar al manager.
 *   - `addFrameListener` para computo casi en tiempo real esta soportado
 *     "desde MSDK 5.8.0" segun la documentacion -- con `dji-sdk-v5-aircraft:5.18.0`
 *     (ver app/build.gradle) estamos muy por encima de ese piso.
 *
 * MEDIA confianza (vista en ejemplos/discusiones, no en la pagina de
 * referencia formal -- VERIFICAR con autocompletado antes de confiar):
 *   - Paquetes exactos: `dji.v5.manager.SDKManager`,
 *     `dji.v5.common.error.IDJIError`, `dji.v5.common.register.DJISDKInitEvent`,
 *     `dji.sdk.keyvalue.value.common.ComponentIndexType`.
 *   - El valor de enum `ComponentIndexType.LEFT_OR_MAIN` para "la camara
 *     principal" (existe para el M4T/M400; para un simulador o RC sin camara
 *     real puede no aplicar igual -- probar con el hardware real).
 *   - El valor de enum `ICameraStreamManager.FrameFormat.RGBA_8888` --
 *     confirmado que EXISTE como opcion (hay ejemplos que la usan), pero no
 *     se pudo confirmar la lista completa de valores del enum. Se eligio
 *     este formato a proposito para que un fotograma se pueda envolver
 *     directo en un `Bitmap.Config.ARGB_8888` sin conversion YUV->RGB propia
 *     (ver DjiVideoFrameListener.onFrame abajo) -- si el enum real no trae
 *     `RGBA_8888`, la alternativa es pedir el formato YUV que si exista y
 *     convertir con `android.graphics.YuvImage` o `RenderScript`/`libyuv`.
 *   - `SDKManager.getInstance().init(Context, SDKManagerCallback)` como forma
 *     de arrancar el SDK (equivalente v5 del `DJISDKManager.registerApp` de
 *     v4). Antes de `init`, el patron v4 exigia `Helper.install(this)` en
 *     `attachBaseContext` de una Application -- en v5 el sample real de DJI
 *     (`DJIAircraftApplication.kt`, tag 5.18.0) sigue llamando
 *     `com.cySdkyc.clx.Helper.install(this)` ahi mismo; ver OloApplication.kt.
 * ══════════════════════════════════════════════════════════════════════════
 */
object DjiSdkManager {
    private const val TAG = "DjiSdkManager"

    interface Listener {
        fun onRegisterSuccess()
        fun onRegisterFailure(message: String)
        fun onProductConnect(productId: Int)
        fun onProductDisconnect(productId: Int)
    }

    private var listener: Listener? = null

    /** Llamar una vez, desde `MainActivity.onCreate` (o antes). No bloquea. */
    fun init(context: Context, listener: Listener) {
        this.listener = listener
        SDKManager.getInstance().init(context, object : SDKManagerCallback {
            override fun onInitProcess(event: DJISDKInitEvent, totalProcess: Int) {
                Log.i(TAG, "onInitProcess: $event ($totalProcess%)")
                if (event == DJISDKInitEvent.INITIALIZE_COMPLETE) {
                    // VERIFICAR: el nombre exacto de la constante del enum
                    // (`INITIALIZE_COMPLETE`) es el que aparece en discusiones
                    // publicas sobre v5, pero no se confirmo contra el enum
                    // fuente -- si el compilador no lo encuentra, mirar los
                    // valores reales de `DJISDKInitEvent` con autocompletado.
                    SDKManager.getInstance().registerApp()
                }
            }

            override fun onRegisterSuccess() {
                Log.i(TAG, "registerApp: exito")
                listener.onRegisterSuccess()
            }

            override fun onRegisterFailure(error: IDJIError) {
                Log.e(TAG, "registerApp: fallo -> $error")
                listener.onRegisterFailure(error.toString())
            }

            override fun onProductConnect(productId: Int) {
                Log.i(TAG, "producto conectado: $productId")
                listener.onProductConnect(productId)
            }

            override fun onProductDisconnect(productId: Int) {
                Log.i(TAG, "producto desconectado: $productId")
                listener.onProductDisconnect(productId)
            }

            // Estos dos NO estaban en la pagina de referencia oficial que se
            // uso como fuente (ver nota de clase) -- confirmados como
            // obligatorios recien al compilar de verdad contra el AAR real
            // (javap sobre dji-sdk-v5-aircraft-provided-5.18.0.jar, 2026-09-03):
            // la interfaz tiene 7 metodos, no 5. Quedan como no-op explicito
            // porque esta Fase 1 no necesita reaccionar a ellos todavia.
            override fun onProductChanged(productId: Int) {
                Log.i(TAG, "producto cambiado: $productId")
            }

            override fun onDatabaseDownloadProgress(current: Long, total: Long) {
                // No-op: descarga de la base de datos de zonas de no-vuelo (NFZ)
                // de DJI, sin relacion con la inferencia de esta app.
            }
        })
    }

    /**
     * Suscribe `frameListener` al feed de video decodificado de la camara
     * principal. Pedimos RGBA_8888 a proposito -- ver nota de clase -- para
     * poder envolver cada fotograma en un `Bitmap` sin escribir un conversor
     * YUV->RGB propio en esta Fase 1.
     */
    fun subscribeToVideoFrames(frameListener: ICameraStreamManager.CameraFrameListener) {
        MediaDataCenter.getInstance().cameraStreamManager.addFrameListener(
            ComponentIndexType.LEFT_OR_MAIN,
            ICameraStreamManager.FrameFormat.RGBA_8888,
            frameListener,
        )
    }

    fun unsubscribeFromVideoFrames(frameListener: ICameraStreamManager.CameraFrameListener) {
        MediaDataCenter.getInstance().cameraStreamManager.removeFrameListener(frameListener)
    }
}
