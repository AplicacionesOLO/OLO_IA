<#
  Arranca el servidor RTMP MediaMTX y muestra las URLs exactas para el dron
  (RTMP, lo que pones en DJI Fly) y para el worker (RTSP, mas fiable en OpenCV).

  Uso:   powershell -ExecutionPolicy Bypass -File iniciar.ps1
  Parar: Ctrl-C en esta ventana.
#>
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $raiz "bin\mediamtx.exe"
if (-not (Test-Path $exe)) {
    Write-Host "No existe $exe. Corre primero:  instalar.ps1" -ForegroundColor Red
    exit 1
}

$path = "dron"   # el nombre del stream (clave) que usara el dron

# IPs utiles de esta PC (USB-RNDIS y WiFi), para no adivinar.
$ips = Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }

Write-Host ""
Write-Host "=================== DIRECTO DEL DRON -> OLO_IA ===================" -ForegroundColor Cyan
Write-Host " En DJI Fly:  Transmision en vivo  ->  RTMP personalizado" -ForegroundColor White
Write-Host " Pega UNA de estas URLs segun como conectes el control:" -ForegroundColor White
Write-Host ""
foreach ($ip in $ips) {
    $alias = $ip.InterfaceAlias
    $tipo = if ($alias -match 'Wi-?Fi') { "INALAMBRICO (WiFi)" }
            elseif ($ip.IPAddress -like '192.168.42.*') { "CABLE USB (RNDIS)" }
            else { $alias }
    Write-Host ("   [{0,-20}]  rtmp://{1}/{2}" -f $tipo, $ip.IPAddress, $path) -ForegroundColor Green
}
Write-Host ""
Write-Host " Para el WORKER (crear el directo), usa la URL RTSP equivalente:" -ForegroundColor White
foreach ($ip in $ips) {
    Write-Host ("   rtsp://{0}:8554/{1}" -f $ip.IPAddress, $path) -ForegroundColor Yellow
}
Write-Host "   (si el worker corre en ESTA misma PC:  rtsp://127.0.0.1:8554/$path )" -ForegroundColor DarkGray
Write-Host ""
Write-Host " Firewall: si el worker esta en OTRA PC, permite los puertos 1935 y 8554." -ForegroundColor DarkGray
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# Arranca con la config que trae el binario (RTMP:1935 + RTSP:8554 activos por defecto).
& $exe
