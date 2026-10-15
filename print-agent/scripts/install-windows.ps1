<#
  Falcon QR Printer — Instalación del agente local en Windows (El Arrecife)

  Ejecutar UNA vez, con la sesión del usuario que opera la computadora
  (el mismo que usa WhatsApp Desktop y tiene instaladas las impresoras):

      powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1

  Qué hace:
    1. Comprueba Node.js (22.13 o superior) y LibreOffice.
    2. Instala las dependencias del agente.
    3. Crea C:\ElArrecife y sus carpetas.
    4. Crea el archivo .env con un secreto nuevo (si aún no existe).
    5. Instala PM2, inicia el agente y lo deja guardado.
    6. Registra tareas programadas: iniciar el agente al iniciar sesión en
       Windows y respaldar el registro local cada día.

  Es seguro volver a ejecutarlo: no sobrescribe un .env existente.
#>
param(
  [string]$BaseDir = "C:\ElArrecife",
  [switch]$SkipStartup
)

$ErrorActionPreference = "Stop"
$agentDir = Split-Path -Parent $PSScriptRoot
Set-Location $agentDir

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Warn($text) { Write-Host "   AVISO: $text" -ForegroundColor Yellow }

Step "1/6 Requisitos"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js no esta instalado. Instale la version LTS desde https://nodejs.org y vuelva a ejecutar." }
$ver = [version]((node --version).TrimStart("v"))
if ($ver -lt [version]"22.13.0") { throw "Se requiere Node.js 22.13 o superior (instalado: $ver)." }
Write-Host "   Node.js $ver"

$lo = @("C:\Program Files\LibreOffice\program\soffice.exe", "C:\Program Files (x86)\LibreOffice\program\soffice.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($lo) { Write-Host "   LibreOffice: $lo" }
else { Warn "LibreOffice no esta instalado. Los PDF funcionaran; los Word (.doc/.docx) quedaran en error hasta instalarlo desde https://www.libreoffice.org/download/" }

Step "2/6 Dependencias del agente"
npm ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci fallo." }

Step "3/6 Carpetas en $BaseDir"
foreach ($d in "Entradas","Procesando","Originales","PDF","Completados","Errores","Logs","Temporales","Datos","Respaldos") {
  New-Item -ItemType Directory -Force -Path (Join-Path $BaseDir $d) | Out-Null
}
Write-Host "   Carpeta para las descargas de WhatsApp: $(Join-Path $BaseDir 'Entradas')"

Step "4/6 Configuracion (.env)"
$envFile = Join-Path $agentDir ".env"
if (Test-Path $envFile) {
  Write-Host "   Ya existe .env: no se modifica."
} else {
  $secret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  (Get-Content (Join-Path $agentDir ".env.example") -Encoding UTF8) |
    ForEach-Object {
      if ($_ -match '^AGENT_SECRET_TOKEN=') { "AGENT_SECRET_TOKEN=$secret" }
      elseif ($_ -match '^BASE_DIR=') { "BASE_DIR=$BaseDir" }
      else { $_ }
    } | Set-Content -Path $envFile -Encoding UTF8
  # Solo el usuario actual puede leer el archivo con las claves.
  icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "   .env creado. PENDIENTE: complete SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY." -ForegroundColor Yellow
  Write-Host "   Copie esta misma linea al .env.local del panel:" -ForegroundColor Yellow
  Write-Host "   AGENT_SECRET_TOKEN=$secret"
}

Step "5/6 PM2 (mantiene el agente activo y lo reinicia si falla)"
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  npm install -g pm2 --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar PM2." }
}
pm2 delete print-agent 2>$null | Out-Null
pm2 start ecosystem.config.cjs
pm2 save

if (-not $SkipStartup) {
  Step "6/6 Inicio automatico con Windows y respaldo diario"
  $pm2Cmd = (Get-Command pm2.cmd).Source
  $user = "$env:USERDOMAIN\$env:USERNAME"
  # Al iniciar sesion (no como servicio): la impresion y las impresoras son del usuario.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

  $start = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$pm2Cmd`" resurrect"
  Register-ScheduledTask -TaskName "FalconPrintAgent" -Action $start -Settings $settings -Force `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) `
    -Description "Inicia el agente de impresion de El Arrecife al iniciar sesion" | Out-Null

  $backup = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c npm run backup" -WorkingDirectory $agentDir
  Register-ScheduledTask -TaskName "FalconPrintAgentRespaldo" -Action $backup -Settings $settings -Force `
    -Trigger (New-ScheduledTaskTrigger -Daily -At "13:00") `
    -Description "Respaldo diario del registro local del agente de impresion" | Out-Null
  Write-Host "   Tareas registradas: FalconPrintAgent y FalconPrintAgentRespaldo"
}

Write-Host "`nListo. Compruebe el estado con:  pm2 status   y   pm2 logs print-agent" -ForegroundColor Green
Write-Host "Configure WhatsApp Desktop para guardar las descargas en: $(Join-Path $BaseDir 'Entradas')"
