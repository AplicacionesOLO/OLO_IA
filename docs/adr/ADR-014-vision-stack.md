# ADR-014 · Pila de visión artificial y licencias

| | |
|---|---|
| **Estado** | **Aprobado.** RF-DETR como detector de producción. Cero licencias de pago. |
| **Fecha** | 2026-07-31 |
| **Contexto** | 74 migraciones aplicadas. 16 arquitecturas y 6 frameworks en `ai.architectures` / `ai.frameworks` desde 0035-0036. Anotador y export YOLO operativos. 17 imágenes subidas, 32 anotaciones, 0 modelos entrenados. |
| **Decide** | Qué detector se entrena y se sirve, con qué licencia, y qué modelos auxiliares lo acompañan |
| **No decide** | Dónde corre la inferencia (servicio aparte, borde, nube). Hiperparámetros. Contrato del servicio de percepción |

---

## 1. El hecho que reordena la decisión

**Ultralytics YOLO Free y Enterprise son el mismo repositorio, el mismo código y los mismos pesos.**

La licencia Enterprise no entrega un modelo más preciso ni actualizaciones distintas: entrega el **derecho legal** de mantener el código cerrado mientras se sirve por red, más soporte y documentación de cumplimiento.

Por tanto la pregunta nunca fue «¿cuál rinde más?». Fue: *¿aceptamos una obligación de copyleft de red, la compramos, o la evitamos?*

## 2. Por qué la AGPL-3.0 es incompatible con este producto

YOLO11 y YOLO26 son **AGPL-3.0**. Su cláusula §13 obliga a entregar el código fuente de la **obra completa** a cualquier usuario que interactúe con el software a través de una red.

OLO_IA es un SaaS multi-tenant. Cada tenant es un usuario remoto. La obligación alcanzaría al backend, al frontend y a la lógica de reconciliación — es decir, al producto entero.

Dos matices que suelen sorprender y que conviene dejar escritos:

- importar `ultralytics` en el backend lo convierte en obra derivada; ejecutarlo como proceso aparte es terreno gris y con acoplamiento estrecho muchos abogados lo tratan igual;
- **Ultralytics sostiene que la AGPL alcanza también a los pesos entrenados con su código.** Es discutible jurídicamente, pero es su posición declarada y es el riesgo que cuenta.

El precio de Enterprise no es público. Terceros reportan del orden de 4.500–5.000 USD/año, sin confirmación oficial.

## 3. Por qué NO se compra la licencia

Aunque el presupuesto lo permita:

1. **Se paga por quitar una restricción evitable.** Existen detectores de la misma clase de precisión bajo Apache 2.0.
2. **Es un coste fijo recurrente que escala con el negocio**, no con el valor entregado.
3. **El dinero rinde diez veces más en anotación.** Pasar de 15 a 400 imágenes anotadas mueve la precisión decenas de puntos; cambiar de arquitectura la mueve dos. Con 5.000 USD se contrata a alguien tres semanas anotando.

## 4. «De pago» no es un control de seguridad

Se evaluó el argumento de que un producto pagado ofrecería actualizaciones más seguras. **El dato lo desmiente.**

En **diciembre de 2024 el paquete `ultralytics` de PyPI fue comprometido**: las versiones 8.3.41 y 8.3.42 —y después 8.3.45 y 8.3.46, publicadas directamente saltándose CI— distribuyeron un minero XMRig. Vector: inyección de script en GitHub Actions a través del nombre de rama de un *pull request*. Miles de máquinas afectadas.

Es el paquete de visión más popular y mejor financiado del mundo. La conclusión no es que Ultralytics sea inseguro, sino que **la popularidad y el precio no son controles**: el atacante va donde hay descargas.

**Dónde está el riesgo real, idéntico en todas las opciones:**

- todas son paquetes de PyPI con dependencias transitivas;
- **los pesos `.pt` son *pickles* de PyTorch y cargarlos ejecuta código.** Es el riesgo más subestimado del campo.

**Lo que sí mitiga, y no lo da ninguna licencia:** versiones fijadas con hash, espejo propio de PyPI, SBOM, escaneo en CI, y pesos guardados en almacenamiento propio en lugar de descargados en cada despliegue.

**Dos controles ya están en la arquitectura:** los pesos entran como asset `kind=weights` en el bucket privado `ai-assets`, y el entrenamiento ocurre **fuera** del backend — así que un entorno de entrenamiento comprometido no alcanza la base de datos ni los datos de ningún tenant.

## 5. La pila

| capa | elección | licencia | motivo |
|---|---|---|---|
| **Detector de producción** | **RF-DETR** | Apache 2.0 | Código **y pesos** permisivos. Familia nano→large: `nano` en el borde, `large` para reverificar dudosos. Sin NMS, exporta limpio a ONNX |
| **Lectura de código** | **OpenCV** primario, **ZXing** segundo intento | Apache 2.0 | Fallan de forma distinta; un segundo decodificador sobre el mismo recorte recupera un porcentaje real a coste casi nulo |
| **Respaldo OCR** | **PaddleOCR** | Apache 2.0 | Ligero y específico de texto |
| **Despliegue** | **ONNX Runtime → TensorRT** | Apache 2.0 / propietario NVIDIA (gratis) | Ver §6 |
| **Preanotación, fuera de línea** | **Grounding DINO** + **SAM 2** | Apache 2.0 | Solo para generar datos de entrenamiento. **Nunca en la ruta de producción** |
| **Calidad de datos** | **CLIP** | MIT | Duplicados, fotos inservibles y *active learning* |

**Coste total de licencias: 0.**

### 5.1 Un detector, no dos

Se rechaza explícitamente ofrecer «plano con YOLO» y «plano con RF-DETR» como escalones de precio:

- el comprador no puede evaluar ni valora la marca del modelo — le importan discrepancias encontradas y tiempo de inventario;
- obliga a mantener dos pipelines de entrenamiento, inferencia, métricas y modos de fallo;
- la licencia es coste fijo de la empresa, no por cliente: poca adopción se come el coste, mucha adopción encarece la mejor función;
- si el plano barato rinde igual, se cobra más por algo que no es mejor, y es indefendible ante el primer cliente técnico.

**El precio escalona por lo que el cliente percibe:** ubicaciones escaneadas, frecuencia, número de sitios y drones, retención del histórico, integración con su WMS, SLA de reporte.

### 5.2 Corrección sobre Florence-2

En una evaluación previa se propuso **Florence-2** como respaldo OCR. **Se descarta para la ruta caliente:** son ~920 MB y es un modelo visión-lenguaje; con millones de fotogramas al mes el coste de cómputo es insostenible. **PaddleOCR** hace el trabajo con una fracción del gasto. Florence-2 queda para lotes fuera de línea, si acaso.

### 5.3 Trampa de licencia dentro del propio catálogo

`ai.architectures` tiene **`rtdetr-l` con `framework_code = 'ultralytics'`**. Es la RT-DETR **empaquetada por Ultralytics**, y por tanto **AGPL-3.0**. La implementación original de sus autores es Apache 2.0.

**Misma arquitectura, licencia distinta según el repositorio de origen.** Si se adopta RT-DETR, tiene que ser la original.

## 6. A escala, la inferencia ES el margen bruto

Un almacén son 29.312 ubicaciones. Diez tenants con escaneo diario son ~300.000 inferencias al día.

Dos puntos de mAP no mueven la factura de cómputo. **Un modelo dos veces más rápido la parte por la mitad, para siempre.** Por eso `ONNX → TensorRT` no es un detalle de despliegue: es la partida de gasto más grande del negocio y la palanca de margen más rentable.

## 7. El foso no es el modelo: son los datos

El sistema genera **etiquetas confirmadas sin coste humano**: cada vez que una lectura de QR coincide con lo que declara el WMS, hay un ejemplo verificado. Con millones de escaneos eso es un volante de datos que la competencia no publica tener.

Ahí `CLIP` y el *active learning* deciden qué fracción de las capturas merece revisión humana, que es lo que mantiene el coste de anotación **sublineal** respecto al volumen.

## 8. Lo que este ADR NO permite hacer

- **entrenar dentro del backend.** `ai.model_versions.weights_asset_id` es NOT NULL y el modelo de datos dice que una versión de modelo **se registra con sus pesos**. Entrenar en una petición HTTP bloquearía un worker durante horas y moriría con el primer redespliegue;
- **poner un modelo visión-lenguaje en la ruta de producción**;
- **usar pesos de ultralytics** en ninguna ruta que se sirva a un tenant.

## 9. Consecuencias abiertas

| pendiente | qué exige |
|---|---|
| Servicio de percepción | Decidir dónde corre la inferencia y su contrato. No existe |
| Registro de pesos | `ai.model_versions` no tiene endpoints |
| Seguimiento de entrenamientos | No hay tabla de runs ni de métricas. Requiere migración |
| Cadena de suministro | `lockfile` con hashes y espejo de PyPI, antes del primer cliente |
| Preanotación | Ruta que escriba anotaciones con `origin='model'` y su confianza. El campo existe desde 0030 |

## 10. Revisión

Se revisa si ocurre alguna de estas tres cosas:

1. una medición sobre ≥400 imágenes propias muestra una diferencia de precisión **superior a 5 puntos de mAP** a favor de otra arquitectura;
2. RF-DETR cambia de licencia o deja de mantenerse;
3. un cliente exige por contrato un proveedor concreto — en ese caso se vende cumplimiento, no precisión, y se factura aparte.

---

## Referencias

- Ultralytics, planes y licencias — https://www.ultralytics.com/pricing · https://www.ultralytics.com/license
- Análisis del ataque a la cadena de suministro — https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/
- Wiz, análisis del compromiso — https://www.wiz.io/blog/ultralytics-ai-library-hacked-via-github-for-cryptomining
- RF-DETR, licencia y comparativas — https://roboflow.com/compare/rf-detr-vs-yolo11
- Alternativas a Ultralytics, licencias — https://www.lightly.ai/blog/best-ultralytics-alternatives-in-2026
