# Gemelo 3D del CEDI OLO — especificación técnica para recrearlo en OLO_IA (`/twin`)

> Fuente: el Simulador Proceso 3D (`C:\Simulador_Proceso_3D`, repo `AplicacionesOLO/Simulacion_Proceso_3D`,
> commit `97c6c9a`, 2026-11-12). Todas las cifras salen del código, y las del plano se calcularon
> ejecutando `buildLayout()` con los 37 andenes físicos. Unidades: **metros**, ángulos en **radianes**,
> colores en hex sRGB.
>
> Destino: `frontend/src/modules/spatial/webgl` de OLO_IA, que usa **three.js 0.185 sin React Three Fiber**.
> Este documento **no contiene secretos ni datos de clientes**.

---

## 0 · Cómo usar este documento

1. Las secciones 1 a 3 fijan el **sistema de coordenadas**, la **conversión a OLO_IA** y el **plano maestro**. Todo lo demás depende de ellas.
2. Las secciones 4 a 12 describen cada pieza con medidas, posición, color, material y técnica de dibujo.
3. La sección 13 reúne las **reglas de rendimiento**. Son obligatorias: sin ellas la escena pasa de 30 ms a 600 ms por cuadro.
4. La sección 14 propone **cómo integrarlo** en OLO_IA: archivos, capas y pruebas.
5. Los anexos traen las tablas completas de puertas, filas de racks y rutas.

**Medidas provisionales.** No existen planos del edificio. Algunas medidas son **estimadas** a partir de fotos, videos y el Excel «Mapa mezzanine N2»:

- el ancho de la columna de rack, 1,9125 m;
- el pasillo, 2,64 m;
- el tamaño de los vecinos;
- el mapeo andén físico ↔ sistema.

Cada una se marca con ⚠ y deben quedar como **constantes en un solo archivo**.

---

## 1 · Sistema de coordenadas

### 1.1 Coordenadas lógicas (las del simulador)

| Eje | Sentido | Referencias |
|---|---|---|
| `x` lógico | norte → sur, a lo largo de la pared de andenes | `xWest = −91,75` (pared norte, lado Recepción y portón norte); `xEast = +91,75` (pared sur, Zona Franca) |
| `z` lógico | frente (−) → atrás (+) | fachada frontal `FRONT_Z = −89`; pared de andenes `z = 0`; calle trasera `z = 28` |
| `y` | arriba | suelo exterior `0`; **losa interior `FLOOR_Y = 1,2`** (altura de plataforma de remolque) |

### 1.2 El espejo

El simulador dibuja todo dentro de un grupo raíz con `scale = (MIRROR_X, 1, 1)`, donde `MIRROR_X = −1`. Así, visto desde el frente, la entrada y la casetilla de despacho quedan a la izquierda, como en el sitio real.

- **x mundo = −x lógico.** z y y no cambian.
- Todo lo que tenga texto se **contra-refleja**: la malla o el plano lleva su propio `scale.x = −1`. Esto aplica a números de puerta, rótulos, letreros de racks, etiquetas QR y rótulos de vecinos. Sin eso, el texto se lee al revés.
- three.js maneja bien un determinante negativo (invierte el winding solo), así que las normales y la iluminación no necesitan ajustes.

### 1.3 Conversión a la convención de OLO_IA

`mundo.ts` de OLO_IA usa: `dominio.x → three.x`, `dominio.y → three.z`, `alto → three.y`, y el giro sobre `y` con **signo negativo** (horario visto desde arriba).

**Recomendación:** construir todo el CEDI dentro de **un** `THREE.Group` raíz con `scale.set(-1, 1, 1)` y escribir las piezas en coordenadas lógicas, igual que el simulador. Es la única forma de copiar las piezas asimétricas sin reflejarlas a mano. Las fracciones de la fachada de oficinas, el caracol, las gradas y los rótulos son asimétricas.

Con eso, un punto lógico `(xL, y, zL)` queda en three.js en `(−xL, y, zL)`. En el dominio de OLO_IA es:

```ts
// funciones puras, sin three.js (mismo criterio que mundo.ts → se prueban en vitest)
export const logicoADominio = (xL: number, zL: number) => ({ x: -xL, y: zL });
export const dominioALogico = (x: number, y: number) => ({ xL: -x, zL: y });
// un rumbo lógico θ (0 = mirando a +z, giro de three) se convierte en dominio como:
//   rotacionDominioGrados = θ·180/π   (el signo ya lo invierte el espejo + la convención −rad de mundo.ts)
```

⚠ Hay que probar esto con un test: un rack colocado por el editor de OLO_IA en el dominio (fuera del grupo reflejado) y el mismo rack del anexo B (dentro del grupo) deben coincidir. Los racks del catálogo de OLO_IA van **fuera** del grupo reflejado, porque ya vienen en el dominio. El contexto del CEDI (edificio, patio, mezzanine, oficinas) va **dentro**.

---

## 2 · Constantes maestras (`lib/layout.ts`)

```ts
export const MIRROR_X = -1;
export const DOCK_SPACING = 4.6;            // entre centros de puertas de andén
export const BUILDING_DEPTH = 89;           // frente → andenes
export const BUILDING_HEIGHT = 14;
export const FLOOR_Y = 1.2;                 // losa interior
export const DOOR_WIDTH = 3.4;              // DOCK_SPACING − 1.2
export const DOOR_HEIGHT = 3.6;             // puerta de andén: de y 1.2 a 4.8
export const CANOPY_DEPTH = 6;
export const TRUCK_LENGTH = 17;
export const DOCKED_Z = 9.1;                // centro de un camión acoplado (0.6 + 17/2)
export const APRON_DEPTH = 24;              // plataforma de concreto detrás de los andenes
export const ROAD_Z = 28, ROAD_WIDTH = 9;   // calle trasera
export const PALLET_Z0 = 33.5;              // franja de tarimas
export const FENCE_Z = 40.5;                // cerca trasera
export const FRONT_Z = -89;
export const CARPARK_DEPTH = 16;
export const BLVD_Z = -112, BLVD_WIDTH = 11;
export const NEIGHBOR_Z1 = -143.5, NEIGHBOR_DEPTH = 70;   // almacén vecino (fachada negra)
export const STAGING_DEPTH = 20;
export const CROSS_AISLE_Z = -23;           // pasillo transversal
export const RACK_Z0 = -26.5;               // LÍNEA AMARILLA: donde arrancan los racks
export const HEAVY_GATE_W = 6, HEAVY_GATE_H = 4.2;
export const HEAVY_GATE_Z = -20.1;          // portón norte (RACK_Z0 + 3.4 + 3)
export const OFFICE_W = 28, OFFICE_DEPTH = 20;
export const OFFICE_FACE_Z = -90;           // sobresale 1 m de la fachada
export const OFFICE_BACK_Z = -70;
export const MEZZ_LEVELS = [4.4, 8.0];      // sobre FLOOR_Y
export const MEZZ_WALL_Z = -0.4, MEZZ_FRONT_Z = -26.4;
export const PHYS_FIRST = 2, PHYS_LAST = 38;
```

### 2.1 Valores derivados (resueltos)

| Nombre | Valor | Fórmula |
|---|---|---|
| `length` | **183,5** | 6,9 + 36·4,6 + 2,3 + 1,2 + 6 + 1,5 |
| `xWest` / `xEast` | **−91,75 / +91,75** | ±length/2 |
| `physX(p)` | **−84,85 + (p−2)·4,6** | 02 → −84,85 … 38 → 80,75 |
| `yardRoadX` | −118,75 | calle del patio de espera (norte–sur) |
| `waitX` | −131,75 | fila de espera junto al talud |
| `embankmentX` | −137,75 | pie del talud |
| `mainGateX` | −167,75 | aguja principal |
| `streetX` | −197,75 | calle pública |
| `eastRoadX` | 105,75 | calle de salida y retorno |
| `despachoGateZ` | −95 | aguja de la casetilla de despacho |
| `officeX` | 39,53 | referencia del bloque Oficinas/Comedor |
| edificio de oficinas | x 18,53 … 46,53 (centro 32,53), z −90 … −70 | `officeSpan` |
| control de acceso | x 27,53 … 37,53, z −69,7 … −65 | pegado al fondo de oficinas |
| escritorios de despacho | x −53,85 … −46,85, z −10 … −0,4 | entre los andenes 09 y 10 |
| portón norte | (−91,75, z −20,1), vano de z −23,1 a −17,1 | al ras del suelo exterior |
| portón sur (ZF) | (87,25, z 0), con rampa | esquina sur de la pared de andenes |
| mezzanine | x −50,35 … 32,45, z −0,4 … −26,4 | andenes físicos 10 a 27 |
| taller de equipos | centro x −67,29, z −88,4; 14,4 × 14 | contra la fachada |

---

## 3 · Plano maestro del sitio

```
 z+ (atrás)
  40.5  ─────────────── cerca trasera (malla) ─────────────────────────────
  33.5     ▤ ▤  franja de pilas de tarimas  ▤ ▤ ▤
  28    ══ calle trasera (doble sentido, 9 m) ══════════════════ ◯ retorno r9 (x 105.75)
  0..24    plataforma de concreto · camiones acoplados en z 9.1
   0    ┃02 03 … puertas de andén (37) … 37 38┃▣ portón sur ZF (rampa)
        ┃ recepción (staging 20 m) / mezzanine x −50.35…32.45            ┃
  −23   ┃- - - - - - - pasillo transversal - - - - - - - - - - - - - - - ┃
  −26.5 ┃═══════ LÍNEA AMARILLA: arrancan las 38 filas de racks ═════════┃
 portón ┃ cantilever · zona a piso · racks …    [OFICINAS 28×20] …  ZF  ┃
 norte  ┃                                                                ┃
  −89   ┗━━━━━━━━━━━━━━ fachada frontal (alero) ━━━━━━━━━━━━━━━━━━━━━━━━┛
  −89…−105  parqueo en espiga · motos (extremo norte) · busetas
  −112  ══════════════ bulevar (11 m) ═══════════════════════════════════
  −143.5   almacén vecino (fachada negra)
        x−  ← talud y meseta (vecinos) · calle pública x −197.75          x+
```

**Circulación de camiones:** calle pública → aguja principal → bulevar → aguja de despacho → patio de espera (lado norte) → calle trasera → andén, en reversa. La salida va por la calle trasera de vuelta → casetilla de despacho (carril de salida) → bulevar → calle pública. Los puntos están en el anexo C.

---

## 4 · Terreno, calles y patio

Los pisos son `PlaneGeometry` rotados `−π/2` en x, con `receiveShadow` y una textura procedural (sección 12) repetida cada *tile* metros. La rugosidad es 0,85 (asfalto 0,92). Para evitar z-fighting, cada capa sube unos milímetros en y: 0,012 a 0,06.

| Pieza | Centro (x, z) | Tamaño | y | Color / textura |
|---|---|---|---|---|
| Terreno | (0, −40) | 623,5 × 520 | 0 | `#5f8d4e` grass/9 m |
| Calle pública | (−197,75, −112) | 14 × 520 | 0 | `#3f4448` asphalt/4 m |
| Bulevar | (−46, −112) | 303,5 × 11 | 0,015 | asphalt |
| Plataforma de andenes | (0, 12) | 183,5 × 24 | 0 | `#c9c6bf` concrete/4 m |
| Calle trasera | (−9,5, 28) | 230,5 × 9 | 0,015 | asphalt |
| Retorno | círculo r 9 en (105,75, 28) | — | 0,02 | asphalt |
| Patio de espera | (−114,75, −31,25) | 46 × 127,5 | 0,013 | asphalt |
| Fila de espera (tierra) | (−131,75, −32,5) | 5 × 105 | 0,02 | `#8a5a3c` dirt/3 m |
| Acceso al patio | (−118,75, −103,5) | 12 × 17 | — | asphalt |

- **Línea discontinua:** planos 3 × 0,18 cada 7 m, `MeshBasic #f5f5f4`, y 0,03.
- **Isla verde:** cilindro r 5, h 0,5 en (96,75, 0,25, 14), `#6fa35a`. A su lado van 3 equipos naranja: caja 1,2×1,4×2 `#ea580c` con mástil negro.
- **Pilas de tarimas:** de x −85,75 cada 7 m, se salta el 25 %. Cada pila es una caja 5 × h × 4 en z 36, con h = 1 + rnd·2,2. Color `#9a6b3f` (80 %) o `#2f3b45`.
- **Postes traseros:** 6 unidades en x −81,75 + 30·i, z 33,3. Fuste: cilindro r 0,09–0,13, h 9, `#6b7280`, metalness 0,6. Luminaria: caja 0,35×0,15×1,4 emisiva (`#fef9c3` de día, `#ffd9a0` de noche).
- **Árboles:** tronco cilindro r 0,3–0,4, h 3, `#6b4f2a`; copa esfera r 3, `#3f6b34`. Primera serie desde x −147,75 cada 11 m en z ≈ 48–70. Segunda columna en x ≈ 131,75 cada 13 m.
- **Almacén vecino:** caja 142,9 × 12 × 70 en (−62,29, 6, −178,5), `#e7e5e4`, con fachada negra 14,2 × 12,6 × 70,4 `#1f2328` en x −126,75. Delante, 2 remolques azules `#1e3a8a`.

**Pseudoaleatorio determinista** (escena estable entre recargas): `s = (s*9301 + 49297) % 233280; return s/233280`. Semillas: 7 tarimas, 11 puestos de parqueo, 23 motos, 23 cargas de racks, 41 mezzanine.

### 4.1 Talud y meseta

- **Taludes:** dos cajas 12 × 5 × 135,5 color `#7a6a4f`, inclinadas con rotZ ∓0,45. Una va en x −143,75 y la otra en −182,75, ambas en y 2,5 y z −27,25.
- **Meseta:** plano `#6b8f55` a **y = 4,6**, de x −178,75 a −147,75 y z −95 a 40,5. Sobre ella van los vecinos (sección 9).

### 4.2 Cerca, agujas y casetillas

- **Cerca de malla:** cajas 0,08 × 2,2, `#1f2937`, opacity 0,55. La trasera va en z 40,5 de x −137,75 a 105,75. La frontal del patio va en z −95, en dos tramos: −137,75…−126,75 y −106,75…−91,75.
- **Aguja:** poste 0,5×1,2×0,5 `#facc15`. Brazo 0,12×0,12×L `#dc2626` con pivote a y 1,1; abierta = rotX −π/2,3.
- **Casetilla:** cuerpo w×3×d `#9ca3af`, ventana `#1e293b` a y 1,9. Techo opcional (w+2,4)×0,25×(d+3) `#f8fafc` a y 3,6.
- **Entrada principal:** isla 14×0,3×1,6 en (−167,75, −112). Casetillas 2,8×1,4 y 3,2×3 en x −170,75. Agujas de 4,5 m.
- **Casetilla de despacho:** 4×4 en (−109,75, −94). Isla en (−118,75, −95). Dos agujas de 5,2 m en x −118,75 ± 5,6.
- **Aguja CEDA (frente):** poste en (officeX−2, −104,7), brazo de 4,4 m.

---

## 5 · Edificio del almacén

### 5.1 Losa

- **Material:** `#d4d7dc`, textura `floor`/6 m, roughness 0,35, metalness 0,05.
- **Forma:** tres cajas de 1,2 m de alto, centradas en y 0,6, de modo que **bajo el edificio de oficinas no hay losa**:
  1. x [−91,75, 18,53] × z [−89, 0]
  2. x [46,53, 91,75] × z [−89, 0]
  3. x [18,53, 46,53] × z [−70, 0]
- El primer piso de oficinas está a nivel de calle (y 0). Entre la puerta del fondo y la bodega quedan 1,2 m de desnivel. ⚠ Falta confirmar en sitio.

### 5.2 Muros

- **Material:** `#eef0f2`, roughness 0,55, metalness 0,15. Mapa `ribTexture`: canvas 64×4 con gradiente horizontal `#e6e8eb → #f7f8f9 (0,42) → #c4c8ce (0,5) → #eceef1 (0,58) → #e6e8eb`, con `repeat.x = largo/1,2`. Queda una costilla cada 1,2 m.
- **Espesor y alto:** espesor 0,3; alto 14. En vista **sin techo** (cutaway) el alto baja a 5,5.
- **Fachada:** en z −88,85, en dos tramos: x [−91,75, 18,53] y [46,53, 91,75]. En el tramo de oficinas no hay muro.
- **Muro sur:** en x 91,6, de 89 m.
- **Muro norte (x −91,75):** partido por el vano del portón: de z −89 a −23,1 y de −17,1 a 0. Dintel de y 4,2 a 14.
- **Cara de andenes (z −0,15):**
  - dintel de y 4,8 a 14;
  - zócalo 183,5 × 1,2 × 0,3 `#9ca3af`;
  - pilares de 1,2 m de ancho entre puertas, de y 1,2 a 4,8, sin pilar en el vano del portón sur (x 84,25…90,25).
- **Parapeto:** 4 cajas de 1,2 de alto (y 12,8–14), `#e9ecef`. **No** hay techo macizo de 12,8 a 14: tapaba el 3.er piso de oficinas.

### 5.3 Cubierta

- **Placa:** 183,9 × 0,1 × 89,4 en y 14,05, `#eef0f3`, textura `roof`/1,6 m, metalness 0,3.
- **Paneles solares:** 3×3 planos de 50,17 × 16 en z −75/−55/−35, y 14,25, inclinados 0,12 rad. Color `#1e3a5f`, metalness 0,6, roughness 0,25.
- **Tragaluces:** 10 planos 2×6 en x −82,75 + 18·i, z −6, emisivo `#bae6fd` 0,2.
- **Alero de andenes:** caja 183,5 × 0,25 × 6 en (0, 6,6, 3), `#f8fafc`.
- **Modo «sin techo»:** oculta cubierta, alero y paneles, y baja los muros a 5,5 m.

### 5.4 Puertas de andén (37, numeradas 02–38)

Cada puerta va en `x = physX(p)`, `z = 0` (lista completa en el anexo A).

**Numeración.** El sistema SRO usa el andén «01NN», que corresponde al físico NN+1 (`0101` = físico 02). ⚠ Es provisional.

| Pieza | Geometría (local de la puerta) | Material |
|---|---|---|
| Hoja cerrada | caja 3,4 × 3,6 × 0,1 en (0, 3,0, −0,05) | `#cbd5e1` con andén asignado, `#d6d3d1` sin andén; metalness 0,35, roughness 0,45 |
| Hoja abierta (camión acoplado) | rollo 3,4 × 0,6 × 0,4 en (0, 4,5, −0,2) | `#94a3b8` |
| Sellos laterales | 2 cajas 0,4 × 3,8 × 0,5 en x ±1,9, y 3, z 0,25 | `#111827`, roughness 0,95 |
| Sello superior | caja 4,2 × 0,6 × 0,5 en y 5,1, z 0,25 | `#111827` |
| Franja de categoría | plano 3,6 × 0,35 en y 5,7, z 0,06 | `MeshBasic` del color de la categoría |
| Nivelador | caja 3,0 × 0,2 × 1,0 en (0, 1,1, 0,5) | `#6b7280`, metalness 0,5 |
| Topes | 2 cajas 0,3 × 0,45 × 0,3 en x ±1,6, y 0,75 | `#1f2937` |
| Semáforo | esfera r 0,2 en (2,45, 4,6, 0,15), emisivo 1,2 | rojo `#ef4444` bloqueado, ámbar `#f59e0b` ocupado, verde `#22c55e` libre |
| Carril amarillo | plano 0,15 × 18 en (2,3, 0,025, 9) | `#facc15` |

Las piezas de las cuatro últimas filas (franja, nivelador, topes, semáforo y carril) solo se dibujan si la puerta tiene andén asignado.

**Número exterior.** Solo se dibuja **con la hoja cerrada**.

- Plano 2,9 × 2,039 en (0, 3,15, +0,011), contra-reflejado.
- Canvas 512×360 transparente: «NN» en Arial bold 330 px centrado en (256, 192), contorno blanco de 22 px y relleno `#15a34a`.
- Material con `alphaTest` 0,05 y `depthWrite` false.

**Número interior.** Siempre visible: plano 1,5 × 0,94 en (0, 5,22, −0,32), rotY π. Canvas 256×160 con fondo `#f8fafc` y número `#14a37f` de 150 px.

**Etiqueta HTML** a y 7,6: «Físico NN · Sistema 01xx».

### 5.5 Portones de carga pesada

`HeavyGate` se arma en coordenadas locales, con z+ hacia afuera.

- **Cerrado:**
  - hoja 6 × 4,2 × 0,08 a y 2,1;
  - 7 listones 6 × 0,04 × 0,02 `#64748b` cada 0,6 m;
  - marco amarillo con 2 cajas 0,3 × 4,2 × 0,1 en x ±3,15, `#facc15`;
  - topes cilindro r 0,12 en x ±3,6.
- **Abierto:** rollo 6 × 0,6 × 0,4 a y 3,9.
- **Portón norte (azul `#1d4ed8`):**
  - grupo en (−91,75, **0**, −20,1) con rotY −π/2, mirando hacia −x lógico;
  - **al ras del suelo exterior**: sin rampa ni explanada;
  - topes de 1,0 m;
  - por dentro queda el borde de la losa de 1,2 m.
- **Portón sur «Zona Franca»:** gris `#9aa5b1`, grupo en (87,25, 0, 0) mirando +z, hoja a y 1,2, topes exteriores de 2,2 m.
- **Rampa del portón sur (cuña maciza):**

```ts
const s = new THREE.Shape();
s.moveTo(0, 0); s.lineTo(8, 0); s.lineTo(0, 1.2); s.closePath();     // (z, y)
const g = new THREE.ExtrudeGeometry(s, { depth: 7, bevelEnabled: false });
g.rotateY(-Math.PI / 2); g.translate(3.5, 0, 0); g.computeVertexNormals();
// 1.2 m de alto en el umbral (z 0), baja a 0 en z 8; x −3.5…3.5 · #9ca3af roughness .9
```

- **Junto al portón norte (adentro):** escritorio del guarda sentado en (xWest+1,3, 1,2, −25,3) y arco detector Garrett pegado al marco.

---

## 6 · Racks (`lib/rackPlan.ts` + `Interior.tsx`)

### 6.1 Grilla

- **Dirección de las filas:** corren **a lo largo de z**, desde la línea amarilla (`RACK_Z0 = −26,5`) hacia la fachada. Se repiten a lo largo de x.
- **Columnas:** `GRID = 32` columnas, numeradas 0 = fachada … 31 = línea amarilla.
  - `zFront = −87,7`
  - **`col = 61,2 / 32 = 1,9125 m`** ⚠ (ancho de bahía provisional)
  - `colZ(c) = −87,7 + c·1,9125` da el borde del lado fachada de la columna `c`
- **Fila de doble fondo:** `FILA_DEPTH = 2,3` (dos racks de 1,15). Entre filas espalda con espalda va `FLUE = 0,3`. Una pareja ocupa 4,9 m.
- **Pasillo:** `aisle = clamp((inner − fijo)/(N−1), 2, 4,5) = 2,6375` ⚠
- **Pasillos cruzados:** son las columnas I y W del Excel, o sea las columnas **11** (z −66,66…−64,75) y **25** (z −39,89…−37,98) de la grilla. Ahí los racks pasan **como puente**: solo se dibujan los niveles con y ≥ 5,2 (N05–N07), aunque los postes siguen completos. Las filas contra la pared (1 y 38) no tienen puente.
- **Numeración de columna de inventario:** `C = c1 + (to − g)`, con C001 del lado de andenes. En las filas «front» (pegadas a la fachada) `c1 = 28 − cols + 1`, de modo que la C028 siempre queda en la fachada.
- **Código de ubicación:** `RCL21-C023-N05-1`, es decir rack · columna · nivel · posición (1 = lado de andenes, 2 = lado de la fachada).
- **Cantilever:** se nombra `CANT C1A · C1B`. Tiene 11 posiciones de 2 columnas: `cantCol = floor((to − g)/2) + 1`.

### 6.2 Categorías y colores (Excel)

| Cat. | Etiqueta | Color | Texto |
|---|---|---|---|
| `sobre` | Sobredimensionado | `#70ad47` | blanco |
| `orig` | Originales | `#4472c4` | blanco |
| `menu` | Menudencia | `#ed7d31` | blanco |
| `zf` | Zona Franca (no nacionalizado) | `#f8fafc` | `#0f172a` |

Las filas 15 y 16 tienen 7 columnas de Menudencia en el extremo de la fachada. Desde la división de Zona Franca (`zfLineX = 60,08`) los racks son **blancos**. En el piso, sobre esa línea, va una raya roja `#dc2626` de 0,18 × 1,2 cada 2 m.

### 6.3 Estructura de un rack

| Pieza | Medida | Posición | Color |
|---|---|---|---|
| Niveles | `LEVELS = [0, 1,3, 2,6, 3,9, 5,2, 6,5, 7,8]` (N01…N07) | sobre la losa | — |
| Poste | caja 0,09 × **9,2** × 0,09, centro y 4,6 | 3 por línea (x0+0,05, centro, x1−0,05) en cada borde de columna | `#1d4ed8` (ZF `#f1f5f9`) |
| Viga | caja 0,06 × 0,12 × 1,9125 (largo en z), y = nivel − 0,08 | en las 3 x de los postes, para nivel > 0 (N01 va a piso) | `#f97316` (ZF `#e2e8f0`) |
| Protector | caja 0,26 × 0,6 × 0,26, y 0,3 | extremos de fila y ambos lados de cada puente | `#facc15` |
| Franja de categoría | 0,45 de ancho en x0−0,33 / x1+0,33, y 0,013 | cara del pasillo | color de la categoría (sin categoría: línea `#eab308` de 0,1) |
| Letrero de cabecera | plano 2,3 × 0,898, y **8,55**, z = colZ(to+1)+0,06 | lado de andenes | canvas 384×150: fondo de la categoría, código bold 50 px y subtítulo 30 px; emisivo 0,12 |

Material: `MeshStandardMaterial`, roughness 0,7, metalness 0,3 (ZF roughness 0,5), con sombras.

### 6.4 Tarimas y cargas en el rack

- **Posiciones:** 2 por bahía, en `zc ± col/4`; la pos 1 hacia andenes. Cada una con 2 de profundidad, en x0+0,575 y x1−0,575.
- **Tarima:** `palletGeometry(1,12, col/2 − 0,06 = 0,896)` con base en nivel + 0,02 ⚠. No caben dos de 120 en 1,91 m, por eso se ajustan.
- **Carga:** caja base 1,0 × 1 × 0,836, escalada sx 0,96–1,0, h 0,75–1,10. Color por instancia de `#c89b62 #d6ae78 #b98a55 #cfa271 #c4955f #ece8e0 #d9d4ca`, textura `carton`, roughness 0,85.
- **Ocupación:** sin inventario, el 22 % vacío. Con inventario, solo donde hay pallet.
- **LOD de tarimas (`PalletsLod`):** dos `InstancedMesh` del mismo tamaño N.
  - Malla cercana: tarima detallada (13 tablas fusionadas).
  - Malla lejana: caja 1,12 × 0,14 × 0,896.
  - Cada **0,33 s** se reparten las matrices según la distancia a la cámara (`LOD_CERCA = 25 m`) y se ajusta `.count`.
  - `frustumCulled = false`, color `#a87c4f`, **sin castShadow**.

### 6.5 Etiquetas de ubicación (eflow) con QR

- **Placa:** **0,44 × 0,11** en la cara de la viga del lado del pasillo, en x = x0+0,018 o x1−0,018 y y = nivel − 0,08.
- **N01:** cuelga bajo la viga del N02, a y 1,105.
- **Cantidad:** por columna y nivel van 4 etiquetas, una del rack del frente (pz+0,235) y otra del fondo (pz−0,235) en cada posición. En los puentes se omiten los niveles < 5,2. Son unas **27 000 a 30 000**.
- **Dibujo:**
  - **Un** `InstancedMesh` con una textura genérica (cuadro `#4b5563` y dos barras `#9ca3af`), sin raycast y con `frustumCulled = false`.
  - Cerca de la cámara: cada 0,1 s se buscan las etiquetas a ≤ **7 m** que miran hacia ella, como máximo **160**. A cada una se le da una malla propia con su QR real.
  - Se crean como máximo **6 texturas nuevas por revisión**, en caché LRU de **480** con `dispose()` al expulsar.
- **Canvas:** 448×112.
  - Borde `#111827` de 4 px.
  - QR nivel M de 100 px. El QR contiene el código.
  - Código en bold 40 px.
  - Una línea en 24 px `#374151` con «Frente/Fondo · Nivel · Pos.».
- **Etiqueta del pallet (con inventario):**
  - Plano 0,22 × 0,15 arriba a la derecha de la carga, en la cara exterior.
  - Canvas 352×240: franja «PALLET», QR de 180 px con el número de pallet (13 caracteres), la ubicación y «+N» si hay más pallets en el slot.
  - Radio de detalle: 8 m.

### 6.6 Cantilever (C1, C2)

- **Ubicación:** x −84,66 y −79,33, columnas 0–21.
- **Medidas:** `CANT_H = 8,6`, 9 niveles en 0,35 + i·0,95. Columnas 0,26 × 8,6 × 0,3 `#1e2a5a` cada 1,9125. Brazos 1,15 × 0,13 × 0,14 `#e2501c` a ambos lados. Pie 2,6 × 0,24 × 0,32.
- **Carga aleatoria:** 14 % vacío, 28 % madera, 22 % perfiles metálicos, 22 % tubos de PVC o metal y 14 % rollos de malla. Todo instanciado con color por instancia.

### 6.7 Zonas a piso, playas y pintura

- **Zona «PISO»:** x −75,34…−68,44 (columnas 10–31) y −67,29…−59,24 (columnas 12–31).
  - Tarimas cada 1,3 m, 35 % apiladas de a 2.
  - Borde amarillo de 0,12.
  - Rótulo amarillo pintado en el piso.
- **Zona «AZF»:** x 66,34…70,94, columnas 0–5, en blanco.
- **Playa de despacho:** x −49,06…−36,62, columnas 21–31.
  - Carriles cada 1,45 con el central libre.
  - Rótulo «PLAYA DE DESPACHO».
- **Mesas de chequeo:** x 3,70…8,60, columnas 21–31.
  - 3 mesas de tablero 0,9 × 0,05 × 1,9 a y 0,9, con monitor emisivo, CPU, impresora y banco.
- **Pasillos cruzados:** plano `#9aa1a9` con franja peatonal verde `#16a34a` de 0,6 y líneas amarillas de 0,1.
- **Recepción:**
  - Carriles amarillos en ±1,97 detrás de cada puerta hasta z −14,6.
  - Líneas transversales en z −19,5 y −25,9.
  - «RECEPCIÓN» cada 48 m y chevrones cada 14 m.
- **Taller de equipos:** 14,4 × 14 contra la fachada en x −67,29, abierto hacia los andenes.

---

## 7 · Mezzanine con bandas (`Mezzanine.tsx`)

### 7.1 Huella y losas

- **Huella:** x **−50,35 … 32,45** (82,8 m) × z −0,4 … −26,4 (26 m). Su cara queda a 10 cm de los racks.
- **Losas:** en y **4,4** y **8,0** sobre la losa interior, espesor 0,25, color `#a3a8ae`. La franja de 3,2 m junto a la cara lleva **aberturas** para las gradas [sx−3,4, sx+4,9] y los ascensores [x±1,2].
- **Mapeo del plano CAD:** `PLAN = {x0: 45, w: 1883, y0: 42, h: 308}`.
  - `x = −50,35 + (v−45)/1883·82,8`
  - `z = −0,4 − (v−42)/308·26`

| Elemento | x lógico |
|---|---|
| Caracol (espiral) | −36,72 |
| Fin de la banda superior | 21,54 |
| Gradas | −26,96 y 27,79 |
| Ascensores | −44,81 y 10,68 |
| Compuertas de tarimas | 3,60 y 17,68 |

### 7.2 Estructura

Todo son **cajas unitarias instanciadas**, unas 6 mallas, con metalness 0,25. Colores: acero `#8f969e`, bandas y escalones `#1f2937`, tableros `#f8fafc`, gabinetes `#dc2626`, compuertas `#facc15`.

- **Columnas:** 0,32 × 8,0 × 0,32 cada 2 andenes, en dos filas: zF+0,3 y media profundidad.
- **Vigas:** de borde largo × 0,5 × 0,18 a nivel − 0,3; secundarias de 0,22 × 0,4.
- **Baranda:** 1,1 m, con pasamanos de 0,06, intermedio de 0,04 y postes cada 1,6.
- **Ascensores:**
  - Torre de 2,2 × 10,2 en z −25,0.
  - Postes de 0,14, 5 anillos y diagonales en X.
  - Malla `#94a3b8` con opacity 0,22.
  - Puertas de 1,8 × 2,1 en cada nivel.
- **Gradas:** en z = zF+1,0, dos tramos:
  - de 0 a 4,4 entre sx∓3,2;
  - descanso 1,6 × 2,4;
  - de 4,4 a 8,0 desplazado 1,2 en z.
  - Cada tramo lleva 11 escalones de 0,25.
- **Último piso (8,0):** estantería liviana de 2,5 m de alto con repisas en 0,15/0,75/1,35/1,95 y cajas de 0,5 × 0,2–0,52. Los tramos salen del plano `PLAN_SHELVES` (en `Mezzanine.tsx`).
- **Piso 4,4:** mesas de trabajo cada 9 m de 6 × 0,9, con banda.

### 7.3 Transportadores

| Pieza | Datos |
|---|---|
| Banda superior | superficie a y **9,025** sobre la losa, z −1,4; del caracol a x 21,54. Bastidor de 0,95, rieles en ±0,45 y patas cada 2,2 |
| Caracol | r 1,0, 2,5 vueltas, centro (−36,72, z −2,4); 91 losetas de 0,6 × 0,08 × 0,32; baja 5,65 m |
| Banda colgada | y **3,375**, z −3,4; del caracol a x 42,25, colgada cada 2,2. Pasado x 32,45 sigue sobre un puente con postes cada 4,6 |
| Bajadas | después de los andenes físicos **15, 17, 19, 21, 23, 25, 27 y 29**, en x = puerta + 2,3 (−22,75 … 41,65, cada 9,2). Ancho 0,45, de z −3,95 (y 3,375) a z −15,6 (y 0,9), unos 12°. Al pie, una mesa de recibo |
| Flujo animado | 24 cajas de 0,42 × 0,34 × 0,42 a 1,1 m/s en un solo `InstancedMesh` actualizado cada cuadro. Recorrido: banda superior → caracol → banda colgada → bajada → 3 s de espera |

---

## 8 · Edificio de oficinas (3 pisos)

### 8.1 Volumen y fachada (`FachadaOficinas.tsx`)

- **Planta:** un rectángulo de **28 × 20**, de x 18,53 a 46,53 y z −90 a −70. Se mete dentro de la bodega frente a las filas 22–29, que son más cortas (20 columnas) y dejan unos 5 m libres.
- **Coordenadas locales:** centro (32,53, −80), cara en z_local −10.
- **Alturas:**

| Nivel | y |
|---|---|
| Piso 1 | 0 (a nivel de calle) |
| Cielo del piso 1 | 3,6 |
| Piso 2 | 4,8 |
| Piso 3 | 9,6 |
| Cielo del piso 3 | 13,4 |
| Techo | 14,6 |
| Remate | 14,6–15,6 |

- **Huecos de la fachada** (x local, W = 28; con el espejo, local +x es la derecha vista desde la calle):

| Hueco | x local | y |
|---|---|---|
| Ventanas del piso 1 | −13,36…−7,98 y [2,58, 6,66], [6,92, 10,84], [11,03, 13,80] | 2,15–3,4 |
| Entrada de vidrio | −4,98…−1,06 | 0–3,5 |
| Ventanas del piso 2 | mismas x que las del piso 1 | 6,7–8,6 |
| Ventana larga de la sala 13 | −13,55…−8,18 | 11,7–13,3 |
| Vidrio central del piso 3 | −4,98…−1,06 | 9,6–13,6 |
| Terraza | 2,30…10,08 | piso 9,6, cielo 12,9 |

- **Pilares:** −8,18…−4,98 y −1,06…2,24, de y 4,8 a 14,6, sobresalen 0,42.
- **Cornisa:** x −17…17 (sobresale 3 m a cada lado y sigue como alero del almacén), y 3,7–4,8, fondo 0,9.
- **Parasoles de lamas:** una geometría fusionada, color `#f4f6f8` con emisivo 0,45.
  - Sobre el piso 2 (y 9,35) y sobre el piso 3 (y 14,25), con fondo de 1,8.
  - 9 lamas de 0,03 × 0,15 rotadas 0,4 rad y costillas cada ~1,5.
- **Revestimiento:** paneles de 1,5 × 1,2 con juntas alineadas. La función `partir()` arma el muro como rectángulos alrededor de los huecos.
- **Vidrios:** `MeshPhysicalMaterial` transparente sin `depthWrite`.
  - Vidrio central `#8fd3c5`, opacity 0,26, con herrajes tipo araña: cilindros r 0,045 en 5 columnas.
  - Piso 2: `#3fa58f`, opacity 0,6–0,85.
- **Remate:** en vista sin techo se oculta si la cámara está por encima del cielo.

### 8.2 Piso 1: recepción

Coordenadas locales: x −13,7…13,7, z −9,7 (fachada) … 9,7 (bodega). Cielo a 3,6.

- **Barra:** blanca, 0,55 × 1,04 × 3,6 en z −7,6, con 4 taburetes. Junto a ella, el mapa de Costa Rica en relieve.
- **Recepción:** mostrador x −4,4…0,4 en z −1,9, con frente de listones, 3 monitores y la pared de cuadros en z 0,2. El árbol de Navidad va a su izquierda.
- **Sala de espera:** a la izquierda, con mapamundi de madera de 5,4 × 2,6, sillones blancos, sofá y flores de pascua.
- **Núcleo de ascensores:** x −13,7…−9, z −3,6…0,8.
- **Pasillo de oficinas:** en z −4,0, con puertas de vidrio esmerilado en x 3,6, 7,6 y 11,6.
- **Bloques cerrados** (`#f1f5f9`, alto completo): [1,6, 13,7]×[−9,7, −5,6]; [3, 13,7]×[−4, 9,7]; [−13,7, −6]×[2,4, 9,7]; [−6, 0]×[0,2, 4,5]; [−6, −3]×[4,5, 6,5]; [−6, 0]×[6,5, 9,7].
- **Pasillo de casilleros:** termina en la **puerta a la bodega en x 1,5**, frente al control de acceso.

### 8.3 Piso 3 y terraza

El piso 3 se modela con la fachada en z −4 y el fondo en 16, y se monta con `P3_DZ = −6`. Piso 9,6, cielo 13,4.

- **Sala 13:** x −13,7…−8,2, en la esquina.
- **Núcleo de ascensores, cocineta y pared turquesa.**
- **Sala de juegos vidriada:** x −4,4…2,3.
- **Mesas y muebles:**
  - barra a lo largo de la fachada;
  - sala de sillones grises;
  - mesas redondas negras;
  - mesa larga de madera;
  - reservados;
  - ping-pong.
- **Cocina larga:** en x 6, con 3 refrigeradoras.
- **Ventanal hacia los racks:** x −3…6, con montantes cada 1,5.
- **Terraza:** x 2,30…10,08 (7,78 m), 5 m de fondo, piso 9,6, cielo 12,9.
  - Piso de madera.
  - Baranda de vidrio `#a7e3dc` de 1,0 m con pasamanos.
  - Cielo de listones con luces lineales y abanicos que giran.
  - Jardín vertical con pantalla y mueble con fregadero.
  - Reciclaje en gris, azul, amarillo y rojo.
  - Sala en L, mesas, futbolín.
  - Mampara de vidrio con marcos blancos.
- **Muebles instanciados (`mueblesInst.ts`):** cada tipo es **una** geometría fusionada con `vertexColors`, en un `InstancedMesh` con `MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })`.
  - Tipos: silla negra o blanca (asiento a 0,45), mesa redonda Ø1,1 × 0,74, taburete (0,76), reservado 1,6 × 2,1, jardinera, planta y basurero.
- **Visibilidad:** los interiores se ocultan a > 170 m de la cámara. Techo y luces se ocultan en vista sin techo con la cámara arriba.

### 8.4 Control de acceso del personal

- **Ubicación:** pegado a la pared del fondo de oficinas (z −69,99, y 1,2), x 27,5…37,5. Usa su propio contra-espejo.
- **Pared y puerta:** pared 11 × 3,2 `#f1f5f4` y puerta «SALIDA» con letrero verde `#15803d`.
- **Reloj marcador:** caja 0,2 × 0,26 × 0,07, con pantalla emisiva `#38bdf8`.
- **Pizarras:** «Bien Informados», seguridad OLO y EPP.
- **Equipo de seguridad:** lector de tarjeta, botón rojo, extintor y «SALIDA DE EMERGENCIA».
- **Malla electrosoldada:** textura canvas 16×64 con celda de 5 × 20 cm, `alphaTest` 0,25, y postes azules `#1e40af`. Una malla baja de 1,25 m y un encierro de 2,6 m para el oficial.
- **Arco detector:** paso interior de 0,76, columnas 0,12 × 2,25 × 0,58 `#b9bec4`, 3 LED verdes por lado.
- **Oficial:** sentado en escritorio de 1,7 × 0,75 con monitor.

---

## 9 · Frente del CEDI (`FrenteCedi.tsx`, `lib/frente.ts`)

```ts
FRENTE = { bandaAlto: 4.2, aleroY: 4.3, aleroFondo: 6.4, aleroAngosto: 2.6,
           columnaZ: -91.5, aceraZ1: -91.6, zacateZ1: -92.6,
           fila1: -94.8, fila2: -102.4, franjaZ0: -105, franjaZ1: -106.5, puesto: 2.8 }
```

- **Tramos:** [−91,75, 18,53] y [46,53, 91,75]. Frente a las oficinas no hay alero ni acera, solo la entrada adoquinada.
- **Pared baja de paneles:** caja L × 4,2 × 0,06 en z −89,03, `#8f959c`. Canvas 4×64 con gradiente vertical, un panel cada 0,6 m (`repeat.y = 7`).
- **Pilastras blancas:** cada 9,6 m desde a+4,8, de 0,6 × (14−4,2) × 0,3, `#f4f6f8`, instanciadas.
- **Puertas peatonales:** blancas, cada 12 m desde a+9, de 0,95 × 2,1.
- **Gabinetes de incendio:** rojos `#c8202f`, de 0,55 × 0,65 × 0,22 a y 1,55, a 3 m de cada puerta.
- **Alero gris oscuro:**
  - Losa `#9aa0a7` a y 4,4, canto `#4a4f57` de 0,5.
  - **Angosto (2,6 m, sin columnas)** en todo el frente.
  - **Ancho (6,4 m)** sobre las motos, de x −86,15 a −70,15, con 4 columnas tubulares blancas: r 0,1, en x −85,65, −80,65, −75,65 y −70,65, z −91,5.
- **Suelos:**

| Franja | z | Color y textura |
|---|---|---|
| Acera bajo el alero | −89…−91,6 | `#c4bcae` concrete |
| Zacate | −91,6…−92,6 | `#5c9a2c` |
| Parqueo de **adoquín en espiga** | −89…−105 | `#a39a8e`, textura `espiga` cada 1,6 m (pieza de 20 × 10 cm), **sin rayas pintadas** |
| Franja verde | −105…−106,5 | `#6a9a3c` |

- **Bordillos amarillos:** cajas 0,16 × 0,16 `#f2c200`, en z −92,6 (uno por tramo) y −105,08, con hueco en officeX ± 5. Es el detalle más repetido del parque.
- **Puestos de parqueo:**
  - Cada 2,8 m desde x −83,75, en filas z −94,8 (rotY π) y −102,4 (rotY 0).
  - Se omiten frente a oficinas (±17 m del centro) y en la entrada (officeX ± 5).
  - Cada puesto lleva un tope de concreto de 1,8 × 0,14 × 0,16 y hileras de adoquín oscuro `#7c756e` en x ±1,4.
- **Motos:** en el extremo norte, **en el espacio de 5 puestos** de la fila 1, de x −85,15 a −71,15.
  - 15 lugares cada 0,9 m, 92 % ocupados.
  - Piezas instanciadas: carenado, asiento, motor, manubrio, horquilla y ruedas r 0,29.
- **Busetas OLO verde menta:** 4 unidades `#3fc6a8` en la fila 1, entre o.x0−17 y o.x0−3.
  - Cuerpo 1,9 × 1,9 × 4,4, trompa 1,88 × 1,2 × 0,9.
  - Franja con logo, llantas r 0,34.
- **Carros:**
  - Cuerpo 1,8 × 0,7 × 4,3 y cabina 1,6 × 0,55 × 2,3 `#1f2937`.
  - **Llantas r 0,32** (nada flota).
  - Colores `#e5e7eb #9ca3af #111827 #1e3a8a #7f1d1d #d1d5db #374151 #1d4ed8`.
  - El 30 % de los puestos queda libre.
- **Postes LED en «V»:**
  - Cada 28 m desde xWest+12, en z −105,75.
  - Fuste de 9,8 m `#8c9196`.
  - 2 cabezas a y 9,6 rotadas ±0,5, con plano emisivo (`#f1f5f9` de día, `#ffe9c4` de noche).
- **Árboles jóvenes:** entre postes. Tronco de 2,8 m y copa r 1,3 `#4f8a2e`.

---

## 10 · Vecinos sobre el talud (`VecinosTalud.tsx`) ⚠ estimados del video

- **Ubicación:** grupo a y 4,6, de x −178,75 a −147,75 y z −95 a 40,5.
- **Franjas, de la calle hacia el patio:**

| Franja | x | Ancho | Color / detalle |
|---|---|---|---|
| Ciclovía | −177,55 | 2,2 | `#c9c5bd`, bordes verdes `#4ade80` de 0,18 |
| Acera | −174,95 | 2,6 | `#d6d3cb`, franja táctil amarilla `#e6b422` de 0,45 |
| Grava | −172,65 | 2,0 | `#8d8a84` |
| Bordillo | −171,6 | — | — |
| Lote de asfalto | −171,55 … −147,75 | — | `#3b3f45` |

- **En la grava:**
  - Seto instanciado: esferas r 0,55 escaladas (1, 0,7, 1,3) cada 1,4 m, `#4d7c2f`.
  - 6 postes LED negros `#111318` de 9 m.
  - 3 palmeras: tronco `#8b7a5c` y 7 hojas.
  - Rack amarillo de bicis en z −47.
- **Parqueo en batería:** cada 2,7 m, con carros en x −168,55 y rayas blancas de 5 × 0,1.
- **Restaurante** (z −87 a −57):
  - Caja azul marino 12 × 6,8 × 30 `#1b2233`, con frente en x −160,25.
  - Zócalo de ladrillo `#7a4a35` de 3 m y vidrio `#1f2a37`.
  - Torre roja 2 × 9,2 × 1,4 `#d62828`.
  - Marco blanco de la entrada.
  - Rótulos «McDonald's» (9 × 2,2) y «McCafé» (4 × 1,5).
  - Valla de 7,2 × 2 junto a la acera.
- **Plaza comercial** (z −45 a 3):
  - Caja gris 12 × 5,4 × 48 `#6b7178`.
  - 7 vitrinas `#25303c`.
  - Alero oscuro corrido 3,2 × 0,25 × 49 `#3a3f46` a y 3,5, con 3 columnas.
  - Rótulos «ampm», «LABORATORIOS SAN JOSÉ» y «LA BOMBA Farmacia».
- **Rótulos:** canvas 1024×256, peso 800, en un plano con rotY −π/2, contra-reflejado y `DoubleSide`.

---

## 11 · Actores dinámicos

### 11.1 Camión (procedural)

Ejes locales: la cabina mira a +z. Largo unos 17 m.

| Pieza | Geometría | Material |
|---|---|---|
| Remolque | caja 2,6 × 2,9 × 13,5 en (0, 2,65, −1,75) | `#f1f5f9`, textura `trailer` (13,5/0,9) |
| Franjas de estado | techo 2,62 × 0,06 × 13,5 a y 4,13; laterales 0,02 × 0,35 a y 1,75 | color de la fase |
| Puertas traseras | cerradas: 2 cajas 1,27 × 2,8 × 0,05 en z −8,52; abiertas: giradas a los costados | `#e2e8f0` |
| Chasis | 1,9 × 0,35 × 16,6 a y 0,95 | `#1f2937` |
| Cabina | 2,5 × 2,7 × 2,4 en (0, 2,35, 6,6), con techo y capó | color de la fase, metalness 0,35 |
| Parabrisas | plano 2,2 × 1,0 | `#0f172a` |
| Detalles | focos (emisivos de noche), tanques cromados, escape | — |
| Llantas | r 0,52, ancho 0,34. Sencillas en z 8,0; dobles en z 4,9, 3,6, −5,6 y −6,9 | — |

- **Interacción:** seleccionado, emisivo `#facc15` 0,55; con el puntero encima, blanco 0,15.
- **En reversa** va a 0,45× la velocidad. El rumbo se suaviza con un factor dt·6.
- **Colores por fase:**

| Fase | Color | Visible |
|---|---|---|
| PROGRAMADO | `#64748b` | no |
| EN_CAMINO | `#0ea5e9` | sí |
| PATIO | `#f59e0b` | sí |
| EN_ANDEN | `#14b8a6` | sí |
| POR_SALIR | `#6366f1` | sí |
| SALIENDO | `#8b5cf6` | sí |
| FINALIZADO | `#22c55e` | no |
| NO_LLEGO | `#ef4444` | no |
| CANCELADO | `#9ca3af` | no |

- **Poses por fase:**
  - **Acoplado:** (physX, 9,1), rumbo 0, en reversa.
  - **Patio:** fila en x −131,75 desde z −73, cada 20 m. Si se llena, una segunda fila en x −135,95.
  - **Llegando:** en la calle pública, en z −130 − i·21.
  - **Fila de salida:** antes de la aguja de despacho.
  - Las rutas son polilíneas sobre `trunk` y `exit` (anexo C), desplazadas 2,5 m al carril derecho.

### 11.2 Tarima 120 × 120 (`palletGeometry`)

- **Tipo:** de largueros, **dos entradas**, 1,2 × 1,2 × **0,14** de alto.
- **Piezas:**
  - 3 tablas inferiores de 0,10 × 0,02, en x −0,55 / 0 / 0,55.
  - 3 largueros de 0,045 × 0,10, en z −0,5775 / 0 / 0,5775. Los de los lados son regla cerrada.
  - 7 tablas superiores de 0,10 × 0,02, separadas 0,1833.
- **Material:** `mergeGeometries`, en caché por tamaño. Color `#b08454`, roughness 0,9.
- **Uñas:** entran a lo largo de x local.

### 11.3 Personal y equipos

- **Persona (~1,8 m):**
  - Piernas 0,15 × 0,85 `#1e293b`.
  - Torso 0,44 × 0,62 × 0,26 del color del chaleco, con franja reflectiva. Chalecos `#f97316 #a3e635 #facc15 #fb923c #bef264 #fde047`.
  - Cabeza r 0,12 a 1,6 y casco.
  - Se puede reemplazar por un GLB (Quaternius «Operario», CC0, clips Walk/Idle).
- **Montacargas:**
  - Chasis 1,12 × 0,5 × 1,75 `#f2a20c` (apilador `#2563eb`), contrapeso `#1a222c`.
  - Techo protector a 2,12 y baliza a 2,23 que parpadea al moverse.
  - Mástil de 3,4 (apilador 3,8). Horquillas de 0,17 × 0,07 × 1,1 en ±0,27.
  - El carro sube de 0,15 a 2,4.
- **Carretilla eléctrica:** `#facc15`. **Carretilla manual:** `#dc2626`.
- **Recorrido de un montacargas (`rackRun`):** andén → pasillo transversal (z −23) → pasillo del rack → giro hacia la cara → sube la tarima → vuelve.

---

## 12 · Texturas procedurales (sin archivos)

- **Base:** todas son `CanvasTexture` con `RepeatWrapping`, sRGB y `anisotropy` 8. Son casi neutras, así que el color del material las tiñe.
- **Tamaño en el mundo:** `tiledTexture(kind, w, d, tile)` clona la base con `repeat = (max(1, w/tile), max(1, d/tile))`.
- **PRNG:** `s = s*16807 % 2147483647`.

| Nombre | Canvas | Dibujo |
|---|---|---|
| asphalt | 256 | grano (base 205, ±60, 9000 puntos) + 14 manchas |
| grass | 256 | fondo `#e8f0e0`, 26 manchas, 5000 trazos de pasto de 2–5 px |
| concrete | 256 | grano 232 + manchas + junta de 2 px arriba y a la izquierda |
| floor | 512 | grano 226 + manchas de pulido + junta |
| pavers | 256 | ladrillos 32 × 16 trabados |
| **espiga** | 256 | adoquín en espiga: unidad u = 16 px, piezas 2u×u y u×2u en escalones diagonales; con tile 1,6 m queda una pieza de 20 × 10 cm |
| dirt | 256 | grano + manchas café |
| roof | 128 | franjas coseno (4 ondas) |
| trailer | 128 | costillas verticales cada 16 px |
| carton | 256 | 2 × 2 cajas con cinta y etiquetas |

Las manchas (blotches) son gradientes radiales que también se dibujan desplazados ±size, para que la textura repita sin costuras.

---

## 13 · Reglas de rendimiento (obligatorias)

Se midieron con GPU Intel UHD. Sin estas reglas: 594 ms por cuadro. Con ellas: unos 30 ms.

1. **Un `InstancedMesh` por tipo de pieza y material.** Aplica a postes, vigas, cargas (con `setColorAt`), tarimas, protectores, pintura de piso, cantilever, mezzanine (unas 6 mallas), motos, seto y etiquetas. Después de llenarlos hay que llamar `computeBoundingSphere()`.
2. **Los `InstancedMesh` no se pasan al `Raycaster`**, porque revisa pieza por pieza. Para los choques o el picking sobre racks hay que usar cajas AABB por pieza, calculadas una vez y guardadas en una cuadrícula de 10 m. La decoración lleva `userData.noCollide = true` y raycast desactivado.
3. **LOD de tarimas** a 25 m, sin sombra, repartido cada 0,33 s. **Etiquetas QR** a ≤ 7 m, máximo 160, máximo 6 texturas nuevas por revisión, en LRU de 480 con `dispose()`.
4. Las **geometrías repetidas se fusionan** con `BufferGeometryUtils.mergeGeometries`: tarima, muebles, parasoles y herrajes.
5. **Interiores de oficinas** ocultos a > 170 m. Techos ocultos en vista sin techo según la altura de la cámara.
6. Los **texto/canvas se cachean** por contenido.
7. Al empezar un recorrido o vuelo guiado se precompilan los materiales con `renderer.compile(scene, camera)`, para que no haya tirones.
8. **Refresco de datos silencioso:** recargar no debe recrear la geometría, mover la cámara ni reiniciar las animaciones. La clave de la escena se calcula **por contenido** (por ejemplo, la lista de andenes serializada), no por identidad del objeto.
9. **Nada flota:** todo apoya en el suelo (0), la losa (1,2), la meseta (4,6) u otro objeto.

---

## 14 · Integración propuesta en OLO_IA

### 14.1 Archivos

```
frontend/src/modules/spatial/webgl/cedi/
  constantes.ts        § 2 (puras, sin three) + logicoADominio/dominioALogico
  plano.ts             buildLayout + planRacks portados tal cual (puros) → anexos A–C
  plano.test.ts        xWest = −91.75; physX(2) = −84.85, physX(38) = 80.75; 38 filas;
                       fila 22 x0 = 18.77; col = 1.9125; mezzanine x −50.35…32.45
  texturas.ts          § 12 (canvas → CanvasTexture, con caché)
  sitio.ts             terreno, calles, patio, talud, cerca, agujas            (§ 4)
  edificio.ts          losa, muros, cubierta, puertas, portones, rampa         (§ 5)
  racks.ts             estructura + cargas + LOD + etiquetas                    (§ 6)
  mezzanine.ts         (§ 7)
  oficinas.ts          fachada + pisos 1 y 3 + terraza + control de acceso      (§ 8)
  frente.ts            fachada frontal, parqueo, motos, busetas                 (§ 9)
  vecinos.ts           (§ 10)
  actores.ts           camión, montacargas, persona                             (§ 11)
  construirCedi.ts     arma el Group raíz con scale(-1,1,1) y devuelve { grupo, actualizar(dt, camara), dispose() }
```

Cada constructor recibe el plano y devuelve un `THREE.Group`, más su `dispose()`. **No usan React.** `Almacen3D.tsx` solo agrega el grupo a su escena y llama `actualizar()` en su bucle de render. Es el mismo criterio que `mundo.ts`: la aritmética, en módulos puros y probados con vitest.

### 14.2 Relación con el catálogo de OLO_IA

- **Racks de OLO_IA:** los 347 racks y 29 310 ubicaciones del catálogo se colocan con el editor de layout y vienen en el **dominio**. Van **fuera** del grupo reflejado.
- **Uso del anexo B:** sirve para **sembrar o validar** el layout publicado.
  - Cada fila `RCLaaa · bbb` tiene x0…x1 (fondo de la fila) y columnas `from…to` (z).
  - Su posición en el dominio es `x = −x_lógico` y `y = z_lógico`.
  - Las columnas C001 quedan del lado de los andenes.
- **Doble dibujo:** si OLO_IA ya pinta los racks del catálogo, en `racks.ts` hay que **apagar** los racks propios del CEDI y dejar solo el contexto: edificio, mezzanine, oficinas y exterior.
- **Capas de `TwinLayerKind`:**

| Capa | Qué controla |
|---|---|
| `racks` | estructura y etiquetas |
| `routes` | flujo de las bandas y recorridos de montacargas |
| `agvs` | montacargas y apiladores |
| `heatmap` | color de las cargas por ocupación |
| `beacons` | semáforos de andén y alertas |

### 14.3 Etiquetas HTML

OLO_IA no tiene drei. En lugar de `<Html>` hay que usar `CSS2DRenderer` / `CSS2DObject` de `three/examples/jsm/renderers/CSS2DRenderer.js`. El comportamiento del simulador es:

- cada etiqueta en su lugar, aunque se encime con otra;
- **arrastrable** con el puntero (sin mover la cámara: `controls.enabled = false` durante el arrastre);
- una línea punteada y un punto que la unen a su ancla;
- la posición se guarda por etiqueta en `localStorage` (`p3d.etiquetas.v1`, en un try/catch);
- doble clic la devuelve a su lugar;
- se ocultan las que quedan detrás de la cámara (producto punto con la dirección de la cámara ≤ 0).

### 14.4 Cámara

- **Límite de altura:** la cámara y su objetivo **nunca bajan de y = 0,6**. Con `OrbitControls`, hay que limitar `target.y` y `camera.position.y` en cada cambio.
- **Vista inicial sugerida:** oblicua desde el frente-oeste, mirando al centro (0, 0, −40) a unos 220 m.
- **Recorrido guiado (opcional):** una `CatmullRomCurve3` por calle → agujas → casetilla → portón norte → patio de andenes → sobre los racks a ~15 m → frente y terraza. Va a 7–9 m de altura y subiendo para quedar ≥ 2,5 m sobre lo que haya debajo. Dura unos 115 s a ×1.

### 14.5 Verificación

1. **vitest** de `plano.ts`: los valores de §2.1 y de los anexos deben salir **exactos**.
2. **Captura** de `/twin` desde 4 vistas (aérea, frente, andenes, interior sin techo) comparada con el simulador (`https://olo3d.onrender.com`, mismas vistas).
3. **Rendimiento:** caminando o volando en el pasillo central, menos de 33 ms por cuadro en GPU integrada.

---

## Anexo A · Puertas de andén (x lógico; en el dominio de OLO_IA, x = −valor)

| Fís. | x | Fís. | x | Fís. | x | Fís. | x |
|---|---|---|---|---|---|---|---|
| 02 | −84,85 | 12 | −38,85 | 22 | 7,15 | 32 | 53,15 |
| 03 | −80,25 | 13 | −34,25 | 23 | 11,75 | 33 | 57,75 |
| 04 | −75,65 | 14 | −29,65 | 24 | 16,35 | 34 | 62,35 |
| 05 | −71,05 | 15 | −25,05 | 25 | 20,95 | 35 | 66,95 |
| 06 | −66,45 | 16 | −20,45 | 26 | 25,55 | 36 | 71,55 |
| 07 | −61,85 | 17 | −15,85 | 27 | 30,15 | 37 | 76,15 |
| 08 | −57,25 | 18 | −11,25 | 28 | 34,75 | 38 | 80,75 |
| 09 | −52,65 | 19 | −6,65 | 29 | 39,35 | | |
| 10 | −48,05 | 20 | −2,05 | 30 | 43,95 | | |
| 11 | −43,45 | 21 | 2,55 | 31 | 48,55 | | |

Sistema = `01` + (físico − 1) con dos dígitos ⚠ (provisional).

## Anexo B · Filas de racks (x lógico; columnas de la grilla `from…to`, z = −87,7 + c·1,9125)

`cara`: −1 = el pasillo queda en x menor, 1 = en x mayor, 0 = ambos. Los puentes son las columnas de la grilla que hacen de pasillo cruzado.

| Fila | Racks | x0 | x1 | cara | cols | C001 en | Puentes | Categoría |
|---|---|---|---|---|---|---|---|---|
| 1 | RCL001·002 | −90,95 | −88,65 | 1 | 4–31 | andenes | — | sin cat. (contra la pared) |
| C1 / C2 | CANT | centro −84,66 / −79,33 | | | 0–21 | | | cantilever |
| 2 | RCL603·602 | −56,60 | −54,30 | −1 | 5–22 | | 11 | sobre |
| 3 | RCL601·600 | −54,00 | −51,70 | 1 | 5–22 | | 11 | sobre |
| 4 | RCL003·004 | −49,06 | −46,76 | −1 | 0–20 | c1 = 8 | 11 | sobre (fachada) |
| 5 | RCL005·006 | −46,46 | −44,16 | 1 | 0–20 | c1 = 8 | 11 | sobre (fachada) |
| 6 | RCL007·008 | −41,52 | −39,22 | −1 | 0–20 | c1 = 8 | 11 | sobre (fachada) |
| 7 | RCL009·010 | −38,92 | −36,62 | 1 | 0–20 | c1 = 8 | 11 | sobre (fachada) |
| 8 | RCL011·012 | −33,99 | −31,69 | −1 | 4–31 | | 25, 11 | sobre |
| 9 | RCL013·014 | −31,39 | −29,09 | 1 | 4–31 | | 25, 11 | orig |
| 10 | RCL015·016 | −26,45 | −24,15 | −1 | 4–31 | | 25, 11 | orig |
| 11 | RCL017·018 | −23,85 | −21,55 | 1 | 4–31 | | 25, 11 | orig |
| 12 | RCL019·020 | −18,91 | −16,61 | −1 | 4–31 | | 25, 11 | orig |
| 13 | RCL021·022 | −16,31 | −14,01 | 1 | 4–31 | | 25, 11 | orig |
| 14 | RCL023·024 | −11,37 | −9,07 | −1 | 4–31 | | 25, 11 | orig |
| 15 | RCL025·026 | −8,77 | −6,47 | 1 | 4–31 | | 25, 11 | menu 4–10 · orig 11–31 |
| 16 | RCL027·028 | −3,84 | −1,54 | −1 | 4–31 | | 25, 11 | menu 4–10 · orig 11–31 |
| 17 | RCL029·030 | −1,24 | 1,06 | 1 | 4–31 | | 25, 11 | orig |
| 18 | RCL031·032 | 3,70 | 6,00 | −1 | 0–20 | c1 = 8 | 11 | orig (fachada) |
| 19 | RCL033·034 | 6,30 | 8,60 | 1 | 0–20 | c1 = 8 | 11 | orig (fachada) |
| 20 | RCL035·036 | 11,24 | 13,54 | −1 | 4–31 | | 25, 11 | orig |
| 21 | RCL037·038 | 13,84 | 16,14 | 1 | 4–31 | | 25, 11 | orig |
| 22 | RCL039·040 | 18,77 | 21,08 | −1 | 12–31 | | 25 | orig (frente a oficinas) |
| 23 | RCL041·042 | 21,38 | 23,68 | 1 | 12–31 | | 25 | orig |
| 24 | RCL043·044 | 26,31 | 28,61 | −1 | 12–31 | | 25 | orig |
| 25 | RCL045·046 | 28,91 | 31,21 | 1 | 12–31 | | 25 | orig |
| 26 | RCL047·048 | 33,85 | 36,15 | −1 | 12–31 | | 25 | orig |
| 27 | RCL049·050 | 36,45 | 38,75 | 1 | 12–31 | | 25 | orig |
| 28 | RCL051·052 | 41,39 | 43,69 | −1 | 12–31 | | 25 | orig |
| 29 | RCL053·054 | 43,99 | 46,29 | 1 | 12–31 | | 25 | orig |
| 30 | RCL055·056 | 48,93 | 51,22 | −1 | 0–27 | | 25, 11 | orig (fachada) |
| 31 | RCL057·058 | 51,52 | 53,82 | 1 | 0–27 | | 25, 11 | orig (fachada) |
| 32 | RCL059·060 | 56,46 | 58,76 | 0 | 0–27 | | 25, 11 | orig (fachada) |
| 33 | RCL061·062 | 61,40 | 63,70 | 0 | 4–31 | | 25, 11 | **zf** (inicio de Zona Franca, línea x 60,08) |
| AZF | piso | 66,34 | 70,94 | | 0–5 | | | zf |
| 34 | RCL063·064 | 73,57 | 75,87 | −1 | 4–31 | | 25, 11 | zf |
| 35 | RCL065·066 | 76,17 | 78,47 | 1 | 4–31 | | 25, 11 | zf |
| 36 | RCL067·068 | 81,11 | 83,41 | −1 | 4–31 | | 25, 11 | zf |
| 37 | RCL069·070 | 83,71 | 86,01 | 1 | 4–31 | | 25, 11 | zf |
| 38 | RCL071·072 | 88,65 | 90,95 | −1 | 0–31 (32 cols.) | | — | zf (contra la pared) |

- **Centros de pasillo** (para los montacargas): −87,33, −57,92, −50,38, −42,84, −35,31, −27,77, −20,23, −12,69, −5,16, 2,38, 9,92, 17,46, 24,99, 32,53, 40,07, 47,61, 55,14, 60,08, 65,02, 72,26, 79,79, 87,33.
- **Pasillos cruzados:** la columna 25 va de x −33,99 a 88,65 y la columna 11 de −56,60 a 88,65.
- **Bloque Oficinas/Comedor en el plano:** x 18,775…46,29, con cara de racks en z −76,83.

## Anexo C · Rutas de camiones (x, z lógicos)

```
trunk (entrada): (−197.75,−342) → (−197.75,−112) → (−167.75,−112) → (−118.75,−112)
                 → (−118.75,−95) → (−118.75,28) → (105.75,28)
exit  (salida):  (105.75,28) → (−118.75,28) → (−118.75,−112) → (−197.75,−112) → (−197.75,118)
carril: desplazamiento 2.5 m a la derecha lógica (−2.5 por el espejo)
acoplar: pasar 14 m más allá del andén por la calle trasera y entrar en reversa a (physX, 9.1)
patio: fila en x −131.75, z = −73 + i·20 (heading 0, de frente); 2.ª fila en x −135.95
```

---

### Preguntas abiertas que afectan las medidas

- Medidas reales del rack (ancho de bahía y fondo) y del edificio.
- Mapeo definitivo de andén físico ↔ sistema.
- Nivel del piso interior en el portón norte y en la puerta del fondo de oficinas.
- Profundidad exacta del alero angosto (se usó 2,6 m).
- Orden y tamaño de los vecinos del talud.
- ¿Uno o dos caracoles? Ubicación de la bajada cerca del andén 17.
