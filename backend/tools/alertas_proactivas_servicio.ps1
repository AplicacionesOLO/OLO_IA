# ═══════════════════════════════════════════════════════════════════════════
#  ALERTAS PROACTIVAS DE CUOTA Y FLOTA (#6), COMO TAREA PROGRAMADA
#
#      powershell -ExecutionPolicy Bypass -File tools\alertas_proactivas_servicio.ps1 -Instalar
#
#  Mismo patron que escalar_incidencias_servicio.ps1: un barrido corto (dos
#  llamadas a la API) que el propio Planificador de Windows repite cada N
#  minutos, sin ningun proceso de Python quieto de fondo el resto del tiempo.
#  `backend\.venv` porque este guion solo habla con la API por `urllib`,
#  biblioteca estandar -- no toca video ni un modelo.
# ═══════════════════════════════════════════════════════════════════════════

param(
    [switch]$Instalar,
    [switch]$Desinstalar,
    [switch]$Estado,
    [string]$Api = 'https://olo-ia-api.onrender.com',
    [int]$CadaMinutos = 15
)

$ErrorActionPreference = 'Stop'
$TAREA   = 'OLO_IA - Alertas proactivas de cuota y flota'
$RAIZ    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PYTHON  = Join-Path $RAIZ '.venv\Scripts\python.exe'
$SCRIPT  = Join-Path $RAIZ 'tools\alertas_proactivas.py'
$LOGDIR  = Join-Path $env:LOCALAPPDATA 'OLO_IA'
$LOG     = Join-Path $LOGDIR 'alertas_proactivas.log'

function Requisitos {
    if (-not (Test-Path $PYTHON)) { throw "No encuentro $PYTHON" }
    if (-not (Test-Path $SCRIPT)) { throw "No encuentro $SCRIPT" }
    $clave = Join-Path (Split-Path -Parent $RAIZ) '.secrets\adminpw.txt'
    if (-not (Test-Path $clave)) {
        throw "Falta la contraseña en $clave. Sin ella las alertas no pueden autenticarse."
    }
    if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Path $LOGDIR | Out-Null }
}

if ($Instalar) {
    Requisitos
    $args = "-Command `"& '$PYTHON' -u '$SCRIPT' --api $Api *>> '$LOG'`""
    $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $RAIZ

    # `[TimeSpan]::MaxValue` produce una duracion XML que Task Scheduler rechaza;
    # 10 años es la forma habitual de decir «indefinido» dentro del formato.
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
        'Avisa si la cuota del tenant esta cerca del limite o si un dispositivo de flota se cayo sin ser retirado. Ver tools/alertas_proactivas_servicio.ps1' `
        -Force | Out-Null

    Write-Output "Instalada: «$TAREA», cada $CadaMinutos minutos"
    Write-Output "  API   : $Api"
    Write-Output "  log   : $LOG"
    Write-Output "  parar : powershell -File tools\alertas_proactivas_servicio.ps1 -Desinstalar"
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
  -Instalar          crea la tarea programada (repite cada -CadaMinutos, 15 por omision)
  -Desinstalar       la elimina
  -Estado            dice si esta instalada, cuando corrio y las ultimas lineas del log
  -Api <url>         por omision https://olo-ia-api.onrender.com
  -CadaMinutos <n>   cada cuanto se repite, por omision 15
"@
