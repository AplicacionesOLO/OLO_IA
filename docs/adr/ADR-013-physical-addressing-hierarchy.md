# ADR-013 · Jerarquía de direccionamiento físico

| | |
|---|---|
| **Estado** | **Aprobado** (Opción C) con el ajuste final de §14. Listo para migrar. |
| **Fecha** | 2026-07-30 |
| **Contexto** | 52 migraciones aplicadas. `spatial.nodes` operativo desde 0050; `logical_level` y `logical_position` desde 0052. |
| **Decide** | Cómo se persiste la jerarquía `warehouse → aisle → rack → body → level → position` y cómo la consulta el frontend sin parsear cadenas |
| **No decide** | Migraciones concretas. Endpoints. Geometría del gemelo |

---

## 1. Tres mediciones que cambian el diseño

Medidas sobre las 29.310 filas del catálogo antes de escribir nada.

### 1.1 «Aisle» NO existe en el dato

El primer segmento se agrupa en **41 familias de letras** —`RCL` con 209 miembros, `PURT` 38, `MZ` 12…—, así que la tentación es leer la familia como el pasillo. **No lo es:**

```
familia RCL   preámbulos 50 y 60   ·  tipos ALMREP y PICKIN  ·  11 zonas distintas
familia MZ    preámbulos 50 y 90   ·  tipos COMPAC y PICKIN  ·   1 zona
```

Una familia que abarca dos preámbulos, dos tipos operativos y once zonas de almacenaje **no puede ser un pasillo físico**. Es una convención de nombres.

**Consecuencia:** `aisle` entra en el modelo como un nivel **opcional y vacío**, igual que `reference_frames`. Lo poblará el importador CAD o una declaración humana, nunca un parser. Inventarlo desde la familia de letras produciría 41 pasillos falsos que el canvas dibujaría como si fueran reales.

### 1.2 La posición 1 **no** existe automáticamente

El enunciado de partida dice que dado `RCL07-C018-N05-2` «automáticamente existe `RCL07-C018-N05-1` porque ambos pertenecen al mismo Body». **El dato lo desmiente:**

```
tripletas (Referencia, Columna, Nivel) con 2 posiciones : 12.722
tripletas con UNA SOLA posición                        :  3.866   ← 23,3 %
```

Casi una de cada cuatro combinaciones body-nivel tiene una sola posición. Un modelo que genere la pareja automáticamente **inventaría 3.866 ubicaciones que no existen**, y el explorador mostraría huecos disponibles donde no hay estructura.

**Consecuencia:** cada posición es una fila del catálogo. Nunca derivada.

### 1.3 El primer segmento es polimórfico **incluso dentro de una familia**

```
referencias con 1 sola ubicación   : 124 de 347
referencias con 19-100             :  69
referencias con más de 100         :  84

RCL71, RCL72   448 ubicaciones cada una      → son racks de verdad
RCL250…RCL253    1 ubicación cada una        → misma familia, no son racks
```

`RCL` contiene a la vez estanterías de 32 cuerpos y puntos sueltos. **No se puede deducir del código si el primer segmento es un rack.** Lo dice `Tipo Ubicación` y, en última instancia, una persona.

### 1.4 Recuento real de objetos por nivel

| Nivel | Objetos reales | Origen |
|---|---|---|
| Warehouse | 1 (17 `IdSucursal` que **no** son espaciales) | `core.warehouses` |
| Aisle | **0** | no existe en el dato (§1.1) |
| Rack / área | **347** | `Referencia` ↔ `IdAlmacenamiento`, 1:1 medido |
| Body | **2.701** | pares `(Referencia, Columna)` distintos |
| Level | 9 valores, 1-9 por body | `Nivel` |
| Position | 2 valores, **1 o 2 por nivel** | `Posición` |
| **Ubicaciones** | **29.310** | filas del catálogo |

Un rack típico de la familia `RCL`: media de **11 cuerpos** y **130 ubicaciones**, con máximos de 32 y 448.

### 1.5 Dos referencias que el esquema actual rechazaría

```
DAÑADO    contiene Ñ
PHA LO    contiene un ESPACIO
```

El CHECK vigente de `spatial.locations.code` es `^[A-Z0-9][A-Z0-9.-]*$`, y **rechaza las dos**. Es un bloqueo real del importador, no de este ADR, pero hay que decidirlo antes: o se amplía el patrón, o esas dos referencias se normalizan y se conserva el original en `raw_source`.

---

## 2. Opción A · columnas explícitas

`spatial.locations` recibe `rack_code`, `body_code`, `level_code`, `position`.

**Ventajas.** El importador es trivial: el catálogo **ya entrega** `Referencia`, `Columna`, `Nivel` y `Posición` como columnas separadas, así que no hay parseo en ninguna parte. Una consulta por rack es un índice y nada más. El frontend recibe los cuatro campos sin tocar una expresión regular.

**Desventajas.** `rack_code` se repite en cada ubicación del rack: 448 veces para `RCL71`. Renombrar un rack es un `UPDATE` masivo, y nada impide que dos filas del mismo rack acaben con códigos distintos.

Y el defecto de fondo: **un rack no existe como entidad.** No hay fila donde poner su geometría, su orientación, su capacidad, su estado ni la malla del gemelo digital. La pregunta «muéstrame el rack RCL07» se responde con un `GROUP BY`, no con un `SELECT` de un objeto. Cuando llegue el CAD no habrá dónde colgar el modelo 3D de la estantería.

**Índices.** `(tenant_id, warehouse_id, rack_code)`, `(rack_code, body_code)` y `(rack_code, body_code, level_code, position)`. Cuatro columnas de baja cardinalidad multiplicadas por millones de filas: los índices crecen con las ubicaciones, no con los racks.

**RLS.** Sin cambios: todo cuelga de `spatial.locations`, que ya tiene su política.

**Veredicto.** Rápida y simple, pero contradice dos requisitos explícitos —«no quiero duplicar información» y «quiero un modelo normalizado»— y deja al gemelo digital sin objetos a los que agarrarse.

---

## 3. Opción B · solo `full_location_code` y funciones

**Ventajas.** Cero duplicación aparente. Una sola columna. El importador guarda la cadena y nada más.

**Desventajas.** Tres, y la tercera es la que la descarta.

**Rendimiento.** `WHERE split_part(code,'-',1) = 'RCL07'` no usa un índice btree normal. Se arregla con índices de expresión —`CREATE INDEX ON locations (split_part(code,'-',1))`— pero eso **es la Opción A con más pasos**: se materializa el mismo valor en un índice, sin ganar la entidad y perdiendo legibilidad.

**Fragilidad.** El modelo depende de que el código sea parseable siempre. Hoy lo es en el 100 % de las 29.310 filas y también en las 4 huérfanas del inventario, que conforman el patrón. Pero `DAÑADO` y `PHA LO` (§1.5) ya avisan de que el WMS inventa códigos, y el día que aparezca uno con cinco segmentos el parser devuelve basura **en silencio**.

**Y no elimina la lógica de interpretación: la traslada.** El objetivo declarado es que no haya parseo en React. La Opción B lo saca de React y lo mete en SQL, donde sigue siendo un parser y sigue rompiéndose con el primer código no conforme. Un `split_part` en una vista es la misma expresión regular con otro traje.

**Veredicto.** Descartada. No da entidades, no elimina el parseo y su rendimiento solo se arregla imitando la Opción A.

---

## 4. Opción C · **recomendada** · la jerarquía es el árbol que ya existe

La observación que resuelve el problema: **`spatial.nodes` ya es exactamente esto.** Es recursivo, tiene vocabulario cerrado de tipos, matriz de aristas legales, protección contra ciclos, FK compuesta por tenant y almacén, y RLS. Se construyó en 0050 para representar contención espacial de profundidad variable.

No hacen falta tablas nuevas. Hacen falta **tres cosas**.

### 4.1 Un tipo de nodo nuevo: `bay`

```
node_types  building · floor · zone · aisle · rack · bay · storage_area
                                                    ↑ nuevo
```

`bay` es el cuerpo: `C018`. En terminología de estanterías es el hueco entre dos bastidores, y es un objeto físico con geometría propia.

Aristas nuevas en la matriz: `rack → bay`, `bay → (nada)`. Y `aisle → rack` ya existe.

### 4.2 Las ubicaciones cuelgan del **body**, no del área

```
core.warehouses
   └── spatial.sites
         └── spatial.nodes  aisle   ·  0 filas, opcional (§1.1)
               └── nodes    rack    ·  347
                     └── nodes  bay ·  2.701
                           └── spatial.locations  ·  29.310
                                 logical_level    1-9
                                 logical_position 1|2
```

**Nodos totales: 3.048.** Con un almacén cien veces mayor serían 300.000 nodos y millones de ubicaciones: `btree` sobre `(parent_node_id)` y `(node_id)` sigue resolviendo en milisegundos.

### 4.3 El corte está entre `bay` y `level`, y es deliberado

`level` y `position` **no son nodos**. Son la dirección de la hoja, y ya existen como `logical_level` y `logical_position` desde 0052.

Cuatro razones:

1. **No duplicar.** Las columnas ya están. Añadir nodos de nivel sería tener el nivel en dos sitios — exactamente lo que se pide evitar.
2. **No tienen identidad propia en el origen.** No hay maestro de niveles: solo un entero 1-9 por ubicación.
3. **Contención de volumen.** Nodos de nivel serían 16.588 filas más, y no aportan nada que las columnas no den.
4. **El gemelo no los necesita.** La geometría de un estante se deriva de la del cuerpo: altura del cuerpo dividida entre sus niveles. Un nodo por estante sería geometría redundante.

El frontend **sí** puede renderizar el nivel como un agrupamiento del árbol: la API lo devuelve y agrupa por él. Es un `GROUP BY`, no un parseo.

### 4.4 `full_code`: redundancia **verificada**, no evitada

`spatial.locations.code` ya contiene el código completo, y es el identificador externo del WMS. **No se elimina**: hay que conservarlo verbatim para poder reconciliar, reimportar y emparejar con el inventario (principio de conservar los valores originales).

Es redundante con la ruta del árbol, sí. La respuesta no es quitarlo, es **hacer imposible que se contradiga**: un trigger comprueba en cada escritura que `code` coincide con la reconstrucción `rack.node_code-bay.node_code-N{level}-{position}`.

Es el mismo criterio que las huellas de las migraciones: no se evita la redundancia, se hace inconsistente por construcción. Y da un beneficio extra — si el WMS cambiara la forma del código, el trigger lo detecta en la primera fila en lugar de en el primer informe raro.

### 4.5 Cómo cumple los seis requisitos

| Requisito | Cómo |
|---|---|
| Normalización | Cada rack y cada body son **una** fila. El código del rack no se repite 448 veces |
| Consultas rápidas | `node_code` indexado; de rack a ubicaciones son dos saltos de índice |
| Importador sencillo | El catálogo ya da `Referencia`/`Columna`/`Nivel`/`Posición` separados: **cero parseo** |
| Escalabilidad | Nodos crecen con la estructura (3.048), no con las ubicaciones (29.310) |
| Gemelo digital | Rack y body son objetos: tienen `world_position`, `world_footprint` y malla propia |
| Búsquedas eficientes | `pg_trgm` sobre `node_code` y `locations.code` para el buscador |
| Millones de ubicaciones | Índices `btree`; particionado por almacén si llegara a hacer falta |

---

## 5. Decisión

**Opción C.** Y con una nota honesta: **C es la Opción A aplicada al nivel correcto.** La A materializa la jerarquía en cada ubicación; la C la materializa **una vez por objeto** y la ubicación solo guarda su dirección dentro de su padre. La diferencia no es de técnica sino de granularidad, y es la que convierte un rack en algo que se puede dibujar.

---

## 6. Tablas

**Ninguna nueva.** Cambios sobre lo existente:

| Tabla | Cambio |
|---|---|
| `spatial.node_types` | `+1 fila`: `bay` |
| `spatial.node_edges` | `+2 filas`: `rack→bay`, `aisle→rack` (si no está) |
| `spatial.nodes` | `+ logical_index smallint` — el número del cuerpo o del rack como entero, para ordenar sin parsear `C018` |
| `spatial.locations` | sin columnas nuevas. `node_id` pasará a apuntar a un `bay` en lugar de a un `storage_area` |
| **`spatial.locations_resolved`** | **vista nueva**, `security_invoker = true` |

### 6.1 La vista es el contrato del frontend

```
spatial.locations_resolved
    location_id · full_code
    warehouse_id · warehouse_code
    site_id · site_code
    aisle_id · aisle_code          ← NULL hasta que exista (§1.1)
    rack_id  · rack_code  · rack_index
    bay_id   · bay_code   · bay_index
    level · position
    location_type · location_status · location_situation
    is_bulk_area · origin
    node_function · function_label   ← «Almacenaje», no «ALMREP»
    logical_x · logical_y · logical_z
    world_frame_id · world_position
```

**`security_invoker = true` es obligatorio.** Sin él la vista se ejecuta con los privilegios de su propietario, que tiene `rolbypassrls`, y se convierte en una fuga entre tenants. Es la lección de la migración 0042.

---

## 7. Relaciones

```
core.warehouses (tenant_id, id)
   ↑ fk_site_warehouse (2 col)
spatial.sites (tenant_id, warehouse_id, id)
   ↑ fk_node_site (3 col)
spatial.nodes (tenant_id, warehouse_id, id)
   ↑ fk_node_parent (3 col)   ← recursiva: aisle → rack → bay
   ↑ fk_loc_node   (3 col)
spatial.locations
```

Las cuatro FK son **compuestas por tenant y almacén**. Hacen inexpresable que un cuerpo cuelgue de un rack de otro almacén, y no es una comprobación que alguien pueda saltarse.

---

## 8. Índices

**`spatial.nodes`** — ya existen `(parent_node_id)`, `(tenant_id, warehouse_id, node_type)`, `UNIQUE (tenant_id, warehouse_id, node_code)`. Se añaden:

```
(tenant_id, warehouse_id, node_type, logical_index)   orden natural del canvas
GIN (node_code gin_trgm_ops)                          buscador por texto
```

**`spatial.locations`** — ya existe `(tenant_id, node_id)`. Se añaden:

```
(node_id, logical_level, logical_position)   las ubicaciones de un cuerpo, ordenadas
GIN (code gin_trgm_ops)                      buscador
```

**No se crea** índice GIST sobre `world_position` mientras la columna esté al 100 % NULL: sería coste de escritura sin consulta.

`pg_trgm` está disponible y sin instalar; su instalación es parte de la migración.

---

## 9. Constraints

| Constraint | Qué impide |
|---|---|
| `node_edges` `rack→bay` | Que un cuerpo cuelgue de algo que no sea un rack |
| `chk_node_logical_index` | `logical_index` negativo |
| `UNIQUE (tenant_id, warehouse_id, node_code)` | Dos racks con el mismo código |
| `UNIQUE (parent_node_id, logical_index)` parcial en `bay` | Dos cuerpos con el mismo número en un rack |
| `UNIQUE (node_id, logical_level, logical_position)` | Dos ubicaciones en el mismo hueco. **Es la clave natural de la hoja** |
| `chk_loc_position` | `logical_position ∈ (1, 2)`. Medido: solo 2 valores |
| `chk_loc_level` | `logical_level` entre 1 y 99. Medido: 1-9 |
| **`trg_loc_code_coherente`** | Que `code` discrepe de la reconstrucción desde el árbol (§4.4) |

**`chk_loc_position` merece un aviso:** cerrar el vocabulario a `(1,2)` es correcto hoy pero es el tipo de CHECK que un almacén con posiciones 1-4 rompería. Recomiendo `BETWEEN 1 AND 9` en lugar de `IN (1,2)`: igual de protector contra basura y sin exigir migración si aparece una tercera posición.

---

## 10. Funciones SQL

Tres, y ninguna es un parser.

**`spatial.node_ancestors(uuid)`** → tabla de ancestros con su tipo. Recursiva sobre `parent_node_id`. Es la que alimenta el breadcrumb del canvas.

**`spatial.node_subtree(uuid)`** → todos los descendientes. Responde «todas las ubicaciones bajo el rack RCL07» en una llamada.

**`spatial.build_location_code(rack text, bay text, level int, position int)`** → `text`. **Compone, no descompone.** La usa el trigger de §4.4 y el importador para verificar lo que va a escribir. Que no exista su inversa es deliberado: descomponer es lo que se quiere eliminar.

Las tres con `SET search_path = ''` y `SECURITY INVOKER`, para que respeten RLS.

---

## 11. Cómo consulta el frontend «Muéstrame Rack RCL07»

**Sin una sola expresión regular, en dos pasos.**

**Paso 1 — el rack es un objeto:**

```
GET /v1/spatial/warehouses/{wid}/nodes?node_type=rack&search=RCL07

{ "id": "…", "node_code": "RCL07", "node_type": "rack",
  "node_function": "storage", "function_label": "Almacenaje",
  "logical_index": 7, "bay_count": 32, "location_count": 448 }
```

**Paso 2 — sus ubicaciones, paginadas:**

```
GET /v1/spatial/warehouses/{wid}/locations?parent_id={rack_id}&page=1&page_size=200

{ "items": [ { "location_id": "…", "full_code": "RCL07-C018-N05-2",
               "rack_code": "RCL07", "bay_code": "C018",
               "bay_index": 18, "level": 5, "position": 2,
               "status": "available", "is_bulk_area": false,
               "function_label": "Almacenaje" } ],
  "page": 1, "page_size": 200, "total": 448, "total_pages": 3,
  "next_cursor": "…" }
```

`parent_id` acepta **cualquier** nodo: pasando un `aisle` devuelve todo el pasillo; pasando un `bay`, sus 18 huecos. El frontend no sabe qué tipo de nodo le dieron, y no le hace falta.

**Y el canvas se dibuja con lo que ya viene**: `rack_index` ordena los racks, `bay_index` ordena los cuerpos, `level` es el eje vertical y `position` la profundidad. Ninguna de esas cuatro requiere partir una cadena.

---

## 12. Lo que este ADR deja sin decidir

- **`aisle` sigue vacío.** No se inventa desde la familia de letras (§1.1). Lo poblará el CAD o una declaración.
- **`DAÑADO` y `PHA LO`** (§1.5) necesitan una decisión antes del importador: ampliar el patrón de `code` o normalizar conservando el original.
- **Geometría** de rack y body: existe el sitio donde ponerla, no el importador que la calcula.
- **Particionado** de `spatial.locations`: innecesario con 29.310 filas; se decide con volumen real.

---

## 13. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | El primer segmento es polimórfico (§1.3): `RCL250` no es un rack | `node_type` se decide con `Tipo Ubicación` y recuento, no con el código. Los no-racks entran como `storage_area` |
| R2 | Generar la posición 1 automáticamente inventaría 3.866 huecos (§1.2) | Cada posición es una fila del catálogo. **Nunca derivada** |
| R3 | `code` redundante con la ruta del árbol | Trigger de coherencia (§4.4): la contradicción es imposible, no improbable |
| R4 | `chk_loc_position IN (1,2)` rompería con una tercera posición | `BETWEEN 1 AND 9` (§9) |
| R5 | 2.701 nodos de cuerpo hoy; 100× sería 300.000 | `btree` los resuelve. `ltree` queda como escalada si la profundidad crece |
| R6 | La vista sin `security_invoker` sería una fuga entre tenants | Obligatorio y verificado por `test_rls_coverage` |

---

## 14. Ajuste final aprobado · 2026-07-30

Ocho decisiones. Donde una medición nueva las refina, se dice.

### 14.1 `bay` entra en el vocabulario cerrado · impacto completo

Es un cambio explícito a la arquitectura congelada. Lo que toca:

| Artefacto | Cambio |
|---|---|
| `spatial.node_types` | `+1 fila`: `bay`, `depth_hint = 6`. `storage_area` pasa a 7 |
| `spatial.node_edges` | `+3`: `rack→bay`, `aisle→rack`, `bay→storage_area` — la última para un cuerpo subdividido |
| `spatial.nodes` | `+ logical_index smallint`: el 18 de `C018`, para ordenar sin parsear |
| Pruebas de jerarquía | `+2`: que `bay→rack` se rechace (arista inversa) y que `rack→bay` se acepte |
| `ARCHITECTURAL_INVARIANTS.md` | **SPA-02 pasa de 6 a 7 valores estructurales.** Es la única invariante que cambia |
| Contrato del frontend | `NodeType` gana `'bay'`. Es aditivo: ningún valor existente cambia de significado |
| ADR-010 §6.6 | La lista de 6 pasa a 7 |

**El coste real de añadir un tipo, medido:** la matriz de aristas crece en 3 filas, no multiplicativamente. Es la propiedad que da la separación `node_type` / `node_function`: si `bay` hubiera sido una función habría necesitado 7 aristas nuevas.

### 14.2 Jerarquía objetivo, confirmada

```
warehouse → site → aisle (opcional, 0 filas) → rack → bay → location
                                                             logical_level 1-9
                                                             logical_position 1-9
```

`logical_level` y `logical_position` **se quedan en `spatial.locations`**. No se crean nodos de nivel ni de posición: serían 16.588 filas que duplican columnas que ya existen desde 0052.

### 14.3 `aisle` no se infiere · nunca

Medido en §1.1: la familia `RCL` abarca 2 preámbulos, 2 tipos operativos y **11 zonas de almacenaje**. Un pasillo físico no hace eso.

**Regla:** un rack sin pasillo tiene `parent_node_id` apuntando directamente al **sitio**, y la arista `site → rack` debe existir en la matriz. La vista devuelve `aisle_id` y `aisle_code` como **NULL**, no como cadena vacía ni como valor inventado.

El frontend renderiza los racks sin pasillo como hijos directos del sitio. Cuando llegue una fuente fiable —CAD, o una declaración humana— se insertan los nodos `aisle` y se repuntan los racks: es un `UPDATE` de `parent_node_id`, **sin `ALTER TABLE`**. Y el trigger de ciclos ya protege ese repunte.

### 14.4 Ninguna posición hermana automática

Medido en §1.2: **3.866 tripletas (referencia, columna, nivel) tienen una sola posición**, el 23,3 %. El importador crea exactamente las filas presentes en la fuente.

Queda como prueba obligatoria del importador (§14.8, P4).

### 14.5 `logical_position BETWEEN 1 AND 9`

Aprobado. Y `logical_level BETWEEN 1 AND 99`. Los dos rangos son laxos a propósito: protegen de basura sin exigir una migración el día que aparezca una tercera posición o un nivel 12.

### 14.6 Estrategia `code` / `external_code`

**Medición que refina el problema.** Los 29.310 códigos conforman `<ref>-C###-N##-P`: cero excepciones estructurales. El problema es el juego de caracteres y afecta a **3 filas**:

```
ref 'DAÑADO'   Ubicación 'DAÑADO-C001-N01-1'   Id Ubicación '80DAÑADO0010101'
ref 'PHA LO'   Ubicación 'PHA LO-C001-N01-1'   Id Ubicación '80PHA LO0010101'
```

**Tres identidades, cada una con un dueño distinto:**

| Columna | Contenido | `DAÑADO` | `PHA LO` |
|---|---|---|---|
| `code` | dirección **normalizada**, uso interno | `DANADO-C001-N01-1` | `PHA_LO-C001-N01-1` |
| `external_code` | `Ubicación` **exacta** del WMS | `DAÑADO-C001-N01-1` | `PHA LO-C001-N01-1` |
| `external_location_id` | `Id Ubicación` del WMS (existe desde 0052) | `80DAÑADO0010101` | `80PHA LO0010101` |

`external_code` es **columna propia, no `raw_source`**, precisamente por lo que se advierte: es una identidad operativa —la que reconcilia con el WMS— y necesita índice único, NOT NULL cuando el origen es el catálogo, y visibilidad en la API. Enterrarla en un JSONB la convertiría en un dato de segunda.

`spatial.nodes` recibe el mismo par: `node_code` normalizado y `external_code` exacto. Si el rack se llama `DAÑADO`, su nodo lo refleja en las dos formas.

**Normalización, determinista y documentada:**

```
1. mayúsculas
2. transliteración de diacríticos:  Ñ→N, Á→A, …   (unaccent sobre ASCII)
3. espacio → «_»
4. cualquier otro carácter fuera de [A-Z0-9._] → «_»
```

**El paso 3 usa `_` y no `-` a propósito.** El guion es el separador de segmentos: convertir el espacio en guion daría `PHA-LO-C001-N01-1`, **cinco segmentos**, y rompería la reconstrucción. Es el tipo de error que produce un resultado plausible y equivocado.

El patrón de `code` se amplía a `^[A-Z0-9][A-Z0-9._-]*$` — añade el `_`. La transliteración es la misma función que ya usa `sanitizar_nombre()` para las rutas de Storage, así que el criterio no se duplica.

### 14.7 Reglas de consistencia · solo para formatos declarados estructurados

**Clasificación explícita.** `spatial.locations` recibe:

```
code_form varchar(12) NOT NULL DEFAULT 'structured'
    ∈ ('structured', 'opaque')
```

| Valor | Significado | En esta fuente |
|---|---|---|
| `structured` | Cumple `^[^-]+-C\d{3}-N\d{2}-\d$`. Rack/body/nivel/posición **significan** algo | **29.310 de 29.310** |
| `opaque` | No cumple, o el origen no garantiza la forma. **El parser no se aplica** | 0 hoy |

Un CHECK impide declarar `structured` una fila que no cumpla el patrón: la etiqueta no puede mentir.

**La regla de coherencia se aplica SOLO a `structured`**, y compara `code` con la reconstrucción:

```
primer_segmento  = node_code del ancestro más cercano de tipo `rack` o `storage_area`
C###             = lpad(logical_column, 3, '0')
N##              = lpad(logical_level,  2, '0')
P                = logical_position
```

Y una segunda regla cuando existe un `bay`: **`bay.logical_index` debe igualar `location.logical_column`.** Sin ella el cuerpo `C018` podría contener ubicaciones que dicen `C019`.

**Dónde vive la regla.** Trigger `BEFORE INSERT OR UPDATE`, no comprobación del importador. La razón es la de siempre en este proyecto: una regla que solo vive en el importador se rompe la primera vez que alguien escribe por otra vía. Códigos de error por `DETAIL` estable —`SPATIAL_CODE_INCONSISTENT`, `SPATIAL_BAY_INDEX_MISMATCH`— registrados en el traductor.

**Lo que la regla NO hace:** no se aplica a `opaque`, no descompone nada, y **no existe función inversa**. `spatial.build_location_code()` compone; que no haya `parse_location_code()` es deliberado.

**Sobre los polimórficos.** `GUACI5-C001-N01-1` es `structured` —parsea perfectamente— pero su nodo padre es un `storage_area`, no un `rack`, y no tiene `bay`. La reconstrucción funciona igual porque usa «el ancestro rack **o** storage_area». Lo que distingue a `GUACI5` no es la forma del código sino `is_bulk_area` y su tipo de nodo, que es donde debe estar.

### 14.8 Consultas, rollback y pruebas del importador

**Consultas esperadas** (§11 sigue vigente, más estas):

```
GET .../nodes?node_type=rack&search=RCL07          el rack como objeto
GET .../nodes?parent_id={rack}&node_type=bay       sus 32 cuerpos, ordenados por logical_index
GET .../locations?parent_id={bay}                  los ≤18 huecos del cuerpo
GET .../locations?parent_id={rack}&page=1          las 448 del rack, paginadas
GET .../locations?search=RCL07-C018                por texto, sobre code y external_code
GET .../nodes?parent_id={site}&node_type=rack      racks SIN pasillo (§14.3)
```

**Rollback.** Cada pieza revierte por separado, en orden inverso:

| Migración | Rollback |
|---|---|
| `bay` en `node_types` + 3 aristas | `DELETE` de las aristas y del tipo. Falla si algún nodo es `bay`, y ese fallo es la señal |
| `logical_index` en `nodes` | `DROP COLUMN` |
| `external_code` y `code_form` | `DROP COLUMN`. **Guarda: falla si algún `code` difiere de su `external_code`**, porque entonces la normalización llevaba información que se perdería |
| Triggers de coherencia | `DROP TRIGGER` + `DROP FUNCTION` |
| Repunte de `node_id` de área a cuerpo | El inverso, con huella del enlace comparada en cuatro puntos, como 0051 |
| Vista `locations_resolved` | `DROP VIEW` |

**Pruebas del importador** — las que cierran las decisiones que un CHECK no puede demostrar:

| # | Prueba |
|---|---|
| **P1** | Las 4 huérfanas del inventario —`RETIRA`, `LAYOUT`, `PISO1`, `SOBRA`— quedan con `origin='inferred'` y aparecen en el resumen. **Es la prueba que reclamaste: el CHECK de `origin` no demuestra el mapeo** |
| **P2** | `DAÑADO` y `PHA LO` producen `code` normalizado y `external_code` exacto, y el original se puede recuperar carácter a carácter |
| **P3** | Reimportar el mismo archivo no duplica ni una fila (hash + clave natural) |
| **P4** | De las 16.588 tripletas, las **3.866 con una sola posición** crean **una** ubicación, no dos |
| **P5** | Los 2.701 cuerpos se crean una vez; `bay.logical_index` coincide con `logical_column` en las 29.310 |
| **P6** | Los 347 primeros segmentos crean 347 nodos, **no 29.310**: la prueba de que no hay duplicación |
| **P7** | Ningún rack recibe `aisle` inventado: `aisle_id` es NULL en las 29.310 |
| **P8** | `999999999`, `1000000000` y `0` de `Peso Máximo` llegan como NULL |
| **P9** | Ninguna `world_*` se puebla: el importador del catálogo no toca geometría |
| **P10** | Un código con 5 segmentos se rechaza como fila inválida y queda auditado, sin tumbar el lote |

### 14.9 Lo que sigue sin decidir

- El **pasillo** sigue vacío hasta que exista fuente (§14.3).
- La **geometría** de rack y cuerpo: existe el sitio, no el importador que la calcula.
- Si `code_form = 'opaque'` llegara a usarse, habrá que decidir qué significa una ubicación sin dirección estructurada. Hoy no hay ninguna.
