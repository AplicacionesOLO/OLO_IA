# ADR-011 · Contenedores y artículos

| | |
|---|---|
| **Estado** | **Propuesto.** Requiere aprobación antes del Bloque 3. |
| **Fecha** | 2026-07-29 |
| **Decide** | Que la entidad sea genérica y no «pallet»; qué identifica el QR; la clave del artículo; cómo se relaciona un artículo con una clase de IA |
| **No decide** | Tablas ni columnas. Embeddings |
| **Depende de** | ADR-009 (`wms` como espejo, regla R1) |

---

## 1. Container, no Pallet

La propuesta de no llamar a la entidad «pallet» es correcta, y el propio Excel ya lo
demuestra sin necesidad de mirar al futuro.

**`Tipo Pallet` tiene cuatro valores**, y solo uno describe un pallet:

```
MULART   35.241 filas   multi-artículo
MERMA     5.193 filas   merma
PRODUC      615 filas   producción
MASTER        6 filas   agrupador
```

La columna ya está tipando **unidades logísticas**, no tarimas. Llamar `pallet` a la
tabla sería nombrar la abstracción por su primera instancia —el error que lleva a
tener `pallets.tipo = 'gaveta'` dentro de dos años.

### 1.1 Una distinción que importa más que el nombre

Hay una pregunta previa a elegir entre `container` y `pallet`, y el dato la
responde:

> **¿La entidad es el soporte físico reutilizable, o la carga que va encima?**

El identificador es `22O0014028883`: **13 caracteres, tres prefijos** (`22O` en
36.526 filas, `22C` en 3.204, `22A` en 1.325). Es una **matrícula de carga**: nace
en la recepción, vive mientras esa mercancía está junta y muere en la expedición.
No es el número de serie de una tarima de madera que vuelve al muelle.

En la nomenclatura de la industria eso es una **unidad logística** —GS1 la
identifica con un SSCC, SAP EWM la llama *handling unit*—, y es distinta del
**soporte** (tarima, gaveta, jaula), que es un activo reutilizable con su propio
inventario.

**Consecuencia:** si algún día se controlan tarimas reutilizables, será una entidad
**distinta**, no una fila más en esta tabla. Confundirlas produciría una carga con
historial de reparaciones y una tarima con fecha de caducidad.

El Excel confirma que hoy solo existe una de las dos: `Propiedad Tarima` es
constante (`'No'` en las 41.055 filas) y `Id Tarima` está **completamente vacía**.
El WMS no está gestionando soportes.

### 1.2 El nombre

| Candidato | A favor | En contra |
|---|---|---|
| `containers` | corto, legible, entendible sin glosario | «contenedor» también significa contenedor marítimo, que es un tipo posible; y en el mundo del software significa Docker |
| `handling_units` | término exacto de la industria (SAP EWM) | requiere glosario para quien viene de fuera |
| `logistic_units` | término GS1, preciso | largo |

**Recomendación: `containers`**, con el tipo como vocabulario cerrado y con la
ambigüedad resuelta en un comentario de tabla. El argumento decisivo es que el
esquema lo leen personas que hablan del almacén, no de GS1, y `containers` es la
palabra que van a usar. La precisión se compra con el `container_type`, no con el
nombre de la tabla.

### 1.3 Los contenedores anidan

**Medido: `Palet Master` trae 97 valores distintos y ninguno aparece como `Pallet`
en el archivo.** Los 1.553 registros que lo llevan apuntan a agrupadores que el
reporte no incluye como filas propias.

Dos consecuencias:

1. **Un container puede contener containers.** Es un árbol, igual que el espacio.
   Y un tote dentro de un pallet dentro de una jaula es exactamente el caso futuro
   que se plantea.
2. **`master_container` no puede ser una FK poblada por este archivo.** Serían 97
   referencias colgantes y la importación fallaría entera por integridad
   referencial. Opciones: texto sin FK, o crear el master bajo demanda con una
   marca de «inferido, nunca observado directamente».

Recomiendo lo segundo, porque un master es un objeto real que alguien puede acabar
fotografiando. Pero con la marca: un container que solo existe porque otro lo
mencionó no es lo mismo que uno que llegó en un snapshot.

### 1.4 El QR

**El QR no es una entidad. Es un atributo del container.** Y el valor se usa **sin
transformar**: 13 caracteres alfanuméricos, sin espacios, verificado en los 28.558
pallets. Es un payload ideal para QR y legible por OCR como respaldo.

Lo que **sí** es una entidad es la **lectura** del QR: ocurre en un instante, desde
una cámara, con una confianza, y puede ser errónea. Vive en `perception`, nunca en
`wms`. Confundir «el container tiene este QR» con «leímos este QR» haría que una
lectura mala corrompiera el maestro.

Y una previsión: hoy el QR **es** el identificador, pero un cliente puede llegar con
etiquetas propias, o con dos etiquetas en el mismo bulto. Modelar `qr_value` como
**una identificación entre varias posibles** —con tipo y con la marca de cuál es la
primaria— cuesta poco ahora y evita rehacer la lectura después. No es
sobreingeniería: es la diferencia entre un campo y una relación, y el dato ya trae
tres prefijos distintos que sugieren tres orígenes de numeración.

---

## 2. Artículos

### 2.1 La clave es `(compañía, código)`, y hay una prueba

De 10.534 artículos, uno tiene dos identidades:

```
Artículo 5140011
  COFERSA                     'Llave tanque Alto 1/2" sin varilla NPT 4004.13 Urrea'
                              EAN 7501973706133
  Inversiones Roblealto S.A.  '6.0TB 7.2K SAS 12Gb/s 3.5in HDD CML'
                              EAN CML-1HT27Z-157-SC280
```

**Un caso entre 10.534 basta**, porque no es un error de tecleo: son dos artículos
reales de dos clientes que comparten código en sus ERP respectivos. Un catálogo
global mostraría un disco duro donde hay una llave de tanque.

Los otros 96 artículos que aparecen en más de un ámbito son la misma compañía en
dos sucursales (`FERRETERIA EPA S.A.` frente a `FERRETERIA EPA S.A SOBRANTE`) y no
colisionan.

**Nota sobre la fragilidad de esta clave:** depende de que `Nombre Compañía` sea un
identificador estable, y es un **nombre**, con 19 valores que incluyen
`'COFERSA'`, `'COFERSA  ADMINISTRATIVO'` (dos espacios) y `'Cofersa Mercadeo'`.
Un nombre no es una clave. La importación tendrá que resolver la compañía contra
`core.companies` y **fallar la fila si no la encuentra**, en lugar de crear una
compañía por cada variante ortográfica.

### 2.2 Lo que no sirve como clave alternativa

| Columna | Medición | Conclusión |
|---|---|---|
| `Referencia ERP` | 1:1 con el artículo, 0 violaciones, pero 99,4 % de relleno | Útil como identificador secundario, no como clave |
| `Código Ean` | 1 artículo con dos EAN | Identificador comercial, no clave |
| `Número Parte` | **0 filas con valor** | No aporta nada en este archivo |

### 2.3 El artículo no debe acoplarse al Excel

Cuatro sistemas van a hablar del mismo artículo y ninguno debe ser el dueño del
modelo:

```
ERP     el maestro comercial: descripción, familia, EAN, referencia
WMS     el maestro operativo: cómo se almacena, en qué unidad
OLO     la identidad interna estable (UUID) que sobrevive a los dos
IA      lo que un modelo puede reconocer
```

La regla: **`wms.items` es un espejo, no el maestro.** Su UUID es lo único que OLO
posee, y existe para que un snapshot de hace seis meses siga apuntando al mismo
artículo aunque el ERP haya renumerado.

Corolario: los atributos del artículo que vienen del reporte —descripción, familia,
subfamilia, clasificaciones— se guardan **sin normalizar en entidades propias**
todavía. `Familia` tiene 150 valores y 62 % de relleno; `SubFamilia` 24 valores y
57 %. Convertirlas en tablas con FK hoy significa decidir su semántica sin datos
suficientes, y esas jerarquías suelen resultar ser del ERP y venir con su propio
árbol. Texto ahora, tabla cuando el ERP la entregue.

---

## 3. El puente entre artículo y clase de IA

Es la parte más delicada de este ADR, porque cruza la frontera de aislamiento que
ADR-009 establece en la regla R1.

### 3.1 Un artículo y una clase no son lo mismo

Es tentador tratarlos como sinónimos —«la clase es el artículo que el modelo
detecta»— y es falso en los dos sentidos:

- **Una clase cubre muchos artículos.** Un modelo que detecta `caja_bosch_azul`
  responde por cientos de SKU con el mismo empaque.
- **Muchos artículos no son distinguibles visualmente.** Dos tornillos que difieren
  en 2 mm de longitud tienen SKU distintos y la misma apariencia. Ningún modelo los
  separará, y pretenderlo produce métricas excelentes y conteos falsos.
- **Una clase puede no ser un artículo en absoluto**: `pallet`, `hueco_vacio`,
  `etiqueta`, `persona` son clases útiles que no son mercancía.

**Por lo tanto es una relación muchos-a-muchos**, y la relación necesita atributos
propios: quién la afirmó, con qué confianza, si es una identificación exacta o solo
una familia visual.

### 3.2 En qué lado vive el puente

Aquí manda la regla R1 de ADR-009: **`ai` está en régimen Platform Owner y no
referencia dato de tenant.**

```
                    ┌──────────────────────┐
   régimen OWNER    │  ai.classes          │
                    │  (vocabulario del    │
                    │   modelo, agnóstico) │
                    └──────────▲───────────┘
                               │  referencia en UN solo sentido
                    ┌──────────┴───────────┐
   régimen TENANT   │  puente              │
                    │  item ↔ class        │
                    └──────────▲───────────┘
                               │
                    ┌──────────┴───────────┐
                    │  wms.items           │
                    └──────────────────────┘
```

**El puente vive en el lado del tenant.** Es la misma dirección que
`core.role_permissions → core.permissions`: el dato específico referencia el
catálogo general, nunca al revés.

Si estuviera en `ai`, pasarían dos cosas y las dos son malas: el catálogo del owner
quedaría atado al inventario de un cliente concreto, y ningún usuario de tenant
podría leer el mapeo de su propio artículo porque la política de `ai` exige ser
Platform Owner.

**Consecuencia operativa:** el mapeo es trabajo del cliente, no del owner. Cada
tenant decide qué SKU corresponde a qué clase, y dos tenants pueden mapear la misma
clase a artículos distintos sin interferir. Eso es correcto: el modelo es
compartido, el significado de negocio no.

### 3.3 Embeddings: por qué no se decide aquí

`pgvector 0.8.2` está disponible —verificado contra la base—, así que la búsqueda
por similitud visual de artículos es viable sin infraestructura nueva.

Pero un embedding de un artículo de cliente es **dato de tenant derivado por un
modelo del owner**, y ese cruce tiene preguntas sin responder que no conviene
resolver por defecto:

- ¿Se invalida el embedding cuando la versión del modelo cambia? (Sí, y eso implica
  guardar `model_version_id` con cada vector.)
- ¿Puede un tenant beneficiarse de embeddings calculados sobre imágenes de otro?
  Comercialmente atractivo, y una fuga si se hace mal.
- ¿Vive en `wms` (es del artículo) o en `perception` (es derivado de evidencia)?

**Queda explícitamente sin decidir.** Lo único que este ADR fija es que un
embedding **no es un atributo de `wms.items`**: llegaría en una tabla propia, con
su versión de modelo, o no llegaría.

---

## 4. Resumen

1. La entidad se llama **`containers`**, tipada por vocabulario cerrado. `pallet`
   es un tipo, no la entidad.
2. Lo que se identifica es la **unidad logística** (la carga), no el soporte
   reutilizable. Si algún día se controlan tarimas, será otra entidad. El Excel
   confirma que hoy no se gestionan: `Id Tarima` está vacía.
3. **Los containers anidan** (`Palet Master`, 97 casos), y el master se crea marcado
   como inferido, no como FK a algo que no llegó.
4. El **QR es un atributo** del container y se usa sin transformar. La **lectura**
   del QR es otra entidad y vive en `perception`.
5. Modelar la identificación como **una entre varias posibles** desde el principio.
6. **Clave del artículo: `(compañía, código)`**, probada por el caso `5140011`.
7. La compañía se resuelve contra `core.companies` y la fila **falla** si no
   aparece. Un nombre con dos espacios no puede crear una compañía nueva.
8. **El puente artículo ↔ clase de IA es muchos-a-muchos y vive en el lado del
   tenant.** La regla R1 lo exige.
9. **Los embeddings quedan sin decidir**, y en ningún caso son columnas de
   `wms.items`.
