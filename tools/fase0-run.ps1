<#
.SYNOPSIS
  Fase 0: ejecuta `npm run dev` del repositorio ORIGINAL de Google sin modificarlo,
  agrega una marca de tiempo a cada línea de consola, redacta handles y claves,
  muestra la consola en pantalla y guarda una copia para la evidencia.

.USO (desde la raíz del laboratorio voice-traductor, en CMD):
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\fase0-run.ps1 -Dir C:\ruta\gemini-live-translate-livekit

  Opcional: -Out evidencia\fase-0\consola-dev.txt (valor por defecto)

  Detener con Ctrl+C. El archivo queda listo para `npm.cmd run fase0:analizar`.

.NOTAS
  - No toca el código de Google: solo envuelve su salida de consola.
  - El código de Google imprime el handle de reanudación completo en dos lugares
    ("Reconnecting Gemini WebSocket with handle: ..." y el JSON del setup).
    Este script lo reemplaza por un prefijo de 6 caracteres y su longitud.
  - También redacta cualquier `key=...` y `AIza...` por si un error imprimiera la URL.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Out = "evidencia\fase-0\consola-dev.txt"
)

$ErrorActionPreference = 'Continue'

if (-not (Test-Path -LiteralPath (Join-Path $Dir 'package.json'))) {
  Write-Error "No se encuentra package.json en $Dir"
  exit 1
}
$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$redact = {
  param($m)
  $prefix = $m.Groups[1].Value
  $value  = $m.Groups[2].Value
  if ($value -eq 'none' -or $value.Length -le 8) { return $m.Value }
  $head = $value.Substring(0, 6)
  return "$prefix$head...[redactado, $($value.Length) car.]"
}

function Redact-Line([string]$line) {
  $line = [regex]::Replace($line, '(with handle: )(\S+?)(?=\.\.\.|\s|$)', $redact)
  $line = [regex]::Replace($line, '("(?:handle|newHandle)"\s*:\s*")([^"]*)(?=")', $redact)
  $line = [regex]::Replace($line, '(key=)([A-Za-z0-9_\-]{8,})', $redact)
  $line = [regex]::Replace($line, '()(AIza[A-Za-z0-9_\-]{20,})', $redact)
  return $line
}

$header = "# consola-dev.txt | inicio $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK') | dir=$Dir | node=$(& node --version) | npm=$(& npm.cmd --version) | os=$([System.Environment]::OSVersion.VersionString)"
Add-Content -LiteralPath $Out -Value $header -Encoding utf8
Write-Host $header

Push-Location $Dir
try {
  & npm.cmd run dev 2>&1 | ForEach-Object {
    $text = Redact-Line ("$_")
    $stamped = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK') $text"
    Write-Host $stamped
    Add-Content -LiteralPath $Out -Value $stamped -Encoding utf8
  }
}
finally {
  $footer = "# fin $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK')"
  Add-Content -LiteralPath $Out -Value $footer -Encoding utf8
  Write-Host $footer
  Pop-Location
}
