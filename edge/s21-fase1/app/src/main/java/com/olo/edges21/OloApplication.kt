package com.olo.edges21

import android.app.Application
import android.content.Context

/**
 * Application subclass requerida por el MSDK -- el propio SDK necesita
 * "instalarse" (descifrar/preparar sus .so nativas) ANTES de que cualquier
 * otro codigo corra, y el unico punto que garantiza eso es
 * `attachBaseContext`, que se ejecuta antes que `onCreate` de cualquier
 * Activity.
 *
 * `com.cySdkyc.clx.Helper.install(this)` es la linea EXACTA que trae el
 * sample oficial `DJIAircraftApplication.kt` del repo
 * dji-sdk/Mobile-SDK-Android-V5 (rama dev-sdk-main) para
 * `dji-sdk-v5-aircraft:5.18.0` -- confianza ALTA porque se leyo del archivo
 * fuente real, no de un resumen.
 *
 * OJO: en documentacion/discusiones sobre otras versiones del MSDK aparece
 * tambien `com.secneo.sdk.Helper.install(this)` como el nombre de esta misma
 * clase -- el paquete de este "Helper" de instalacion cambia entre builds
 * porque el propio mecanismo de proteccion del SDK lo reofusca. Si al
 * compilar contra `5.18.0` el simbolo `com.cySdkyc.clx.Helper` no existe,
 * probar con `com.secneo.sdk.Helper` antes de asumir que el problema es otro.
 */
open class DjiApplication : Application() {
    override fun attachBaseContext(base: Context?) {
        super.attachBaseContext(base)
        com.cySdkyc.clx.Helper.install(this)
    }
}

/** Application real de la app -- separada de [DjiApplication] solo para dejar clara la razon de cada linea. */
class OloApplication : DjiApplication() {
    override fun onCreate() {
        super.onCreate()
    }
}
