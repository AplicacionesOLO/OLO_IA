# Manual de OLO_IA

Guía de uso del sistema, pantalla por pantalla, con capturas tomadas de la aplicación
funcionando contra la base de datos real.

**Fecha:** 6 de agosto de 2026 · **Operador:** OLO Logistics Demo · **Almacén:** OLO-CR —
Centro de Distribución San José (29.312 ubicaciones importadas)

> Todas las cifras de este manual salen de la pantalla o de una consulta a la base. Donde
> el sistema no hace algo, se dice. El apartado final —[Qué no hace el sistema
> todavía](#qué-no-hace-el-sistema-todavía)— es tan importante como el resto: describe
> límites medidos, no sospechas.

---

## Índice

1. [Entrar](#1-entrar)
2. [Panel de inicio](#2-panel-de-inicio)
3. [Configuración del sistema](#3-configuración-del-sistema)
   - [Dar de alta a alguien](#dar-de-alta-a-alguien)
   - [La matriz de permisos](#la-matriz-de-permisos)
4. [Catálogo espacial](#4-catálogo-espacial)
5. [Percepción: el flujo del drone](#5-percepción-el-flujo-del-drone)
   - [5.1 Nueva inspección](#51-nueva-inspección)
   - [5.2 Analizar: el worker](#52-analizar-el-worker)
   - [5.3 Revisar las detecciones](#53-revisar-las-detecciones)
   - [5.4 Reconciliar con el WMS](#54-reconciliar-con-el-wms)
   - [5.5 Un análisis en directo](#55-un-análisis-en-directo)
6. [OLOBOT](#6-olobot)
7. [Temas](#7-temas)
8. [Módulos todavía no implementados](#8-módulos-todavía-no-implementados)
9. [Inventario](#9-inventario)
10. [Qué no hace el sistema todavía](#qué-no-hace-el-sistema-todavía)

---

## 1. Entrar

![Pantalla de acceso](manual/01-login.png)

Identidad y clave. El sistema resuelve a qué operador (*tenant*) perteneces y qué
almacenes puedes ver: **todo lo que aparece después está filtrado por eso**, no por un
menú de preferencias.

Eso tiene una consecuencia práctica que conviene entender desde el principio: dos personas
del mismo operador pueden ver cifras distintas en la misma pantalla, y ninguna está mal.
Cada una ve sus almacenes.

---

## 2. Panel de inicio

![Panel de inicio](manual/02-inicio.png)

Vista de conjunto con la representación isométrica del almacén.

Las tres cifras de arriba —**ubicaciones, racks y posiciones**— salen del catálogo real,
sumadas sobre los almacenes que tú puedes ver. Si todavía no han llegado, se pinta un guion
en lugar de un número.

> Aquí hubo un defecto que conviene recordar: eran literales escritos a mano —«12 480
> ubicaciones», «94,7 % de cobertura»— y encima marcados como *medidos*. El catálogo real
> tiene 29.312. Era lo primero que veía alguien al entrar, y era falso.
>
> No se muestra la **ocupación**, aunque sería más interesante: el único dato disponible es
> la foto del WMS, y ponerlo junto al distintivo «En vivo» sería el mismo engaño en versión
> más difícil de detectar. La ocupación está en [Inventario](#9-inventario), con su fecha.

Cuatro paneles inferiores —Cobertura de percepción, Precisión, Throughput, Previsión— dicen
**SIN FUENTE DE DATOS**. Eso sí es honesto: esas métricas no están conectadas todavía.

---

## 3. Configuración del sistema

![Configuración del sistema](manual/03-configuracion.png)

La estructura del operador y quién puede hacer qué. Seis bloques desplegables.

### El vocabulario, que es donde más se confunde la gente

| Término | Qué es |
|---|---|
| **Operador** (*tenant*) | Tu empresa de logística. Es «nosotros». |
| **Entidad legal** | Una sociedad del operador en un país. Un almacén le pertenece. |
| **Cliente** | El **dueño de la mercancía**. NO es un usuario de la aplicación. |
| **Usuario** | Una persona con acceso. Tiene roles, y los roles dan permisos. |
| **Almacén** | El edificio. Tiene un catálogo espacial. |

La confusión más común es *cliente*: en este sistema Cofersa y EPA son clientes —dueños de
pallets—, no gente que entra a la aplicación.

### Qué se puede hacer

Cada fila de países, entidades legales, clientes, almacenes y usuarios tiene **editar** y
**dar de baja**. Se edita en la propia fila, sin salir de la tabla, para poder comparar con
las vecinas mientras corriges.

Dos comportamientos deliberados:

- **Dar de baja pide confirmación con el nombre delante.** El segundo clic cae a dos
  centímetros del primero y dice qué se va a perder.
- **Una baja imposible se explica con cifras.** Al intentar dar de baja una entidad legal
  que tiene almacenes dentro, responde: *«No se puede dar de baja: la entidad legal todavía
  tiene 2 almacen(es) y 2 cliente(s). Reasígnalos o dalos de baja primero.»* La cifra es la
  mitad de la información.

Los **usuarios no tienen papelera**, y es a propósito: un usuario no se borra, se
**suspende**, y eso es el campo `estado` de su propia fila. El correo no se edita porque es
la llave con su identidad de acceso.

### Dar de alta a alguien

En la carpeta **Usuarios**, el botón **«Invitar a una persona»**.

![Invitar a una persona](manual/15-invitar-usuario.png)

Pide correo, nombre, apellido, un **rol** y los **almacenes** a los que tendrá acceso. La
persona recibe un correo, abre el enlace y **elige su propia contraseña**: no se la pones
tú, y eso es deliberado. Una contraseña que inventa el administrador viaja por WhatsApp o
por un papel, la saben dos personas —así que «quién hizo esto» deja de tener respuesta— y
casi nadie la cambia después.

**El rol y los almacenes no son opcionales en la práctica**, y el formulario lo avisa
mientras los dejas en blanco:

- **sin rol** entra sin un solo permiso, y cada botón le responde «no autorizado»;
- **sin almacenes** ve el explorador espacial, las inspecciones y el inventario **en
  blanco**, sin ningún mensaje que lo explique. Es el síntoma más difícil de diagnosticar
  del sistema, porque no parece un error.

Se pueden añadir después desde su fila, pero es un paso que ninguna pantalla te va a
recordar.

#### Dos mensajes que hay que leer

**«Ya tenía cuenta en el sistema, así que no se ha enviado ningún correo.»** Pasa cuando esa
dirección ya existía —porque se le dio de baja y vuelve, o porque se le invitó antes—. Se le
añade al operador y entrará con la contraseña que ya usaba. Si no la recuerda, la salida es
**recuperar contraseña**: volver a invitarla no manda nada.

**«Esa persona ya tiene una cuenta activa en otro operador.»** Una cuenta pertenece a un solo
operador a la vez. El sistema **no la mueve**, porque eso le quitaría el acceso al operador
actual sin que nadie lo haya pedido: primero tiene que darse de baja allí.

> ### ⚠ Hace falta configurar el SMTP en Supabase
>
> Sin un servidor de correo propio, Supabase usa su remitente integrado, que permite **solo
> unos pocos correos por hora**. Para dar de alta a un grupo de operarios hay que configurar
> el SMTP en *Authentication → Emails* del panel de Supabase.
>
> Si el envío falla, la invitación **no se crea a medias**: el mensaje dice que es el límite
> de correos y quién lo resuelve. Y las personas que ya tienen cuenta se pueden añadir
> igualmente, porque ese caso no gasta ningún envío.

### La matriz de permisos

Al final del todo, roles en columnas y permisos en filas. Dos cosas que sorprenden:

- **Las casillas con un guion son imposibles, no vacías.** Son permisos de plataforma, y un
  rol del operador no los puede tener nunca. Se pintan así para que no gastes 135 clics
  descubriéndolo.
- **La matriz es de solo lectura hasta que crees un rol propio.** Los cinco roles del
  sistema los comparten todos los operadores, así que sus permisos no se pueden cambiar
  desde aquí. La salida es crear un rol del tenant, que puede heredar de uno del sistema.

### OLOBOT: el nivel de cada usuario

Un bloque propio con una tabla de usuario → nivel (`Usuario`, `Supervisor`,
`Administrador`, `Owner`).

> **El nivel NO concede permisos.** Recorta lo que el asistente puede hacer, y OLOBOT actúa
> siempre con los permisos del usuario. Alguien con nivel «Owner» y un rol de solo lectura
> sigue sin poder cambiar nada.

Y **nadie puede cambiar su propio nivel**: su fila dice «tu propio nivel» en lugar del
desplegable. Así el registro de quién lo concedió significa algo.

---

## 4. Catálogo espacial

![Catálogo espacial](manual/04-espacial.png)

**Aquí están los datos reales del almacén.** Del catálogo importado el 30 de julio:

| | |
|---|---|
| Ubicaciones | **29.312** |
| Disponibles | 18.075 (61,7 %) |
| Bloqueadas | 11.237 (38,3 %) |
| Racks | 347 |
| Cuerpos | 2.701 |

La pantalla declara además tres cosas que no esconde:

- **2.365 ubicaciones con estado y situación contradictorios.** El catálogo espacial dice
  una cosa y el WMS otra. Es un dato valioso, no un error: significa que uno de los dos
  está desactualizado, y saber cuál es trabajo de la reconciliación.
- **2 con código opaco** — no se pueden interpretar.
- **Sin levantamiento métrico** y **sin pasillos**: el catálogo tiene la estructura lógica
  (rack, cuerpo, nivel) pero no las medidas en metros. Por eso todavía no se dibujan rutas
  sobre un plano a escala.

El almacén **WH-002 — Bodega Alajuela** aparece marcado *(sin catálogo)*: existe como
almacén y no tiene ubicaciones importadas.

---

## 5. Percepción: el flujo del drone

![Lista de inspecciones](manual/06-percepcion-lista.png)

El módulo que analiza vídeo o imágenes del almacén con un modelo de visión. La lista
muestra las inspecciones con su estado y cuántas detecciones produjo cada una.

Fíjate en que las dos entradas se identifican distinto: la de archivo por su nombre
(`pallet3.jpg`) y la de directo por su URL (`rtmp://...`). No es decoración — en un directo
no hay archivo que nombrar.

### 5.1 Nueva inspección

![Nueva inspección](manual/07-nueva-inspeccion.png)

Cuatro decisiones:

1. **El archivo.** JPG, PNG, WebP, MP4 o WebM, hasta 500 MB. Se sube directo al
   almacenamiento, no a través del servidor.
2. **El almacén.** Importa más de lo que parece: *«las detecciones se guardan contra este
   almacén, y los códigos de rack que se lean se resolverán contra SU catálogo»*. Elegir el
   equivocado hace que ningún código case.
3. **El pipeline:**
   - *Detección de objetos* — encuentra y clasifica, con sus cajas.
   - *OCR* — lee texto.
   - *Detección + OCR* — las dos. **Es el que hace falta** si quieres identificar huecos o
     pallets por su etiqueta.
4. **El umbral de confianza y el muestreo.** El muestreo (fotogramas por segundo) solo
   aplica a vídeo: analizar los 25 fps de un vídeo de diez minutos son 15.000 fotogramas
   para ver lo mismo que en 600.

Al guardar, la inspección queda en **Subido**. No se encola sola: encolar consume máquina y
es una decisión aparte, para que puedas revisar el modelo y el umbral antes.

### 5.2 Analizar: el worker

Lo que analiza **no es un botón de la aplicación**: es un proceso que corre donde haya
máquina. Decodificar un vídeo de 1 GB y pasarlo por un modelo tarda minutos y quiere GPU;
dentro del servidor web sería un proceso bloqueado sin forma de repartir el trabajo.

```bash
# Qué hay en cola y quién está vivo
python backend/tools/inferir.py --listar

# Coger el siguiente trabajo, o quedarse esperando
python backend/tools/inferir.py
python backend/tools/inferir.py --bucle
```

**Con el modelo entrenado que hay hoy, las dos opciones siguientes son obligatorias:**

```bash
python backend/tools/inferir.py --bucle \
  --pesos "C:/Users/arojast/olo-entrenamientos/<ejecución>/salida/checkpoint_best_ema.pth" \
  --clases "qr_ubicacion,qr_pallet,pallet,hueco_vacio,etiqueta_ilegible"
```

- **`--pesos`** — los pesos del modelo no se pueden publicar (ver [límites](#qué-no-hace-el-sistema-todavía)),
  así que el worker los lee del disco. Sin esto usa un detector genérico y **lo avisa**: lo
  que salga no es de tu modelo.
- **`--clases`** — sin el vocabulario, las detecciones salen como `clase_3` y **la
  reconciliación las rechaza**, porque no puede saber si lo que vio es un hueco vacío o un
  pallet.

> **El intérprete es `C:\OLO_IA\.venv-train\Scripts\python.exe`** (Python 3.13), no el del
> backend. Una de las dependencias de entrenamiento no tiene versión compilada para 3.14.
> Es el fallo que más tiempo hace perder.

Si no hay ningún worker vivo, la pantalla de percepción **lo avisa**: los trabajos se
quedan en cola y no avanzan solos. Eso no es un fallo, es información — y el aviso es real,
sale de un latido que el worker manda cada 30 segundos.

### 5.3 Revisar las detecciones

![Detecciones de una inspección](manual/08-inspeccion-detecciones.png)

La inspección de ejemplo: **4 detecciones**, umbral ≥25 %, un fotograma (`FRAMES 1/1`).

Arriba, la línea de estados: `Borrador → Subiendo → Subido → En cola → Procesando →
Completado`. Si algo falla, marca **en qué etapa** se rompió — y si el historial no lo
registra, lo dice en vez de culpar a una etapa al azar.

Cada detección trae su clase y su confianza (`pallet 28 %`, `qr_pallet 36 %`). Se pueden
aceptar o rechazar; el filtro de arriba las separa en Todas / Pendientes / Aceptadas /
Rechazadas.

### 5.4 Reconciliar con el WMS

![Reconciliación con el WMS](manual/09-reconciliacion.png)

**Esta es la pantalla que convierte un análisis en trabajo.** Las detecciones dicen «vi un
pallet con confianza 0,86»; esto dice:

> «hay un pallet en A-01-02 y el WMS declara ese hueco vacío»

Se pulsa *Reconciliar contra el WMS* y el sistema convierte las detecciones en lecturas de
inventario, comparándolas con el último corte importado del WMS.

Los nueve estados posibles se agrupan en **tres**, que son las tres preguntas reales:

| | Significa | Qué haces |
|---|---|---|
| **Cuadra** | El WMS y lo observado coinciden | Nada |
| **No cuadra** | Se contradicen | Aquí hay trabajo |
| **No se pudo ver** | QR ilegible, hueco tapado | Repetir la captura |

> **«No se pudo ver» no dice que el almacén esté bien.** Dice que hay que volver a
> capturar. Si el 60 % de un vuelo cae en ese grupo, el resultado no vale — y esa es la
> lectura que se pierde si se agrupa con «Cuadra».

Cada recuento **es un filtro**: se pulsa y la tabla se acota a ese grupo.

En el ejemplo, la única lectura sale como **«hueco no identificado»**: se detectó el pallet
y se leyó su código (`22C0005993390`), pero **no se leyó el código del hueco**. Sin saber de
qué ubicación es, el sistema no afirma nada sobre ninguna — y eso es correcto. Aproximar
«RCL104» a «RCL1O4» convertiría un error de lectura en un dato del inventario.

La columna del WMS distingue dos cosas que parecen la misma:

- **«sin corte del WMS»** — no hay ningún corte importado con el que comparar.
- **«nada que comparar»** — sí lo hay, pero esta lectura no se pudo atribuir a un hueco.

Dos avisos sobre el botón:

- Está **apagado hasta que la inspección esté completada**: antes, sus detecciones todavía
  pueden cambiar.
- **Cada reconciliación crea un recorrido nuevo**, no sustituye al anterior. Es
  deliberado —quizá con otro corte del WMS de por medio— pero significa que pulsar dos veces
  no es inocuo.

### 5.5 Un análisis en directo

![Análisis en directo](manual/10-directo.png)

La misma pantalla, leyendo de una cámara en vez de un archivo. Se distingue en tres cosas:

| | Archivo | Directo |
|---|---|---|
| Cabecera | `pallet3.jpg` | **EN DIRECTO** · `rtmp://...` |
| Etapas | seis | **tres**: En cola → Emitiendo → Cerrado |
| Contador | `FRAMES 1/1` | **FOTOGRAMAS VISTOS 297** |

Las tres tienen motivo. En un directo no hay nada que subir, así que las etapas de subida
no existirían. **«Cerrado» no significa «terminó bien»**: significa que alguien lo cortó o
que el emisor dejó de emitir. Y no hay proporción porque no hay total — un directo no tiene
final.

> ⚠ **OLO_IA no es un servidor RTMP.** Nada en el sistema acepta una emisión. El drone o su
> mando publican en un servidor de medios —MediaMTX, nginx-rtmp, SRS— y aquí se registra la
> URL desde la que ese servidor sirve el stream. **Sin ese servidor montado, un directo no
> puede funcionar** aunque la sesión se cree.

Una decisión que parece un defecto y no lo es: en un directo el worker **descarta
fotogramas**. Si el modelo tarda 300 ms y la cámara entrega 25 por segundo, analizarlos
todos haría que la latencia creciera sin techo: al minuto estarías viendo imágenes de hace
un minuto. Se coge el más reciente y se tira el resto. Con un archivo es lo contrario: no se
pierde ninguno.

Para cortar un directo: `Ctrl-C` en el worker, o `--segundos 60` al lanzarlo.

---

## 6. OLOBOT

![Panel de OLOBOT](manual/13-olobot.png)

El asistente. Se abre con el botón de la barra superior y **no cierra la pantalla en la que
estás**: se ancla al lado, porque lo que mejor hace es llevarte a una pantalla y comentarla.

La cabecera dice tu nivel y qué implica: *«nivel owner · puede proponer cambios»*.

Tres reglas que gobiernan lo que hace:

1. **No contesta de memoria.** Consulta la base cada vez. Si le preguntas una cifra que no
   puede consultar, lo dice en lugar de inventarla.
2. **Solo habla de esta aplicación.** No responde preguntas generales aunque sepa la
   respuesta.
3. **Ningún cambio se aplica hasta que lo confirmes.** Cuando propone algo, aparece una
   tarjeta con la frase exacta de lo que va a pasar y dos botones. Mientras no pulses
   *Confirmar*, **no ha cambiado nada** — y la tarjeta lo dice.

Lo que **no** puede hacer, por diseño: dar permisos, cambiar roles, cambiar el nivel de
OLOBOT de nadie, ni borrar nada. Eso se hace en Configuración, con una persona mirando.

---

## 7. Temas

![Selector de tema](manual/14-temas.png)

En el menú de usuario: **Claro**, **Oscuro** y **Seguir al sistema**. La tercera muestra
además a qué resuelve ahora mismo (*«oscuro»*), para que no tengas que adivinar por qué se
ve como se ve.

---

## 7 bis. En el teléfono

![Una inspección en el móvil](manual/movil-inspeccion.png)

Sí funciona, y se midió en un iPhone 13 emulado (390×844) pantalla por pantalla:

- **ninguna pantalla se desborda de lado.** Es el defecto que más molesta en un móvil
  —arrastras para bajar y la página se va en diagonal, escondiendo contenido a la
  derecha— y no ocurre en ninguna de las ocho;
- **los botones crecen al tacto.** Con ratón miden 32 px, que sobra; con un dedo pasan a
  44, que es lo que piden Apple y Google. La densidad de escritorio no cambia: la regla
  solo se aplica cuando el dispositivo apunta con un dedo.

Antes de eso, las pestañas de revisión de detecciones —*Todas / Aceptadas / Pendientes /
Rechazadas*, las que más se tocan— medían 32 px, y los controles del mapa espacial 24×24.

**Lo que sigue siendo incómodo en un móvil** y no es un defecto sino una consecuencia:

- **la matriz de permisos** son 5 roles × 73 permisos con casillas de 14 px. Es una tabla
  de escritorio; en un teléfono no cabe de ninguna manera razonable;
- **el texto secundario está a 11 px** en toda la aplicación. Es un token del diseño, no un
  descuido, y se lee bien de cerca; a un brazo de distancia, justo.

En la práctica: el operario hace las lecturas y revisa detecciones desde el teléfono sin
problema. La configuración del sistema se hace sentado.

---

## 8. Módulos todavía no implementados

Tres entradas del menú lateral **no son módulos**: son páginas que describen lo que harán,
con su versión objetivo. Están así a propósito, y es mejor que una pantalla vacía.

| Módulo | Estado | Versión objetivo |
|---|---|---|
| **Analítica** (`/analytics`) | Planificado | v0.4 |
| **Incidencias** (`/incidents`) | Planificado | v0.4 |

Las dos tienen la misma forma: qué permitirá hacer el módulo, a qué familia pertenece y
qué permiso pedirá.

> **Inventario ya no está en esta lista.** Tiene su propia sección: [Inventario](#9-inventario).

![Analítica: planificado](manual/11-analitica.png)

Analítica promete indicadores operativos: precisión de inventario en el tiempo, throughput,
mapa de calor de ocupación y alertas por umbral.

![Incidencias: planificado](manual/12-incidencias.png)

Incidencias es la que cierra el círculo del drone: cuando la reconciliación encuentra una
discrepancia, abrirá una incidencia con la evidencia fotográfica enlazada y su flujo de
resolución. Hoy la discrepancia se ve —en la pantalla de reconciliación— pero **no genera
nada**: anotarla y repartirla es todavía trabajo manual.

---

## 9. Inventario

![Inventario](manual/16-inventario.png)

Lo que el WMS declara que hay dentro del almacén. La separación con el explorador
espacial es deliberada y conviene tenerla clara:

- **espacial = el edificio.** Qué huecos existen, cómo están estructurados, si están
  disponibles o bloqueados. Es una propiedad del inmueble.
- **inventario = la mercadería.** Qué hay dentro de cada hueco, cuánto, y qué no cuadra.

### Todo esto es una foto, no un directo

Arriba del todo salen **dos fechas y la antigüedad**: cuándo se sacó del WMS, cuándo se
importó aquí, y cuántos días tiene. Las dos primeras se separan por días con frecuencia, y
la que manda para decidir es cuándo se sacó.

La antigüedad va **en palabras y en ámbar a partir de una semana** —hoy dice *«hace 8
días»*— porque «29 jul» obliga a restar mentalmente y eso nadie lo hace. Es el dato que
decide si fiarse de todo lo demás de esta pantalla: un almacén que mueve mercadería a
diario ya no se parece a una foto de hace ocho días.

Los datos actuales vienen de un Excel del **29 de julio**: 41.055 líneas, 29.312
ubicaciones, 15.594 con stock, 27.920 pallets.

### Lo que no cuadra: la parte que da trabajo

El bloque principal no es la ocupación, es la lista de **2.186 huecos donde el WMS se
contradice consigo mismo**. Cada uno es una comprobación en el pasillo, y cada clase
significa un trabajo distinto:

| Clase | Cuántos | Qué significa |
|---|---|---|
| **Libre con stock** | 716 | El WMS lo da por libre y tiene mercadería. **Es el urgente:** el WMS puede mandar otro pallet al mismo hueco. |
| **Ocupado sin stock** | 1178 | Figura ocupado y no hay nada. Suele ser mercadería que salió y nadie descargó: el hueco está libre y el sistema no deja usarlo. |
| **Bloqueado con stock** | 292 | Bloqueado con carga dentro. Puede haber mercadería inmovilizada sin que su dueño lo sepa. |

Al pulsar una clase, la pantalla explica qué significa y qué hacer.

### ¿Qué hay en ese hueco?

![Contenido de un hueco](manual/17-hueco.png)

Cada fila se abre con **«¿Qué hay?»** y muestra la mercadería que el WMS declara dentro:
pallet, artículo, descripción, cantidad, lote y caducidad.

Lo que dice el panel **depende de la clase**, porque la respuesta útil es distinta:

- **Ocupado sin stock** → *«Confirmado: el WMS da CANT1A-C002-N04-1 por ocupado y no tiene
  ninguna línea de stock.»* El vacío no es «sin datos»: **es la confirmación**. Si en el
  pasillo está vacío, el hueco se puede liberar en el WMS.
- **Libre con stock** → sale la lista de lo que hay dentro, con el aviso de que el WMS lo da
  por libre. Ejemplo real: `CANT1A-C002-N05-1` figura disponible y contiene un pallet de
  *Tubo PVC 4" x 6m*, 25 unidades.
- **Bloqueado con stock** → puede haber mucho. `CAAU59-C001-N01-1` tiene **143 líneas**; se
  muestran las 15 primeras y un botón despliega el resto.

En el teléfono la tabla se desplaza dentro de su propio panel, así que la página nunca se
va de lado.

> **Los recuentos son del total; la lista está acotada a 200.** Se avisa debajo de la
> tabla. Contar las filas daría un número menor que el real.

Aparte salen las **773 líneas de stock en ubicaciones que no existen en el catálogo**. No
es un descuadre entre columnas: el WMS ubica mercadería en huecos que el edificio no
tiene. O falta catálogo, o el código está mal escrito — y hasta saber cuál, esa mercadería
no se puede ir a buscar.

### Ocupación por rack, y el buscador del pasillo

Los racks salen **ordenados por ocupación, los más llenos primero**: es donde no va a caber
lo siguiente. Ordenar por código dejaría eso enterrado en la fila 200.

El buscador responde a «¿dónde está esto?», por pallet o por artículo. Si no aparece nada,
recuerda que busca en la última foto importada: lo que entró después todavía no está.

### Importaciones: de dónde salen estos datos

![Historial de importaciones](manual/18-importaciones.png)

Al pie de la pantalla, el historial: cuándo se sacó cada foto, cuándo se importó, su
antigüedad, el origen del archivo, cuántas líneas trajo y en qué estado quedó. La que se
está usando va marcada.

**Las importaciones que fallaron también salen**, y es deliberado: alguien lo intentó y no
salió. Esconderlas haría que repitiera el intento a ciegas, sin saber que ya había fallado
antes.

> **Hoy solo hay una importación**, así que no hay nada que comparar y la pantalla lo dice
> en lugar de fingir un panel vacío. Cuando haya una segunda, aquí se verá qué descuadres
> son nuevos, cuáles se resolvieron y cuáles llevan semanas sin tocarse — que es lo que
> responde si el trabajo del pasillo está sirviendo de algo.

### Lo que este módulo NO hace

**No se puede corregir nada desde aquí, y es deliberado.** El WMS es el sistema de origen y
esto es su espejo. Un botón para «arreglar» una cantidad crearía una segunda verdad, y la
de este lado sería la equivocada. El operario que va al pasillo y cuenta no está
corrigiendo el inventario: está **observando**, y eso tiene su propio sitio en las
inspecciones.

Importar una foto nueva se hace con `tools/import_inventory_snapshot.py`, fuera de la
aplicación.

---

## Qué no hace el sistema todavía

Límites **medidos**, no sospechas. Esto es lo que hay que saber antes de confiar en el
sistema para operar.

### 1. El modelo NO lee los códigos de hueco. Cero.

Se entrenó con **15 imágenes**. El detalle por clase, medido en la validación, es lo que
hay que mirar y no el promedio:

| Clase | AP |
|---|---|
| `pallet` | **0,72** |
| `qr_pallet` | 0,28 |
| `qr_ubicacion` | **0,00** |

El promedio (mAP@50 = 0,52) suena aceptable y **engaña**: el modelo ve los pallets bien,
las etiquetas de pallet a medias, y **el código de la ubicación no lo detecta nunca**.

Eso no es «lee mal», es que no lee. Y es justo el dato del que depende todo: la
reconciliación compara *«en el hueco X hay un pallet»* contra lo que declara el WMS. Sin
saber de qué hueco se trata, cada lectura sale como «hueco no identificado» y no hay nada
que comparar.

**Qué hace falta:** más imágenes anotadas, con los códigos de hueco bien marcados. Con
150–200 el modelo empieza a leerlos, y un solo vuelo del drone da cientos de fotogramas.
**Esto es lo que desbloquea todo lo demás** — no la interfaz, ni el worker, ni el
despliegue.

### 2. ~~Los pesos del modelo no se pueden publicar~~ · Resuelto

El punto de control de RF-DETR Nano son **121 MB** y el tope de subida del proyecto estaba
en **50 MiB**, así que ninguna versión podía registrarse: `weights_asset_id` es obligatorio.
Tampoco se arreglaba recortando el archivo — no es estado del optimizador, son 30,2 M de
parámetros reales, y en media precisión seguirían siendo 60 MB.

**Ya está resuelto:** el tope se subió a 210 MB y el modelo está publicado con sus pesos en
Storage, así que el worker los descarga por su cuenta y las detecciones quedan atribuidas a
una versión concreta del registro. Ya no hace falta `--pesos` apuntando a un disco.

### 3. Un directo solo se abre por API

El formulario de *Nueva inspección* pide un archivo y no ofrece una URL. Hoy una sesión en
directo se abre con `POST /v1/perception/live`; desde ahí ya se ve bien en la aplicación.

Y hace falta un **servidor de medios** que no está montado en el entorno local. Lo que se ha
probado es el transporte RTMP, **no un drone emitiendo**.

### 4. El panel de inicio muestra cifras inventadas

«Ubicaciones 12 480» y «Cobertura 94,7 %» son literales escritos en el código y marcados
como *medidos*. El catálogo real tiene **29.312** ubicaciones. Cuatro paneles más dicen
honestamente *SIN FUENTE DE DATOS*, pero esos dos no.

**Mientras no se arregle: no uses el panel de inicio para nada.** Los datos están en
Catálogo espacial.

### 5. Las escrituras de Configuración no tienen control de concurrencia

Dos personas editando la misma fila se sobrescriben **en silencio**: no se envía `If-Match`,
así que la segunda en guardar gana sin avisar de que había un cambio anterior.

### 6. El catálogo espacial no tiene medidas

Tiene la estructura lógica (rack, cuerpo, nivel) pero no metros ni pasillos. Por eso no se
dibujan rutas a escala sobre el plano, aunque las observaciones de rack sí se registren.

---

## Apéndice: las inspecciones de ejemplo

Las dos inspecciones que aparecen en las capturas se llaman **«Ejemplo del manual»** y son
reales: una imagen del propio almacén analizada con el modelo entrenado, y un directo por
RTMP de 297 fotogramas. Se pueden dar de baja sin consecuencias.
