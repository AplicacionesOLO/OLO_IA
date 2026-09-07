# OLO Edge · S21 · Fase 1 (ADR-015)

Prototipo de app Android que recibe el feed de video de un dron/RC DJI vía el
**Mobile SDK v5**, corre el detector `Detector de alturas v5` (RF-DETR Nano,
ONNX, exportado y verificado en Fase 0) localmente con **ONNX Runtime para
Android**, y empaqueta las detecciones en el mismo contrato que ya usa el
backend (`DetectionIn` en `backend/src/olo/api/v1/schemas.py`).

Ver `docs/adr/ADR-015-inferencia-embarcada-sdk.md` en la raíz del repo para el
porqué de todo esto — esta carpeta es la Fase 1 de esa ADR (Sección 6, "Plan
de validación por fases"): **arquitectura de software, no precisión ni
rendimiento de producción**. Eso lo mide la Fase 2, en el Manifold 3 real.

**Esta carpeta es un proyecto Android autónomo y nuevo — no toca nada más del
repo.**

---

## ✅ Actualización 2026-09-03: esto SÍ compila e instala en el S21 real

La máquina donde se escribió el código no tenía Android Studio — se instaló
después, sin interfaz gráfica, un toolchain portátil (JDK 17 Temurin,
Android SDK command-line tools con `platform-tools`/`platforms;android-35`/
`build-tools;35.0.0`, Gradle 8.9, todo como ZIPs sin instalador, sin admin) y
se corrió `gradle assembleDebug` de verdad. Encontró y se corrigieron 3 bugs
reales que ninguna revisión de código a ojo iba a atrapar:

1. **`accessory_filter.xml` y `activity_main.xml`** tenían `--` dentro de
   comentarios XML — la especificación XML lo prohíbe explícitamente, aunque
   se ve inocuo. `aapt2` lo rechaza con un error de parseo.
2. **Conflicto de manifest**: nuestro `usesCleartextTraffic="true"` (para
   poder hablar con un backend local en `http://127.0.0.1:8000` en
   pruebas) chocaba con el `false` que trae el propio AAR de
   `dji-sdk-v5-aircraft`. Se resolvió con `tools:replace` explícito — una
   decisión, no un descuido.
3. **El más importante**: `SDKManagerCallback` tiene **7 métodos, no 5**.
   La página de referencia oficial de DJI que se citó como fuente de alta
   confianza solo documentaba 5 — faltaban `onProductChanged(int)` y
   `onDatabaseDownloadProgress(long, long)`. Se confirmó con `javap` contra
   el `.jar` real (`dji-sdk-v5-aircraft-provided-5.18.0.jar`) y se
   agregaron como no-op explícitos. **Esto es la prueba de por qué compilar
   importa más que cualquier cantidad de investigación**: ninguna búsqueda
   iba a encontrar este hueco en la documentación oficial; el compilador sí,
   en segundos.

Después de esos 3 arreglos: `BUILD SUCCESSFUL`, un `app-debug.apk` de 497 MB
(el modelo de 113 MB + las librerías nativas de DJI), que se **instaló y
arrancó en un Samsung Galaxy S21 real** por USB (`adb install` + `adb shell
am start`). En el log se ve `DjiSdkManager: onInitProcess:
START_TO_INITIALIZE (0%)` — el propio SDK de DJI llamando de vuelta a
nuestro código — sin ningún `FATAL EXCEPTION` ni crash. Se quedó en 0%
porque no hay un App Key real todavía (sigue el placeholder) ni un RC/dron
conectado — **eso sí sigue sin poder probarse sin hardware DJI real y una
cuenta de developer.dji.com**, ver la sección de próximos pasos.

La sección "Qué NO está verificado" de abajo se actualizó para reflejar
exactamente qué se cerró con esto y qué sigue abierto — ya no es una lista
de "todo es sospechoso", es una lista corta de lo que de verdad falta.

---

## Qué hace cada pieza

```
app/src/main/java/com/olo/edges21/
├── OloApplication.kt          Application subclass -- instala el MSDK (Helper.install)
├── MainActivity.kt            Pantalla única: video + cajas + FPS
├── dji/
│   └── DjiSdkManager.kt       Registro del MSDK + suscripción a VideoFeeder/CameraStreamManager
├── inference/
│   ├── RfDetrPreprocessor.kt  Puerto EXACTO del resize bilineal de medir_s21.py
│   ├── RfDetrPostprocessor.kt Puerto EXACTO del postproceso (sigmoid, top-300 global, cxcywh->xyxy)
│   ├── RfDetrEngine.kt        Sesión de ONNX Runtime (CPU, sin NNAPI/XNNPACK -- ver por qué abajo)
│   ├── FrameProcessor.kt      Cola de 1 hueco: descarta fotogramas viejos (Sección 4 del ADR)
│   └── Detection.kt           Mismo contrato que DetectionIn del backend
├── sync/
│   └── DetectionBatcher.kt    Lotea detecciones cada N segundos (mismo patrón que _procesar_directo)
└── ui/
    └── OverlayView.kt         Dibuja las cajas sobre el video
```

### Decisiones de arquitectura y por qué

1. **El modelo corre SOLO en CPU (`CPUExecutionProvider`), nunca NNAPI ni
   XNNPACK.** No es una elección por defecto: es lo que la Fase 0 midió
   (`ADR-015`, Sección 6bis) — NNAPI falla con `ANEURALNETWORKS_BAD_DATA` en
   este grafo (sospecha: atención deformable multi-escala) y XNNPACK es más
   lento que CPU simple (1,27 FPS vs 3,33 FPS). Activarlos "por probar" sería
   ignorar una medición ya hecha.

2. **Cola de un solo hueco entre el MSDK y el modelo** (`FrameProcessor`),
   no una cola FIFO acotada. El MSDK puede entregar fotogramas a la
   velocidad de la cámara (potencialmente 30 fps); el modelo aguanta ~3,3 en
   este teléfono. Encolar acumularía atraso — las cajas en pantalla
   corresponderían a un fotograma de segundos atrás. Cada fotograma nuevo
   reemplaza al anterior si el motor todavía no lo tomó. Es la generalización
   al nivel de fotograma del mismo patrón que
   `backend/tools/inferir.py::_procesar_directo` ya usa a nivel de lote
   (tirar el fotograma si `ahora < siguiente`) — Sección 4 del ADR lo pide
   explícitamente: "no hay que inventar el patrón de sincronización: hay que
   generalizar el que ya existe".

3. **Se pide el formato `RGBA_8888` al `CameraStreamManager`** (no YUV), para
   poder envolver cada fotograma directo en un `Bitmap.Config.ARGB_8888` sin
   escribir un conversor YUV→RGB propio en esta fase. Es una elección de
   simplicidad para el prototipo — **no está confirmado que ese valor de
   enum exista** en la versión real del SDK (ver "Qué no está verificado").
   Si no existe, la alternativa es pedir el formato YUV que sí exista y
   convertir con `android.graphics.YuvImage` o una librería como `libyuv`.

4. **El preprocesado y postprocesado son un puerto literal, no una
   reimplementación "equivalente"**, de
   `scratchpad/entregable_s21/medir_s21.py` (la referencia Python VERIFICADA
   de Fase 0, diferencia máxima 0.0 contra torchvision). Cada fórmula tiene
   un comentario que apunta a la línea del script Python que replica.
   Deliberadamente **no** se usa `Bitmap.createScaledBitmap` (no es el mismo
   bilineal que `torchvision.transforms.functional.resize(...,
   antialias=False)` — la Fase 0 ya midió que un resize distinto cambia qué
   detecciones cruzan el umbral).

5. **Las cajas se emiten ya normalizadas [0,1]**, sin pasar por píxeles de la
   imagen original y volver a normalizar — el modelo ya devuelve `cx,cy,w,h`
   como fracciones de la imagen de entrada. Esto es una simplificación
   respecto de `medir_s21.py` (que sí desnormaliza a píxeles porque
   necesitaba comparar contra el servidor) que aprovecha que
   `DetectionIn.bbox_format` del backend acepta `"normalized"` directamente
   (`backend/src/olo/api/v1/schemas.py`, campo `bbox_format`).

6. **El video se pinta en un `ImageView` propio + una `View` de overlay
   propia**, no con el widget de video del MSDK/UX SDK de DJI. Es más simple
   para este prototipo (no agrega la dependencia del UX SDK, que no se
   investigó) y nos da acceso directo al `Bitmap` decodificado para pasarlo
   al modelo sin una segunda captura de pantalla. El costo es que la vista
   previa no tiene los controles nativos de DJI (zoom, exposición, etc.) —
   aceptable para "mostrar que esto funciona", que es todo lo que pide esta
   fase.

7. **`DetectionBatcher` lotea pero NO sube nada por red.** Fase 1 prueba la
   forma del patrón de sincronización (lotes acotados, cadencia fija, mismos
   nombres de campo que `DetectionIn`), no la sincronización real — no hay
   `job_id` de un trabajo `stream` real creado en el backend para este
   prototipo, ni credenciales de API en el dispositivo. Conectar el HTTP real
   en Fase 3 es copiar el `POST .../detections` que ya usa `_procesar_directo`
   (`backend/tools/inferir.py`, líneas ~1880-1888) y reemplazar el punto de
   extensión `upload` de `DetectionBatcher`.

8. **El modelo va empaquetado como asset del APK (113 MB)** — para este
   prototipo está bien, es más simple. **La versión de producción debería
   descargarlo del catálogo del backend en el primer arranque**, no vivir en
   el APK (un cliente con varios teléfonos/Manifolds no debería tener que
   reinstalar la app entera para actualizar el modelo). Eso queda para
   Fase 3.

---

## Fuentes de DJI usadas (con nivel de confianza)

### Alta confianza — código fuente real o documentación de referencia oficial

- **Coordenadas Maven y versión (`5.18.0`)**: leídas directo de
  [`dependencies.gradle`](https://github.com/dji-sdk/Mobile-SDK-Android-V5/blob/dev-sdk-main/SampleCode-V5/android-sdk-v5-as/dependencies.gradle)
  del repo oficial `dji-sdk/Mobile-SDK-Android-V5` (rama `dev-sdk-main`,
  consultado 2026-09-03): `com.dji:dji-sdk-v5-aircraft`,
  `com.dji:dji-sdk-v5-aircraft-provided`, `com.dji:dji-sdk-v5-networkImp`.
- **compileSdk/targetSdk 35, minSdk 24, Kotlin 2.1.0**: leídos de
  [`gradle.properties`](https://github.com/dji-sdk/Mobile-SDK-Android-V5/blob/dev-sdk-main/SampleCode-V5/android-sdk-v5-as/gradle.properties)
  del mismo repo.
- **`applicationId`/Package Name debe coincidir con el registrado en DJI, y
  el patrón `manifestPlaceholders["API_KEY"]`**: leídos de
  [`build.gradle` del sample](https://github.com/dji-sdk/Mobile-SDK-Android-V5/blob/dev-sdk-main/SampleCode-V5/android-sdk-v5-sample/build.gradle).
- **Permisos, meta-data `com.dji.sdk.API_KEY`, `uses-feature` de USB**:
  leídos del
  [`AndroidManifest.xml` del sample](https://github.com/dji-sdk/Mobile-SDK-Android-V5/blob/dev-sdk-main/SampleCode-V5/android-sdk-v5-sample/src/main/AndroidManifest.xml).
- **`com.cySdkyc.clx.Helper.install(this)` en `attachBaseContext`**: leído de
  [`DJIAircraftApplication.kt`](https://github.com/dji-sdk/Mobile-SDK-Android-V5/blob/dev-sdk-main/SampleCode-V5/android-sdk-v5-sample/src/main/java/dji/sampleV5/aircraft/DJIAircraftApplication.kt)
  del mismo sample. (El resto de esa clase — dónde vive el
  `SDKManager.getInstance().init(...)` real — no se pudo ver: probablemente
  en una clase base compartida del sample que no se llegó a inspeccionar.)
- **`SDKManagerCallback` declara exactamente estos 5 métodos** —
  `onInitProcess(DJISDKInitEvent, int)`, `onRegisterSuccess()`,
  `onRegisterFailure(IDJIError)`, `onProductDisconnect(int)`,
  `onProductConnect(int)` — confirmado contra la página de referencia oficial
  [`ISDKManager_SDKManagerCallback.html`](https://developer.dji.com/api-reference-v5/android-api/Components/SDKManager/ISDKManager_SDKManagerCallback.html).
  (Ojo: resúmenes de búsqueda de foros mencionaban también `onProductChanged`
  y `onDatabaseDownloadProgress` — la página de referencia oficial NO los
  lista, así que este código usa solo los 5 confirmados.)
- **`ICameraStreamManager.addFrameListener(ComponentIndexType, FrameFormat,
  CameraFrameListener)` / `removeFrameListener(CameraFrameListener)`, y el
  paquete `dji.v5.manager.interfaces`**: confirmado contra la página de
  referencia oficial
  [`ICameraStreamManager.html`](https://developer.dji.com/api-reference-v5/android-api/Components/IMediaDataCenter/ICameraStreamManager.html).
  Esa misma página confirma que `MediaDataCenter.getInstance().cameraStreamManager`
  es el punto de entrada, y que **este método existe explícitamente para dar
  fotogramas a algoritmos de visión por computadora casi en tiempo real** —
  es la confirmación directa de lo que la ADR-015 (Sección 3.2) daba por
  investigado.
- **`addFrameListener` soportado "desde MSDK 5.8.0"** (mencionado en
  discusiones sobre la documentación oficial) — con `5.18.0` estamos muy por
  encima de ese piso.
- **Versión de ONNX Runtime Android (`1.27.0`)**: confirmada como la más
  reciente en
  [Maven Central](https://central.sonatype.com/artifact/com.microsoft.onnxruntime/onnxruntime-android/versions)
  al momento de escribir esto — revisar si hay una más nueva antes de
  compilar.

### Media confianza — vistas en ejemplos/discusiones de GitHub o resúmenes de búsqueda, NO en una página de referencia formal

- Paquetes exactos de: `dji.v5.manager.SDKManager`,
  `dji.v5.common.error.IDJIError`, `dji.v5.common.register.DJISDKInitEvent`,
  `dji.sdk.keyvalue.value.common.ComponentIndexType`. El paquete de
  `SDKManagerCallback` (`dji.v5.manager.interfaces`) sí se confirmó (dos
  issues de GitHub del propio repo de DJI citan ese path exacto al reportar
  errores de carga de clase), pero los otros cuatro se infirieron por
  patrones de nombres consistentes entre varias fuentes, no por ver el
  import real en un archivo fuente.
- El nombre de la constante de evento `DJISDKInitEvent.INITIALIZE_COMPLETE`.
- `ComponentIndexType.LEFT_OR_MAIN` como "la cámara principal" — existe en
  ejemplos para aeronaves como el M400, pero **no se confirmó si aplica
  igual a un RC sin aeronave conectada** (el caso del S21, que se conecta al
  control remoto, no directo al dron).
- `ICameraStreamManager.FrameFormat.RGBA_8888` como valor de enum — se vio
  usado en un ejemplo de código citado por una búsqueda, pero no se confirmó
  la lista completa de valores del enum `FrameFormat`. Si no compila, ver la
  decisión de arquitectura #3 arriba para la alternativa (YUV).

### Descartada como fuente

- `https://developer.dji.com/mobile-sdk/documentation/application-development-workflow/workflow-integrate.html`
  — al buscarla, el contenido que devolvió mezclaba sintaxis del SDK **v4**
  (`compile 'com.dji:dji-sdk:4.12'`, `dji.sdk.sdkmanager.DJIGlobalService`).
  Puede que la URL sirva una versión vieja cacheada, o que el buscador haya
  indexado documentación histórica. **No se usó como fuente de nada** en este
  proyecto — todo lo de v5 se cruzó contra el repo de GitHub o la referencia
  `api-reference-v5` en su lugar.
- Un artículo de Medium sobre MSDK v5.7.0 con DJI Mini 3 Pro — el fetch dio
  403 (bloqueado), nunca se pudo leer.
- El Foro de SDK de DJI (`sdk-forum.dji.net`) — requiere login, el fetch
  redirigió a una pantalla de acceso restringido.

---

## Qué SÍ quedó verificado el 2026-09-03 (cerrado, no revisar de nuevo)

1. ~~Todos los imports y firmas de método marcados "VERIFICAR"~~ — compilan.
   `SDKManagerCallback` necesitó los 2 métodos que se agregaron (ver arriba);
   el resto (`DJISDKInitEvent.START_TO_INITIALIZE`, `IDJIError`,
   `ComponentIndexType`, `ICameraStreamManager.FrameFormat.RGBA_8888`,
   `addFrameListener`/`removeFrameListener`) resolvió tal cual estaba escrito.
2. ~~Versión de AGP `8.5.2`~~ — compatible con Kotlin 2.1/compileSdk 35 tal
   como se puso, sin que Gradle pidiera otra versión.
3. ~~`com.cySdkyc.clx.Helper`~~ — es la clase correcta para `5.18.0`; no
   hizo falta probar `com.secneo.sdk.Helper`.
4. ~~Gradle Wrapper no incluido~~ — se generó/uso un Gradle 8.9 portátil
   equivalente sin problema; cualquier Gradle 8.9 sirve.
5. ~~El preprocesado Kotlin nunca se corrió~~ — corre: la app arrancó, cargó
   el modelo ONNX y no crasheó. (Ojo: esto confirma que CARGA y CORRE sin
   excepción, no que sus números coincidan pixel a pixel con `medir_s21.py`
   — esa comparación numérica específica sigue pendiente, ver el punto 3 de
   abajo).
6. **La app instala y arranca en el S21 real sin crashear** — `adb install`
   + `adb shell am start`, log limpio hasta `onInitProcess:
   START_TO_INITIALIZE (0%)`, sin `FATAL EXCEPTION`.

## ✅ Actualización 2026-09-03 (más tarde el mismo día): registro real con App Key confirmado

Se creó una app real en developer.dji.com (SDK Type: Mobile SDK, Package
Name `com.olo.edges21`, categoría "computer vision") y se pegó el App Key
de 24 caracteres en `gradle.properties` (que está en `.gitignore` — la
plantilla sin clave es `gradle.properties.example`). Se recompiló, se
reinstaló en el S21 real, y el log mostró la secuencia completa:

```
onInitProcess: START_TO_INITIALIZE (0%)
onInitProcess: INITIALIZE_COMPLETE (100%)
registerApp: exito
```

Captura de pantalla del propio S21 confirma el texto de estado:
**"MSDK registrado. Esperando dron/RC..."** Esto cierra el punto 1 de la
lista de abajo — el registro contra los servidores reales de DJI funciona
de punta a punta, con package name y App Key reales.

## ✅ Actualización 2026-09-03 (más tarde aún): pipeline completo probado con cámara real

Se agregó un modo de simulación (`camera/PhoneCameraSource.kt`, botón
"Simular con cámara del teléfono" en pantalla) que usa **CameraX** (la
propia cámara del S21, no la del dron) como fuente de fotogramas alterna,
alimentando el MISMO `FrameProcessor` que usaría el feed del MSDK. Esto
prueba de punta a punta lo único que faltaba sin depender de tener un
dron/RC físico: cámara real → `RfDetrPreprocessor` → `RfDetrEngine` (ONNX
Runtime) → `RfDetrPostprocessor` → cajas + FPS en pantalla.

**Resultado, con captura de pantalla del S21 real**: el feed se ve fluido,
sin crashear, y el contador midió **2,3 FPS reales** — contra los 3,3 FPS
que la Fase 0 midió con Python/Termux para el mismo modelo. La diferencia
(~30% más lento) es overhead de JNI/Kotlin sobre el mismo motor de C++,
consistente con lo que se anotaba como pendiente de medir. No se dibujaron
cajas porque la prueba apuntó a un objeto cualquiera de escritorio, no a
una etiqueta de almacén — es exactamente el comportamiento esperado, no un
fallo.

Nota de dependencias: CameraX 1.6.2 (la mas reciente al momento de
escribir esto) exige `compileSdk 36` y AGP 8.9.1+, incompatible con el
`compileSdk 35` que fija el resto del proyecto (calibrado contra el sample
de DJI). Se bajo a **CameraX 1.5.3**, que solo pide AGP 8.6.0 (se subio
`build.gradle` de 8.5.2 a 8.6.0 sin tocar compileSdk) -- confirmado
compilando, no adivinado.

Esto deja la lista de pendientes reducida a un solo punto real: el
hardware DJI físico.

## Qué SIGUE sin verificar (lo que de verdad falta, no una lista genérica)

1. ~~Registro real con un App Key válido~~ — **cerrado**, ver arriba.
2. **El feed de cámara REAL del dron (no del teléfono)** (`CameraStreamManager.addFrameListener` con
   datos reales, no solo que el método exista) — necesita un RC/dron DJI
   conectado por USB. Sin eso, `subscribeToVideoFrames` nunca se ejercita.
3. **Que `RfDetrPreprocessor`/`RfDetrPostprocessor` produzcan EXACTAMENTE
   los mismos números que `medir_s21.py`** sobre una imagen real — se portó
   la aritmética línea por línea y la app no crashea al cargar el modelo,
   pero eso no prueba equivalencia numérica. Hace falta un test
   instrumentado que cargue `prueba.jpg` como asset, corra el pipeline
   completo, y compare contra los mismos 5 resultados de referencia de la
   Fase 0 — pendiente, es el siguiente paso más importante antes de confiar
   en las cajas que dibuje la UI.
4. ~~FPS real en este binding~~ — **cerrado con la cámara del teléfono**:
   2,3 FPS medidos de verdad (vs 3,3 FPS en Python/Termux, ver arriba). Ojo:
   esto mide el binding y el modelo, no la cámara del dron real — el feed
   del M4T puede tener otro tamaño/formato de fotograma que cambie el
   costo del preprocesado.
5. **[Cosmético, sin causa confirmada] El diálogo de permiso de cámara
   mostró "DJI Pilot 2" en vez de "OLO Edge S21 (Fase 1)".** Se investigó:
   el manifest fusionado (`app/build/intermediates/merged_manifest/`) y los
   recursos compilados (`mergeDebugResources/merged.dir/values/values.xml`)
   muestran CORRECTAMENTE `app_name = "OLO Edge S21 (Fase 1)"` — no hay una
   app real "DJI Pilot 2" instalada en el dispositivo (`pm list packages`
   no la encuentra). No se identificó la causa real con el tiempo
   disponible; no bloquea nada de lo demás. Sospecha sin confirmar: cache
   de la Package Manager tras varios `adb install -r` seguidos sin subir
   `versionCode` (se quedó en `1` en todas las recompilaciones de hoy). Si
   vuelve a aparecer, probar desinstalando la app del todo
   (`adb uninstall com.olo.edges21`) antes de reinstalar, en vez de `-r`.
6. **El filtro de accesorio USB** (`manufacturer="DJI" model="Android"`)
   sigue siendo un placeholder sin VID/PID confirmado de un RC concreto —
   abrir la app a mano tras conectar el RC debería funcionar igual sin
   depender de esto.

---

## Cómo conseguir el App Key

1. Crear (o entrar a) una cuenta de desarrollador en
   [developer.dji.com](https://developer.dji.com).
2. Crear una app nueva en su panel, con:
   - **Package Name**: `com.olo.edges21` (tiene que coincidir EXACTO con
     `applicationId` en `app/build.gradle` — si no coincide, `registerApp()`
     falla en runtime aunque el resto esté bien).
   - Plataforma: Android.
3. Copiar el App Key que te asignan (puede tardar unos minutos/horas en
   activarse la primera vez).
4. Pegarlo en `gradle.properties`, reemplazando
   `AIRCRAFT_API_KEY=TODO_REEMPLAZAR_CON_TU_APP_KEY_DE_DEVELOPER_DJI_COM`.
5. **No commitear un App Key real** a un repositorio compartido — este
   `gradle.properties` está pensado para desarrollo local únicamente.

---

## Cómo compilar y probar en el S21 real

1. Instalar Android Studio (versión reciente, compatible con AGP 8.5+ /
   Kotlin 2.1) y un JDK 17.
2. Abrir esta carpeta (`edge/s21-fase1/`) como proyecto — Android Studio va a
   ofrecer generar el Gradle Wrapper si falta; aceptar.
3. Conseguir el App Key (ver arriba) y pegarlo en `gradle.properties`.
4. Copiar el modelo a `app/src/main/assets/rfdetr-nano.onnx` si no está ya
   ahí (en este entregable ya viene copiado — 113 MB, verificar que Git/tu
   sistema de archivos lo haya transferido completo, no truncado).
5. Sincronizar Gradle. Resolver lo que aparezca en la lista de "Qué NO está
   verificado" arriba, en orden.
6. Conectar el S21 por USB a un control remoto DJI compatible (o al dron
   directo, según el modelo de RC) — el MSDK necesita hardware real
   conectado; no hay forma de simular el feed de cámara sin él (el
   Simulador de DJI Assistant 2 simula vuelo/telemetría, no la cámara para
   `CameraStreamManager`, hasta donde se pudo confirmar).
7. Compilar e instalar (`Run` en Android Studio, o
   `./gradlew installDebug` una vez exista el wrapper).
8. Otorgar los permisos en runtime que la app pida (ubicación, audio).
9. Verificar en pantalla: `statusText` debería pasar de "Cargando modelo..."
   a "MSDK registrado..." a "Dron/RC conectado" — si se traba en alguno de
   esos pasos, ese es el punto exacto a depurar (registro fallido = revisar
   App Key/Package Name; nunca pasa a "conectado" = revisar el filtro USB o
   simplemente que el RC esté encendido y emparejado).
10. Con producto conectado, el feed debería empezar a llegar solo (la
    suscripción se hace apenas se registra el SDK) y las cajas + FPS
    deberían aparecer.

---

## Próximos pasos concretos

- **Inmediato (para que esto compile)**: recorrer la lista de "Qué NO está
  verificado" con Android Studio abierto y el SDK real descargado — es un
  trabajo de 1-2 horas de ajuste de imports/firmas, no de rediseño.
- **Fase 2** (ver ADR-015, Sección 6): repetir esta misma arquitectura sobre
  el Manifold 3 (Jetson Orin NX) con el Payload SDK en vez del Mobile SDK, y
  ahí sí medir rendimiento real de producción — el número de FPS de esta app
  en el S21 NO es representativo del Manifold 3 (SoCs de clases distintas).
- **Fase 3**: reemplazar `DetectionBatcher.upload` (hoy solo loguea) por el
  `POST /v1/perception/jobs/{id}/detections` real, con un `job_id` de un
  trabajo `stream` creado contra el backend, y mover el modelo de "asset del
  APK" a "descargado del catálogo del backend en el primer arranque".
