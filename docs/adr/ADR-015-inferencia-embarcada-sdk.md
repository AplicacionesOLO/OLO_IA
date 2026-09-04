# ADR-015 · Inferencia embarcada: módulo SDK para dron, como segundo nivel de producto

| | |
|---|---|
| **Estado** | **Borrador para discusión.** Arquitectura + plan de validación por fases. **Fase 0 completa y medida (2026-09-03, Sección 6bis)** — Fases 1-3 sin empezar. |
| **Fecha** | 2026-08-27 (actualizado 2026-09-03 con resultados de Fase 0) |
| **Contexto** | ADR-014 fijó el detector (RF-DETR, Apache 2.0) y dijo explícitamente que NO decidía «dónde corre la inferencia (servicio aparte, borde, nube)». Esta ADR es esa pregunta, motivada por: (1) el diagnóstico de esta semana de por qué el pipeline actual no lee ciertas etiquetas (`docs/adr/ADR-014-vision-stack.md`, y la sesión de depuración de `qr_ubicacion`/`qr_pallet` en `perception.detections`), y (2) la pregunta del cliente de si vale la pena un módulo de IA embarcada en el dron en vez de subir el video entero. |
| **Decide** | Si construimos un segundo nivel de producto (inferencia a bordo) además del actual (video completo a la nube), y con qué arquitectura y plan de validación. |
| **No decide** | Compromiso de fecha ni de presupuesto. Cuál payload compra cada cliente. Si se cobra aparte. |

---

## 1. La pregunta que el cliente hizo, reformulada

La pregunta original fue «¿migramos la IA al dron?». La reformulación correcta, y la que esta ADR responde, es otra: **¿ofrecemos un segundo nivel de producto — detección en vivo a bordo — sin apagar el nivel actual (video completo por lote)?**

La respuesta corta: **sí es viable como los dos niveles conviviendo**, no como reemplazo. El nivel por lote sigue siendo necesario aunque exista el nivel embarcado: es donde vive el reentrenamiento, la auditoría completa y la reconciliación contra el WMS, y es el único nivel que no exige hardware adicional al cliente.

## 2. Lo que la inferencia embarcada NO resuelve

Antes de diseñar nada: mover el modelo al dron **no arregla el problema que diagnosticamos esta semana**. El desenfoque de movimiento, los módulos de QR por debajo de resolución decodificable y la fuente que EasyOCR no lee son problemas de **óptica y distancia de vuelo**, idénticos corran donde corran. Un modelo a bordo ve los mismos píxeles que el mismo modelo en la nube. Lo que sí cambia es la **latencia** (alerta en vuelo en vez de en el reporte posterior) y el **volumen de subida** (resultados livianos en vez de 700 MB de video). Ese es el problema real que este segundo nivel resuelve, y hay que venderlo como eso — no como «lee mejor».

## 3. Dos caminos de hardware, y no son intercambiables

La investigación (con fuentes) encontró dos rutas completamente distintas bajo el nombre «IA en el dron», y confundirlas invalida cualquier conclusión de precisión:

### 3.1 · Producción real: PSDK + Manifold 3

El **Payload SDK** de DJI sí da acceso al video crudo de la cámara (`DjiLiveview_StartH264Stream`), pero para la serie Matrice 4 (M4/M4D/M4T) y M400 **exige el Manifold 3** conectado por USB — no es opcional para esta gama.

El **Manifold 3** es el computador de a bordo oficial de DJI: **NVIDIA Jetson Orin NX, 100 TOPS INT8, 16 GB RAM**, compatible explícitamente con Matrice 400 / M4D / M4 Series, soporta Onboard SDK v5.0 y Payload SDK v3.6. Precio confirmado: **1.799 USD** ([DSLRPros](https://www.dslrpros.com/products/dji-manifold-3)). Es la evolución del Manifold 2-G (Jetson TX2) — DJI ya vende esta línea de producto hace años, no es experimental.

**Esto cambia la pregunta de negocio**: el nivel embarcado no exige que OLO_IA invente hardware. Es «Matrice 4T + Manifold 3 (+1.799 USD)», con DJI resolviendo la integración de bajo nivel. Nuestro trabajo es el modelo y el software que corre encima, no el compute.

### 3.2 · Prototipo de validación: MSDK + Samsung S21

El **Mobile SDK** expone el feed H264 decodificado a una app corriendo en el control remoto/teléfono, pensado explícitamente por DJI para «computer vision casi en tiempo real» en el dispositivo móvil. Es el camino que el S21 rooteado puede probar hoy, sin comprar nada.

**Lo que el S21 SÍ valida** (transferible al Manifold 3 sin reservas):
- la integración real con el SDK de DJI;
- la arquitectura de la app (recepción del feed, cola, sincronización con la nube);
- el patrón de software de inferencia + empaquetado de resultados.

**Lo que el S21 NO valida** (no transferible):
- **rendimiento del modelo**: el Manifold 3 (Jetson Orin NX, 100 TOPS) y el SoC de un S21 son familias de cómputo distintas; un número de latencia en uno no predice el otro;
- **tasa de lectura**: el M4T trae cámara de **48 MP gran angular + zoom híbrido de hasta 128x (7x óptico)**, la cámara que precisamente resuelve el problema de resolución que diagnosticamos la semana pasada. El S21 no tiene nada parecido. Un resultado de lectura bueno o malo en el S21 no dice nada sobre el M4T.

**Conclusión operativa**: el S21 es un prototipo de **arquitectura de software**, no un banco de pruebas de precisión. Cualquier métrica de «tasa de lectura» que salga de él debe presentarse como tal, nunca como proyección del producto real.

## 4. Qué se comparte entre los dos niveles, y qué no

El error de diseño más fácil de cometer aquí es tratar el nivel embarcado como un pipeline paralelo que hay que mantener por separado. No lo es, si se traza bien el corte:

- **El borde solo produce el mismo contrato de detección que ya produce `_analizar()` hoy** (`class_name`, `bbox`, `confidence`, `text_value`) — el resto del sistema (reconciliación contra el WMS, `es_codigo_de_ubicacion`, el puente a `inventory.readings`, las incidencias) no cambia una línea. El borde es un PRODUCTOR nuevo del mismo contrato, no un sistema nuevo.
- **La sincronización sigue el patrón store-and-forward / offline-first**: encolar localmente, sincronizar cuando haya enlace, nunca depender de streaming continuo para que el sistema funcione. Con cola acotada y descarte del fotograma más viejo bajo presión — que es **exactamente** el patrón que `backend/tools/inferir.py::_procesar_directo` ya implementa para directos hoy. No hay que inventar el patrón de sincronización: hay que generalizar el que ya existe.
- **El respaldo de vision que se acaba de conectar** (`_leer_con_vision` en `inferir.py`, detrás de `--lector-vision`) sigue viviendo en la nube: el borde manda el crop cuando QR+OCR fallan y la confianza es baja, la nube decide si vale la pena gastar la llamada — el borde nunca necesita su propia clave de API ni su propio presupuesto de LLM.

## 5. Riesgos medidos, no supuestos

Tres hallazgos de la investigación que cambian el plan si se ignoran:

1. **No existe benchmark público de RF-DETR en NPU de teléfono.** Sí existen rutas de exportación (ONNX, TensorRT, TFLite, ExecuTorch, CoreML) y Roboflow vende las variantes Nano/Small para edge, pero la única señal de rendimiento real encontrada es una queja sin resolver de más de 1 segundo por imagen **en un Jetson Orin Nano** — hardware más potente que un teléfono ([issue #597](https://github.com/roboflow/rf-detr/issues/597)). No se puede prometer un FPS sin medirlo en el hardware real primero.
2. **La cuantización INT8 pega justo en nuestro punto débil.** Cuesta 3-7 puntos de mAP en promedio, y los modelos pequeños (los que tocaría usar en edge) son los más afectados — específicamente en la regresión de cajas pequeñas, que es exactamente el tamaño de las etiquetas que ya nos cuesta leer. Un caso documentado: YOLOv5s cayó de 0.362 a 0.054 de mAP con INT8 sin cuidado. Cuantizar para que quepa en el dispositivo puede empeorar precisamente lo que ya es frágil.
3. **PaddleOCR-mobile, no ML Kit, es el reemplazo lógico de EasyOCR en el borde** — 2-4x más rápido, sub-100ms en un núcleo de CPU. Pero ninguna fuente pública compara el caso concreto que ya nos falló esta semana (texto pequeño, grabado, brillante) contra EasyOCR. Hay que probarlo con los mismos recortes reales del diagnóstico de esta semana, no asumir que un motor más rápido lee mejor ese caso.

## 6. Plan de validación por fases

No se compromete presupuesto de desarrollo del módulo completo hasta pasar la Fase 0. El orden importa: cada fase solo tiene sentido si la anterior no descartó el camino.

- **Fase 0 — Medir, no construir** (S21, software existente). Exportar el detector actual (o la variante Nano) a ONNX/TFLite, correrlo sobre el S21 con los MISMOS recortes que fallaron esta semana (`recortes_ocr/` del diagnóstico de hoy) y medir: FPS real, uso de batería/térmica, y si PaddleOCR-mobile lee mejor o peor que EasyOCR sobre esos casos concretos. Esto responde si el camino móvil siquiera es viable antes de tocar el SDK de DJI. **✅ Hecho — resultados en la Sección 6bis.**
- **Fase 1 — Integración de software** (S21 + MSDK). Solo si la Fase 0 no descarta el camino: app Android mínima que reciba el feed vía MSDK, corra el modelo exportado, y empaquete resultados en el mismo contrato de `_analizar()`. Aquí se prueba la arquitectura de sincronización (Sección 4), no la precisión. **🔶 En curso (2026-09-03)** — proyecto escrito en `edge/s21-fase1/`, **compila** (`gradle assembleDebug` verificado con un toolchain portátil, sin Android Studio) e **instala y arranca sin crashear en un S21 real** (log limpio hasta `onInitProcess: START_TO_INITIALIZE`). Compilar de verdad encontró un hueco real en la documentación oficial de DJI: `SDKManagerCallback` tiene 7 métodos, no los 5 que documentaba la página de referencia citada — confirmado con `javap` contra el `.jar` real. **Actualización el mismo día**: se creó una app real en developer.dji.com y se confirmó el registro completo contra los servidores de DJI en el S21 (`registerApp: exito`, pantalla mostrando "MSDK registrado. Esperando dron/RC...").

**Actualización posterior (mismo día)**: sin dron/RC todavía disponible, se agregó un modo de simulación (`camera/PhoneCameraSource.kt`) que usa la cámara PROPIA del S21 (CameraX) como fuente de fotogramas alterna al feed del MSDK — alimenta el mismo `FrameProcessor`, así que prueba el pipeline completo (cámara → preprocesado → ONNX → postproceso → cajas + FPS) con video real sin depender del hardware DJI. Medido en el S21: **2,3 FPS reales**, contra 3,3 FPS en Python/Termux de la Fase 0 (~30% más lento, overhead esperable de JNI/Kotlin sobre el mismo motor de C++). También se agregó `recording/LocalRecorder.kt`: guarda evidencia de cada sesión en el almacenamiento propio de la app (fotogramas anotados con las cajas ya dibujadas + un `.jsonl` con el mismo contrato de `DetectionIn`), para poder probar en el almacén con el teléfono desconectado de cualquier PC y tener algo que revisar después — confirmado escribiendo archivos reales en el dispositivo. Esto deja la Fase 1 completa salvo por lo que solo el hardware físico puede probar: el feed de cámara REAL del dron (tamaño/formato de fotograma puede diferir del de la cámara del teléfono) y el RC/dron conectado. Detalle completo, con capturas y metodología, en `edge/s21-fase1/README.md`.

**Primera prueba de campo real (2026-09-04, almacén, teléfono desconectado de la PC)**: sesión de ~7 min caminando entre estanterías usando el modo de simulación con cámara del teléfono, sin ningún cable ni red conectada a esta PC durante la prueba — solo se recuperó el teléfono después vía USB para leer `LocalRecorder`. Resultado: 221 fotogramas procesados de punta a punta, 563 detecciones guardadas, las 5 clases del modelo aparecieron (`pallet` fue la más confiable, 0.68 de confianza promedio sobre 172 detecciones; `qr_pallet` con picos de 0.98). FPS efectivo ~1.6 mientras la cámara apuntaba a algo (coherente con el 2,3 FPS de la prueba estática), con una pausa de ~3,4 min en medio de la sesión que no afecta la medición de FPS activo. Hallazgo real: en los fotogramas tomados en movimiento (caminando) aparece desenfoque de movimiento notable, y se encontró un falso positivo (`hueco_vacio` al 31% sobre un pantalón borroso) — riesgo ya anticipado en la Sección 5, y que en el dron real se mitiga porque un vuelo estabilizado se mueve mucho menos que una mano caminando. El flujo "probar desconectado, revisar después" quedó validado end-to-end: los 68 fotogramas anotados y el `.jsonl` de detecciones se recuperaron intactos del `getExternalFilesDir` del teléfono.
- **Fase 2 — Validación en hardware real** (Manifold 3 + M4T, o alquilado/prestado si no se compra todavía). Repetir la medición de la Fase 0 en Jetson Orin NX real, y — esto es lo único que puede probar la promesa de «mejor lectura» — comparar la tasa de lectura del M4T (con su zoom real) contra el pipeline de nube actual sobre el mismo vuelo.
- **Fase 3 — Producto**: empaquetar como nivel comercial aparte, con el contrato de sincronización ya probado en las fases anteriores.

## 6bis. Fase 0 — resultados reales, medidos el 2026-09-03

Contra lo que se prometió en la Sección 5: ningún número de esta sección se asumió. Todos salieron de correr el modelo de verdad en el hardware de verdad.

**Configuración de la prueba:**
- Dispositivo: Samsung Galaxy S21 (`SM-G991B`), Android 15, arm64-v8a, rooteado, conectado por USB con depuración autorizada (el emparejamiento inalámbrico se descartó: el teléfono y la PC estaban en subredes distintas y ni el `ping` ni el TCP llegaban).
- Runtime: Termux (build `-debug`, lo que permitió automatizar todo por `adb shell run-as` sin que nadie tocara la pantalla del teléfono), `python-onnxruntime 1.29.0` instalado desde **el repositorio propio de Termux** — el paquete de PyPI no tiene wheel para esta plataforma (`pip install onnxruntime` falla con «no matching distribution»; es la incertidumbre que ya se había anotado en la Sección 5, y ahora es un hecho confirmado, no una sospecha).
- Modelo: RF-DETR Nano (`Detector de alturas v5`, el mismo que corre en producción) exportado a ONNX. La exportación se verificó **byte-exacta** contra la referencia de PyTorch/torchvision en escritorio: se reimplementó el resize bilineal de torchvision (`antialias=False`) en numpy puro porque `PIL.Image.resize` NO produce el mismo resultado (diferencia media ~0,03 sobre píxeles en [0,1] — bastante para cambiar qué detecciones cruzan el umbral); la reimplementación en numpy dio diferencia máxima **0.000000** contra la referencia.
- Imagen de prueba: `DJI_20260315145713_0030_D.JPG` (8064×4536), la misma foto ya usada en el diagnóstico de OCR de esta semana. Línea base real: **5 detecciones** sobre umbral 0,3 (2× `qr_ubicacion`, 1× `qr_pallet`, 2× `pallet`), idéntica en PyTorch y en ONNX de escritorio.

**Resultados:**

| Configuración | FPS (S21) | Detecciones (de 5) | Notas |
|---|---|---|---|
| FP32, CPU | 3,33 | **5/5**, idénticas al servidor | Línea base — funciona, pero lento |
| FP32, NNAPI | — | — | **Falla**: `ANEURALNETWORKS_BAD_DATA`. El acelerador de hardware de Android no soporta algo en el grafo de RF-DETR (sospecha: la atención deformable multi-escala, poco común fuera de arquitecturas tipo DETR) |
| FP32, XNNPACK | 1,27 | 5/5 | Corre, pero **más lento** que CPU simple — no ayuda en este modelo |
| INT8 (cuantización dinámica), CPU | **7,57** (2,3× más rápido) | **3/5** — perdió un `qr_pallet` y un `pallet`; las que sobreviven cambiaron de confianza (una pasó de 0,35 a 0,72) | Confirma con datos reales el riesgo de la Sección 5, punto 2: la cuantización pega en las cajas pequeñas, y aquí se llevó específicamente una lectura de código de pallet |
| INT8, NNAPI | — | — | Mismo error que en FP32 — cuantizar no arregla la incompatibilidad de operadores |

De contexto, el mismo modelo en la PC de escritorio (RTX 2000 Ada, CPU del servidor): FP32 a 18,7 FPS con 5/5 detecciones; INT8 a 23,3 FPS con 4/5 (pierde una detección distinta a la que pierde el S21 — la cuantización no es determinista entre builds de onnxruntime). Sirve para calibrar expectativa, no como comparación directa: es hardware de escritorio, no el Jetson Orin NX del Manifold 3.

**Veredicto de la Fase 0:**

1. **El modelo exportado es fiel** — en FP32, cero diferencia con el servidor, en cualquier hardware probado. La exportación no es el problema.
2. **El techo práctico hoy en el S21 es CPU, no el acelerador.** NNAPI no sirve para esta arquitectura tal como está exportada, y XNNPACK es peor que no usar nada. Cualquier plan que asuma «el NPU del teléfono lo hace rápido» está descartado por esta medición, no por suposición.
3. **Ni FP32 (3,3 FPS) ni INT8 (7,6 FPS) llegan a tiempo real fluido** (se necesitarían ~15-30 FPS para video en vivo sin saltos perceptibles).
4. **La cuantización dinámica no es un buen trato aquí**: la ganancia de velocidad (2,3×) cuesta una detección de código de pallet — justo el dato que el producto existe para leer. No se recomienda este camino de cuantización para producción sin antes probar cuantización estática con calibración o FP16, que quedan como experimento pendiente, no hecho todavía.
5. Esto **no cierra la Ruta C**: el Manifold 3 (Jetson Orin NX, 100 TOPS) es una clase de cómputo distinta a un SoC de teléfono de 2021, y sigue siendo la Fase 2 la que puede responder si el camino real de producción rinde. Lo que sí cierra es la promesa de «el teléfono ya prueba que funciona» — no la prueba, sirvió para descubrir un problema real (NNAPI) antes de gastar en el Manifold 3.

## 7. Agentes propuestos para ejecutar esto ordenadamente

Ver `.claude/agents/`: `edge-model-porting`, `dji-sdk-integration`, `edge-cloud-sync`, `edge-validation`. Cada uno tiene alcance y checklist propios para no mezclar la fase de medición (Sección 6) con la de integración — mezclarlas es como se pierde el rigor que esta ADR pide mantener.
