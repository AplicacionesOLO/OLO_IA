> **Ya no se usa en producción.** Desde el 2026-11-25 el directo va por un servidor de video
> en la nube (AWS, ver `backend/tools/nube/`): el dron transmite por internet desde cualquier
> red, el directo se abre solo y todo se maneja desde la app (Percepción → «Directo del
> dron»). Esta carpeta queda como respaldo para pruebas con un servidor MediaMTX local.

# Directo RTMP del dron → OLO_IA

Transmitir el video del dron **en vivo** al sistema, para ver los huecos vacíos
**mientras vuelas** — sin grabar, sin subir archivos de cientos de MB, sin esperar
20 minutos de proceso. Funciona por **cable USB** o por **WiFi (inalámbrico)**.

Todo esto es **aditivo**: no toca el backend, el worker ni el frontend existentes.
Usa el modo "directo" (`start_live`) que el sistema ya soporta.

```
  Dron DJI ──► Control RC331 ──►  Servidor RTMP (esta PC)  ──►  Worker GPU  ──►  Huecos en la app
   (H.264)       (USB o WiFi)      MediaMTX  1935/8554          inferir.py       hueco_vacio + ubicación
```

## Componentes (en esta carpeta)

| Archivo | Qué hace |
|---|---|
| `instalar.ps1` | Baja MediaMTX (servidor RTMP, binario suelto) a `bin/`. Una sola vez. |
| `iniciar.ps1` | Arranca el servidor y muestra las URLs exactas (USB y WiFi). |
| `crear_directo.py` | Abre el trabajo en vivo que el worker GPU recoge. |

---

## Paso a paso

### 1. Instalar el servidor RTMP (una vez)
```powershell
cd C:\OLO_IA\backend\tools\rtmp
powershell -ExecutionPolicy Bypass -File instalar.ps1
```
Descarga la última versión oficial de MediaMTX a `bin\mediamtx.exe`. No instala nada
en el sistema.

### 2. Arrancar el servidor
```powershell
powershell -ExecutionPolicy Bypass -File iniciar.ps1
```
Déjalo abierto. Te imprime las URLs según cómo conectes el control. Con esta PC:

- **Cable USB (RNDIS):** `rtmp://192.168.42.1/dron`
- **Inalámbrico (WiFi):** `rtmp://10.17.226.120/dron`  ← *la IP WiFi puede cambiar; el script muestra la real*

### 3. Configurar el dron (DJI Fly)
En la pantalla del RC331: **Transmisión en vivo → Plataforma RTMP personalizada**,
y pega **una** de las URLs de arriba (la que corresponda a tu conexión). Empieza a transmitir.

> Graba/transmite en **H.264** y color **Normal** (no D-Log). Y recuerda: para leer las
> ubicaciones, vuela **cerca** (etiquetas ≥ 400 px) — el directo no cambia esa física.

### 4. Abrir el trabajo en vivo (lo recoge el worker GPU)
Desde `C:\OLO_IA\backend`, con el venv:
```bash
PYTHONPATH=src .venv/Scripts/python.exe tools/rtmp/crear_directo.py --url rtsp://<IP>:8554/dron
```
- Si el **worker corre en ESTA PC**: `--url rtsp://127.0.0.1:8554/dron`
- Si el **worker corre en la OTRA PC** (lo normal): usa la IP de red de esta PC que la otra
  PC pueda alcanzar, p. ej. `--url rtsp://10.17.226.120:8554/dron`, y abre los puertos
  **1935** y **8554** en el Firewall de esta PC.

El worker (`inferir.py --bucle`) toma el trabajo `queued`, abre el stream y empieza a
mandar detecciones. Se ven en la app en la inspección en vivo.

**Por qué RTSP para el worker y RTMP para el dron:** el dron *publica* por RTMP; MediaMTX
reexpone el mismo stream por RTSP, que OpenCV abre de forma más fiable.

### 5. Cerrar
`Ctrl-C` en la ventana del servidor, y pon el trabajo en **cancelled** en la app (o el
worker lo cierra al perder el stream).

---

## Preset "huecos vacíos"
`crear_directo.py` usa por defecto: modelo **Detector de alturas v5**, pipeline
**detection-ocr** (detecta `hueco_vacio` y lee `qr_ubicacion`), **umbral 0.5**, **2 fps**.
Ajustable con `--umbral`, `--fps`, `--pipeline`.

## Requisitos del worker
La PC del worker necesita **ffmpeg en el PATH** (OpenCV lo usa para abrir RTSP/RTMP) además
de las dependencias de `inferir.py` (opencv-python, rfdetr/torch, easyocr). Ver
`docs/REQUISITOS_MAQUINA.md`.

## Seguridad
El servidor queda abierto en tu red local sin contraseña (lo normal para una demo en LAN).
No lo expongas a internet así. Si hace falta, MediaMTX admite usuario/clave de publicación
en su `mediamtx.yml`.
