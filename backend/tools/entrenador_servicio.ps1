# ═══════════════════════════════════════════════════════════════════════════
#  EL RUNNER DE ENTRENAMIENTO, COMO SERVICIO DE ESTA PC
#
#  Arranca `tools/entrenar.py --bucle` contra PRODUCCION y lo mantiene vivo. Se
#  instala como tarea programada de Windows con:
#
#      powershell -ExecutionPolicy Bypass -File tools\entrenador_servicio.ps1 -Instalar
#
#  ── POR QUE HACIA FALTA ESTE ARCHIVO ────────────────────────────────────────
#
#  Hasta ahora, encolar un entrenamiento desde la pantalla no bastaba: alguien
#  tenia que ACORDARSE de abrir una consola y lanzar `entrenar.py` a mano en esta
#  maquina. Dos ejecuciones se quedaron horas esperando por exactamente eso el 20
#  de agosto de 2026. Este script es el mismo patron que ya resuelve esto para la
#  inferencia (`worker_servicio.ps1`), aplicado al entrenamiento.
#
#  ── POR QUE CONTRA PRODUCCION Y NO CONTRA LOCALHOST ────────────────────────
#
#  Igual que el worker de inferencia: el runner no recibe conexiones, las hace.
#  Pregunta cada rato a la API si hay una ejecucion en cola y se la lleva. Asi,
#  encolar un entrenamiento desde cualquier PC hace que ESTA maquina —la que
#  tiene la GPU— lo procese sin que nadie configure nada en su lado.
#
#  ── LO QUE HACE FALTA QUE SIGA SIENDO CIERTO ───────────────────────────────
#
#  · esta PC encendida y con internet. Si se apaga, las ejecuciones se acumulan
#    en cola —no se pierden— y se procesan cuando vuelva;
#  · la contraseña en C:\OLO_IA\.secrets\adminpw.txt;
#  · `.venv-train` con `rfdetr[train,loggers]` instalado — sin eso, el runner NO
#    entrena y deja la ejecucion encolada para otra maquina, en vez de fallarla.
#
#  ── POR QUE «al iniciar sesion» Y NO «al arrancar el equipo» ───────────────
#
#  Misma razon que `worker_servicio.ps1`: al iniciar sesion no exige guardar la
#  contraseña de Windows en la tarea, y el caso real es una PC que alguien
#  enciende y usa.
# ═══════════════════════════════════════════════════════════════════════════

param(
    [switch]$Instalar,
    [switch]$Desinstalar,
    [switch]$Estado,
    [string]$Api = 'https://olo-ia-api.onrender.com'
)

$ErrorActionPreference = 'Stop'
$TAREA   = 'OLO_IA - Runner de entrenamiento'
$RAIZ    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
# `.venv-train`, no `backend\.venv`: el runner necesita RF-DETR con los extras de
# entrenamiento (`rfdetr[train,loggers]`), y solo ese entorno los tiene instalados.
$PYTHON  = Join-Path (Split-Path -Parent $RAIZ) '.venv-train\Scripts\pythonw.exe'
$SCRIPT  = Join-Path $RAIZ 'tools\entrenar.py'
$LOGDIR  = Join-Path $env:LOCALAPPDATA 'OLO_IA'
$LOG     = Join-Path $LOGDIR 'entrenador.log'

function Parar {
    <#
        Deja la maquina SIN ningun runner: para la tarea y mata los procesos sueltos.
        Mismo razonamiento que `Parar` en `worker_servicio.ps1` — ver ese archivo.
    #>
    if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
    }
    $sueltos = Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
        Where-Object { $_.CommandLine -like '*tools\entrenar.py*' }
    foreach ($p in $sueltos) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "  detenido runner suelto (PID $($p.ProcessId))"
    }
}

function Requisitos {
    if (-not (Test-Path $PYTHON)) { throw "No encuentro $PYTHON" }
    if (-not (Test-Path $SCRIPT)) { throw "No encuentro $SCRIPT" }
    $clave = Join-Path (Split-Path -Parent $RAIZ) '.secrets\adminpw.txt'
    if (-not (Test-Path $clave)) {
        throw "Falta la contraseña en $clave. Sin ella el runner no puede autenticarse."
    }
    if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Path $LOGDIR | Out-Null }
}

if ($Instalar) {
    Requisitos
    # `-u`: sin buffer, mismo motivo que el worker de inferencia.
    #
    # `--espera 30`, mas espaciado que los 15 s del worker de inferencia: entrenar
    # tarda minutos u horas, asi que sondear la cola cada 15 s gastaria llamadas a
    # la API sin ninguna ventaja sobre 30.
    $args = "-u `"$SCRIPT`" --api $Api --bucle --espera 30 --log `"$LOG`""
    $accion = New-ScheduledTaskAction -Execute $PYTHON -Argument $args -WorkingDirectory $RAIZ

    $disparadores = @(
        (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
    )

    # Sin limite de duracion: un entrenamiento real puede tardar mas de las 3 horas
    # que Windows le daria a una tarea por omision, y esta tarea ademas debe vivir
    # siempre, no solo mientras entrena.
    $ajustes = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable

    # Se limpia ANTES de registrar: dos runners sondeando la misma cola no darian
    # ningun error, pero podrian competir por la misma ejecucion encolada.
    Parar

    Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparadores `
        -Settings $ajustes -Description `
        'Entrena los modelos que se encolan desde olo-ia.onrender.com. Ver tools/entrenador_servicio.ps1' `
        -Force | Out-Null

    Start-Sleep -Seconds 2
    if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') {
        Start-ScheduledTask -TaskName $TAREA
    }
    Write-Output "Instalada y arrancada: «$TAREA»"
    Write-Output "  API   : $Api"
    Write-Output "  log   : $LOG"
    Write-Output "  parar : powershell -File tools\entrenador_servicio.ps1 -Desinstalar"
    exit 0
}

if ($Desinstalar) {
    Parar
    if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TAREA -Confirm:$false
        Write-Output "Desinstalada: «$TAREA»"
    } else {
        Write-Output "No estaba instalada; los procesos sueltos (si habia) quedan parados."
    }
    exit 0
}

if ($Estado) {
    $t = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output 'La tarea NO esta instalada.'; exit 1 }
    $info = Get-ScheduledTaskInfo -TaskName $TAREA
    Write-Output "tarea            : $($t.State)"
    Write-Output "ultima ejecucion : $($info.LastRunTime)  (resultado $($info.LastTaskResult))"
    $procesos = @(Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
        Where-Object { $_.CommandLine -like '*tools\entrenar.py*' })
    $pids = $procesos | ForEach-Object { $_.ProcessId }
    $raices = @($procesos | Where-Object { $pids -notcontains $_.ParentProcessId })
    Write-Output "runners vivos    : $($raices.Count)  (procesos en total: $($procesos.Count), los hijos son normales)"
    if ($raices.Count -gt 1) {
        Write-Output "  ⚠ HAY MAS DE UN RUNNER. Deberia haber exactamente uno."
        Write-Output "    arreglalo con:  -Instalar   (limpia y vuelve a dejar uno solo)"
    }
    try {
        $r = Invoke-RestMethod -Uri "$Api/health" -TimeoutSec 20
        Write-Output "API              : $($r.status)"
    } catch {
        Write-Output "API              : no responde"
    }
    if (Test-Path $LOG) {
        Write-Output "`nultimas lineas del log:"
        Get-Content $LOG -Tail 8 | ForEach-Object { "   $_" }
    }
    exit 0
}

Write-Output @"
Uso:
  -Instalar      crea la tarea programada y la arranca
  -Desinstalar   la para y la elimina
  -Estado        dice si esta viva, y las ultimas lineas del log
  -Api <url>     por omision https://olo-ia-api.onrender.com

Contra produccion a proposito: asi un entrenamiento encolado desde cualquier PC
lo procesa esta maquina, que es la que tiene la GPU.
"@
