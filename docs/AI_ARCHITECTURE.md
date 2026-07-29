# OLO_IA - ARQUITECTURA DE IA

## 1. INTRODUCCIÓN

Este documento define la arquitectura del subsistema de Inteligencia Artificial de OLO_IA. El diseño es agnóstico al motor de IA: YOLO es la primera implementación, pero la arquitectura soporta cualquier motor presente o futuro sin modificar el core.

### 1.1 Principio Fundamental

> La plataforma NO está acoplada a YOLO. YOLO es un motor más que implementa una interfaz estándar.

---

## 2. ARQUITECTURA DE MOTORES

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI ENGINE ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              APPLICATION LAYER (Use Cases)                  │ │
│  │  • RunInference • TrainModel • ManageDataset • DeployModel │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │                                  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              ENGINE INTERFACE (Puerto)                       │ │
│  │                                                             │ │
│  │  class IInferenceEngine(Protocol):                          │ │
│  │      def predict(image, config) → List[Detection]           │ │
│  │      def predict_batch(images, config) → List[Results]      │ │
│  │      def get_model_info() → ModelInfo                       │ │
│  │      def health_check() → HealthStatus                      │ │
│  │                                                             │ │
│  │  class ITrainingEngine(Protocol):                           │ │
│  │      def train(dataset, config, callbacks) → TrainResult    │ │
│  │      def evaluate(model, dataset) → Metrics                 │ │
│  │      def export(model, format) → ExportedModel              │ │
│  │                                                             │ │
│  └───────────┬────────────┬────────────┬────────────┬─────────┘ │
│              │            │            │            │            │
│      ┌───────┴──┐  ┌─────┴────┐  ┌───┴─────┐  ┌──┴────────┐  │
│      │  YOLO    │  │ Grounding│  │  SAM    │  │ Detectron2│  │
│      │  Engine  │  │  DINO    │  │  Engine │  │  Engine   │  │
│      ├──────────┤  ├──────────┤  ├─────────┤  ├───────────┤  │
│      │Ultralytics│ │GroundDINO│  │SegmentAM│  │Detectron2 │  │
│      │ v8/v9/v11│ │          │  │         │  │           │  │
│      └──────────┘  └──────────┘  └─────────┘  └───────────┘  │
│                                                                  │
│      ┌───────────┐  ┌───────────┐  ┌───────────┐              │
│      │ TensorRT  │  │ OpenVINO  │  │  Custom   │              │
│      │ Runtime   │  │ Runtime   │  │  Engine   │              │
│      └───────────┘  └───────────┘  └───────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. INTERFACES DEL MOTOR DE IA

### 3.1 IInferenceEngine

```python
class IInferenceEngine(Protocol):
    """Interface que todo motor de inferencia debe implementar."""
    
    @property
    def engine_type(self) -> str:
        """Identificador del tipo de motor (yolo, grounding_dino, etc.)"""
        ...
    
    @property
    def supported_tasks(self) -> List[AITask]:
        """Tareas soportadas (detection, segmentation, classification)."""
        ...
    
    async def load_model(self, model_path: str, config: Dict) -> None:
        """Cargar modelo en memoria/GPU."""
        ...
    
    async def unload_model(self) -> None:
        """Liberar modelo de memoria."""
        ...
    
    async def predict(
        self, image: np.ndarray, config: InferenceConfig
    ) -> InferenceResult:
        """Ejecutar inferencia en una imagen."""
        ...
    
    async def predict_batch(
        self, images: List[np.ndarray], config: InferenceConfig
    ) -> List[InferenceResult]:
        """Ejecutar inferencia en batch."""
        ...
    
    async def health_check(self) -> HealthStatus:
        """Verificar que el motor está operativo."""
        ...
    
    def get_model_info(self) -> ModelInfo:
        """Información del modelo cargado."""
        ...
```

### 3.2 ITrainingEngine

```python
class ITrainingEngine(Protocol):
    """Interface para motores que soportan entrenamiento."""
    
    async def train(
        self,
        dataset_path: str,
        config: TrainingConfig,
        callbacks: TrainingCallbacks,
    ) -> TrainingResult:
        """Ejecutar entrenamiento."""
        ...
    
    async def evaluate(
        self, model_path: str, dataset_path: str
    ) -> EvaluationMetrics:
        """Evaluar modelo contra dataset."""
        ...
    
    async def export(
        self, model_path: str, format: ExportFormat
    ) -> str:
        """Exportar modelo a formato optimizado."""
        ...
    
    def get_default_config(self) -> TrainingConfig:
        """Configuración default para entrenamiento."""
        ...
    
    def validate_config(self, config: TrainingConfig) -> ValidationResult:
        """Validar configuración de entrenamiento."""
        ...
```

---

## 4. IMPLEMENTACIÓN YOLO

### 4.1 YOLOInferenceEngine

```python
class YOLOInferenceEngine(IInferenceEngine):
    """Implementación del motor de inferencia usando Ultralytics YOLO."""
    
    def __init__(self):
        self._model: Optional[YOLO] = None
        self._model_info: Optional[ModelInfo] = None
    
    @property
    def engine_type(self) -> str:
        return "yolo"
    
    @property
    def supported_tasks(self) -> List[AITask]:
        return [AITask.DETECTION, AITask.SEGMENTATION, AITask.CLASSIFICATION]
    
    async def load_model(self, model_path: str, config: Dict) -> None:
        self._model = YOLO(model_path)
        self._model_info = ModelInfo(
            engine="yolo",
            architecture=self._model.model.yaml.get("model_type", "unknown"),
            classes=self._model.names,
            input_size=config.get("imgsz", 640),
        )
    
    async def predict(
        self, image: np.ndarray, config: InferenceConfig
    ) -> InferenceResult:
        results = self._model.predict(
            source=image,
            conf=config.confidence_threshold,
            iou=config.iou_threshold,
            max_det=config.max_detections,
            classes=config.target_class_ids,
            verbose=False,
        )
        
        return self._parse_results(results[0])
    
    def _parse_results(self, result) -> InferenceResult:
        detections = []
        for box in result.boxes:
            detections.append(Detection(
                class_id=int(box.cls),
                class_name=result.names[int(box.cls)],
                confidence=float(box.conf),
                bbox=BoundingBox(
                    x_min=float(box.xyxy[0][0]),
                    y_min=float(box.xyxy[0][1]),
                    x_max=float(box.xyxy[0][2]),
                    y_max=float(box.xyxy[0][3]),
                ),
            ))
        
        return InferenceResult(
            detections=detections,
            inference_time_ms=result.speed.get("inference", 0),
            image_size=(result.orig_shape[1], result.orig_shape[0]),
        )
```

---

## 5. ENGINE REGISTRY

```python
class EngineRegistry:
    """Registro de motores de IA disponibles."""
    
    _engines: Dict[str, Type[IInferenceEngine]] = {}
    _training_engines: Dict[str, Type[ITrainingEngine]] = {}
    
    @classmethod
    def register(cls, engine_type: str, engine_class: Type[IInferenceEngine]):
        cls._engines[engine_type] = engine_class
    
    @classmethod
    def register_training(cls, engine_type: str, engine_class: Type[ITrainingEngine]):
        cls._training_engines[engine_type] = engine_class
    
    @classmethod
    def create_inference_engine(cls, engine_type: str) -> IInferenceEngine:
        if engine_type not in cls._engines:
            raise EngineNotFoundError(f"Engine '{engine_type}' not registered")
        return cls._engines[engine_type]()
    
    @classmethod
    def get_available_engines(cls) -> List[str]:
        return list(cls._engines.keys())

# Registro al startup de la aplicación
EngineRegistry.register("yolo", YOLOInferenceEngine)
EngineRegistry.register_training("yolo", YOLOTrainingEngine)
# Futuro:
# EngineRegistry.register("grounding_dino", GroundingDINOEngine)
# EngineRegistry.register("sam", SAMEngine)
```

---

## 6. PIPELINE DE INFERENCIA

```
┌─────────────────────────────────────────────────────────────┐
│                  INFERENCE PIPELINE                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  REQUEST ──► QUEUE ──► PREPROCESS ──► INFERENCE ──► POST     │
│                                                    │         │
│                                                    ▼         │
│                                              RESULTS         │
│                                                    │         │
│                                                    ▼         │
│                                              STORAGE         │
│                                                    │         │
│                                                    ▼         │
│                                              NOTIFY          │
│                                                              │
│  Detalle:                                                    │
│                                                              │
│  1. REQUEST: API recibe solicitud de inferencia               │
│     • Validar input (imagen/video/batch)                     │
│     • Verificar límites del tenant                           │
│     • Crear InferenceJob en DB                               │
│                                                              │
│  2. QUEUE: Encolar para procesamiento                        │
│     • Priority queue por tenant tier                         │
│     • Fair scheduling entre tenants                          │
│                                                              │
│  3. PREPROCESS: Preparar input                               │
│     • Decodificar imagen                                     │
│     • Resize si necesario                                    │
│     • Normalización                                          │
│     • Video: frame extraction                                │
│                                                              │
│  4. INFERENCE: Ejecutar modelo                               │
│     • Cargar modelo (cached in memory)                       │
│     • Ejecutar predicción                                    │
│     • Medir tiempo de inferencia                             │
│                                                              │
│  5. POSTPROCESS: Procesar resultados                         │
│     • Filtrar por confidence threshold                       │
│     • NMS (Non-Maximum Suppression)                          │
│     • Mapear class_id → product_id (si configurado)          │
│     • Mapear coordinates → location_id (si configurado)      │
│                                                              │
│  6. STORAGE: Guardar resultados                              │
│     • Imagen anotada → Supabase Storage                      │
│     • Resultados JSON → Base de datos                        │
│     • Métricas → Analytics                                   │
│                                                              │
│  7. NOTIFY: Informar al usuario                              │
│     • Supabase Realtime event                                │
│     • Webhook si configurado                                 │
│     • Email si batch completado                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. PIPELINE DE ENTRENAMIENTO

```
Dataset Ready ──► Config Validated ──► Resources Allocated
                                              │
                                              ▼
                                        Training Loop
                                         │        │
                                    Progress    Early Stop?
                                    Events         │
                                         │        ▼
                                         └──► Model Saved
                                                  │
                                                  ▼
                                            Evaluation
                                                  │
                                                  ▼
                                         Model Registered
                                                  │
                                                  ▼
                                        Ready for Deploy
```

---

## 8. GPU RESOURCE MANAGEMENT

```
┌─────────────────────────────────────────────────────────────┐
│              GPU RESOURCE MANAGEMENT                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  INFERENCE POOL                                              │
│  ├── GPU workers dedicados a inferencia                      │
│  ├── Models cached en VRAM                                   │
│  ├── Auto-scale por carga                                    │
│  └── Prioridad: Starter < Pro < Enterprise                   │
│                                                              │
│  TRAINING POOL                                               │
│  ├── GPU workers dedicados a training                        │
│  ├── Aislamiento por tenant (no compartir GPU en training)   │
│  ├── Queue con prioridad por plan                            │
│  └── Time limits configurables                               │
│                                                              │
│  MODEL CACHE                                                 │
│  ├── LRU cache de modelos cargados                           │
│  ├── Hot models: deployed, en VRAM permanente                │
│  ├── Warm models: recientes, cargados on-demand rápido       │
│  └── Cold models: en Storage, requieren load completo        │
│                                                              │
│  FALLBACK (sin GPU)                                          │
│  ├── CPU inference (degraded performance)                    │
│  ├── Smaller models auto-selected                            │
│  └── Queue más lento pero funcional                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. INTEGRACIÓN IA → INVENTARIO

### 9.1 Mapeo de Resultados

```
Detección IA              →    Dato de Inventario
─────────────                  ──────────────────
class_name: "box_A"       →    product_id (via class-product mapping)
bbox coordinates          →    location_id (via image-location mapping)
count of detections       →    quantity counted
confidence               →    reliability score
image evidence           →    evidence_url for incident
```

### 9.2 Configuración de Mapeo

```json
{
  "class_to_product_mapping": {
    "box_type_a": "product-uuid-1",
    "box_type_b": "product-uuid-2",
    "pallet_wrapped": "product-uuid-3"
  },
  "image_to_location_mapping": {
    "capture_point_01": "location-uuid-1",
    "capture_point_02": "location-uuid-2"
  },
  "confidence_threshold": 0.7,
  "auto_create_incident": true,
  "incident_threshold_percent": 10
}
```

---

## 10. MOTORES FUTUROS

| Motor | Tarea | Caso de Uso | Fase |
|-------|-------|-------------|------|
| YOLO v8/v9/v11 | Detection, Segmentation | Conteo de objetos, clasificación | 2 |
| GroundingDINO | Open-vocabulary detection | Detectar objetos sin entrenamiento previo | 3+ |
| SAM | Segmentation | Segmentación precisa de objetos | 3+ |
| Detectron2 | Detection, Segmentation | Modelos avanzados de Meta | 4 |
| TensorRT | Optimized inference | Acelerar inferencia en NVIDIA GPUs | 3 |
| OpenVINO | Optimized inference | Acelerar inferencia en Intel CPUs | 4 |
| LLMs | Document understanding | Lectura de etiquetas, OCR inteligente | 4+ |

---

## 11. MÉTRICAS Y MONITOREO DE IA

| Métrica | Cálculo | Alerta |
|---------|---------|--------|
| Inference latency p95 | Percentil 95 del tiempo | > 3s |
| Inference throughput | Images/second | < 5/s |
| Model accuracy (mAP) | Evaluación periódica | < 80% |
| GPU utilization | % VRAM usada | > 90% |
| Queue depth | Jobs esperando | > 50 |
| Error rate | Fallos / total | > 5% |
| Model drift | Accuracy vs baseline | Degradación > 5% |

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
