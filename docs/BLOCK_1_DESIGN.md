# Bloque 1 — Precisiones al modelo y diseño del CRUD

> **Estado: propuesta. Nada ejecutado, nada modificado.**
> Última migración aplicada: **0041**. Historial 41/41. Suite: 102 en verde.
>
> Las conclusiones de §1 **no son análisis del código: son mediciones**. Ejecuté un
> sondeo contra la base real que intenta mutar cada campo del contrato con una
> versión existente, dentro de una transacción deshecha. La salida está en §1.1.

---

## 1. Precisión 1 — Inmutabilidad completa del contrato

### 1.1 Lo que mide el sondeo

Modelo `yolo11n` / `detect` / `image` con **una versión registrada**. Se intenta
mutar cada campo:

```
A input_type       : MUTABLE  → quedó en "frames"
B framework_code   : protegido (framework incoherente: …)
C requires_training : protegido (requires_training se deriva de la arquitectura …)
D divergencia fw   : SÍ  → modelo="ultralytics" arquitectura="pytorch"
E divergencia rt   : modelo=true  arquitectura=false
F quitar la tarea  : PERMITIDO → el modelo detect queda huérfano
```

**Tres agujeros reales, y el más grave no es ninguno de los tres campos por los
que preguntas.**

### 1.2 Agujero A — `input_type` es mutable. Defecto directo.

El trigger protege `architecture_code` y `task`, y **se olvidó de `input_type`**.
`yolo11n` soporta `image`, `video` y `frames`, así que un modelo con pesos puede
pasar de `image` a `frames`. Eso cambia cómo se alimentan los pesos: un modelo
entrenado sobre fotogramas sueltos y consultado como secuencia produce resultados
distintos sin avisar de nada.

Es exactamente el mismo error que `task` y `architecture_code`, y se colgó de la
misma condición. **Se arregla añadiendo `input_type` a la guarda.**

### 1.3 Agujeros D y E — divergencia por el otro lado. Es el hallazgo importante.

`framework_code` y `requires_training` están protegidos contra edición **del
modelo**. Nadie protege la **arquitectura**.

Editando `ai.architectures.framework_code`, la copia del modelo queda obsoleta:
el modelo dice `ultralytics` y su arquitectura dice `pytorch`. Consecuencia
concreta: el worker despacha por `framework_code` (migración 0035), así que
invocaría el **adaptador equivocado** — y ese fallo aparecería en el worker,
lejos de la causa, con un mensaje sobre un modelo que no carga.

Lo mismo con `requires_training`: modelo `true`, arquitectura `false`.

La guarda de la migración 0037 comprueba la coherencia **solo cuando se toca el
modelo**. Es la mitad del invariante.

### 1.4 Agujero F — se puede retirar la capacidad que un modelo usa

Cambiar `supported_tasks` de `yolo11n` a `['segment']` deja huérfano a todo modelo
`detect` que la use: el modelo existe, referencia una arquitectura que ya no
declara su tarea, y nada lo detecta. Un `INSERT` nuevo se rechazaría, pero los
existentes quedan en un estado que el propio sistema considera imposible.

### 1.5 Propuesta: quitar el duplicado, no vigilarlo

Dijiste «no dupliques valores derivados sin necesidad». Aplicado a los dos
campos, dan respuestas distintas:

| Campo | ¿Qué es? | Decisión |
|---|---|---|
| `models.framework_code` | **duplicado puro.** El framework de una arquitectura es un hecho de identidad: si `yolo11n` es de Ultralytics, lo será siempre. Cambiarlo no es una edición legítima, es corrupción | **ELIMINAR** de `ai.models`. Se deriva con un JOIN por PK |
| `models.requires_training` | **instantánea con significado.** Congela «qué era cierto cuando se creó este modelo», igual que `class_snapshot` congela el vocabulario. No es duplicado: es historia | **CONSERVAR**, y proteger la arquitectura |

Eliminar `framework_code` no deja el invariante «protegido»: lo hace
**inexpresable**. No puede divergir algo que solo existe en un sitio. Es
estrictamente mejor que cualquier trigger.

El coste es un JOIN por PK cuando el worker necesita el adaptador. Insignificante,
y de todos modos ya tiene que leer la arquitectura para conocer
`hyperparam_schema` y `weights_extension`.

### 1.6 Regla final del contrato

Con **al menos una versión no eliminada**, son inmutables:

| Campo | Mecanismo | ¿Existe hoy? |
|---|---|---|
| `architecture_code` | guarda en `models` | sí (0038) |
| `task` | guarda en `models` | sí (0038) |
| `input_type` | guarda en `models` | **NO — agujero A** |
| `requires_training` | no editable + guarda en `architectures` | mitad: falta el lado de la arquitectura |
| `framework_code` | **inexpresable**: se elimina la columna | **NO** |

Y en `ai.architectures`, con modelos que la referencien:

- `framework_code` inmutable **siempre** (es identidad, no una propiedad)
- `requires_training` y `requires_annotations` inmutables si hay modelos
- no se puede **retirar** de `supported_tasks` ni de `supported_input_types` un
  valor que algún modelo vivo use. Añadir sí: amplía capacidades sin romper nada.

Esa asimetría —añadir libre, retirar restringido— es la forma correcta: el
catálogo debe poder crecer sin ceremonia.

---

## 2. Precisión 2 — Ciclo de vida de `ai.model_versions`

### 2.1 Qué está mal hoy

`status ∈ {candidate, active, archived, rejected}`. Tienes razón en que `active`
carga con cuatro significados a la vez, y hay uno más que no mencionas: **no hay
forma de decir «esta versión existe pero todavía no sabemos si sirve»** que se
distinga de «la evaluamos y no sirve».

### 2.2 Los siete estados

Tu lista es correcta. Cambio **un** nombre y explico por qué:

```
registered ──► validating ──► validated ──► published ──► deprecated ──► archived
     │              │              │                                        ▲
     │              └──► failed ───┘                                        │
     └──────────────────────────────────────────────────────────────────────┘
                                    (retirar sin publicar nunca)
```

| Estado | Significado | Puede ser el publicado |
|---|---|---|
| `registered` | pesos presentes, nada afirmado sobre su calidad | no |
| `validating` | evaluación en curso | no |
| `validated` | evaluación superada; **elegible** para publicar | no |
| `published` | **la que produce observaciones en producción** | sí, y solo una |
| `deprecated` | fue la publicada, sustituida; sigue descargable y auditable | no |
| `archived` | retirada del uso; se conserva por trazabilidad | no |
| `failed` | la evaluación falló, o los pesos no cargan | no |

**`draft` → `registered`.** «Draft» implica incompleto o editable, y una versión
nunca lo es: `weights_asset_id` es `NOT NULL`, así que en el instante en que la
fila existe los pesos existen. Lo que falta no es contenido, es **juicio**.
`registered` lo dice sin prometer nada. Es un cambio cosmético; si prefieres
`draft`, no cambia ninguna invariante.

`deprecated` y `archived` no son redundantes: `deprecated` es «tuvo su turno»,
`archived` es «no volverá a usarse». La política de retención que fijaste
distingue justamente esos dos casos.

### 2.3 `current_version_id` debería desaparecer

Tus invariantes 2, 3 y 5 son las tres sobre `current_version_id`:

> 2. solo puede apuntar a una versión `published`
> 3. la versión debe pertenecer al mismo modelo
> 5. una versión `failed` o `archived` nunca puede serlo

Las tres son consecuencias de un problema evitable. El índice parcial
`UNIQUE (model_id) WHERE status = 'published'` garantiza **exactamente 0 o 1**
versión publicada por modelo. Así que `current_version_id` es **100 % derivable**:

```sql
SELECT id FROM ai.model_versions
 WHERE model_id = :m AND status = 'published';   -- una sonda al índice único
```

Mantener la columna exige:

- un trigger en `model_versions` que actualice el puntero al publicar y al
  degradar, en las dos direcciones;
- un trigger en `models` que rechace un puntero a una versión no publicada o de
  otro modelo;
- y aun así queda una ventana dentro de una transacción en la que ambos discrepan.

Eliminarla convierte las tres invariantes en **inexpresables**: no hay puntero
que pueda apuntar mal. Es el mismo argumento de §1.5, aplicado dos veces en el
mismo documento porque es el mismo error dos veces.

**Recomiendo eliminarla.** Con 0 filas es un `DROP COLUMN` y la FK que añadí en
0038 desaparece con ella.

Si prefieres conservarla —porque leer el modelo sin JOIN tiene valor—, se puede,
y entonces hacen falta los dos triggers. Dilo y lo hago así; solo quiero que la
elección sea consciente, porque en el segundo caso la corrección depende de
código y no de estructura.

### 2.4 Publicar: una transacción, dos sentencias

```sql
BEGIN;
  UPDATE ai.model_versions
     SET status = 'deprecated', deprecated_at = now()
   WHERE model_id = :m AND status = 'published';        -- degradar la anterior

  UPDATE ai.model_versions
     SET status = 'published', published_at = now(), published_by = :u
   WHERE id = :v AND status = 'validated';              -- promover la nueva
COMMIT;
```

El orden es obligatorio: al revés, el índice parcial rechaza la segunda sentencia.
Eso no es un inconveniente — es el motor forzando que la degradación sea
**explícita**, que es tu invariante 4. No existe un camino que publique sin
degradar.

**El rollback es la misma operación**, con los papeles cambiados: promover una
`deprecated` degrada a la actual. Así no hay un camino de código distinto que
pueda estar roto justo el día que hace falta revertir.

Solo se publica desde `validated`. Un `registered` sin evaluar no llega a
producción por descuido.

### 2.5 Los tres orígenes comparten el ciclo (invariante 6)

`status` no menciona `origin` en ninguna condición, así que se cumple por
construcción. Un SAM2 `pretrained` pasa por `registered → validating → validated
→ published` igual que un `trained`.

Con un matiz que conviene dejar dicho: para `pretrained`, «validar» no es
reentrenar sino **evaluar contra una versión de dataset**, que es lo que hará
`ai.evaluations` en el Bloque 5. Hasta entonces la transición
`registered → validated` la hará un owner de forma explícita, y el registro
privilegiado guardará quién y cuándo.

---

## 3. ¿Migración 0042? Sí, y son dos

Recomiendo **dos**, no una, por la razón que ya acordamos en la decisión E: no
fusionar cambios cuyo rollback es independiente.

| # | Contenido | Riesgo |
|---|---|---|
| **0042** | Contrato del modelo: `input_type` a la guarda · `DROP framework_code` · trigger nuevo en `ai.architectures` | medio |
| **0043** | Ciclo de vida: 7 estados · `deprecated_at`, `validated_at` · índice parcial `published` · `DROP current_version_id` | medio |

Fusionarlas significaría que revertir el ciclo de vida obliga a revertir también
la corrección de inmutabilidad, que es un defecto de seguridad y debe poder
quedarse aplicada por sí sola.

**Las dos antes del Bloque 1**, y no después. Ambas cambian la forma de
`ai.models` y `ai.model_versions`, que es justo lo que el CRUD va a exponer: el
esquema Pydantic de un modelo no puede llevar `framework_code` si la columna va a
desaparecer, y el contrato TypeScript tampoco.

### 3.1 Objetos afectados

**0042**
- `ai.models`: `DROP COLUMN framework_code` (y su FK a `ai.frameworks`)
- `ai.validate_model_against_architecture()`: `input_type` en la guarda; deja de
  comprobar `framework_code`; toma el framework de la arquitectura
- **nueva** `ai.protect_architecture_contract()` + trigger `BEFORE UPDATE` en
  `ai.architectures`
- **nueva vista** `ai.models_resolved` — el modelo con su framework y adaptador
  resueltos, para que el worker no repita el JOIN

**0043**
- `ai.model_versions`: nuevo `CHECK` de los 7 estados, `+ validated_at`,
  `+ deprecated_at`, `+ failure_reason`
- índice `uq_mv_activo` → `uq_mv_publicada` (`WHERE status = 'published'`)
- `CHECK` de coherencia entre estado y sus marcas de tiempo
- `ai.models`: `DROP COLUMN current_version_id` + su FK
- **nueva** `ai.validate_version_transition()` + trigger: solo transiciones del
  diagrama de §2.2

---

## 4. Bloque 1 — Endpoints

Todos bajo `/v1/ai`, todos con `PlatformOwnerRequired` **antes** de cualquier
permiso.

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/v1/ai/frameworks` | `ai_architectures:read` | catálogo, sin paginar: son 6 |
| `GET` | `/v1/ai/architectures` | `ai_architectures:read` | filtros `framework`, `task`, `is_active` |
| `GET` | `/v1/ai/architectures/{code}` | `ai_architectures:read` | incluye `hyperparam_schema` |
| `GET` | `/v1/ai/projects` | `ai_projects:read` | keyset, filtros `status`, `search` |
| `POST` | `/v1/ai/projects` | `ai_projects:write` | `201` + `Location` + `ETag` |
| `GET` | `/v1/ai/projects/{id}` | `ai_projects:read` | `ETag` |
| `PATCH` | `/v1/ai/projects/{id}` | `ai_projects:write` | exige `If-Match` |
| `DELETE` | `/v1/ai/projects/{id}` | `ai_projects:delete` | lógico; exige `If-Match` |
| `GET` | `/v1/ai/projects/{id}/models` | `ai_projects:read` | keyset, filtros `task`, `status` |
| `POST` | `/v1/ai/projects/{id}/models` | `ai_models:write` | valida contra el catálogo |
| `GET` | `/v1/ai/models/{id}` | `ai_models:read` | framework resuelto por la vista |
| `PATCH` | `/v1/ai/models/{id}` | `ai_models:write` | `409` si toca lo inmutable con versiones |
| `DELETE` | `/v1/ai/models/{id}` | `ai_projects:delete` | lógico |
| `GET` | `/v1/ai/projects/{id}/classes` | `ai_classes:read` | filtro `is_active` |
| `POST` | `/v1/ai/projects/{id}/classes` | `ai_classes:write` | `class_index` lo asigna el servidor |
| `PATCH` | `/v1/ai/classes/{id}` | `ai_classes:write` | nombre, color, `is_active`. **NO** `class_index` |
| `GET` | `/v1/ai/models/{id}/classes` | `ai_classes:read` | vocabulario con `training_index` |
| `PUT` | `/v1/ai/models/{id}/classes` | `ai_classes:write` | **reemplazo completo**, ver §4.2 |

**18 endpoints.** Ninguno de `model_versions`: fuera de alcance.

### 4.1 Tres decisiones de contrato

**`class_index` lo asigna el servidor, no el cliente.** Es inmutable y no
reutilizable (migración 0026); dejar que el cliente lo elija solo permite
colisiones y huecos. El servidor toma `max(class_index) + 1` del proyecto.

**No hay `DELETE` de clases.** Se desactivan con `PATCH is_active = false`, que es
lo que pediste en la Fase 2 y la única vía segura. Exponer un `DELETE` que
internamente desactiva mentiría sobre lo que hace.

**El vocabulario de un modelo se reemplaza con `PUT`, no se parchea.** Ver abajo.

### 4.2 Por qué `PUT` para `model_classes`

`training_index` debe ser contiguo `0..N-1`: es lo que el framework espera. Con
`POST`/`DELETE` individuales, retirar la clase del índice 1 de tres deja `0, 2`
—un hueco que el framework no admite— y el cliente tendría que renumerar el resto
con varias peticiones, sin atomicidad.

Con `PUT` se envía la lista ordenada completa, el servidor asigna los índices por
posición, y la operación es atómica. Además encaja con el trigger de la migración
0039: si el modelo ya tiene versiones, el `PUT` falla completo en lugar de a
medias.

### 4.3 Un detalle de `PATCH /models/{id}` que el frontend debe conocer

Intentar cambiar `task` o `input_type` en un modelo **con versiones** devuelve
`409 CONFLICT` con `details.immutable_fields`, no `400`. No es un error de
validación —el valor es válido— sino un conflicto con el estado del recurso. El
mensaje debe decir «crea un modelo nuevo», que es la salida real.

---

## 5. Tablas afectadas

| Tabla | Bloque 1 |
|---|---|
| `ai.projects` | CRUD completo |
| `ai.models` | CRUD completo |
| `ai.classes` | crear, editar, desactivar. Sin borrado |
| `ai.model_classes` | reemplazo completo por modelo |
| `ai.frameworks` | solo lectura |
| `ai.architectures` | solo lectura |
| `ai.model_versions` | **solo lectura de conteo**, para saber si el contrato está congelado |
| `platform.privileged_operation_log` | escritura en borrados y desactivaciones |

Ninguna otra se toca.

---

## 6. Archivos

### Nuevos — 14

```
backend/src/olo/domain/ai/__init__.py
backend/src/olo/domain/ai/project.py        AiProject + invariantes de dominio
backend/src/olo/domain/ai/model.py          AiModel, Task, InputType, ModelStatus
backend/src/olo/domain/ai/klass.py          AiClass, ModelClass
backend/src/olo/domain/ai/catalog.py        Framework, Architecture (capacidades)

backend/src/olo/repositories/ai/__init__.py
backend/src/olo/repositories/ai/project.py
backend/src/olo/repositories/ai/model.py
backend/src/olo/repositories/ai/klass.py
backend/src/olo/repositories/ai/catalog.py

backend/src/olo/services/ai/__init__.py
backend/src/olo/services/ai/project.py
backend/src/olo/services/ai/model.py        traduce los errores del trigger a 409/422
backend/src/olo/services/ai/klass.py        asignación de índices, reemplazo atómico

backend/src/olo/api/v1/ai_projects.py
backend/src/olo/api/v1/ai_models.py
backend/src/olo/api/v1/ai_classes.py
backend/src/olo/api/v1/ai_catalog.py
backend/src/olo/api/v1/ai_schemas.py        Pydantic del módulo, separado del resto

backend/tests/test_ai_projects_api.py
backend/tests/test_ai_models_api.py
backend/tests/test_ai_classes_api.py
backend/tests/test_ai_repositories.py

frontend/src/lib/aiTypes.ts                 contrato TypeScript
```

`klass.py` y no `class.py`: `class` es palabra reservada de Python.

`ai_schemas.py` separado de `api/v1/schemas.py`: ese archivo ya tiene 200 líneas
y el módulo de IA añadiría unas 300. Mezclarlos haría que un cambio en un almacén
y uno en un modelo compitan por el mismo archivo.

### Modificados — 4

```
backend/src/olo/main.py                     registrar 4 routers
backend/src/olo/api/deps.py                 nada, o un alias de conveniencia
frontend/src/auth/sessionStore.ts           reexportar los tipos de IA
docs/FRONTEND_INTEGRATION_GUIDE.md          sección del módulo de IA
```

`repositories/ai/` como paquete y no `repositories/ai_project.py`: cuatro
repositorios de un mismo dominio, y en el Bloque 3 llegan datasets y anotaciones.

---

## 7. Pruebas

**~55 nuevas.** Sobre las 102 actuales.

**Precisión 1 — inmutabilidad (12)**
1. `input_type` mutable **sin** versiones
2. `input_type` inmutable **con** versiones → 409
3. `framework_code` no existe en `ai.models`
4. `ai.models_resolved` devuelve el framework y el adaptador correctos
5. `architectures.framework_code` inmutable siempre → error
6. `architectures.requires_training` inmutable con modelos → error
7. quitar de `supported_tasks` una tarea en uso → error
8. **añadir** a `supported_tasks` → permitido
9. quitar de `supported_tasks` una tarea que nadie usa → permitido
10-12. las tres guardas previas (`architecture_code`, `task`, `requires_training`) siguen vivas

**Precisión 2 — ciclo de vida (11)**
13. los 7 estados se aceptan
14. `candidate` y `active` ya no → error
15. dos `published` del mismo modelo → error
16. `registered → published` directo → error (hay que validar antes)
17. `validated → published` → correcto
18. publicar degrada la anterior en la misma transacción
19. publicar sin degradar → violación de unicidad
20. rollback: promover una `deprecated` degrada a la actual
21. `failed → published` → error
22. `current_version_id` no existe
23. los tres orígenes recorren el mismo ciclo

**CRUD de proyectos (8)** · listado con keyset · crear/leer/editar/borrar ·
`If-Match` ausente → 428 · `ETag` obsoleto → 412 · slug duplicado → 409 ·
borrado lógico invisible

**CRUD de modelos (10)** · varios por proyecto · `409` al tocar lo inmutable con
versiones · `422` por combinación no soportada, con la lista de soportadas ·
filtros por `task` y `status` · framework resuelto en la respuesta

**Clases y vocabulario (9)** · `class_index` asignado por el servidor ·
desactivar no renumera · nombre único entre vivas · `PUT` reemplaza y renumera ·
`PUT` con versiones existentes falla **completo** · clase de otro proyecto → 422

**Autorización (5)** · no-owner → 403 `NOT_PLATFORM_OWNER` en los 18 endpoints ·
owner con permiso → 200 · aislamiento RLS de las tablas nuevas

Y las **102 existentes** deben seguir pasando: es la prueba de compatibilidad.

---

## 8. Orden de implementación

| Paso | Contenido | Comprobación de que está bien |
|---|---|---|
| 1 | Migración **0042** con su rollback y ciclo completo | el sondeo de §1.1 falla en los 6 puntos |
| 2 | Migración **0043** con su rollback y ciclo completo | publicar exige degradar; no hay puntero que pueda apuntar mal |
| 3 | Dominio: `domain/ai/*` | invariantes puras, sin base de datos |
| 4 | Repositorios: `repositories/ai/*` + `test_ai_repositories.py` | keyset estable, sin filtrado propio |
| 5 | Servicios + traducción de errores del trigger | un `raise_exception` del motor sale como 409, no como 500 |
| 6 | Endpoints de catálogo (los 3 más simples) | primer 403 y primer 200 reales |
| 7 | CRUD de proyectos | patrón completo replicado |
| 8 | CRUD de modelos | el trigger visible como 409/422 |
| 9 | Clases y `PUT` de vocabulario | renumeración atómica |
| 10 | Contrato TypeScript + `tsc` | frontend compila con los tipos nuevos |
| 11 | Suite completa + guía del frontend | ~157 pruebas en una invocación |

Los pasos 1 y 2 son los que necesitan tu aprobación explícita: los demás no
cambian el esquema.

---

## 9. Riesgos y decisiones abiertas

### 9.0 Resuelto antes de empezar (post-aprobación)

Tres ajustes pedidos en la revisión, ya hechos:

**`ai.models_resolved` es un read model, no el contrato del dominio.** Las
entidades siguen siendo `ai.models`, `ai.architectures` y `ai.frameworks`.
Consecuencia concreta para el Bloque 1:

| Capa | Qué usa |
|---|---|
| `repositories/ai/model.py` | **escribe y lee `ai.models`**. Es la fuente de verdad |
| `repositories/ai/model.py` (consultas de listado y detalle) | lee `ai.models_resolved` solo para enriquecer |
| `domain/ai/model.py` | `AiModel` **no** tiene `framework_code`: es derivado |
| `ai_schemas.py` | `AiModelOut` expone `framework_code`, `framework_name`, `adapter` como **solo lectura**; `AiModelCreate` y `AiModelUpdate` **no los aceptan** |

Así, cambiar la vista —añadir una columna derivada, reorganizar el JOIN— no rompe
clientes ni el dominio. La migración 0044 comprueba además que la vista **no es
insertable**, para que nadie la convierta en una segunda puerta de escritura.

**El catálogo es vigente, el entrenamiento es histórico.** Escrito en los
comentarios de `ai.architectures` (migración 0044) y en el ADR-008 §8.1. Para
responder «¿con qué parámetros se entrenó esta versión?» nunca se consulta el
catálogo, sino el `config_snapshot` del run.

**Extracción de errores encapsulada.** `olo/db/pg_errors.py` es el único archivo
del proyecto acoplado a los internos de SQLAlchemy y asyncpg. Detalle en §9.1.

### 9.1 Riesgos

**Traducir errores del motor — RESUELTO, con una trampa medida.**

El acoplamiento con el driver está encapsulado en un componente único:

```
olo/db/pg_errors.py        extract_pg_error(exc) -> PgError | None   (mecánico)
olo/services/ai/errors.py  translate_pg_error(exc) -> OloError | None (política)
```

`PgError` devuelve `sqlstate`, `detail`, `constraint`, `message`, `table`, `schema`
y `hint`. Se separan a propósito: el extractor no sabe nada del dominio, y la
política no sabe nada del driver.

**La trampa, medida contra este stack:** SQLAlchemy conserva `sqlstate` en
`e.orig` pero **pierde `detail`** — solo está en `e.orig.__cause__`. Y eso es un
detalle de implementación del dialecto, no su contrato público. Por eso el
extractor **no asume ninguna forma**: recorre la cadena siguiendo `__cause__`,
`__context__` y `.orig`, y recoge **cada campo por separado** del primer sitio
donde aparezca. Funciona igual con asyncpg crudo, con SQLAlchemy encima, o con una
capa futura que envuelva a las dos.

**El mapa es exhaustivo, y está demostrado.** `test_pg_error_extraction.py` lee
los archivos de `supabase/migrations/`, extrae cada literal `DETAIL = '...'` y
falla si alguno no tiene traducción. Verifiqué que la prueba muerde inyectando un
código inventado en una migración temporal: falló nombrando el código y el archivo.
Un `DETAIL` sin mapear ya no puede llegar a producción como 500.

Dos decisiones del traductor que conviene conocer:

- **un código desconocido devuelve `None`**, y sale como 500. Devolver un 409
  genérico convertiría un fallo real —conexión caída, bug— en algo que parece una
  regla de negocio y que nadie investigaría;
- **el mensaje del motor nunca sale al cliente.** Los mensajes de los triggers
  nombran tablas, columnas y constraints; van al log y se responde con el mensaje
  de la clase de error. Hay una prueba que lo comprueba buscando fugas concretas.

**El `PUT` de vocabulario con versiones existentes.** El trigger de 0039 rechaza
`INSERT`, `UPDATE` y `DELETE` cuando hay versiones. Un `PUT` que borre e inserte
fallará en la primera sentencia. Correcto, pero el mensaje debe explicar el
porqué, no filtrar el del trigger.

**Renumerar `training_index` en una sola sentencia.** Reemplazar `[a,b,c]` por
`[c,a,b]` con `UPDATE` individuales viola `uq_mc_indice` a mitad de camino.
Solución: `DELETE` + `INSERT` en la misma transacción, o un `UPDATE ... FROM`
con los índices finales calculados. Lo segundo es preferible: conserva `created_at`.

**`ai.projects` sigue sin `current_model_version_id`.** No hace falta y no lo voy
a añadir: un proyecto con cinco modelos no tiene un modelo activo. Lo menciono
porque estaba en la arquitectura original y desaparece a propósito.

### 9.2 Decisiones abiertas — necesito tu respuesta

| | Pregunta | Mi recomendación |
|---|---|---|
| **A** | ¿Eliminar `models.framework_code`? | **Sí.** Duplicado puro sin semántica de instantánea |
| **B** | ¿Eliminar `models.current_version_id`? | **Sí.** Convierte tus invariantes 2, 3 y 5 en inexpresables |
| **C** | `registered` en lugar de `draft` | **Sí**, pero es cosmético |
| **D** | ¿`PUT` para el vocabulario del modelo? | **Sí.** `training_index` contiguo exige atomicidad |
| **E** | ¿`class_index` lo asigna el servidor? | **Sí.** Inmutable y no reutilizable: el cliente no puede elegirlo bien |
| **F** | ¿Dos migraciones (0042 + 0043) o una? | **Dos.** El arreglo de seguridad debe poder quedarse solo |

Si las seis son «sí», el Bloque 1 son 2 migraciones y 11 pasos.

### 9.3 Lo que sigue fuera

Datasets, anotador, `training_runs`, worker GPU, CRUD completo de
`model_versions`, publicación, inferencia, observaciones, `perception`,
importador Excel y frontend productivo. Y **dónde corre el worker con GPU**, que
sigue sin bloquear nada de este bloque.
