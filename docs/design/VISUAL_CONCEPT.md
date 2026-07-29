# OLO IA — CONCEPTO VISUAL Y ADN DEL PRODUCTO

## NWOS — Neural Warehouse Operating System

---

## 1. LA IDEA CENTRAL

> La interfaz no muestra un almacén. **Es la consciencia del almacén.**

La mayoría del software logístico presenta datos: tablas, gráficos, formularios. El dato
llega, se dibuja, se queda quieto. El usuario interpreta.

NWOS invierte esa relación. El sistema **está pensando**, y la interfaz es la ventana a ese
pensamiento. Cuando un dron detecta una discrepancia en el rack B-14, no aparece una fila
en una tabla: se enciende un nodo, viaja un pulso por la red neuronal hasta la estación de
inventario, el gemelo digital resalta la ubicación, y la predicción de impacto se recalcula
visiblemente. El usuario no lee el evento. **Lo ve propagarse.**

### 1.1 La metáfora estructural

```
        ┌─────────────────────────────────────────────────┐
        │                                                 │
        │    PERCEPCIÓN          COGNICIÓN        ACCIÓN  │
        │    ──────────          ─────────        ──────  │
        │                                                 │
        │    Drones          →   Inferencia   →   Alertas │
        │    Cámaras         →   Predicción   →   Rutas   │
        │    Sensores Edge   →   Correlación  →   Ajustes │
        │    Conectores WMS  →   Anomalías    →   Órdenes │
        │                                                 │
        │         ↓                  ↓              ↓     │
        │    ═══════════════════════════════════════════  │
        │              SISTEMA NERVIOSO VISUAL            │
        │    ═══════════════════════════════════════════  │
        │                                                 │
        └─────────────────────────────────────────────────┘
```

Toda la UI se organiza en estas tres capas cognitivas. No en "módulos". Un usuario nunca
piensa "voy al módulo de inventarios": piensa "quiero ver qué está percibiendo el sistema"
o "quiero entender por qué predijo eso".

### 1.2 Los tres estados del sistema

El sistema siempre está en uno de tres estados, y **el estado es visible sin leer texto**:

| Estado | Qué significa | Manifestación visual |
|--------|--------------|---------------------|
| **IDLE / Respirando** | Todo nominal, el sistema observa | Pulso lento (4s), red neuronal en reposo, glow tenue cian |
| **THINKING / Procesando** | Inferencia, sync o predicción en curso | Pulsos viajando por conexiones, nodos activos, partículas dirigidas |
| **ALERT / Atención** | Anomalía detectada, requiere decisión | Acento ámbar, pulso acelerado localizado, jerarquía visual reordenada |

Esto no es decoración. Es el canal de comunicación primario. Un operador debe poder entrar
a la sala, mirar la pantalla desde 3 metros, y saber el estado del almacén.

---

## 2. ADN DEL PRODUCTO

### 2.1 Los siete rasgos genéticos

Cada decisión de diseño se valida contra estos siete rasgos. Si una pantalla no expresa al
menos cuatro, está mal diseñada.

#### G1 — PROFUNDIDAD ES INFORMACIÓN

El eje Z no es estética: es jerarquía. Lo que está más cerca es más urgente, más relevante,
más accionable. Lo que está al fondo es contexto ambiental.

```
Z-0    Ambiente          Fondo vivo, gemelo digital, red neuronal    blur 24px, opacity 0.3
Z-1    Contexto          Estaciones secundarias                      blur 4px, opacity 0.7
Z-2    Trabajo           Estación activa                             sin blur, opacity 1
Z-3    Decisión          Diálogos, confirmaciones                    elevación + backdrop
Z-4    Crítico           Alertas que bloquean                        toma toda la atención
```

Nunca hay dos elementos compitiendo en el mismo plano Z. La profundidad resuelve la
ambigüedad de "¿qué miro primero?".

#### G2 — LA LUZ VIENE DEL DATO

En interfaces convencionales la luz es arbitraria (sombras hacia abajo-derecha por
convención). En NWOS **el dato emite luz**. Un KPI en buen estado tiene glow cian suave.
Uno degradándose pierde luminosidad. Una alerta irradia ámbar. La iluminación ambiental de
un panel se deriva de su contenido, no de una regla de sombreado.

Consecuencia práctica: no hay `box-shadow` genérico. Hay `--glow-nominal`, `--glow-thinking`,
`--glow-alert`, y su intensidad es una función del estado del dato.

#### G3 — TODO ESTÁ CONECTADO Y SE VE

Los paneles no son islas. Cuando el usuario enfoca una entidad (un pallet, un rack, un dron),
las conexiones a esa entidad se iluminan en todos los paneles simultáneamente. Es el
principio de **coherencia neuronal**: el sistema muestra que sabe que esos datos están
relacionados.

Implementación conceptual: un `FocusContext` global. Al hacer hover sobre el pallet #4471
en la tabla, el gemelo digital resalta su ubicación, el gráfico de rotación marca su punto,
y el panel de inferencias filtra las detecciones que lo mencionan. Sin clicks. Sin recargas.

#### G4 — MOVIMIENTO CON MASA

Nada aparece de la nada ni desaparece en el aire. Todo tiene inercia, origen y destino.
Un panel que se abre viene de algún sitio. Un dato que cambia transiciona, no salta.

Prohibido: `opacity: 0 → 1` como única transición. Es el gesto de un ERP.
Obligatorio: origen espacial + escala + blur de movimiento + easing con overshoot mínimo.

#### G5 — DENSIDAD SIN RUIDO

Público objetivo: operadores que miran la pantalla 8 horas. Necesitan **mucha** información
simultánea, sin fatiga. La solución no es reducir datos: es jerarquizar con brutal
disciplina.

- Un solo acento de color por vista (el resto es escala de grises + cian estructural).
- Tipografía monoespaciada para todo dato numérico (alineación vertical perfecta = lectura
  por patrón, no por lectura).
- Cero bordes decorativos. Los límites se expresan con cambio de luminancia o de blur.
- El espacio negativo es negro profundo, no gris. El negro no cansa.

#### G6 — TIEMPO REAL VISIBLE

El usuario debe distinguir sin esfuerzo entre: dato en vivo, dato de hace 30 segundos, y
dato histórico. Cada valor lleva su **temperatura temporal**:

| Frescura | Tratamiento |
|----------|------------|
| Live (< 2s) | Pulso sutil de fondo + indicador de latido |
| Reciente (< 60s) | Estático, luminancia plena |
| Enfriándose (< 5 min) | Luminancia -15% |
| Histórico | Luminancia -30%, sin glow |
| Stale (conexión perdida) | Desaturado + patrón diagonal tenue |

Esto elimina la clase entera de errores de "tomé una decisión con datos viejos".

#### G7 — ESCALA COMPRENSIBLE

El sistema gestiona millones de SKUs y cientos de almacenes. La interfaz debe hacer sentir
esa escala sin abrumar. Se logra con **zoom semántico**: el mismo componente muestra
distinta información según el nivel de zoom, igual que un mapa.

```
Nivel Red        →  Todos los almacenes, salud agregada, un punto por sitio
Nivel Almacén    →  Gemelo digital completo, áreas, flujo, dispositivos
Nivel Área       →  Racks, ocupación, actividad de picking
Nivel Ubicación  →  Pallets individuales, detecciones IA, historial
```

La transición entre niveles es una **cámara que se mueve**, no una navegación que recarga.

### 2.2 Los cinco anti-patrones prohibidos

| Prohibido | Por qué | Alternativa |
|-----------|---------|------------|
| **Cards con borde y sombra** | Es el lenguaje de Bootstrap/Material. Grita "aplicación web genérica" | Estaciones definidas por luminancia, glass y profundidad |
| **Spinners circulares genéricos** | No comunican nada. El usuario no sabe si falta 1s o 60s | Loaders que representan el proceso real (escaneo, inferencia, sync) |
| **Tablas con filas zebra** | Patrón de hoja de cálculo. Anti-futuro | Tablas con densidad de luz, hover que ilumina, sin rayas |
| **Iconos con relleno de color** | Estética consumer/mobile | Iconos de línea 1.5px, monocromo, el color es del estado no del icono |
| **Modales centrados con overlay negro 50%** | Interrumpe sin contexto | Paneles que emergen del punto de origen, backdrop con blur no con negro |

### 2.3 El test de identidad

Cualquier captura de pantalla de OLO IA debe pasar estas tres pruebas:

1. **Test de silueta**: en miniatura de 100px, sin leer nada, ¿se distingue de un ERP? Si
   la respuesta es no, el layout es demasiado convencional.
2. **Test de 3 metros**: desde lejos, ¿se percibe el estado del sistema (nominal / pensando
   / alerta)? Si no, la jerarquía de color falla.
3. **Test de captura estática**: en un screenshot congelado, ¿se intuye que la interfaz
   está viva? Si parece muerta, falta la evidencia visual del movimiento (trazas, glow,
   partículas en tránsito).

---

## 3. LA ESCENA DE ENTRADA (LOGIN)

No es un login. Es la secuencia de **arranque de consciencia** del sistema.

### 3.1 Guion cinematográfico

La escena dura 6-8 segundos si el usuario no interactúa, y es interrumpible en cualquier
momento (nunca bloquea el acceso).

```
T+0.0s   NEGRO ABSOLUTO
         Silencio visual total. Un punto de luz cian aparece en el centro geométrico.

T+0.6s   PRIMER LATIDO
         El punto pulsa. Del pulso emergen 6 líneas finas que se expanden radialmente.
         Son los primeros axones. Velocidad lenta, easing de desaceleración larga.

T+1.4s   LA RED SE TEJE
         Las líneas encuentran nodos. Los nodos generan nuevas líneas. En 1.2s se ha
         formado una malla neuronal que ocupa la pantalla. Densidad: ~180 nodos visibles.
         Los nodos más lejanos tienen menos opacidad y más blur (profundidad real).

T+2.6s   LA CÁMARA RETROCEDE
         Movimiento de dolly-back muy lento. La malla neuronal se revela como la
         estructura de un almacén: los nodos son ubicaciones, las líneas son rutas.
         Comienza a materializarse la geometría: racks en wireframe, pasillos, niveles.

T+4.0s   EL ALMACÉN RESPIRA
         Los racks ganan volumen (wireframe → superficie translúcida). Aparecen:
         · 3 drones en patrulla, trayectorias con estela luminosa
         · 2 AGVs desplazándose por pasillos
         · Conos de escaneo desde las cámaras fijas
         · Partículas ambientales flotando (polvo de datos)
         Todo a velocidad contemplativa. Nada tiene prisa.

T+5.2s   HUD DE DIAGNÓSTICO
         Sobre la escena aparecen, en secuencia escalonada de 80ms, indicadores técnicos
         en tipografía monoespaciada, en los márgenes:
           NEURAL MESH ......... ONLINE
           EDGE NODES .......... 47 / 47
           INFERENCE ENGINE .... READY
           DIGITAL TWIN ........ SYNCED
           TENANT CONTEXT ...... AWAITING IDENTITY
         El último es la invitación implícita a autenticarse.

T+6.4s   LA PUERTA
         El panel de credenciales emerge. No aparece: se materializa desde el centro
         de la escena con glass fuerte, como si el propio sistema lo hubiera generado.
         La escena de fondo pasa a Z-0: blur 24px, opacity 0.35, y sigue viva.

T+∞      RESPIRACIÓN PERPETUA
         La escena nunca se detiene. Loop no perceptible. Los drones siguen su ruta,
         las partículas flotan, el pulso base continúa a 4s de período.
```

### 3.2 La transición de entrada (post-autenticación)

El momento más importante de toda la experiencia. Duración: 1.8s.

```
T+0.0s   El panel de credenciales se disuelve hacia adelante (escala 1.08, blur, fade).
T+0.2s   La escena de fondo recupera foco: blur 24px → 0px, opacity 0.35 → 1.
T+0.4s   La cámara hace un push-in y desciende hacia el almacén.
T+0.9s   El almacén se transforma: la vista isométrica cinematográfica rota y se aplana
         hacia la vista operativa del gemelo digital que vivirá en el dashboard.
T+1.3s   Las estaciones del dashboard emergen desde el plano del gemelo digital,
         escalonadas por prioridad (stagger 60ms), como si el almacén las hubiera parido.
T+1.8s   Estado IDLE. El sistema respira. El usuario está dentro.
```

El usuario no siente que "cargó una página". Siente que **descendió al interior del sistema**.

### 3.3 Restricciones no negociables de la escena

| Restricción | Valor |
|-------------|-------|
| Presupuesto de GPU | La escena nunca supera 8ms de frame time |
| Presupuesto de peso | Escena completa < 400KB (geometría procedural, no modelos) |
| Fallback sin WebGL | Versión canvas 2D con la malla neuronal, sin geometría 3D |
| Fallback de bajo rendimiento | Detección automática: si FPS < 45 durante 2s, degrada a 2D |
| `prefers-reduced-motion` | Escena estática compuesta, un solo pulso lento de respiración |
| Interrumpibilidad | Cualquier tecla o click salta al panel de credenciales inmediatamente |
| Tiempo hasta interactivo | El campo de email es enfocable a T+0.8s, sin esperar la escena |

**El principio**: la escena es un regalo, nunca un peaje. Un operador que entra 40 veces al
día no puede esperar 6 segundos. A partir de la segunda sesión del día, la escena arranca
en T+5.0s (salta el tejido de la red) y dura 1.4s.

---

## 4. POSICIONAMIENTO VISUAL FRENTE A REFERENTES

Qué tomamos de cada referente y qué rechazamos explícitamente.

| Referente | Tomamos | Rechazamos |
|-----------|---------|-----------|
| **Palantir Foundry** | Densidad de datos sin caos. Grafos de relación como ciudadano de primera clase | Su frialdad institucional gris. Nosotros tenemos luz y movimiento |
| **Anduril Lattice** | La estética de mando y control. Estado del sistema legible a distancia | Su lenguaje militar/táctico. Somos corporativos, no bélicos |
| **Tesla (UI vehículo)** | Minimalismo funcional. Un solo acento. Tipografía impecable | Su plano bidimensional. Nosotros usamos profundidad |
| **Apple VisionOS** | Glass con jerarquía real. Profundidad como información. Materiales | Su calidez consumer y sus esquinas muy redondeadas |
| **Unreal Engine 5** | Iluminación volumétrica. Escala. Materiales creíbles | Su complejidad de herramienta. Somos operación, no autoría |
| **Interstellar / Tron** | Escala sobrecogedora. Silencio. Elegancia del movimiento lento | Todo lo neón saturado. Todo lo "cyberpunk de saldo" |
| **IBM Watson (era clásica)** | La idea de un sistema que razona visiblemente | Su ejecución visual, envejecida |

### 4.1 La frase que resume el posicionamiento

> Si Palantir tuviera el gusto estético de Apple y la escala visual de Unreal, y sirviera
> para operar un almacén en tiempo real: eso es OLO IA.

---

## 5. VOCABULARIO VISUAL

Nombres oficiales de los elementos del lenguaje. Se usan en código, en diseño y en
conversación.

| Término | Definición |
|---------|-----------|
| **Station** (Estación) | Unidad de información autónoma. Sustituye al concepto de "card". Tiene estado propio, respira, puede recibir foco |
| **Mesh** (Malla) | La red neuronal visual de fondo. Existe en todas las vistas con distinta intensidad |
| **Pulse** (Pulso) | Unidad de movimiento que viaja por la Mesh transportando la noción de un evento |
| **Twin** (Gemelo) | La representación espacial del almacén. Puede estar en cualquier nivel de zoom |
| **Trace** (Traza) | Estela luminosa que deja un objeto en movimiento (dron, AGV, ruta de picking) |
| **Halo** | El glow que rodea un elemento y codifica su estado |
| **Veil** (Velo) | Capa de glass + blur que separa planos Z |
| **Beacon** (Faro) | Marcador de atención sobre el Twin. Ámbar para alerta, cian para foco |
| **Cortex** | La barra de comando global (command palette). Es el punto de entrada a todo |
| **Vitals** | La franja de indicadores de salud del sistema, siempre visible |
| **Scan** | Animación de barrido que representa procesamiento en curso sobre una región |

---

## 6. CRITERIO DE ÉXITO DEL CONCEPTO

El concepto está bien ejecutado cuando:

- [ ] Un CTO que ve una demo de 60 segundos pregunta quién diseñó el producto.
- [ ] Un operador de 55 años sin formación técnica entiende el estado del almacén en 5s.
- [ ] Una captura de pantalla funciona como material de venta sin retoque.
- [ ] El producto es reconocible por su silueta, sin logo.
- [ ] Nadie lo describe nunca como "un ERP moderno".
- [ ] Corre a 60 FPS en un portátil corporativo de gama media de hace 3 años.
- [ ] Pasa WCAG 2.1 AA completo, incluido el modo de movimiento reducido.

---

*Documento 1 de 7 del sistema de diseño de OLO IA.*
*Versión: 1.0*
