# OLO_IA - VISIÓN DEL PRODUCTO

## 1. DECLARACIÓN DE VISIÓN

OLO_IA es una plataforma SaaS empresarial de Inteligencia Artificial aplicada a operaciones logísticas. Su propósito es transformar la gestión de inventarios, el control de almacenes y los procesos logísticos mediante la integración inteligente de múltiples motores de IA, visión por computadora, drones autónomos y gemelos digitales.

OLO_IA no es una aplicación de detección de objetos. Es una plataforma integral que orquesta múltiples tecnologías de IA para resolver problemas reales de la cadena de suministro a escala global.

---

## 2. PROBLEMA QUE RESUELVE

### 2.1 Problemas del Mercado Actual

| Problema | Impacto | Solución OLO_IA |
|----------|---------|-----------------|
| Conteos de inventario manuales y lentos | Pérdidas millonarias por inexactitud | Conteo automatizado con drones + IA |
| Falta de visibilidad en tiempo real | Decisiones basadas en datos obsoletos | Streaming y procesamiento en tiempo real |
| Sistemas WMS aislados y fragmentados | Ineficiencia operativa entre almacenes | Conectores universales con mapeo inteligente |
| Imposibilidad de escalar operaciones de IA | Dependencia de soluciones puntuales | Plataforma multi-motor escalable |
| Auditorías costosas y propensas a errores | Riesgos regulatorios y financieros | Auditoría continua automatizada con trazabilidad |
| Falta de estándares entre países | Complejidad operativa multinacional | Soporte nativo multi-país, multi-moneda, multi-idioma |
| Planos y ubicaciones desactualizados | Pérdida de eficiencia en picking/putaway | Digital Twin con sincronización AutoCAD |
| Dependencia de un solo proveedor de IA | Riesgo tecnológico y vendor lock-in | Arquitectura de motores desacoplada |

### 2.2 Segmentos de Cliente Objetivo

- **Operadores logísticos 3PL/4PL**: Gestión de múltiples clientes y almacenes con requerimientos distintos.
- **Retail y distribución masiva**: Centros de distribución con alto volumen de SKUs.
- **Manufactura**: Control de materias primas, WIP e inventarios terminados.
- **Farmacéutica**: Trazabilidad estricta, cumplimiento regulatorio.
- **E-commerce**: Fulfillment centers con alta rotación.
- **Gobierno y defensa**: Almacenes estratégicos con requisitos de seguridad elevados.
- **Minería y energía**: Inventarios en ubicaciones remotas y condiciones extremas.

---

## 3. PROPUESTA DE VALOR

### 3.1 Propuesta de Valor Principal

> "Inteligencia Artificial operativa para la cadena de suministro, accesible como servicio, escalable a nivel global."

### 3.2 Diferenciadores Clave

1. **Multi-Motor de IA**: No está atada a YOLO ni a ningún motor específico. La plataforma abstrae los motores de IA permitiendo incorporar nuevas tecnologías sin impacto en los procesos de negocio.

2. **Verdadero Multi-Tenancy Empresarial**: Aislamiento total por tenant con jerarquía País → Compañía → Almacén → Área → Ubicación.

3. **Agnóstica de WMS**: Conectores configurables para cualquier sistema de gestión de almacenes existente.

4. **Digital Twin Nativo**: Representación digital del almacén físico con sincronización de planos AutoCAD/DXF/DWG.

5. **Preparada para Drones**: Arquitectura diseñada desde el inicio para gestionar flotas de drones con planificación de rutas y procesamiento de video en tiempo real.

6. **Seguridad de Grado Empresarial**: RBAC + ABAC + RLS + Auditoría completa desde el primer día.

7. **Licenciamiento Modular**: Los clientes pagan únicamente por los módulos que utilizan.

8. **Escalabilidad Horizontal**: Diseñada para crecer desde 1 almacén hasta miles sin degradación.

---

## 4. MODELO DE NEGOCIO

### 4.1 Modelo de Monetización

```
┌─────────────────────────────────────────────────────────────┐
│                    MODELO DE INGRESOS                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐  │
│  │  Suscripción    │  │  Por Consumo    │  │  Servicios │  │
│  │  Mensual/Anual  │  │  (Usage-Based)  │  │  Prof.     │  │
│  ├─────────────────┤  ├─────────────────┤  ├────────────┤  │
│  │ • Plan por      │  │ • Inferencias   │  │ • Impl.    │  │
│  │   módulos       │  │ • Storage       │  │ • Training │  │
│  │ • Usuarios      │  │ • API calls     │  │ • Custom   │  │
│  │ • Almacenes     │  │ • Video hours   │  │ • Soporte  │  │
│  │ • Tier (Basic/  │  │ • GPU compute   │  │   Premium  │  │
│  │   Pro/Enterpr.) │  │ • Bandwidth     │  │ • Consult. │  │
│  └─────────────────┘  └─────────────────┘  └────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Tiers de Servicio

| Tier | Descripción | Módulos | Límites |
|------|-------------|---------|---------|
| **Starter** | Pequeñas operaciones | Dashboard, Inventarios, Usuarios básicos | 1 almacén, 5 usuarios, 1 modelo IA |
| **Professional** | Operaciones medianas | Starter + IA avanzada, Integraciones, Reportes | 5 almacenes, 25 usuarios, 3 modelos IA |
| **Enterprise** | Grandes corporaciones | Todos los módulos | Ilimitado, SLA garantizado, soporte dedicado |
| **Custom** | Necesidades especiales | Selección a medida | Negociado individualmente |

### 4.3 Modelo de Precios por Módulo

Cada módulo tendrá un precio base que se suma al plan del tenant:

- **Módulos Core** (incluidos en todos los planes): Dashboard, Administración, Usuarios, Roles.
- **Módulos Standard** (incluidos desde Professional): Inventarios, Ubicaciones, Reportes, Logs.
- **Módulos Premium** (addon o Enterprise): IA, Drones, Digital Twin, Integraciones WMS, Developer Center.
- **Módulos Custom** (negociados): Conectores personalizados, modelos IA propios, on-premise deployment.

---

## 5. POSICIONAMIENTO EN EL MERCADO

### 5.1 Mapa Competitivo

```
                    Alta Especialización IA
                           ▲
                           │
                           │         ★ OLO_IA
                           │        (target position)
                           │
    Solución Puntual ◄─────┼─────► Plataforma Integral
                           │
                           │
              Zebra/Cognex │    SAP EWM
                           │
                           │
                    Baja Especialización IA
```

### 5.2 Competidores y Diferenciación

| Competidor | Fortaleza | Debilidad vs OLO_IA |
|------------|-----------|---------------------|
| SAP EWM | Ecosistema empresarial | Sin IA nativa, caro, rígido |
| Zebra Technologies | Hardware + software | Dependiente de hardware propio |
| 6 River Systems | Robótica | Solo robótica, sin visión IA amplia |
| Locus Robotics | AMR | No cubre inventario completo |
| Gather AI | Drones para inventario | Solo drones, sin plataforma integral |
| Vimaan | Visión para warehousing | Solución puntual, no multi-tenant SaaS |

### 5.3 Ventaja Competitiva Sostenible

1. **Efecto de Red de Datos**: Más clientes → Más datos de entrenamiento → Mejores modelos → Mejor producto.
2. **Ecosistema de Conectores**: Cada nueva integración WMS beneficia a todos los clientes.
3. **Abstracción de IA**: Capacidad de incorporar el mejor motor disponible en cada momento.
4. **Conocimiento de Dominio**: Los modelos entrenados en operaciones logísticas reales son difíciles de replicar.

---

## 6. VISIÓN TÉCNICA

### 6.1 Principios Arquitectónicos

1. **Cloud-Native First**: Diseñada para la nube desde el primer día, pero con posibilidad de deployment on-premise.
2. **API-First**: Toda funcionalidad accesible vía API antes que vía UI.
3. **Event-Driven**: Comunicación por eventos para desacoplamiento y escalabilidad.
4. **Security by Design**: Seguridad integrada en cada capa, no añadida después.
5. **Observable**: Métricas, logs y trazas distribuidas desde el inicio.
6. **Modular**: Cada módulo es independiente y puede evolucionar sin afectar otros.
7. **Progressive Enhancement**: Funcionalidad básica siempre disponible, features avanzados opcionales.

### 6.2 Stack Tecnológico Seleccionado

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│  React + TypeScript + Vite + Tailwind + Zustand         │
│  React Query + React Router                             │
├─────────────────────────────────────────────────────────┤
│                      BACKEND                             │
│  Python + FastAPI + Pydantic + SQLAlchemy + Alembic     │
├─────────────────────────────────────────────────────────┤
│                      AI ENGINES                          │
│  RF-DETR + PaddleOCR + OpenCV + PyTorch                 │
│  (Extensible: GroundingDINO, SAM, TensorRT, etc.)       │
├─────────────────────────────────────────────────────────┤
│                      PLATFORM                            │
│  Supabase (PostgreSQL + Auth + Storage + Realtime)      │
├─────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                      │
│  Docker + Kubernetes + CI/CD                            │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Razón de Cada Elección

| Tecnología | Razón |
|------------|-------|
| React + TypeScript | Ecosistema maduro, tipado estricto, pool de talento amplio |
| Vite | Build rápido, HMR instantáneo, mejor DX |
| Tailwind | Consistencia visual, productividad, sistema de diseño |
| Zustand | Estado global ligero, sin boilerplate |
| React Query | Cache, sincronización servidor, optimistic updates |
| Python + FastAPI | Ecosistema IA nativo, async, alto rendimiento, tipado |
| Pydantic | Validación robusta, serialización, documentación auto |
| SQLAlchemy | ORM maduro, flexible, soporte multi-DB |
| Alembic | Migraciones versionadas, reproducibles |
| Supabase | PostgreSQL managed, Auth integrado, Realtime, Storage, RLS nativo |
| Docker | Reproducibilidad, aislamiento, CI/CD |
| Kubernetes | Orquestación, auto-scaling, self-healing |

---

## 7. VISIÓN A LARGO PLAZO (5 AÑOS)

### Año 1: Fundación
- Plataforma core multi-tenant operativa.
- Módulos de administración, inventarios y IA (RF-DETR).
- Primeros clientes piloto.
- 1-3 conectores WMS.

### Año 2: Expansión
- Módulo de drones completo.
- Digital Twin básico.
- Marketplace de conectores.
- 10+ clientes activos.
- Expansión a 3+ países.

### Año 3: Inteligencia
- Múltiples motores de IA integrados.
- Predicción de demanda con ML.
- Optimización de rutas de picking.
- Analytics avanzados.
- 50+ clientes.

### Año 4: Ecosistema
- Developer Center con SDK público.
- Marketplace de plugins.
- Partner program.
- Certificaciones.
- 200+ clientes.

### Año 5: Liderazgo
- Estándar de la industria en IA logística.
- Presencia global.
- IPO o exit strategy.
- 1000+ clientes.
- Múltiples verticales.

---

## 8. MÉTRICAS DE ÉXITO

### 8.1 Métricas de Producto

| Métrica | Objetivo Año 1 | Objetivo Año 3 |
|---------|----------------|----------------|
| Uptime | 99.5% | 99.99% |
| Latencia API (p95) | < 500ms | < 200ms |
| Tiempo de inferencia | < 2s | < 500ms |
| Precisión IA (mAP) | > 85% | > 95% |
| Tiempo de onboarding | < 1 semana | < 1 día |

### 8.2 Métricas de Negocio

| Métrica | Objetivo Año 1 | Objetivo Año 3 |
|---------|----------------|----------------|
| MRR | $50K | $500K |
| Clientes activos | 5 | 50 |
| Churn mensual | < 5% | < 2% |
| NPS | > 40 | > 60 |
| LTV/CAC | > 3x | > 5x |

### 8.3 Métricas de Impacto en Cliente

| Métrica | Mejora Esperada |
|---------|-----------------|
| Precisión de inventario | +30% |
| Tiempo de conteo | -70% |
| Costos operativos | -40% |
| Incidencias no detectadas | -80% |
| Tiempo de auditoría | -60% |

---

## 9. PRINCIPIOS GUÍA

1. **Excelencia sobre velocidad**: Preferir hacer bien las cosas a hacerlas rápido.
2. **Empresa desde el día uno**: Arquitectura empresarial, no MVP desechable.
3. **Datos como activo**: Todo dato generado es valioso y debe preservarse.
4. **Experiencia premium**: La UI/UX debe inspirar confianza y profesionalismo.
5. **Seguridad innegociable**: Nunca comprometer seguridad por conveniencia.
6. **Desacoplamiento radical**: Cada componente debe poder evolucionar independientemente.
7. **Documentación como producto**: La documentación es tan importante como el código.
8. **Observabilidad total**: Si no se puede medir, no se puede mejorar.

---

## 10. RESTRICCIONES Y SUPUESTOS

### 10.1 Restricciones

- El presupuesto inicial es limitado; priorizar Supabase como backend managed para reducir costos operativos.
- El equipo inicial será pequeño; la arquitectura debe permitir productividad con pocos desarrolladores.
- Supabase es la plataforma de base de datos y servicios backend (no negociable en fase 1).
- La primera implementación de IA será exclusivamente RF-DETR (pero la arquitectura no debe limitarse a
  esto). Esta restricción decía «YOLO» hasta que ADR-014 la revisó: YOLO11/YOLO26 son AGPL-3.0, una
  licencia vírica incompatible con vender el servicio sin liberar el código. RF-DETR es Apache-2.0.
  La abstracción de motores del punto 1 es lo que permitió cambiar de motor sin tocar el negocio.

### 10.2 Supuestos

- Los clientes tienen conectividad a internet estable en sus almacenes.
- Los almacenes cuentan con infraestructura eléctrica y de red básica para drones y cámaras.
- Existe demanda de mercado para IA aplicada a inventarios (validado previamente).
- Supabase puede escalar para los volúmenes esperados en los primeros 2 años.
- El marco regulatorio permite el uso de drones en interiores de almacenes en los mercados objetivo.

---

*Documento generado como parte del diseño de plataforma OLO_IA.*
*Versión: 1.0*
*Última actualización: Julio 2026*
