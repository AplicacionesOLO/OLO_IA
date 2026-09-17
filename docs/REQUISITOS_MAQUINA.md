# Requisitos de máquina — OLO_IA

> Esto es solo la referencia de hardware/software. Para el proceso de instalación paso a
> paso, ver `ONBOARDING.md` en la raíz del repo.

Qué hace falta para montar y correr el **worker de visión** (`backend/tools/inferir.py`)
en una máquina nueva. El backend y el frontend por sí solos piden mucho menos —son una
API web y un sitio estático—; lo que empuja los requisitos hacia arriba es RF-DETR +
EasyOCR + torch.

## Resumen

| | Mínimo | Recomendado | Esta máquina (referencia, medida el 2026-08-19/20) |
|---|---|---|---|
| GPU | Ninguna — cae a CPU | NVIDIA con CUDA, ≥4 GB VRAM **libres** tras cargar el modelo | RTX 2000 Ada, 16 GB |
| CPU | 4 núcleos | 8+ núcleos | Intel i9-14900, 24 núcleos / 32 hilos |
| RAM | 8 GB | 16 GB+ | 31,6 GB |
| Disco libre | ~6 GB para los dos entornos, más material en tránsito | 20 GB+ | `.venv-train` 3,46 GB · `backend/.venv` 0,16 GB (medido) |
| SO | Windows 10/11 | Windows 11 | Windows 11 Pro |
| Python | 3.12+ para `backend/.venv`; **3.13 exacto** para `.venv-train` | igual | 3.12.10 y 3.13.15 |

No hace falta que los dos Python sean la misma versión, y no hace falta ser
administrador de la máquina: todo se instala con `winget install --scope user` y `pip`.

---

## Por qué estos números, y no otros

### GPU: opcional, pero cambia el análisis entre 10 y 50 veces

Medido en la máquina de desarrollo original (ver `ONBOARDING.md` §2.2): con
`torch+cpu`, un análisis de 74 fotogramas con troceado tardó unas dos horas. Esa es la
única razón por la que el proyecto se mueve de máquina en primer lugar.

Sin GPU el worker sigue funcionando igual —`torch.cuda.is_available()` decide solo, no
hay bandera que tocar— solo que mucho más lento, y **sin avisar**: es el fallo más caro
de este proyecto porque no deja rastro en ningún log (ver ONBOARDING §2.2, "la trampa
número uno").

**Cuánta VRAM hace falta de verdad, medido**: con RF-DETR Nano cargado y 31 regiones por
fotograma —un fotograma completo más los 30 trozos del tope de troceado (ONBOARDING
§4.4)— procesadas en lotes de 8 (`LOTE_REGIONES` en `inferir.py`), el pico medido fue
**0,32 GB**. El umbral de 4 GB que exige el código (`VRAM_MIN_OCR_GB`) para encender
también el OCR en GPU es deliberadamente generoso: dejar sitio a EasyOCR en la misma
tarjeta sin competir por memoria con el detector, no porque el detector solo lo necesite.

Una tarjeta con menos de 4 GB libres sigue sirviendo para el detector en GPU; lo que se
apaga automáticamente es el OCR en GPU, que cae a CPU sin que el trabajo falle (ver
`_ocr_en_gpu` en `inferir.py`).

### CPU: decodificar vídeo, y el respaldo del OCR

ffmpeg/OpenCV decodifican fotogramas en CPU sin importar la GPU que haya. Y si la
tarjeta no tiene margen de VRAM, EasyOCR corre entero en CPU — más núcleos ayudan a las
dos cosas, aunque no hay un mínimo medido más allá de "lo suficiente para que decodificar
no sea el cuello de botella".

### RAM: fotogramas grandes en memoria a la vez

Un vídeo 8K trae fotogramas de decenas de MB cada uno, y el troceado mantiene el
fotograma completo más sus recortes en memoria durante el análisis de ese fotograma. 8
GB es un piso razonable; con 4K o menos sobra de sobra.

### Disco: los dos entornos, más el material en tránsito

Medido en esta máquina:

- `.venv-train` (torch+CUDA, torchvision, rfdetr, supervision, easyocr, opencv, y el
  paquete `olo` del backend en editable): **3,46 GB**.
- `backend/.venv` (FastAPI, SQLAlchemy, asyncpg, etc.): **0,16 GB**.

A eso hay que sumarle el checkpoint del modelo (~350 MB, se descarga solo una vez, a
`~/.roboflow/models/`) y espacio para el material que esté subiéndose o troceándose: el
límite de un archivo es 2 GiB (ONBOARDING §4.7), y un vídeo grande puede convivir en
disco con sus trozos si se particiona con ffmpeg antes de subir.

### Software exacto, y por qué no cualquier versión sirve

- **Python 3.13 para `.venv-train`, no 3.12 ni 3.14**: `faster-coco-eval` —que RF-DETR
  necesita para entrenar— no tiene rueda compilada para 3.14 (`docs/MANUAL.md:348`). No
  se probó explícitamente que rompa en 3.12, pero 3.13 es la versión que ya está en
  producción y con la que se generaron los números de arriba: cambiarla sin necesidad es
  arriesgar una combinación sin probar.
- **Python 3.12+ para `backend/.venv`**: es lo que exige `requires-python` en
  `backend/pyproject.toml`. Cualquier 3.12/3.13/3.14 real sirve.
- **El índice de CUDA de PyTorch NO se asume**: hay que comprobar contra
  `https://download.pytorch.org/whl/<índice>/` cuál coincide con lo que reporta
  `nvidia-smi` en la máquina nueva, en vez de copiar un `cu124` de otra sesión. En esta
  máquina el driver reportaba CUDA 13.2 y el índice correcto resultó ser `cu132`.
- **ffmpeg en el PATH**: el worker lo busca con `shutil.which`; sin él el análisis
  funciona pero el vídeo no se puede reproducir en el navegador (ONBOARDING §2.4).
- **Node.js**: probado con v22 y v24 sin problemas conocidos entre versiones, para el
  frontend.

## Qué NO hace falta

- Permisos de administrador.
- Docker.
- La misma versión de Python en los dos entornos.
- Una GPU de gama alta: el modelo del proyecto es RF-DETR **Nano**, el más chico de la
  familia — de ahí que 0,32 GB de pico sea tan poco.
