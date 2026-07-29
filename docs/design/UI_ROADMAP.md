# OLO IA — ROADMAP DE IMPLEMENTACIÓN VISUAL

## Fases de construcción de la capa de experiencia

---

## 1. PRINCIPIOS DEL ROADMAP

**P1 — Los cimientos antes del espectáculo.**
Tokens, materiales y reloj ambiental primero. Sin ellos, cada componente inventa su propio
lenguaje y el resultado es incoherente. La escena de login es lo último, no lo primero.

**P2 — La identidad se demuestra pronto.**
Al final de la Fase V1 debe existir **una** pantalla completa que pruebe el concepto. Si el
lenguaje no funciona en una pantalla, no funcionará en veinte.

**P3 — El rendimiento es un requisito de aceptación.**
Ninguna fase se cierra si los objetivos de FPS y bundle no se cumplen. La deuda de
rendimiento es la más caría de pagar en una interfaz con movimiento.

**P4 — Cada fase entrega valor demostrable.**
Al final de cada fase existe algo que se puede mostrar a un cliente.

**P5 — La accesibilidad es concurrente, no posterior.**
Cada componente nace con sus tests de accesibilidad. No hay "fase de accesibilidad".

### 1.1 Relación con el roadmap de producto

Esta capa visual se desarrolla **en paralelo** a las fases de producto de `ROADMAP.md`.
No las sustituye ni las reordena.

| Fase visual | Coincide con | Depende de |
|------------|--------------|-----------|
| V0 Cimientos | Fase 0 (Sprint 0.4) | Nada del backend |
| V1 Shell + prueba de concepto | Fase 0 → Fase 1 | Contratos de API definidos |
| V2 Estaciones operativas | Fase 1 | API de inventarios y admin |
| V3 Escena cinematográfica | Fase 1 (paralelo) | Nada del backend |
| V4 Gemelo digital | Fase 1 → Fase 2 | API de locations |
| V5 Inteligencia visible | Fase 2 | API de inferencia |
| V6 Percepción en vivo | Fase 3 | API de dispositivos y streaming |
| V7 Refinamiento | Continuo | — |

---

## 2. FASE V0 — CIMIENTOS (3 semanas)

> Construir el lenguaje. Ninguna pantalla de producto todavía.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V0.1 | Sistema de tokens completo | 5 archivos CSS + espejo TS. Primitivos, semánticos, materiales, tipografía, espacio |
| V0.2 | Tres temas | Deep Space, Daylight, High Contrast. Conmutables en runtime sin recompilar |
| V0.3 | Test de contraste automatizado | Recorre cada par color/fondo documentado y falla si < AA |
| V0.4 | Tailwind consumiendo tokens | `tailwind.config.ts` referenciando variables CSS |
| V0.5 | Sistema de movimiento | easing, spring, duration, stagger, variants |
| V0.6 | `AmbientClock` | Un solo rAF global, publica breath/pulse/frame |
| V0.7 | `MotionProvider` | Contexto + preferencias + modo de rendimiento |
| V0.8 | `useMotionBudget` | Control de las 24 animaciones simultáneas |
| V0.9 | `usePerformanceGuard` | Monitorización de FPS y degradación en cascada |
| V0.10 | `<Surface>` | El componente de planos Z con las 5 recetas de material |
| V0.11 | `<Halo>`, `<Veil>` | Materiales independientes |
| V0.12 | `<MeshLayer>` | Red neuronal en Canvas 2D, 5 niveles de densidad, pulsos |
| V0.13 | `<FocusContext>` | Coherencia neuronal global |
| V0.14 | Storybook configurado | Con los 3 temas, control de densidad y toggle de reduced-motion |
| V0.15 | Setup de testing visual | jest-axe + visual regression |

### Criterio de cierre

- [ ] Los 3 temas conmutan sin parpadeo ni recompilación.
- [ ] Test de contraste en verde: 100% de pares documentados cumplen AA.
- [ ] `AmbientClock` con **un solo** rAF verificado en el profiler.
- [ ] `MeshLayer` a 60 FPS con 180 nodos y 6 pulsos simultáneos.
- [ ] `<Surface>` renderiza las 5 recetas Z correctamente en los 3 temas.
- [ ] Contador de capas blur emite warning al superar 4.
- [ ] Storybook publicado y navegable.

---

## 3. FASE V1 — SHELL Y PRUEBA DE CONCEPTO (4 semanas)

> El momento de la verdad: demostrar que el concepto funciona en una pantalla real.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V1.1 | 14 primitivos | Button, Input, Select, Combobox, Textarea, Checkbox, Switch, Badge, Chip, Icon, Divider, ScrollArea, Kbd, Tooltip |
| V1.2 | 9 moléculas | MetricValue, StatusIndicator, FreshnessIndicator, Sparkline, DataField, ConfidenceBar, DeltaIndicator, Timestamp, EntityRef |
| V1.3 | `<Station>` base | Contenedor con los 7 estados, registro en el presupuesto, pausa fuera de viewport |
| V1.4 | `<AppShell>` | Composición completa del shell |
| V1.5 | `<VitalsBar>` | 32px, signos vitales, sincronizada con el reloj |
| V1.6 | `<Spine>` | Navegación por capas cognitivas, colapsable, barra de acento deslizante |
| V1.7 | `<StreamBar>` | Flujo de eventos, entrada animada, expansión a 240px |
| V1.8 | `<Canvas>` | Modos grid/immersive/focus con transiciones de layout |
| V1.9 | `<Cortex>` | Command palette con 4 clases de resultado |
| V1.10 | Overlays | Dialog, SidePanel, Drawer, Popover, ContextMenu (base Radix) |
| V1.11 | Feedback | Toast, AlertBanner, CriticalOverlay, ConfirmAction |
| V1.12 | Estados | Skeleton (con SCAN), EmptyState, ErrorState, OfflineState, LoadingScan, ProgressRing |
| V1.13 | Movimientos base | EMERGE, COUNT, SCAN, FOCUS RIPPLE, CONFIRM, ALERT INTRUSION |
| V1.14 | **Overview con datos simulados** | La pantalla de prueba de concepto: 9 estaciones, Mesh, movimiento completo |
| V1.15 | Página de login funcional | Sin escena cinematográfica todavía. Composición estática elegante |

### Criterio de cierre

- [ ] **La pantalla Overview pasa el test de silueta**: en miniatura de 100px no se
      confunde con un ERP.
- [ ] **Pasa el test de 3 metros**: el estado del sistema es legible desde lejos.
- [ ] **Pasa el test de captura estática**: un screenshot se percibe vivo.
- [ ] FPS ≥ 58 en Overview con 9 estaciones activas, en el hardware de referencia.
- [ ] Bundle inicial ≤ 180KB gzip.
- [ ] Cortex funcional con navegación completa por teclado.
- [ ] Todo el shell navegable sin ratón.
- [ ] jest-axe en verde en los 40+ componentes entregados.
- [ ] Aprobación explícita del concepto visual por el owner tras ver Overview.

> **Puerta de decisión.** Si el owner no aprueba la identidad al ver Overview, se itera el
> concepto antes de continuar. Es mucho más barato cambiar el lenguaje con 40 componentes
> que con 75 y doce pantallas.

---

## 4. FASE V2 — ESTACIONES OPERATIVAS (4 semanas)

> Conectar el lenguaje a los datos reales de Fase 1 de producto.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V2.1 | `<MetricStation>` | KPI + sparkline + delta, con COUNT y frescura |
| V2.2 | `<ChartStation>` | Contenedor de gráficos |
| V2.3 | `<FeedStation>` | Eventos en vivo con entrada animada y límite de buffer |
| V2.4 | `<TableStation>` | Virtualizada, sin zebra, densidad de luz, selección múltiple |
| V2.5 | `<AlertStation>` | Alertas agrupadas con acciones en línea |
| V2.6 | `<GaugeStation>` | Medidor radial |
| V2.7 | 8 gráficos con Visx | TimeSeries, StackedFlow, Distribution, RadialGauge, Heatmap, NetworkGraph, ConfidenceScatter, Waterfall |
| V2.8 | Alternativas accesibles de gráficos | Tabla de datos equivalente para cada uno |
| V2.9 | Vistas de administración | Countries, Companies, Warehouses, Areas, Locations |
| V2.10 | Vistas de usuarios y roles | Incluida la matriz de permisos visual |
| V2.11 | Vistas de inventario | Products, Stock, Counts, Adjustments, Incidents |
| V2.12 | Vistas de integración | Connectors, mapeo de campos, monitor de sync |
| V2.13 | Formularios en SidePanel | Sustituyen a los modales. Validación en línea |
| V2.14 | Overview con datos reales | Sustituye la simulación de V1.14 |
| V2.15 | Persistencia de layout | El usuario reordena estaciones; se guarda por usuario |

### Criterio de cierre

- [ ] Todas las vistas de Fase 1 de producto tienen interfaz completa.
- [ ] Los formularios viven en SidePanel, no en modales centrados.
- [ ] Ninguna tabla usa filas zebra ni spinners genéricos.
- [ ] TableStation a 60 FPS con 100.000 filas virtualizadas.
- [ ] Cada gráfico tiene su alternativa accesible verificada con lector de pantalla.
- [ ] Presets de layout funcionando (Operations, Intelligence, Executive).
- [ ] Cobertura de tests ≥ 70% en `design/`.

---

## 5. FASE V3 — ESCENA CINEMATOGRÁFICA (3 semanas)

> El login. Se hace ahora, no antes: requiere el lenguaje maduro y puede desarrollarse en
> paralelo a V2 sin dependencias de backend.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V3.1 | `useSceneCapability` | Detección de WebGL2, memoria, núcleos, preferencias |
| V3.2 | `<SceneStatic>` | Composición estática para reduced-motion. **Se construye primero** |
| V3.3 | `<Scene2D>` | Canvas 2D: Mesh densa + partículas + HUD. Fallback universal |
| V3.4 | Geometría procedural del almacén | Racks con InstancedMesh, pasillos, niveles. Cero texturas |
| V3.5 | `<Scene3D>` | R3F completo con iluminación volumétrica |
| V3.6 | Agentes | 3 drones + 2 AGVs sobre trayectorias Catmull-Rom, con TRACE |
| V3.7 | Shader de cono de escaneo | GLSL, coste mínimo |
| V3.8 | Partículas ambientales | 120 en login, con deriva |
| V3.9 | Timeline GSAP | La secuencia de 8 segundos, interrumpible |
| V3.10 | HUD de diagnóstico | 5 líneas con stagger de 110ms |
| V3.11 | Panel de credenciales | Emerge del centro de la escena |
| V3.12 | `<EntryTransition>` | La secuencia post-login de 1.8s: el descenso al sistema |
| V3.13 | Modo sesión recurrente | A partir de la 2ª sesión del día: 1.4s en lugar de 8s |
| V3.14 | Degradación en cascada | Verificada en los 5 escenarios |

### Criterio de cierre

- [ ] Frame time de la escena ≤ 8ms en el hardware de referencia.
- [ ] Chunk de la escena ≤ 400KB gzip.
- [ ] El campo de email es enfocable a los 800ms, **sin esperar la escena**.
- [ ] La escena es interrumpible con cualquier tecla o click.
- [ ] Los 5 niveles de degradación verificados manualmente.
- [ ] `prefers-reduced-motion` sirve `SceneStatic` sin cargar R3F ni GSAP.
- [ ] `EntryTransition` encadena con Overview sin salto perceptible.
- [ ] Modo de sesión recurrente funcionando.

> **Orden deliberado**: `SceneStatic` → `Scene2D` → `Scene3D`. Construir el fallback primero
> garantiza que existe. Si se construye al final, no se construye.

---

## 6. FASE V4 — GEMELO DIGITAL (5 semanas)

> El componente más ambicioso y el que más impresiona en demo.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V4.1 | `<Twin2D>` | Canvas 2D isométrico. **Fallback, se construye primero** |
| V4.2 | Generación de geometría desde datos | Desde `core.locations`, procedural, sin modelos |
| V4.3 | `<Twin3D>` con InstancedMesh | ~2000 racks en 1 draw call |
| V4.4 | Sistema de LOD | 4 niveles según distancia de cámara |
| V4.5 | Capas | Racks, Drones, AGVs, Routes, Heatmap, Sensors — toggleables |
| V4.6 | Presets de cámara | Top, Iso, Front, Free, con transiciones `cinematic` |
| V4.7 | Zoom semántico | 4 niveles: Network → Warehouse → Area → Location |
| V4.8 | Movimiento CAMERA | Con motion blur direccional en el push-in |
| V4.9 | Selección e Inspector | Panel contextual al seleccionar entidad |
| V4.10 | Beacons | Marcadores de alerta y foco sobre el Twin |
| V4.11 | Traces | Estelas de drones, AGVs y rutas de picking |
| V4.12 | Heatmap volumétrico | Shader GLSL sobre el layout |
| V4.13 | Scrubber temporal | Ver el estado del almacén en cualquier momento pasado |
| V4.14 | Vista de lista equivalente | Alternativa accesible con la misma información |
| V4.15 | Transición Overview ↔ Twin | Con `layoutId`, sin desmontaje |
| V4.16 | Integración con FocusContext | Enfocar en tabla resalta en Twin y viceversa |

### Criterio de cierre

- [ ] FPS ≥ 55 con 2000 racks + 8 agentes + heatmap activo.
- [ ] Draw calls ≤ 60.
- [ ] Chunk del Twin ≤ 320KB gzip.
- [ ] Transición Overview → Twin sin desmontaje verificado (mismo nodo DOM).
- [ ] Los 4 niveles de zoom semántico con transición `cinematic` de 900ms.
- [ ] Scrubber temporal reconstruyendo estado histórico correctamente.
- [ ] Vista de lista equivalente verificada con lector de pantalla.
- [ ] Degradación a `Twin2D` verificada.

---

## 7. FASE V5 — INTELIGENCIA VISIBLE (3 semanas)

> Hacer visible que el sistema piensa. Coincide con Fase 2 de producto.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V5.1 | `<InferenceStation>` | Throughput, precisión, cola, modelos activos |
| V5.2 | Movimiento PULSE completo | Eventos reales propagándose por la Mesh, 3 fases |
| V5.3 | Mesh vinculada a entidades reales | Los nodos **son** almacenes, áreas, dispositivos |
| V5.4 | Visualización de detecciones | Bounding boxes con confianza sobre imagen |
| V5.5 | Herramienta de anotación | Canvas interactivo para etiquetar datasets |
| V5.6 | Monitor de entrenamiento | Loss y mAP en vivo, con interpolación de path |
| V5.7 | Comparación de modelos | Vista lado a lado de métricas |
| V5.8 | Conos de predicción | Visualización de proyecciones con incertidumbre |
| V5.9 | Distinción medido vs inferido | Verificada en toda la aplicación |
| V5.10 | Estado `thinking` global | Toda la app acelera su respiración durante inferencia |

### Criterio de cierre

- [ ] Un evento real de inferencia se ve propagarse por la Mesh hasta su estación.
- [ ] Máximo 6 pulsos simultáneos; los excedentes se encolan sin pérdida.
- [ ] En cualquier pantalla, el usuario distingue un dato medido de uno inferido.
- [ ] La herramienta de anotación es usable con teclado.
- [ ] El estado `thinking` global cambia el ritmo de toda la aplicación.

---

## 8. FASE V6 — PERCEPCIÓN EN VIVO (4 semanas)

> Streaming, drones, dispositivos. Coincide con Fase 3 de producto.

### Entregables

| # | Entregable | Detalle |
|---|-----------|---------|
| V6.1 | `<VisionStation>` | Stream de vídeo con overlay de detecciones en tiempo real |
| V6.2 | Vista multi-cámara | Rejilla de streams simultáneos |
| V6.3 | `<FleetStation>` | Dispositivos: estado, batería, posición, salud |
| V6.4 | Planificador de misiones | Definir waypoints sobre el Twin |
| V6.5 | Telemetría en vivo | Posición del dron en el Twin en tiempo real, con TRACE |
| V6.6 | Checklist pre-vuelo | Interfaz de verificación obligatoria |
| V6.7 | `<HeatmapStation>` | Actividad por zona sobre el layout |
| V6.8 | `<TimelineStation>` | Eventos en eje temporal |
| V6.9 | Digital Twin en tiempo real | Estado sincronizado vía Supabase Realtime |
| V6.10 | Optimización de streams | Adaptación de calidad, límite de streams concurrentes |

### Criterio de cierre

- [ ] 4 streams simultáneos con overlay de IA a 60 FPS de interfaz.
- [ ] Latencia de telemetría en el Twin < 500ms.
- [ ] El planificador de misiones es usable sin ratón.
- [ ] El Twin refleja cambios de estado en tiempo real sin re-montar.

---

## 9. FASE V7 — REFINAMIENTO (continuo)

| Área | Trabajo |
|------|---------|
| Rendimiento | Perfilado continuo, optimización de los puntos calientes |
| Accesibilidad | Auditoría externa, pruebas con usuarios de lectores de pantalla |
| Densidad | Ajuste de los 3 modos según feedback de operadores reales |
| Iconografía | Completar el set propio de dominio (~30 iconos) |
| Microanimación | Los 6 Lottie de estados complejos |
| Internacionalización | Verificación de layout en ES, EN, PT |
| Personalización | Paleta de 8 acentos por tenant, validada |
| Documentación | Guía de uso del design system para nuevos desarrolladores |

---

## 10. CRONOGRAMA

```
Semana:  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26
         ─────────────────────────────────────────────────────────────────────────────
V0       ███████                                    Cimientos
V1              ██████████                          Shell + PoC        ◆ PUERTA
V2                        ██████████                Estaciones
V3                        ██████████                Escena (paralelo a V2)
V4                                  █████████████   Gemelo digital
V5                                              ██████████  Inteligencia
V6                                                      ████████████  Percepción
V7                                                                  ███████ Refinamiento
```

| Fase | Duración | Semanas | Perfil requerido |
|------|---------|---------|-----------------|
| V0 | 3 sem | 1-3 | 1 frontend senior |
| V1 | 4 sem | 4-7 | 2 frontend (1 senior) |
| V2 | 4 sem | 8-11 | 2 frontend |
| V3 | 3 sem | 8-10 | 1 frontend con experiencia en WebGL/GSAP |
| V4 | 5 sem | 12-16 | 1 frontend 3D + 1 frontend |
| V5 | 3 sem | 17-19 | 2 frontend |
| V6 | 4 sem | 20-23 | 2 frontend |
| V7 | continuo | 24+ | 1 frontend |

**Total hasta V6 completo: ~23 semanas** con un equipo de 2 frontend, uno de ellos con
experiencia en WebGL. V3 se solapa con V2 porque no comparten dependencias.

---

## 11. RIESGOS DE LA CAPA VISUAL

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| El rendimiento del Twin no alcanza 55 FPS con datos reales | Media | Alto | `Twin2D` construido primero. InstancedMesh + LOD desde el inicio. Benchmark con 2000 racks en V4.1 |
| El concepto visual no convence al owner | Media | **Crítico** | Puerta de decisión al final de V1 con Overview funcional. Iterar con 40 componentes, no con 75 |
| Falta de perfil con experiencia WebGL/GSAP | Alta | Alto | V3 y V4 requieren ese perfil. Si no existe: el fallback 2D es un entregable válido y se posterga el 3D |
| El bundle inicial supera 180KB | Media | Medio | `size-limit` en CI desde V0. Todo lo pesado con lazy loading |
| La densidad de información fatiga a operadores reales | Media | Medio | Los 3 modos de densidad. Pruebas con operadores en V2 |
| El movimiento resulta excesivo en uso prolongado | Media | Medio | Preferencia de usuario para reducir movimiento (independiente del sistema operativo) |
| `backdrop-filter` degrada en gráficos integrados | Media | Medio | Límite de 4 capas, contador en desarrollo, fallback opaco |
| Sobre-ingeniería visual retrasa las funcionalidades | Media | Alto | V0-V1 acotados a 7 semanas. Las vistas de CRUD en V2 son deliberadamente sobrias |

---

## 12. CRITERIO DE ÉXITO GLOBAL

La capa visual cumple su objetivo cuando:

- [ ] Un CTO que ve una demo de 60 segundos pregunta quién diseñó el producto.
- [ ] Un operador sin formación técnica entiende el estado del almacén en 5 segundos.
- [ ] Una captura de pantalla funciona como material comercial sin retoque.
- [ ] El producto es reconocible por su silueta, sin logo.
- [ ] Nadie lo describe como "un ERP moderno".
- [ ] 60 FPS en un portátil corporativo de gama media de hace 3 años.
- [ ] WCAG 2.1 AA completo, verificado por auditoría externa.
- [ ] Un desarrollador nuevo construye una vista nueva coherente en menos de un día usando
      solo el design system.

---

*Documento 7 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
