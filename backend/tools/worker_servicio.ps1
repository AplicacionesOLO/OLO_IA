# ═══════════════════════════════════════════════════════════════════════════
#  EL WORKER DE INFERENCIA, COMO SERVICIO DE ESTA PC
#
#  Arranca `tools/inferir.py --bucle` contra PRODUCCION y lo mantiene vivo. Se
#  instala como tarea programada de Windows con:
#
#      powershell -ExecutionPolicy Bypass -File tools\worker_servicio.ps1 -Instalar
#
#  ── POR QUE CONTRA PRODUCCION Y NO CONTRA LOCALHOST ────────────────────────
#
#  Porque es lo que hace que el sistema sirva a un GRUPO. El worker no recibe
#  conexiones: las hace. Pregunta cada 15 s a la API si hay algo en cola y se lo
#  lleva. Asi, alguien desde otra PC entra a olo-ia.onrender.com, sube su video, y
#  esta maquina lo procesa sin que nadie tenga que abrir un puerto ni configurar
#  nada en su lado.
#
#  Apuntarlo a `http://127.0.0.1:8000` —el valor por omision de `inferir.py`— lo
#  dejaria mirando una cola que solo existe en esta maquina, y los trabajos de los
#  demas se quedarian encolados para siempre sin que nada lo avisara.
#
#  ── LO QUE HACE FALTA QUE SIGA SIENDO CIERTO ───────────────────────────────
#
#  · esta PC encendida y con internet. Si se apaga, los trabajos se acumulan en
#    cola —no se pierden— y se procesan cuando vuelva;
#  · la contraseña en C:\OLO_IA\.secrets\adminpw.txt, que es como se autentica;
#  · un modelo PUBLICADO con sus pesos. Ya lo hay: los descarga solo de Storage y
#    los cachea, asi que no depende de ninguna ruta local.
#
#  ── POR QUE «al iniciar sesion» Y NO «al arrancar el equipo» ───────────────
#
#  Arrancar con el equipo exige guardar la contraseña de Windows en la tarea. Al
#  iniciar sesion no hace falta, y el caso real es una PC que alguien enciende y
#  usa. Si algun dia esto tiene que vivir en un servidor sin nadie delante, la
#  respuesta correcta no es esta tarea: es un contenedor.
# ═══════════════════════════════════════════════════════════════════════════

param(
    [switch]$Instalar,
    [switch]$Desinstalar,
    [switch]$Estado,
    [string]$Api = 'https://olo-ia-api.onrender.com'
)

$ErrorActionPreference = 'Stop'
$TAREA   = 'OLO_IA - Worker de inferencia'
$RAIZ    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
# `.venv-train` y no `backend\.venv`, y esto no es un detalle: el worker necesita
# RF-DETR para detectar Y `easyocr` para leer, y solo ese entorno tiene los dos.
#
# Medido: con `backend\.venv` el trabajo se coge, se procesa la deteccion y muere con
# «ModuleNotFoundError: No module named 'easyocr'» — el trabajo queda `failed` y el
# operario no tiene forma de saber que el problema es de esta maquina.
#
# Se llama «-train» por como nacio (Python 3.13, porque `faster-coco-eval` no tenia
# rueda para 3.14), pero hoy es el entorno completo de vision.
$PYTHON  = Join-Path (Split-Path -Parent $RAIZ) '.venv-train\Scripts\pythonw.exe'
$SCRIPT  = Join-Path $RAIZ 'tools\inferir.py'
$LOGDIR  = Join-Path $env:LOCALAPPDATA 'OLO_IA'
$LOG     = Join-Path $LOGDIR 'worker.log'

function Parar {
    <#
        Deja la maquina SIN ningun worker: para la tarea y mata los procesos sueltos.

        Los procesos aparte hacen falta porque `Stop-ScheduledTask` no siempre se lleva
        al hijo: si la tarea se reinstalo o Windows perdio el vinculo, queda un
        `pythonw.exe` huerfano sondeando la cola que nadie ve en el planificador.

        El filtro es por NOMBRE de ejecutable Y por la linea de comandos, nunca por la
        linea sola: un filtro amplio sobre CommandLine puede coincidir con el propio
        proceso que lo ejecuta y matarlo a mitad.
    #>
    if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
    }
    $sueltos = Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
        Where-Object { $_.CommandLine -like '*tools\inferir.py*' }
    foreach ($p in $sueltos) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "  detenido worker suelto (PID $($p.ProcessId))"
    }
}

function Requisitos {
    # `pythonw.exe` y no `python.exe`: el segundo abre una consola negra en cada
    # inicio de sesion, y lo primero que hace la gente con una ventana que no
    # entiende es cerrarla — matando el worker.
    if (-not (Test-Path $PYTHON)) { throw "No encuentro $PYTHON" }
    if (-not (Test-Path $SCRIPT)) { throw "No encuentro $SCRIPT" }
    $clave = Join-Path (Split-Path -Parent $RAIZ) '.secrets\adminpw.txt'
    if (-not (Test-Path $clave)) {
        throw "Falta la contraseña en $clave. Sin ella el worker no puede autenticarse."
    }
    if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Path $LOGDIR | Out-Null }
}

if ($Instalar) {
    Requisitos
    # `-u`: sin buffer. Con buffer, el log se queda vacio durante minutos y parece
    # que el worker esta colgado cuando esta trabajando.
    #
    # `--log` y no una redireccion `>` : la tarea ejecuta `pythonw.exe` directamente,
    # sin shell, asi que no hay quien redirija. El propio worker escribe el archivo, y
    # ademas le pone marca de tiempo a cada linea — que es lo que se busca cuando algo
    # dejo de funcionar.
    $args = "-u `"$SCRIPT`" --api $Api --bucle --espera 15 --log `"$LOG`""
    $accion = New-ScheduledTaskAction -Execute $PYTHON -Argument $args -WorkingDirectory $RAIZ

    $disparadores = @(
        (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
    )

    # Sin limite de duracion: es un proceso que debe vivir siempre. Por omision
    # Windows mata las tareas a los 3 dias, y el sintoma seria «dejo de funcionar
    # el jueves» sin ninguna otra pista.
    $ajustes = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable

    # Se limpia ANTES de registrar, para no dejar dos workers sondeando la misma cola:
    # no darian ningun error, se repartirian los trabajos o competirian por el mismo, y
    # eso puede duplicar detecciones en silencio.
    #
    # Reinstalar es ademas la forma de recuperarse de un `pythonw.exe` huerfano que
    # sobrevivio a una tarea eliminada, que el planificador ya no muestra.
    Parar

    Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparadores `
        -Settings $ajustes -Description `
        'Procesa las inspecciones que se encolan desde olo-ia.onrender.com. Ver tools/worker_servicio.ps1' `
        -Force | Out-Null

    # Solo si el registro no la arranco ya.
    Start-Sleep -Seconds 2
    if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') {
        Start-ScheduledTask -TaskName $TAREA
    }
    Write-Output "Instalada y arrancada: «$TAREA»"
    Write-Output "  API   : $Api"
    Write-Output "  log   : $LOG"
    Write-Output "  parar : powershell -File tools\worker_servicio.ps1 -Desinstalar"
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
        Where-Object { $_.CommandLine -like '*tools\inferir.py*' })

    # Se cuentan solo los RAIZ, no todos los procesos.
    #
    # El worker tiene hijos y es NORMAL: en Windows, `multiprocessing` arranca un hijo
    # re-ejecutando el interprete CON LA MISMA LINEA DE COMANDOS, asi que un `pythonw`
    # hijo es indistinguible del padre si solo se mira el comando. Contarlos a todos
    # daba «procesos vivos: 2» con un unico worker — una falsa alarma que me llevo a
    # perseguir un duplicado que no existia. Lo resolvio mirar ParentProcessId.
    $pids = $procesos | ForEach-Object { $_.ProcessId }
    $raices = @($procesos | Where-Object { $pids -notcontains $_.ParentProcessId })
    Write-Output "workers vivos    : $($raices.Count)  (procesos en total: $($procesos.Count), los hijos son normales)"
    if ($raices.Count -gt 1) {
        # DOS workers si serian un problema: se reparten la cola o compiten por el mismo
        # trabajo, y eso puede duplicar detecciones sin que nada lo avise.
        Write-Output "  ⚠ HAY MAS DE UN WORKER. Deberia haber exactamente uno."
        Write-Output "    arreglalo con:  -Instalar   (limpia y vuelve a dejar uno solo)"
    }
    # Lo que de verdad importa no es que el proceso exista, sino que la API lo vea
    # latir: un worker vivo que no puede autenticarse es igual de inutil que uno
    # apagado, y solo la API sabe la diferencia.
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

Contra produccion a proposito: asi las inspecciones que suba cualquiera desde
olo-ia.onrender.com las procesa esta maquina.
"@
