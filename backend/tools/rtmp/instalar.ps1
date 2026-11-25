<#
  Descarga el servidor RTMP MediaMTX (ultima release oficial, Windows x64)
  a backend/tools/rtmp/bin/. No instala nada en el sistema: es un binario suelto.

  Uso:   powershell -ExecutionPolicy Bypass -File instalar.ps1
#>
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin  = Join-Path $raiz "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

Write-Host "-> Consultando la ultima release de MediaMTX..." -ForegroundColor Cyan
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/bluenviron/mediamtx/releases/latest" `
        -Headers @{ "User-Agent" = "olo-rtmp-setup" }
$tag = $rel.tag_name
$asset = $rel.assets | Where-Object { $_.name -match "windows_amd64\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "No se encontro el binario windows_amd64 en la release $tag" }

$zip = Join-Path $env:TEMP $asset.name
Write-Host "-> Bajando $($asset.name) ($tag)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing

Write-Host "-> Extrayendo en $bin ..." -ForegroundColor Cyan
Expand-Archive -Path $zip -DestinationPath $bin -Force
Remove-Item $zip -Force

$exe = Join-Path $bin "mediamtx.exe"
if (Test-Path $exe) {
    Write-Host "OK. Servidor RTMP listo en: $exe" -ForegroundColor Green
    Write-Host "   Siguiente paso:  powershell -ExecutionPolicy Bypass -File iniciar.ps1" -ForegroundColor Green
} else {
    throw "La extraccion no dejo mediamtx.exe en $bin"
}
