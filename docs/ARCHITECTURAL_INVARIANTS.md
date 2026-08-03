# ARCHITECTURAL_INVARIANTS.md

| | |
|---|---|
| **Naturaleza** | **Normativo.** No explica la arquitectura: la delimita. |
| **Vigente desde** | 2026-07-30 · congela la arquitectura del Bloque 3 |
| **Autoridad** | ADR-008 a ADR-012 y `BLOCK_3_MIGRATION_PLAN.md` (rev. 3) |
| **Alcance** | Todo el desarrollo, incluidos bloques futuros |

**Cómo se usa este documento.**

1. Estas reglas **no se negocian durante la implementación.** Si una tarea exige
   romper una, la tarea se detiene y se escribe un ADR.
2. **Cada regla es falsable.** La columna *Verificación* dice cómo. Donde dice
   `revisión`, la regla **no tiene comprobación automática** y depende de la lectura
   humana: son las más frágiles y están contadas en §9.
3. **Un `MUST` roto es un defecto**, no una decisión de diseño local.
4. Las razones están en los ADR. Aquí solo se enuncia lo suficiente para reconocer
   la infracción.

**Convenciones.** `MUST` / `NEVER` son normativos. `SPA` spatial · `WMS` espejo del
WMS · `PER` perception · `AI` modelos · `PLT` plataforma y transversales · `IMP`
importadores · `TWN` gemelo digital.

---

## 1 · SPATIAL

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **SPA-01** | Una `location` es **siempre** hoja. Ningún nodo tiene padre de tipo `location` | Una existencia referencia `location_id` sin preguntar si tiene hijos | Los agregados por ubicación cuentan dos veces; la comparación con lo observado se vuelve ambigua | `test_spatial_invariants` |
| **SPA-02** | `node_type` expresa **solo estructura**. 6 valores: `building, floor, zone, aisle, rack, storage_area` | ADR-010 §6.1: valores con idéntico comportamiento estructural no son tipos | La matriz de aristas crece multiplicativamente (6×5 en lugar de 6+1) | `test_spatial_invariants` |
| **SPA-03** | `node_function` expresa **solo función**. `dock`, `buffer`, `bulk`, `staging`, `inspection` **NEVER** son `node_type` | ADR-010 §6.2 | Ídem SPA-02 | `test_spatial_invariants` |
| **SPA-04** | `node_type` **solo** cambia mediante migración | Cambia con obra, no con una decisión operativa | Un tipo nuevo sin aristas legales deja nodos inalcanzables | `test_catalog_governance` |
| **SPA-05** | `node_function` **solo** cambia en el catálogo global, y **solo** lo escribe el Platform Owner | ADR-010 §9.5: si cada tenant añadiera funciones, dos inventarían nombres distintos para lo mismo | El informe agregado entre tenants deja de ser comparable | `test_catalog_governance` |
| **SPA-06** | Toda arista `padre → hijo` **MUST** existir en `node_edges` | Un árbol libre admite un `floor` colgando de un `rack` | La jerarquía deja de ser interpretable; las consultas de subárbol devuelven basura | `test_spatial_invariants` |
| **SPA-07** | Si cualquier `world_*` no es nulo, `world_frame_id` **MUST** no ser nulo | ADR-010 §3.1: una coordenada sin marco es un número sin unidad | Coordenadas inutilizables y **no recuperables**: nadie anotó su marco | `test_reference_frames` |
| **SPA-08** | `logical_*` **NEVER** representa coordenadas físicas. No se convierte a metros ni entra en aritmética métrica | Medido: `Eje Z` tiene 9 valores = los de `Nivel`; máximos 1.000.006 son centinelas | Un gemelo digital con estanterías a 1.000 km, geométricamente consistente y falso | `test_spatial_invariants` · `revisión` para la aritmética |
| **SPA-09** | `reference_frames` **puede** estar vacía. Vacía es un estado **válido** | Ningún levantamiento se ha hecho | Un marco fabricado sin medición es una afirmación falsa contra la que alguien cargará datos | `test_reference_frames` |
| **SPA-10** | Un `device` **MUST** pertenecer a un nodo válido o a un marco válido | ADR-010 §7.2: sin ello, la trazabilidad «qué cámara vio esto y desde dónde» se pierde | Un conteo no auditable | `test_spatial_invariants` (cuando exista `spatial.devices`) |
| **SPA-11** | Un nodo **NEVER** representa ocupación. `spatial` no tiene columna de ocupación | La ocupación es del snapshot (ADR-010 §3.2) | 29.310 filas del gemelo a actualizar en cada importación, y el gemelo miente entre ellas | `test_spatial_invariants` |
| **SPA-12** | `location_status` **NEVER** contiene `occupied` ni `reserved` | Corolario de SPA-11. El vocabulario heredado de `core.locations` los traía | Dos verdades sobre si un hueco está ocupado | `test_spatial_invariants` |
| **SPA-13** | `spatial` **NEVER** referencia `wms` | Medido: el inventario solo trae las 15.599 ubicaciones **ocupadas** | Un estante desaparece del gemelo al vaciarse, que es cuando hace falta saber que está libre | `test_domain_boundaries` |
| **SPA-14** | La clave natural de una ubicación **NEVER** incluye la compañía | Medido: 42 racks `CANT*` con mercancía de dos clientes son **un** estante físico | Un estante real partido en dos filas; el mapa apunta a un lugar que no existe | `test_spatial_invariants` |
| **SPA-15** | `is_bulk_area` se **declara**, nunca se deriva de un recuento de contenedores | Un patio es un patio aunque esté vacío | Dependería del snapshot, contra SPA-13 | `revisión` |
| **SPA-16** | Existe **una sola** fuente de verdad espacial. **NEVER** una segunda tabla de ubicaciones o áreas | D2 | Dos modelos parciales; nadie sabe cuál miente | `test_spatial_invariants` |
| **SPA-17** | Ningún **modelo de lectura** de `spatial` expone una columna de ocupación, ni con otro nombre. Un `occupied_count` derivado de `location_situation` **NEVER** es ocupación | Corolario operativo de SPA-11/12, que hablaban de tablas y no de vistas. Medido: `occupied_count` (15.862) salía de otra columna que `available_count` (18.075) y `blocked_count` (11.237), y los tres sumaban **45.174 sobre 29.312** | Un gráfico apilado imposible que el frontend dibujará porque los nombres invitan a ello | Verificación de la migración 0059 · `test_spatial_api` |
| **SPA-18** | `available_count` + `blocked_count` = `location_count`, **siempre**. Todo recuento por estado que se publique **MUST** particionar el total | Un conjunto de recuentos que solapan no es un desglose: es tres números sueltos con nombres que prometen un desglose | Porcentajes por encima del 100 %, y nadie sabe qué numerador usar | Verificación de 0059 sobre datos reales · `test_spatial_api` |
| **SPA-19** | Una capacidad se acepta **por plausibilidad**, no contra una lista de centinelas: `0 < valor < core.capacity_ceiling(tipo)` | Medido: el catálogo usa **ocho** grafías distintas de «sin límite» (`1e5`, `1e6`, `9999999`, `1e7`, `99999999`, `1e8`, `999999999`, `1e9`). Enumerarlas es un juego de topos y la novena llega con el siguiente archivo | Una ubicación de 100.000 t que el motor acepta, y un cálculo de carga que la usa | `chk_loc_peso_plausible` · verificación de 0058 |
| **SPA-20** | «El origen declaró sin límite» y «el origen no dijo nada» **MUST** ser distinguibles. El valor crudo descartado se conserva en `raw_source` | Son estados operativos distintos: una ubicación sin límite declarado se puede usar; una sin dato hay que ir a medirla. Medido: 26.244 frente a 727, indistinguibles antes de 0058 | Se manda a alguien a medir 26.971 ubicaciones cuando solo 727 lo necesitan | Verificación de 0058 · `test_spatial_api` |

---

## 2 · WMS

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **WMS-01** | Un snapshot es **inmutable**. Se corrige creando otro | Es la base de comparaciones ya hechas | Un conteo de ayer pasa a comparar contra datos que cambiaron después | `test_snapshot_invariants` |
| **WMS-02** | Un snapshot **publicado** **NEVER** cambia, ni se borra | Permite comparar contra un momento pasado | Se pierde la referencia de toda observación anterior | `test_snapshot_invariants` |
| **WMS-03** | El snapshot vigente es un **predicado** con índice único parcial. **NEVER** una tabla paralela, una columna `is_current` sin índice, ni un puntero `current_*` | Lección de la migración 0043 (`models.current_version_id` eliminada) | Dos vigentes en una carrera, o dos verdades que se contradicen | `test_snapshot_invariants` |
| **WMS-04** | `wms` es de **solo lectura para el usuario**: sin política de `UPDATE` ni `DELETE`, **y** con trigger que lanza `WMS_MIRROR_READ_ONLY` | Un espejo editable deja de ser un espejo. Y sin política, un `UPDATE` afecta a 0 filas **en silencio** | La siguiente sincronización borra la edición sin avisar; o el usuario cree haber guardado | `test_snapshot_invariants` |
| **WMS-05** | Un `container` es la **identidad logística** (la carga), no el soporte reutilizable | Medido: matrícula de 13 caracteres que nace en recepción y muere en expedición | Una carga con historial de reparaciones y una tarima con fecha de caducidad | `revisión` |
| **WMS-06** | El QR identifica un container y se almacena **sin transformar** | Verificado: 13 caracteres alfanuméricos en los 28.558 | La lectura de campo no empareja con el maestro | `test_import_contract` |
| **WMS-07** | El importador **NEVER** modifica un snapshot anterior | Corolario de WMS-01 | Ídem WMS-01 | `test_import_contract` |
| **WMS-08** | Toda fila de `wms` declara de qué `sync_run` proviene | Reproducibilidad desde el origen | Un dato sin procedencia no se puede reconstruir ni auditar | `test_snapshot_invariants` |
| **WMS-09** | `wms` **NEVER** referencia `perception` | Lo esperado no puede depender de lo observado | El snapshot deja de ser reproducible sin conservar las observaciones | `test_domain_boundaries` |
| **WMS-10** | La clave natural de un artículo es `(compañía, código externo)` | Medido: `5140011` es una llave de tanque en COFERSA y un disco duro en Roblealto | Se muestra un disco duro donde hay una llave; la comparación con IA es basura | `test_import_contract` |
| **WMS-11** | Estado, evento y documento son **tres modelos**. Los movimientos son solo-añadir, **NEVER** versionados por snapshot | Dos cortes no dicen en qué orden ocurrieron los movimientos intermedios | Se pierde el orden y los movimientos ocurridos entre cortes | `revisión` |

---

## 3 · PERCEPTION

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **PER-01** | `perception` **NEVER** modifica un snapshot | Observar no es autorizar un cambio de inventario | Una detección errónea corrompe el inventario esperado sin revisión humana | `test_domain_boundaries` |
| **PER-02** | Una `capture` es **evidencia** e inmutable | Es la prueba de la que todo lo demás deriva | Toda conclusión posterior queda sin respaldo | `test_snapshot_invariants` |
| **PER-03** | Una `detection` es **inferencia del modelo** y **NEVER** se corrige: se supersede | Es la prueba de cómo se comportó el modelo | Se destruye la trazabilidad que permite evaluar el modelo | `revisión` |
| **PER-04** | Una `observation` es una **afirmación de dominio** y es **agnóstica al modelo** | Es el contrato que permite añadir SAM, DINO u OCR sin tocar `wms` | Cada modelo nuevo obliga a modificar el dominio | `test_domain_boundaries` |
| **PER-05** | Toda `observation` **MUST** rastrearse hasta al menos una `capture` | Una afirmación sin evidencia no es auditable | Un ajuste de inventario que nadie puede justificar | `test_spatial_invariants` |
| **PER-06** | **Nada** referencia `perception`. Es el sumidero terminal del grafo | Permite añadir, archivar y reparticionar sin romper integridad ajena | Archivar evidencia antigua rompe otras tablas | `test_domain_boundaries` |
| **PER-07** | Una lectura de QR **NEVER** modifica el maestro de containers | Una lectura puede ser errónea | Una lectura mala corrompe la identidad logística | `revisión` |
| **PER-08** | Una sesión de observación **MUST** declarar su cobertura | El snapshot no contiene ubicaciones vacías | Se informan faltantes en ubicaciones que nadie miró | `revisión` |

---

## 4 · AI

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **AI-01** | `ai` **NEVER** referencia dato de tenant (`spatial`, `wms`, `perception`, ni `core` más allá de la identidad) | `ai` es régimen Platform Owner y agnóstico al tenant | El catálogo del owner queda atado al inventario de un cliente, y ningún usuario de tenant puede leer lo suyo | `test_domain_boundaries` |
| **AI-02** | `ai.assets` almacena **artefactos** (imágenes, vídeos, pesos). **NEVER** dispositivos físicos ni geometría CAD | ADR-008 | Un plano del cliente queda en régimen owner: invisible para su dueño y expuesto entre clientes si alguien relaja la política | `test_domain_boundaries` |
| **AI-03** | Un modelo **NEVER** contiene estado operativo | El estado vive en su versión y en su ciclo de vida | Dos lugares afirman qué versión está en producción | `test_ai_contract_lifecycle` |
| **AI-04** | El puente artículo ↔ clase vive en el lado **tenant** | Corolario de AI-01 | Ídem AI-01 | `test_domain_boundaries` |
| **AI-05** | Los campos del contrato de un modelo son inmutables desde que existe una versión | Los pesos guardan índices, no nombres | Los pesos publicados dejan de corresponder a su contrato declarado | `test_ai_contract_lifecycle` |

---

## 5 · PLATFORM y transversales

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **PLT-01** | Toda tabla de dominio **MUST** tener `ENABLE` + **`FORCE`** ROW LEVEL SECURITY y al menos una política `RESTRICTIVE` | Sin `FORCE`, el propietario de la tabla la salta | Fuga entre tenants | `test_rls_coverage` |
| **PLT-02** | Toda vista **MUST** declarar `security_invoker = true` | Lección de 0042: sin ello la vista salta RLS por el `rolbypassrls` del propietario | Una vista de conveniencia se convierte en una fuga entre tenants | `test_rls_coverage` |
| **PLT-03** | Ningún tenant modifica un catálogo global | Un vocabulario común es la condición para comparar entre tenants | Los informes agregados dejan de ser comparables | `test_catalog_governance` |
| **PLT-04** | Los catálogos globales **solo** los modifica una migración o el Platform Owner | Ídem PLT-03 | Ídem PLT-03 | `test_catalog_governance` |
| **PLT-05** | Un permiso de alcance `platform` **NEVER** se mapea a un rol de tenant | Trigger de la migración 0022; cierra una escalada de privilegios real | Un `tenant_admin` se concede a sí mismo permisos de plataforma | `test_platform_block0` |
| **PLT-06** | El privilegio se resuelve **contra la base en cada petición**, nunca desde el JWT | Revocar debe surtir efecto de inmediato | Un privilegio revocado sigue vigente hasta una hora | `test_platform_block0` |
| **PLT-07** | Un error de negocio viaja por **código `DETAIL` estable**, nunca por el texto del mensaje | El mensaje del motor nombra tablas y constraints | Cambiar un mensaje rompe la API; devolverlo filtra la forma del esquema | `test_pg_error_extraction` |
| **PLT-08** | Todo `DETAIL` emitido por una migración **MUST** estar registrado en el traductor | Un código sin traducir sale como 500 | Una regla de negocio se presenta como fallo del sistema | `test_pg_error_extraction` |
| **PLT-09** | La inmutabilidad se impone con **trigger**, no con ausencia de política | Medido: sin política de `UPDATE`, un `UPDATE` afecta a 0 filas en silencio | El usuario cree haber guardado; nada indica lo contrario | `test_snapshot_invariants` |
| **PLT-10** | Un valor derivado **NEVER** se duplica. Nada de punteros `current_*` | Lecciones de 0042 y 0043 | El derivado y su origen se contradicen, y nadie sabe cuál manda | `test_snapshot_invariants` |
| **PLT-11** | Todo cambio de esquema existe **primero** como migración versionada. **NEVER** un cambio manual en Supabase | Reproducibilidad del entorno | Un entorno irreproducible; el siguiente despliegue no coincide | `revisión` + historial de `schema_migrations` |
| **PLT-12** | Referencias a PostGIS desde código de aplicación o funciones **MUST** ir cualificadas (`extensions.…`) | Medido: `extensions` no está en el `search_path` de `authenticated` ni `olo_app` | Falla en ejecución, no al desplegar. Una política RLS con operador geométrico falla en la primera fila | `revisión` |
| **PLT-13** | Una política RLS **NEVER** llama a una función pasándole una **columna**. La parte que no depende de la fila se envuelve en `(SELECT …)` para que se evalúe una vez | `STABLE` no significa «se llama una vez»: solo promete no cambiar dentro de la consulta. Con un argumento que varía por fila se llama por fila. Y una función con `SET search_path` **no se puede integrar**, así que cada llamada es una invocación real. Medido: `count(1)` sobre 29.312 filas pasó de **6,7 ms** (bypassrls) a **59.048 ms** (RLS), y `/v1/spatial/warehouses` devolvía 500 por `statement_timeout` | El módulo entero es inutilizable con volumen real, y el defecto no aparece hasta que una tabla pasa de cientos a decenas de miles de filas | Verificación de 0060: ninguna política puede contener `can_access_warehouse(` |
| **PLT-14** | Toda medición de rendimiento se hace **con RLS activa**, como el rol de la aplicación. Medir como propietario **NEVER** cuenta como medición | El propietario tiene `rolbypassrls`: las políticas no se evalúan y el plan es OTRO. No es un margen, fue un factor de 8.800 | Se declara «objetivo cumplido» sobre un plan que ningún usuario ejecutará nunca | `revisión` · el script de medición avisa si no encuentra credenciales del rol de aplicación |
| **PLT-15** | Reescribir un predicado de seguridad **MUST** venir con una demostración de equivalencia **fila a fila** sobre datos reales, con `IS DISTINCT FROM` | Un predicado más rápido que decide distinto no es una optimización, es un agujero. `IS DISTINCT FROM` y no `<>` porque con NULL la lógica ternaria deja pasar la discrepancia | Un cambio de rendimiento que además cambia quién ve qué, y nadie lo nota | Verificación de 0060, sobre las 29.312 ubicaciones y los 3.049 nodos |
| **PLT-16** | Toda migración **MUST** tener su rollback como archivo versionado en `supabase/migrations/`, y **MUST** probarse ejecutándolo dentro de una transacción que se aborta | El DDL de PostgreSQL es transaccional, así que la cadena entera se puede ejecutar de verdad —sintaxis, orden de dependencias y bloques de verificación incluidos— y después no persistir nada. No hace falta entorno desechable. Un rollback no ejecutado nunca es SQL optimista: la prueba de la cadena 0060→0047 encontró dos defectos (nombre de trigger equivocado en dos rollbacks, `%%` con argumentos en un `RAISE`) que una revisión no vio | La reversibilidad existe en el papel y falla el día que se necesita, que es el peor día | `revisión` de la existencia del archivo · la prueba en transacción abortada es el método |
| **PLT-17** | Un rollback que no puede revertir sin destruir datos **MUST** abortar nombrando la decisión pendiente, **NEVER** elegir por su cuenta | 0051 tendría que convertir 3.048 nodos en áreas que nunca existieron; 0053 tendría que borrar, reasignar o dejar huérfanos 2.701 cuerpos con 29.310 ubicaciones. Son decisiones de producto | Un rollback fabrica historia que nadie escribió, y parece haber funcionado | Los propios rollbacks: abortan con el recuento y el motivo |

---

## 6 · IMPORTADORES

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **IMP-01** | Toda importación es **idempotente**: hash del archivo y clave natural por fila | Reejecutar tras una interrupción debe converger | Inventario duplicado; cantidades infladas | `test_import_contract` |
| **IMP-02** | Ninguna importación modifica dato histórico | Corolario de WMS-01 | Se reescribe el pasado que respaldaba una comparación | `test_import_contract` |
| **IMP-03** | Una fila inválida **NEVER** detiene el lote | 41.055 filas no pueden depender de una | Una celda mala impide importar el almacén entero | `test_import_contract` |
| **IMP-04** | Toda fila rechazada **MUST** quedar auditada: número de fila, contenido crudo, motivo | Un rechazo silencioso produce un inventario que **parece** completo | Faltan 560 pallets y nadie lo sabe | `test_import_contract` |
| **IMP-05** | Los encabezados se validan **por nombre y posición** antes de leer una fila | Ocurrió en el análisis: un índice desplazado un puesto dio resultados plausibles y falsos | Se carga `IdSucursal` en `Ubicación` sin protestar | `test_import_contract` |
| **IMP-06** | Toda clave derivada la calcula el **servidor**. El cliente **NEVER** elige una ruta, un identificador ni un destino | Aceptar la ruta del cliente rompe el aislamiento por proyecto o por tenant | Escritura fuera del prefijo autorizado | `test_import_contract` |
| **IMP-07** | El catálogo espacial se importa **antes** del inventario | El catálogo trae `logical_*`; al revés se pierde la rejilla | 15.599 ubicaciones creadas como inferidas y una reconciliación posterior | `revisión` |
| **IMP-08** | Una compañía se resuelve contra `core.companies`. **NEVER** se crea desde un nombre | 19 nombres con variantes: `'COFERSA'`, `'COFERSA  ADMINISTRATIVO'` | Una compañía por variante ortográfica, y el aislamiento por cliente deja de significar nada | `test_import_contract` |
| **IMP-09** | Un valor de vocabulario desconocido se **guarda y avisa**, nunca rechaza la fila | Medido: `Situación` tiene 5 valores en un archivo y 8 en el otro | Un valor nuevo del WMS tumba la importación entera | `test_import_contract` |
| **IMP-10** | Publicar es un acto **explícito y separado** de crear | Quien opera debe poder mirar el resumen de rechazos antes | Se publica un snapshot con 300 filas perdidas sin que nadie lo vea | `test_snapshot_invariants` |
| **IMP-11** | `Cantidad Unidades` es la **única** fuente numérica | `Cantidad Almacenaje` es derivada y textual (`"54 UD"`) | Cantidades erróneas en las 3 filas con unidad de empaque distinta | `test_import_contract` |
| **IMP-12** | El archivo original se conserva como evidencia de importación | Auditoría y reproceso | Un snapshot que no se puede reconstruir ni justificar | `revisión` |
| **IMP-13** | Un importador escribe por **conjuntos**, nunca fila a fila contra una base remota | Medido: 3.048 `INSERT` individuales contra el pooler de AWS = **275 ms por fila**, 14 minutos sin terminar. Con `unnest` y lotes: **31 segundos** para 32.358 filas | Un importador que no se puede reejecutar en la práctica, y por tanto una idempotencia que solo existe en el papel | `revisión` · el tiempo del lote queda en `spatial.import_batches` |
| **IMP-14** | Todo umbral que el importador aplique y el motor también **MUST** leerse de la base y compararse antes de escribir | Dos constantes copiadas divergen en cuanto una se toca. Si el importador anula por encima de 50.000 y el CHECK por encima de 40.000, el lote falla a mitad | Un lote que aborta tras 20.000 filas, o capacidades anuladas que la base habría aceptado | El importador aborta si `core.capacity_ceiling()` no coincide con su constante |

---

## 7 · DIGITAL TWIN

| ID | Regla | Justificación | Si se rompe | Verificación |
|---|---|---|---|---|
| **TWN-01** | Un `world_position` sin marco es **inválido** | Un número sin unidad | Coordenadas inutilizables y sin backfill posible | `test_reference_frames` |
| **TWN-02** | Un CAD **NEVER** modifica la estructura lógica | El árbol lo define el WMS y la operación; el CAD aporta geometría | Un plano desactualizado reorganiza el almacén operativo | `revisión` |
| **TWN-03** | Un robot **NEVER** publica coordenadas sin indicar su marco | Un SLAM publica en su marco de mapa | Poses interpretadas en el marco equivocado: el robot cree estar en otro sitio | `test_reference_frames` |
| **TWN-04** | Las transformaciones entre marcos son **explícitas** y viven en la base | Si cada integración transforma por su cuenta, dos lo harán distinto | Dos sistemas discrepan sobre dónde está lo mismo | `test_reference_frames` |
| **TWN-05** | Todo marco declara **`unit`** y **`axis_convention`** | Un CAD puede venir en metros o milímetros; DWG e IFC son Z-up y hay formatos Y-up | 12,4 m frente a 12,4 mm indistinguibles; o el almacén rotado 90°, consistente y falso | `test_reference_frames` |
| **TWN-06** | La geometría tiene **procedencia y linaje** (revisiones), no deduplicación por contenido | Un plano se revisa; una imagen se deduplica. ADR-008 | No se sabe qué revisión sustituyó a cuál ni por qué | `revisión` |
| **TWN-07** | `logical_*` y `world_*` **NEVER** aparecen en la misma expresión aritmética | Familias sin relación métrica | Un resultado numérico plausible y sin sentido físico | `revisión` |

---

## 8 · Pruebas de arquitectura

Contrato de las pruebas. **No implementadas todavía.** Ubicación:
`backend/tests/architecture/`.

| Prueba | Valida | Invariantes | Cuándo |
|---|---|---|---|
| `test_domain_boundaries` | El grafo de dependencias entre schemas: ninguna FK `spatial→wms`, `wms→perception`, `ai→`(tenant), y nada referencia `perception`. **Además lee `supabase/migrations/` para detectar una FK nueva que cruce una frontera** | SPA-13 · WMS-09 · PER-01 · PER-04 · PER-06 · AI-01 · AI-02 · AI-04 | **Cada ejecución de la suite** y en CI |
| `test_rls_coverage` | Toda tabla de dominio con `FORCE ROW LEVEL SECURITY` y al menos una política `RESTRICTIVE`; toda vista con `security_invoker` | PLT-01 · PLT-02 | **Cada ejecución** y en CI |
| `test_spatial_invariants` | `location` es hoja; aristas legales; `node_type` con 6 valores; sin ocupación en `spatial`; `location_status` sin `occupied`/`reserved`; clave natural sin compañía; una sola fuente espacial; toda observación con evidencia | SPA-01 · 02 · 03 · 06 · 08 · 10 · 11 · 12 · 14 · 16 · PER-05 | **Cada ejecución** |
| `test_snapshot_invariants` | Inmutabilidad; un solo vigente por el índice parcial; trigger de solo lectura; procedencia de `sync_run`; publicación separada; sin derivados duplicados | WMS-01 · 02 · 03 · 04 · 08 · PER-02 · PLT-09 · PLT-10 · IMP-10 | **Cada ejecución** |
| `test_reference_frames` | `world_*` implica `world_frame_id`; `unit` y `axis_convention` obligatorios; árbol de marcos sin ciclos; **tabla vacía es válida** | SPA-07 · SPA-09 · TWN-01 · 03 · 04 · 05 | **Cada ejecución** |
| `test_import_contract` | Idempotencia por hash y clave natural; encabezados por nombre y posición; una fila mala no detiene el lote; todo rechazo auditado; compañía resuelta y no creada; vocabulario abierto; QR sin transformar; clave de artículo; claves derivadas del servidor | WMS-06 · 07 · 10 · IMP-01 a 06 · 08 · 09 · 11 | **Cada ejecución** (con el importador implementado) |
| `test_catalog_governance` | `node_type` solo por migración; `node_function` solo por el owner; ningún tenant escribe un catálogo global | SPA-04 · SPA-05 · PLT-03 · PLT-04 | **Cada ejecución** |
| `test_pg_error_extraction` **(existe)** | Todo `DETAIL` de las migraciones está registrado en el traductor | PLT-07 · PLT-08 | **Cada ejecución** |
| `test_platform_block0` **(existe)** | Permisos de plataforma fuera de los roles de tenant; privilegio resuelto contra la base | PLT-05 · PLT-06 | **Cada ejecución** |
| `test_ai_contract_lifecycle` **(existe)** | Contrato del modelo inmutable con versiones; sin estado operativo en el modelo | AI-03 · AI-05 | **Cada ejecución** |

**Momento de ejecución.** Todas en cada ejecución de la suite y como puerta de CI.
Ninguna es una migración: una migración afirma sobre un instante, y una invariante que
debe cumplirse siempre necesita comprobarse siempre — una migración de verificación no
detectaría la infracción introducida en la migración 0071.

**Lo que sí se queda en las migraciones** son sus bloques `DO $$ … $$`, que verifican
un acto puntual:

> En la migración: «esto que acabo de hacer, quedó hecho».
> En la prueba de arquitectura: «esto sigue siendo cierto».

---

## 9 · Cobertura real

**82 invariantes.** Las 11 últimas (SPA-17 a SPA-20, IMP-13, IMP-14, PLT-13 a PLT-17) **no salieron de
un diseño**: salieron de importar el catálogo real y medir lo que pasó. Cada una tiene
detrás un defecto que llegó a estar aplicado en la base o ejecutándose contra ella; ver
la cabecera de las migraciones 0058, 0059 y 0060.

PLT-13 es la más cara de las nueve: el bloque espacial se dio por medido y funcionando
con un plan que ningún usuario habría ejecutado. Lo descubrió una prueba de integración
contra la base real, y el mensaje de error traducido —«Database error»— ocultó la causa
hasta que se quitó el traductor para leer el SQLSTATE.

Y el reparto honesto, que no es el que este documento decía hasta
ahora —afirmaba «58 invariantes, 42 automáticas, 16 por revisión», y las tres cifras
estaban mal: un recuento a ojo que nadie volvió a hacer—:

| | Cuántas | Qué significa |
|---|---|---|
| **Comprobadas por una prueba que EXISTE y corre** | **12** | Se rompen y la suite se pone roja hoy |
| **Comprobadas por la verificación de una migración** | **12** | Se comprobaron al aplicarla. Afirman sobre un instante, no sobre siempre |
| Nombran una prueba **que aún no está escrita** | **41** | Contrato, no garantía. Ver §8: `backend/tests/architecture/` no existe |
| Solo por **revisión humana**, por diseño | **17** | No son automatizables o no vale la pena |

La segunda y la tercera fila son la parte incómoda, y la distinción importa:

**Nombrar una prueba no es tener una prueba.** 42 invariantes de este documento dicen
`test_spatial_invariants` o `test_import_contract` en su columna de verificación, y esos
archivos **no existen todavía**. Sumarlas a las «automatizadas» convertiría este
documento en el problema que pretende resolver: una garantía escrita que nadie comprueba.

**Una verificación de migración caduca.** El bloque `DO $$ … $$` de 0058 demostró que no
quedaba ninguna capacidad implausible *el 30/07/2026*. No dice nada de la migración 0071.
Nueve invariantes están en ese estado.

Las 11 que de verdad corren hoy:

```
SPA-17  SPA-18  SPA-20    test_spatial_api  (integración, con datos reales)
PLT-07  PLT-08             test_pg_error_extraction
PLT-05  PLT-06             test_platform_block0
AI-03   AI-05              test_ai_contract_lifecycle
SPA-19                     chk_loc_peso_plausible  (el motor, en cada INSERT)
IMP-14                     el importador aborta si su techo no coincide con el de la base
PLT-13                     test_spatial_api  (el endpoint moria por timeout sin esto)
```

SPA-19 e IMP-14 son las dos mejores del documento, y por el mismo motivo: **no las
comprueba una prueba, las impone el motor y el arranque del importador**. Una invariante
que no se puede infringir no necesita que nadie se acuerde de comprobarla.

Las 15 solo por revisión, por si alguien pretende que este documento garantiza más de lo
que garantiza:

```
SPA-08 (la aritmética)  SPA-15   WMS-05   WMS-11
PER-03  PER-07  PER-08
PLT-11  PLT-12
IMP-07  IMP-12  IMP-13
PLT-14  PLT-16
TWN-02  TWN-06  TWN-07
```

**Son las más frágiles.** Varias podrían automatizarse con análisis estático —SPA-08,
TWN-07 y PLT-12 son detectables leyendo el código— y son las candidatas naturales si
alguna vez se rompe una en producción.

**PER-07, WMS-05 y TWN-02 no son automatizables**: dependen de que quien escriba el
código entienda la diferencia entre observar y afirmar, entre carga y soporte, y entre
geometría y estructura. Para esas tres, este documento es la única defensa.

**Deuda declarada.** Escribir `backend/tests/architecture/` mueve 41 invariantes de
«contrato» a «garantía». Es el trabajo de mayor rendimiento pendiente en este documento,
y hasta que exista, la fila de 41 debe leerse como lo que es.

---

## 10 · Modificación de este documento

1. **Ninguna invariante se relaja durante la implementación.** Si una tarea la exige,
   la tarea se detiene.
2. Añadir, cambiar o retirar una invariante requiere **un ADR nuevo** que la nombre
   por su identificador.
3. Los identificadores **no se reutilizan.** Una invariante retirada se marca como
   tal, con el ADR que la retiró.
4. Si la implementación descubre que una invariante es **falsa o imposible**, eso es
   un hallazgo objetivo y justifica un ADR — es el único camino previsto para
   cambiarla.
