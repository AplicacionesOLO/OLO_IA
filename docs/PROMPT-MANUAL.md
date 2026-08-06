# Prompt para generar el manual de OLO_IA con capturas

Pega **todo lo que hay debajo de la línea** en Claude Code, con el proyecto arrancado.
Genera un manual paso a paso navegando la aplicación de verdad y capturando cada
pantalla.

**Antes de pegarlo, comprueba tres cosas** (si algo falta, el manual saldrá con huecos y
el propio Claude te lo dirá en vez de inventarlo):

```bash
# 1 · el backend responde
curl -s -o /dev/null -w "api: %{http_code}\n" http://127.0.0.1:8000/health

# 2 · el frontend responde
curl -s -o /dev/null -w "web: %{http_code}\n" http://localhost:3000/

# 3 · Chrome con puerto de depuración abierto (necesario para las capturas)
curl -s http://127.0.0.1:9336/json/version | head -c 60
```

Si el 3 falla, arranca Chrome así y vuelve a comprobarlo:

```
chrome.exe --remote-debugging-port=9336 --user-data-dir="C:\OLO_IA\.chrome-debug"
```

---

Eres un redactor técnico que documenta **OLO_IA**, un sistema de gestión de almacenes
con visión por computador. Vas a producir un manual de usuario en español, con capturas
reales, recorriendo la aplicación tú mismo.

## Lo que tienes disponible

- La aplicación en `http://localhost:3000`, y la API en `http://127.0.0.1:8000`.
- Chrome con el puerto de depuración **9336** abierto. Úsalo por CDP para navegar y
  capturar: `Page.navigate`, `Page.captureScreenshot`, `Runtime.evaluate`,
  `Input.dispatchMouseEvent`.
- Credenciales: el correo es `arojas@ologistics.com` y la contraseña está en
  `C:\OLO_IA\.secrets\adminpw.txt`. **Léela del archivo**; no la escribas en ningún
  comando ni la copies al manual.

## Cómo trabajar con el navegador (esto te ahorra cuatro vueltas)

Son trampas medidas de este proyecto, no precauciones genéricas:

1. **La sesión caduca.** Detecta el login por `document.querySelector('input[type=password]')`,
   no por su texto: el texto lleva acentos que se rompen al viajar entre capas de comillas.
2. **Nada está renderizado al llegar.** Las secciones de `/admin` están plegadas y las
   tablas tardan. Espera a que el ELEMENTO exista sondeando en bucle; nunca un `sleep`
   fijo. Un conteo a cero se lee como «no hay nada» y casi siempre es «todavía no ha
   llegado».
3. **Activa el ciclo de vida** antes de capturar: `Page.setWebLifecycleState: active` y
   `Emulation.setFocusEmulationEnabled`. Sin eso `requestAnimationFrame` se suspende y
   los lienzos 3D salen en blanco a 300×150.
4. **Cuidado con los escapes.** Un `\n` dentro de heredoc → plantilla → RegExp llega
   como salto de línea real y parte la expresión. Usa `includes()` y
   `String.fromCharCode(10)` en vez de expresiones regulares.
5. **Pon la ventana a 1800×1040** con `Browser.setWindowBounds` para que las capturas
   sean legibles y consistentes.

## Qué documentar, en este orden

Para **cada** pantalla: una captura, para qué sirve, qué se hace en ella paso a paso, y
qué significan las cifras que muestra.

1. **Entrar** — el login.
2. **Panel de inicio** (`/`).
3. **Configuración del sistema** (`/admin`) — despliega todas las secciones. Explica
   países, entidades legales, clientes, almacenes, usuarios, OLOBOT y la matriz de
   permisos. Aquí hay tres cosas que el manual DEBE explicar porque son las que generan
   dudas:
   - un **cliente** es el dueño de la mercancía, no un usuario de la aplicación;
   - las casillas con guion en la matriz son **imposibles**, no vacías: son permisos de
     plataforma y un rol de tenant no los puede tener;
   - el **nivel de OLOBOT no concede permisos**: recorta lo que el asistente puede
     hacer, y el bot siempre actúa con los permisos del usuario.
4. **Catálogo espacial y visor 3D** (`/spatial`) — cómo se navega el plano, cómo se
   selecciona un rack y cómo se leen los colores de ocupación.
5. **Inventario** (`/inventory`) — ocupación y **discrepancias**. Explica que una
   discrepancia es el WMS contradiciéndose consigo mismo (dice ocupado y no hay stock, o
   al revés), y que es un dato valioso, no un error.
6. **Percepción** (`/perception`) — el flujo del drone, que es el que más se pregunta:
   1. `Nueva inspección`: subir el vídeo o la imagen, elegir el modelo, el umbral de
      confianza y la frecuencia de muestreo.
   2. Encolar el trabajo.
   3. Que lo procese un worker (ver el apartado siguiente).
   4. Revisar las detecciones.

7. **La reconciliación con el WMS** — está en la misma página de la inspección, debajo de
   las detecciones, y es lo que convierte un análisis en trabajo accionable. Documéntala
   aparte porque es la pantalla que responde a la pregunta del operador:

   > «hay un pallet en A-01-02 y el WMS declara ese hueco vacío»

   Tres cosas que el manual debe explicar, porque son las que se malinterpretan:

   - Los nueve estados de la base se agrupan en **tres**: `Cuadra`, `No cuadra` y
     `No se pudo ver`. Explica que el tercero **no dice que el almacén esté bien**: dice
     que hay que volver a capturar. Si el 60 % de un vuelo cae ahí, el resultado no vale.
   - Cada recuento **es un filtro**: se pulsa y la tabla se acota a ese grupo.
   - Reconciliar **crea un recorrido nuevo cada vez**, no sustituye al anterior. Hacerlo
     dos veces deja dos recorridos, y eso es a propósito —quizá con otro corte del WMS de
     por medio—, pero significa que pulsar dos veces no es inocuo.

   Y el botón está **apagado hasta que la inspección esté completada**: sus detecciones
   aún pueden cambiar. Captura los dos estados si puedes.

8. **Un análisis EN DIRECTO** — si hay alguna sesión de directo en la lista, documenta en
   qué se diferencia de un archivo, porque la pantalla lo distingue a propósito:

   - la cabecera dice **EN DIRECTO** y enseña la URL `rtmp://` en vez del nombre de archivo
   - la barra tiene **tres etapas** (`En cola → Emitiendo → Cerrado`) y no seis: en un
     directo no hay nada que subir, y `Cerrado` no es «terminó bien», es que alguien lo
     cortó o el emisor dejó de emitir
   - el contador dice **Fotogramas vistos** y **no** una proporción: no se sabe el total,
     porque un directo no tiene final

   Si no hay ninguna sesión, **dilo** en vez de describirla de oído: hoy un directo solo se
   abre por API (`POST /v1/perception/live`), no desde el formulario. Es una limitación
   real y va en el apartado del final.

9. **OLOBOT** — abre el panel con el botón de la barra superior. Enseña una pregunta de
   datos y una propuesta de cambio con su confirmación. Deja claro que **un cambio no se
   aplica hasta pulsar Confirmar**.

10. **Temas** — claro, oscuro y seguir al sistema, desde el menú de usuario.

## El flujo del drone, de punta a punta

Es la parte que más falta hace y no se puede documentar solo con capturas: hay dos
procesos que corren fuera de la aplicación. Documéntalos como comandos, con lo que hace
cada uno y qué esperar:

Ojo con el intérprete: los dos guiones se ejecutan con **`C:\OLO_IA\.venv-train\Scripts\python.exe`**,
que es Python 3.13. El del backend es 3.14 y `faster-coco-eval` —que RF-DETR necesita para
entrenar— no tiene wheel para esa versión. Ponlo en el manual: es el fallo que más tiempo
hace perder.

```bash
# Analizar lo que esté en cola. Necesita `rfdetr` y `opencv-python`.
python backend/tools/inferir.py --listar     # qué hay en cola y quién está vivo
python backend/tools/inferir.py              # coge el siguiente trabajo
python backend/tools/inferir.py --bucle      # se queda esperando trabajo

# Con el modelo entrenado que hay hoy. Las dos opciones son necesarias, no adorno:
python backend/tools/inferir.py --bucle \
  --pesos "C:/Users/arojast/olo-entrenamientos/<run>/salida/checkpoint_best_ema.pth" \
  --clases "qr_ubicacion,qr_pallet,pallet,hueco_vacio,etiqueta_ilegible"

# Un directo se corta solo si se le dice; sin esto corre hasta Ctrl-C.
python backend/tools/inferir.py --segundos 60

# Entrenar con las imágenes anotadas.
python backend/tools/entrenar.py --listar
python backend/tools/entrenar.py --run <uuid>
```

Explica **por qué** `--pesos` y `--clases` hacen falta hoy, porque parecen opcionales y no
lo son:

- **`--pesos`**: el checkpoint de RF-DETR Nano son ~120 MB y el plan de Supabase corta la
  subida en 50 MB, así que los pesos no se pueden publicar y el worker los lee del disco.
  Sin esto cae a un detector genérico preentrenado y lo avisa —lo que salga no es del
  modelo entrenado—.
- **`--clases`**: si el checkpoint no está en el registro, no hay vocabulario, las
  detecciones salen como `clase_3` y **la reconciliación las rechaza**, porque no puede
  saber si lo que vio es un hueco vacío o un pallet.

Explica también **por qué son guiones y no botones**: analizar un vídeo de 1 GB tarda
minutos y quiere GPU, así que corre donde haya máquina, no dentro del servidor web. Y
menciona que en la pantalla de percepción aparece un aviso cuando **no hay ningún worker
vivo**: los trabajos se quedan en cola y no avanzan solos. Eso no es un fallo, es
información —y desde la migración 0075 es un latido real, no un valor fijo—.

## El directo, y lo que hace falta que OLO_IA no es

Documenta esto con cuidado porque es donde es más fácil prometer de más.

**OLO_IA no es un servidor RTMP.** No hay nada en el sistema que acepte una emisión. El
drone o su mando publican en un servidor de medios —MediaMTX, nginx-rtmp, SRS— y lo que se
registra en OLO_IA es la URL desde la que ese servidor sirve el stream. El worker la abre y
lee fotogramas.

Consecuencia práctica que el manual debe decir: **sin ese servidor de medios montado, un
directo no puede funcionar**, aunque la sesión se cree. Hoy no hay ninguno en el montaje
local; lo que se ha probado es el transporte RTMP, no un drone emitiendo.

Y una decisión que conviene explicar porque parece un defecto: el worker **descarta
fotogramas** en un directo. Si el modelo tarda 300 ms y la cámara entrega 25 fps,
analizarlos todos haría que la latencia creciera sin techo —al minuto se estarían
analizando imágenes de hace un minuto—. Se coge el más reciente y se tira el resto. Con un
archivo es lo contrario: no se pierde ninguno.

## Reglas de honestidad — esto es lo más importante del encargo

- **No inventes ninguna pantalla.** Documenta lo que veas. Si una pantalla está vacía o
  a medias, dilo y captúrala tal cual.
- **No inventes cifras.** Las que pongas tienen que salir de una captura o de una
  consulta que hayas hecho.
- **Si algo falla, documéntalo como limitación**, con el mensaje de error que salga. Un
  manual que promete lo que el sistema no hace es peor que uno incompleto: el operador
  descubre el hueco en el pasillo, con el drone en la mano.
- Si una sección del menú está marcada como no lista, dilo en vez de saltártela sin
  explicación.

### Cuatro límites que ya se conocen, y que van SÍ O SÍ en el manual

No hay que descubrirlos: están medidos. Van en el apartado del final, con su cifra, porque
son exactamente lo que un operador necesita saber antes de confiar en el sistema:

1. **El modelo lee mal los códigos de hueco.** Se entrenó con 15 imágenes y da mAP 0,172.
   La consecuencia se ve en la reconciliación: casi todo sale como «hueco no identificado»,
   porque se detecta el pallet pero no se lee la etiqueta de la ubicación. Hacen falta más
   imágenes anotadas; es lo que desbloquea todo lo demás.
2. **Los pesos no se pueden publicar.** 120 MB frente al tope de 50 MB del plan de
   Supabase. Medido: 40 MB pasa, 60 no. Por eso el worker se ejecuta con `--pesos`.
3. **Un directo solo se abre por API.** El formulario de «Nueva inspección» pide un archivo
   y no ofrece una URL. Y hace falta un servidor de medios que hoy no está montado.
4. **Las escrituras de Configuración no tienen control de concurrencia.** Dos personas
   editando la misma fila se sobrescriben en silencio: no hay `If-Match`.

Si al recorrer la aplicación encuentras más, añádelos. Si alguno de estos ya no aplica
—porque se arregló— compruébalo antes de quitarlo y di cómo lo comprobaste.

## Formato de salida

Escribe `docs/MANUAL.md`, con:

- Un índice al principio.
- Las capturas en `docs/manual/`, referenciadas con rutas relativas y con un nombre que
  diga qué son (`03-configuracion-paises.png`, no `captura7.png`).
- Un apartado **«Qué NO hace el sistema todavía»** al final, con lo que hayas encontrado
  incompleto. Sé concreto: qué no funciona y qué haría falta.
- Tono directo, para alguien que va a operar un almacén de verdad. Sin entusiasmo de
  folleto y sin promesas.

Cuando termines, dime cuántas capturas tomaste, qué pantallas documentaste y qué te
encontraste incompleto.
