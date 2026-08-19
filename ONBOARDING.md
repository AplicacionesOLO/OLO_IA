# OLO_IA · Montar el proyecto en otra máquina (y correr el worker con GPU)

> Escrito el **19 de agosto de 2026**, tras la sesión que dejó el repositorio en `d70826f`.
> **No contiene ningún secreto**: solo los nombres de los ficheros y de las claves que hay
> que llevar a mano.

Esto es una plataforma SaaS multi-tenant de inventario de almacén con visión artificial. Un
dron graba un pasillo, el sistema detecta palets y etiquetas, lee los códigos, los compara
con lo que declara el WMS y lo pinta sobre un rack en 3D.

El motivo de este documento: **el análisis corre en CPU en la máquina de desarrollo**. Se
comprobó: `torch 2.13.0+cpu`, `torch.cuda.is_available() → False`. Un análisis de 74
fotogramas con troceado tarda unas dos horas. Con GPU eso cambia por completo, y es la
única razón por la que el proyecto se mueve de máquina.

---

## 1 · Lo que NO viaja en git, y sin lo cual nada arranca

Cinco ficheros, todos ignorados por `.gitignore` —comprobado con `git check-ignore`— y
todos necesarios. **Hay que copiarlos a mano** (USB o gestor de contraseñas; no por chat ni
por correo).

| fichero | qué lleva |
|---|---|
| `.env.local` (raíz) | `DATABASE_URL` y demás. Lo lee `backend/tools/admin_sql.py` |
| `docs/.envlocal` | `claude_token` (es el token de **Supabase**, empieza por `sbp_`), `passwordBD_OLO_IA`, `anon_public`, `service_role_secret`, `Git_repo`, `apikey_open_IA` |
| `frontend/.env.local` | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_MODE`, `VITE_VISUAL_LAYER` |
| `.secrets/adminpw.txt` | contraseña del usuario administrador. **Una línea, sin salto final** |
| `.secrets/testpw.txt` | contraseña del usuario de pruebas |

Dos reglas que vienen de haberlas roto:

- **Las contraseñas se leen de fichero, nunca se pasan como argumento de línea de órdenes.**
  Un argumento queda en el historial del shell y en la lista de procesos.
- **`claude_token` está mal llamado**: es el token de Supabase, no de Claude. Y la
  Management API de Supabase **exige cabecera `User-Agent`** o responde 403 sin explicar por
  qué.

---

## 2 · Entorno

Lo que hay en la máquina de origen, para que la nueva no se quede corta:

```
Python 3.14.6      Node v24.18.0      npm 11.16.0
```

### 2.1 · Backend y worker

```bash
git clone https://github.com/AplicacionesOLO/OLO_IA.git
cd OLO_IA/backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e .          # las dependencias están en pyproject.toml
```

### 2.2 · TORCH CON CUDA — la trampa número uno

`pip install torch` puede instalar la rueda de **CPU** sin decir nada, y el worker
funcionará: solo será entre diez y cincuenta veces más lento, sin un aviso en ningún log.
Es lo que hay hoy en la máquina de desarrollo.

Hay que instalarlo desde el índice de CUDA **explícitamente**, con la versión que
corresponda a los drivers de la máquina nueva:

```bash
.venv/Scripts/python.exe -m pip install --force-reinstall \
    torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

Y comprobarlo antes de lanzar nada, porque es el único punto donde el fallo es silencioso:

```bash
.venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Si eso no dice `True` y el nombre de la tarjeta, el worker seguirá en CPU.

Versiones que funcionan hoy, para reproducir si algo se rompe:

```
rfdetr 1.9.1        supervision 0.30.0      easyocr 1.7.2
opencv-python 5.0.0.93                      numpy 2.5.1
torch 2.13.0        torchvision 0.28.0      asyncpg 0.31.0
fastapi 0.141.1     uvicorn 0.52.1          sqlalchemy 2.0.51
```

### 2.3 · Licencias: esto no es una preferencia

**YOLO / Ultralytics está PROHIBIDO en este proyecto** (ADR-014). Es AGPL-3.0 y esto es un
SaaS multi-tenant: usarlo obligaría a publicar el servicio entero. El detector es
**RF-DETR** (Apache 2.0). Si algún tutorial o dependencia arrastra `ultralytics`, hay que
buscar otra vía.

### 2.4 · ffmpeg

Hace falta para dos cosas: la copia H.264 que permite ver los vídeos en el navegador, y
partir archivos grandes sin recodificar. Sin él el análisis funciona igual, pero el vídeo no
se puede reproducir.

```bash
winget install --scope user Gyan.FFmpeg
```

`--scope user` porque en la máquina de origen **no hay permisos de administrador**: chocolatey
y `Program Files` están descartados; `winget --scope user` y `pip` sí funcionan. Si la nueva
sí los tiene, da igual cómo se instale mientras `ffmpeg` quede en el `PATH` —el worker lo
busca con `shutil.which`—.

### 2.5 · Frontend

```bash
cd OLO_IA/frontend
npm install
npm run dev
```

**Escucha solo en IPv6.** Hay que abrir `http://localhost:3000`, no `http://127.0.0.1:3000`,
que no responde. Costó un rato la primera vez.

---

## 3 · Arrancar

```bash
# Backend — OJO: es una factoría, sin --factory no arranca
cd backend
.venv/Scripts/python.exe -m uvicorn "olo.main:create_app" --factory \
    --host 127.0.0.1 --port 8000 --app-dir src

# Worker: coge el siguiente trabajo de la cola
.venv/Scripts/python.exe -u tools/inferir.py --email <correo del admin>

# O uno concreto, y sin trocear
.venv/Scripts/python.exe -u tools/inferir.py --job <uuid> --trozos no --email <correo>

# Ver la cola y los workers vivos
.venv/Scripts/python.exe tools/inferir.py --listar --email <correo>
```

El `-u` no es un adorno: sin él Python no vuelca la salida a un fichero hasta el final, y
durante media hora parece que el worker está colgado.

### La base de datos

**Una sola instancia de Supabase, y es la de producción.** No hay entorno de pruebas
separado. Consecuencias:

- Las migraciones se aplican con `backend/tools/admin_sql.py <fichero.sql> --record`.
  **Toda migración lleva su rollback** en `supabase/migrations/rollbacks/`.
- Última aplicada: **0101** (`nombre_de_clase_canonico`).
- Para inspeccionar: `admin_sql.py --rows --inline "SELECT ..."`. Sin `--rows` ejecuta y
  descarta el resultado, que es lo correcto para migraciones y engañoso para mirar.
- **`PYTHONIOENCODING=utf-8` es obligatorio** al llamar a `admin_sql.py`. Sin él falla antes
  de conectar y el traceback señala a otro sitio.
- La latencia al pooler es de unos **260 ms**. Ningún objetivo de «menos de 300 ms de reloj»
  es alcanzable; para medir consultas hay que usar `EXPLAIN ANALYZE`, no el cronómetro.
- La suite marca sus escrituras como de prueba (migración 0086) para no ensuciar el registro
  de auditoría.

---

## 4 · Estado del trabajo: lo que se midió, y lo que significa

Esta es la parte que no está en el código. Todos los números son medidos, no estimados.

### 4.1 · Por qué no se leen los códigos QR

Cruzando **703 etiquetas** detectadas en cuatro vídeos con si se pudieron decodificar:

| ancho de la etiqueta | se leyó |
|---|---|
| 0–200 px | 9 % |
| 200–400 px | 31 % |
| 400–600 px | 61 % |
| 600–800 px | 72 % |
| 1200+ px | 86–100 % |

El umbral operativo está en **~400 px de ancho de etiqueta**. Y el QR ocupa solo un **24 %**
de la etiqueta, así que 400 px de etiqueta son unos 95 px de QR.

**La resolución no es la variable.** Es la conclusión que más cuesta aceptar y está medida:

| vídeo | imagen | etiqueta | se lee |
|---|---|---|---|
| dataset7 / Video9 / Video10 | 4320 × 7680 | 615 px | 66–84 % |
| DJI …0008_D | 3840 × 2160 | 199 px | 3,8 % |

El ancho de imagen difiere un 12 %; el de la etiqueta, un 300 %. Los que funcionan son de
**móvil a un metro del rack**; el que falla es de **dron a distancia**. El mismo vuelo en 8K
habría dejado la etiqueta en 224 px de los 400 necesarios: seguiría sin leerse.

Lo que decide es **cuánto ocupa el rack en el encuadre**, no la altura del dron ni el sensor.

### 4.2 · Lo que se probó y NO funcionó

Para que nadie lo repita:

- Corregir exposición, contraste, umbral adaptativo y ampliación sobre un QR de 42 px: nada
  lo recupera. A 1,4 píxeles por módulo el código no está en la imagen.
- OCR del número impreso a ese tamaño: fragmentos con confianza 0,3.
- Subir de 4K a 8K en vídeo: 84 px de QR, al límite y con un dron de cine.
- El Autel EVO II 8K: sus fotos son 8000 × 6000, **las mismas** que las del DJI Flip que ya
  se tiene, y su sensor de 1/2" recoge menos luz por píxel.

### 4.3 · Lo que sí abre una vía

En el último vuelo (`DJI_20260309122954_0023_D`), con la exposición corregida, el OCR sacó
los números impresos **casi** bien:

```
720014520293 0*0 DYX      200014570616 @*O 05Y      RC27-CO1O N0I =
```

No son QR decodificados —un QR da una cadena limpia— pero un `200014570616` con uno o dos
caracteres mal tiene casi siempre **una única coincidencia posible en el catálogo del WMS**.
Casar el texto por proximidad contra el catálogo es una vía sin explorar y probablemente la
más rentable.

### 4.4 · Troceado automático

`--trozos auto` (por omisión) sonda seis fotogramas, mide la etiqueta típica y decide. La
regla **no** puede ser la resolución: el 8K vertical se reduce el doble que el 4K y aun así
lee mejor. Se compara el tamaño en la **entrada del modelo** (736 px), con un tope de 30
piezas que protege el 8K por construcción —trocearlo son 104 pasadas por fotograma—.

Funcionó en el primer uso real: «las etiquetas llegan al modelo con 49 px de 258 reales; se
trocea en 28 piezas». Y el efecto es grande: **23 detecciones por fotograma frente a 0,85**
sin trocear. El precio es ese mismo factor en tiempo, y es la razón de mover el worker a una
GPU.

### 4.5 · Huecos vacíos: se deducen, no se detectan

Un hueco vacío no es una cosa que un detector pueda proponer, es una ausencia: con 15
anotaciones el modelo encontró **cero**. Se deduce cruzando `larguero` con `paral` para sacar
la rejilla y midiendo cuánto se mueve lo que hay dentro de cada posición — los racks están
pegados de espaldas, así que por un hueco vacío se ve el rack de atrás, que está más lejos y
se desplaza menos entre dos fotogramas.

Medido sobre 36 anotaciones, con el flujo de cada región dividido por el del fotograma:

| | n | mín | mediana | máx |
|---|---|---|---|---|
| `hueco_vacio` | 15 | 0,192 | **0,268** | 0,475 |
| `pallet` | 21 | 0,808 | **1,007** | 1,102 |

Separación completa, sin solapamiento, y en los **11** fotogramas con un vacío y un lleno a
la vez el vacío se movió menos en **11 de 11**. Umbral: **0,64** (el punto medio del margen,
no el corte que más acierta en la muestra).

**Para volver a medirlo** cuando haya más anotaciones —o material de otro almacén, u otra
altura de vuelo— está `backend/tools/medir_huecos.py`. No hay que elegir el umbral, hay que
leerlo:

```bash
python tools/medir_huecos.py <el mismo video que se subio> --asset <original_filename>
```

Saca el resumen de las dos poblaciones, si se solapan, el histograma, los pares del mismo
fotograma —los que no admiten excusas— y el umbral recomendado, que es el punto medio del
margen y no el corte que más acierta. Sobre las 36 anotaciones actuales dice 0,641, que es
lo que está en el dominio.

Dos cosas que hay que respetar al tocar esto:

- **Con el dron parado no hay paralaje.** Todas las regiones dan flujo bajo y un rack lleno
  saldría entero como huecos vacíos, con toda la confianza y sin un error en ningún log. Por
  eso lo primero que se comprueba es el movimiento del fotograma, y hay una prueba dedicada
  a que ese orden no se cambie.
- **Un hueco de rack selectivo no tiene ningún poste entre sus dos posiciones.** Los parales
  delimitan la ubicación y las dos tarimas se reparten el espacio. La primera versión no
  dividía y dedujo 0 de 3; dividiendo, 3 de 3 con un solape del 94–100 % contra lo anotado a
  mano.

### 4.6 · El vídeo del navegador

Los drones graban **H.265 Main 10** y Chrome lo rechaza entero (`MEDIA_ERR_SRC_NOT_SUPPORTED`,
comprobado). El worker genera una copia **H.264 a resolución nativa** —hasta 4K— y el visor
la usa. Dos detalles que costaron encontrarse:

- **`format=yuv420p` no es opcional.** libx264 hereda los 10 bits y produce un `High 10` que
  los navegadores tampoco reproducen.
- La copia conserva la resolución porque de ella salen los fotogramas que se mandan a
  anotar cuando el navegador no puede con el original. Con 720p se entrenaría el modelo con
  imágenes que la inferencia nunca ve.
- Si el material ya es H.264 y no pasa de 4K, **no se hace copia**: el navegador puede con él.

Las medidas del vídeo se leen de las cajas del MP4 (`moov`/`trak`/`tkhd`), sin decodificar
nada: funciona con cualquier códec. Antes las leía un `<video>`, y un navegador sin
decodificador devolvía tres ceros en silencio — de ahí un trabajo que anunciaba «1 de 1»
mientras analizaba 212 fotogramas.

### 4.7 · Límites de subida

**2 GiB**, y solo hay un número: `BYTES_MAX` en `olo.domain.perception.media`. El bucket
declara lo mismo. El navegador lo pide al servidor con el catálogo de modelos; antes lo
llevaba escrito a mano y decía «máximo 500 MB» mientras el servidor aceptaba cuatro veces
más.

Aun así, **una sola petición de 1,2 GB se corta** (`Errno 10054`). Para archivos así, partir
sin recodificar y subir por trozos:

```bash
ffmpeg -i entrada.MP4 -c copy -map 0:v:0 -f segment -segment_time 37 \
       -reset_timestamps 1 -movflags +faststart "salida_p%02d.mp4"
```

Calidad idéntica, un minuto para 1,2 GB.

---

## 5 · Vocabulario de clases: es una CLAVE, no una etiqueta

Siete clases, y el nombre se compara con `==` en el código del worker:

```
0 qr_ubicacion   1 qr_pallet   2 pallet   3 hueco_vacio
4 etiqueta_ilegible          5 larguero   6 paral
```

`CLASES_DE_CODIGO`, `CLASES_CON_PRUEBA` y `CLASES_DE_UBICACION` hacen comparaciones exactas.
Una clase creada como `Larguero` no casa nunca con un `"larguero"` del código, y el síntoma
no es un error: es una detección sin recorte o un hueco que no se promueve, sin una línea en
ningún log. Pasó. Ahora el nombre se **normaliza** —dominio, servicio y un CHECK en la base—
y `class_index` es **inmutable**: las clases nuevas van al final o los modelos ya entrenados
devuelven la etiqueta equivocada.

---

## 6 · Lo que queda pendiente

1. **Reentrenar con `larguero` y `paral`.** El modelo publicado v4 no las detecta —se entrenó
   antes de que existieran— así que la deducción de huecos vacíos no produce nada todavía.
   Hay 17 largueros y 22 parales anotados como punto de partida. Esto es lo que desbloquea
   todo lo de la sección 4.5.
2. **Los trozos 2 y 3** del vídeo `0023` están partidos y sin subir. El trabajo `dd272548`
   (trozo 1) quedó analizándose en CPU.
3. **Revocar el token de GitHub** (`ghp_…`) que se pegó en un chat: se debe considerar
   comprometido. https://github.com/settings/tokens
4. **Acercar la cámara.** Es lo único que hace legibles los códigos: hacen falta unas 3 veces
   más cerca de lo que se grabó en `0023`. La exposición ya está resuelta (luminancia 96
   frente a 46, nitidez 578).
5. Deuda conocida: `mypy src` da 49 errores y `mypy tools` 11; hay 7 errores de ruff en
   `tests/` y un aviso de ESLint en `FramesToDatasetModal.tsx`. Todo preexistente.

---

## 7 · Trampas que ya se pagaron

- **`ApiModel` tiene `extra="forbid"`.** Cualquier columna que el repositorio devuelva y el
  esquema de salida no declare produce un **500 en todas las peticiones**. Pasó cuatro veces.
- **El backend rechaza el lote entero de detecciones** si alguna baja del umbral que el
  propio trabajo declaró. Un contador tumbó un análisis de 455 detecciones.
- **La ruta en el bucket tiene que tener exactamente cuatro segmentos** (migración 0076).
  Con cinco, Storage rechaza cada subida con un error de RLS y el worker lo traga porque la
  prueba visual es un extra: dos análisis completos sin una sola imagen.
- **Los tests dejan efectos**: `test_17` deja la base sin Platform Owner y los JWT caducan,
  así que `test_spatial_api` sale 401 sin que nada esté roto de verdad.
- **La suite de integración corre contra producción.** Marcar `-m "not integration"` para lo
  rápido.
