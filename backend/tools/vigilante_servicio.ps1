# ═══════════════════════════════════════════════════════════════════════════
#  EL VIGILANTE DE PROCESOS HUERFANOS, COMO TAREA PROGRAMADA
#
#      powershell -ExecutionPolicy Bypass -File tools\vigilante_servicio.ps1 -Instalar
#
#  ── POR QUE UN DISPARADOR CON REPETICION, Y NO `--bucle` COMO LOS OTROS DOS ──
#
#  `inferir.py`/`entrenar.py` tienen que quedarse residentes: en cuanto ven
#  trabajo, lo cogen y ocupan la GPU un rato largo. `vigilante.py` hace un
#  barrido corto —unas pocas llamadas a la API— y termina. Repetirlo es trabajo
#  del PROPIO PLANIFICADOR: un disparador con repeticion cada 10 minutos, sin
#  ningun proceso de Python quieto de fondo la mayor parte del tiempo.
#
#  ── POR QUE `backend\.venv` Y NO `.venv-train` ────────────────────────────
#
#  A diferencia de los otros dos, este guion no toca video ni un modelo: solo
#  habla con la API por `urllib`, que es libreria estandar. No necesita
#  `rfdetr` ni `easyocr`, asi que no hace falta el entorno de vision.
# ═══════════════════════════════════════════════════════════════════════════

param(
    [switch]$Instalar,
    [switch]$Desinstalar,
    [switch]$Estado,
    [string]$Api = 'https://olo-ia-api.onrender.com',
    [int]$CadaMinutos = 10
)

$ErrorActionPreference = 'Stop'
$TAREA   = 'OLO_IA - Vigilante de procesos huerfanos'
$RAIZ    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
#  `python.exe`, no `pythonw.exe`: la tarea lo lanza DENTRO de un `powershell.exe
#  -Command` que redirige su salida a un archivo con `*>>`. `pythonw.exe` no tiene
#  ninguna consola de la que redirigir nada —para eso existe—, asi que con el la
#  redireccion capturaba cero bytes. Aqui no hace falta pythonw: a diferencia de
#  los otros dos servicios, esta tarea no queda residente para que alguien la
#  encuentre y la cierre por error; corre unos segundos y termina.
$PYTHON  = Join-Path $RAIZ '.venv\Scripts\python.exe'
$SCRIPT  = Join-Path $RAIZ 'tools\vigilante.py'
$LOGDIR  = Join-Path $env:LOCALAPPDATA 'OLO_IA'
$LOG     = Join-Path $LOGDIR 'vigilante.log'

function Requisitos {
    if (-not (Test-Path $PYTHON)) { throw "No encuentro $PYTHON" }
    if (-not (Test-Path $SCRIPT)) { throw "No encuentro $SCRIPT" }
    $clave = Join-Path (Split-Path -Parent $RAIZ) '.secrets\adminpw.txt'
    if (-not (Test-Path $clave)) {
        throw "Falta la contraseña en $clave. Sin ella el vigilante no puede autenticarse."
    }
    if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Path $LOGDIR | Out-Null }
}

if ($Instalar) {
    Requisitos
    # Sin `--log`: cada pasada es corta y su salida se redirige aqui abajo con
    # `>>`, que si funciona porque el disparador SI pasa por un shell -Command.
    $args = "-Command `"& '$PYTHON' -u '$SCRIPT' --api $Api *>> '$LOG'`""
    $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $RAIZ

    # `[TimeSpan]::MaxValue` produce una duracion XML que Task Scheduler rechaza
    # («fuera de intervalo»); 10 años es la forma habitual de decir «indefinido»
    # dentro de lo que el formato SI acepta.
    $disparador = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes $CadaMinutos) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    $disparador.StartBoundary = [datetime]::Now.ToString('s')

    $ajustes = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable

    if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false
    }

    Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparador `
        -Settings $ajustes -Description `
        'Cierra entrenamientos y trabajos de percepcion huerfanos. Ver tools/vigilante_servicio.ps1' `
        -Force | Out-Null

    Write-Output "Instalada: «$TAREA», cada $CadaMinutos minutos"
    Write-Output "  API   : $Api"
    Write-Output "  log   : $LOG"
    Write-Output "  parar : powershell -File tools\vigilante_servicio.ps1 -Desinstalar"
    exit 0
}

if ($Desinstalar) {
    if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false
        Write-Output "Desinstalada: «$TAREA»"
    } else {
        Write-Output "No estaba instalada."
    }
    exit 0
}

if ($Estado) {
    $t = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output 'La tarea NO esta instalada.'; exit 1 }
    $info = Get-ScheduledTaskInfo -TaskName $TAREA
    Write-Output "tarea            : $($t.State)"
    Write-Output "ultima ejecucion : $($info.LastRunTime)  (resultado $($info.LastTaskResult))"
    Write-Output "proxima ejecucion: $($info.NextRunTime)"
    if (Test-Path $LOG) {
        Write-Output "`nultimas lineas del log:"
        Get-Content $LOG -Tail 12 | ForEach-Object { "   $_" }
    }
    exit 0
}

Write-Output @"
Uso:
  -Instalar          crea la tarea programada (repite cada -CadaMinutos, 10 por omision)
  -Desinstalar       la elimina
  -Estado            dice si esta instalada, cuando corrio y las ultimas lineas del log
  -Api <url>         por omision https://olo-ia-api.onrender.com
  -CadaMinutos <n>   cada cuanto se repite, por omision 10
"@
