#requires -version 5.1

<#
.SYNOPSIS
    URL Relay - Browser Extension Installer
    Descarga e instala la extensión URL Relay para Chrome y Firefox.

.DESCRIPTION
    Este script descarga la ultima version de URL Relay desde GitHub Releases,
    la extrae en una ubicacion permanente y la registra en el navegador.
    No requiere permisos de administrador.

    Compatibilidad:
    - Windows 10/11
    - Chrome / Edge (Chromium) / Firefox

.PARAMETER Browser
    Fuerza la instalacion para un navegador especifico:
    "Chrome", "Firefox", "Edge" o "Auto" (detecta automaticamente, por defecto)

.PARAMETER Repo
    URL del repositorio GitHub (usuario/repo). Por defecto: Deen0X/url-relay.

.PARAMETER Tag
    Tag de release especifico. Por defecto: "latest".

.EXAMPLE
    .\install.ps1
    Ejecucion interactiva con deteccion automatica del navegador.

.EXAMPLE
    .\install.ps1 -Browser Firefox
    Instala solo para Firefox.
#>

param(
    [ValidateSet("Auto", "Chrome", "Firefox", "Edge")]
    [string]$Browser = "Auto",
    [string]$Repo = "Deen0X/url-relay",
    [string]$Tag = "latest"
)

# --- CONFIGURACION --------------------------------------------------
$CHROME_ID    = "kefplkpcljcdphiabegokfdpedadgbda"
$FIREFOX_ID   = "url-relay-kefplkpc@url-relay"
$APP_NAME     = "URL-Relay"
$INSTALL_DIR  = "$env:LOCALAPPDATA\$APP_NAME"

$CHROME_X64_PATH  = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$CHROME_X86_PATH  = "$env:LOCALAPPDATA\Google\Chrome SxS\User Data"
$EDGE_PATH        = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
$FIREFOX_PROFILES = "$env:APPDATA\Mozilla\Firefox\Profiles"

# --- FUNCIONES ------------------------------------------------------ 

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [ERR] $msg" -ForegroundColor Red }

function Test-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ChromePath {
    $paths = @(
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

function Get-FirefoxPath {
    $paths = @(
        "${env:ProgramFiles}\Mozilla Firefox\firefox.exe",
        "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

function Get-FirefoxProfile {
    $iniPath = "$env:APPDATA\Mozilla\Firefox\profiles.ini"
    if (!(Test-Path $iniPath)) { return $null }

    $content = Get-Content $iniPath -Raw
    $default = $null
    $installFb = $null

    if ($content -match 'Default=(.+\.default-release)') { $default = $matches[1] }
    elseif ($content -match 'Default=(.+\.default)') { $default = $matches[1] }
    if ($content -match 'InstallDirectory=(.+)') { $installFb = $matches[1] }

    if ($default) {
        $profilePath = "$env:APPDATA\Mozilla\Firefox\Profiles\$default"
        if (Test-Path $profilePath) { return $profilePath }
    }
    if ($installFb) {
        $profilePath = "$env:APPDATA\Mozilla\Firefox\Profiles\$installFb"
        if (Test-Path $profilePath) { return $profilePath }
    }

    $dirs = Get-ChildItem -Path $FIREFOX_PROFILES -Directory -ErrorAction SilentlyContinue
    if ($dirs) { return $dirs[0].FullName }

    return $null
}

function Get-ChromeUserData {
    $paths = @($CHROME_X64_PATH, $CHROME_X86_PATH, $EDGE_PATH)
    foreach ($p in $paths) { if (Test-Path "$p\Local State") { return $p } }
    return $null
}

function Download-Release {
    param([string]$AssetName)

    if ($Tag -eq "latest") { $apiUrl = "https://api.github.com/repos/$Repo/releases/latest" }
    else { $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Tag" }

    Write-Step "Consultando releases de $Repo..."
    try {
        $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "url-relay-installer" }
    } catch {
        Write-Err "No se pudo consultar GitHub: $_"
        return $null
    }

    $asset = $release.assets | Where-Object { $_.name -eq $AssetName }
    if (!$asset) {
        Write-Err "No se encontro asset: $AssetName"
        Write-Warn "Assets disponibles:"
        $release.assets | ForEach-Object { Write-Warn "  - $($_.name)" }
        return $null
    }

    $zipPath = "$env:TEMP\$AssetName"
    Write-Step "Descargando $AssetName ($([math]::Round($asset.size / 1KB)) KB)..."
    try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers @{ "User-Agent" = "url-relay-installer" }
    } catch {
        Write-Err "Error en descarga: $_"
        return $null
    }
    return $zipPath
}

function Install-ChromeExtension {
    param([string]$ZipPath)

    Write-Step "Instalando en Chrome..."
    if (!(Get-ChromePath)) { Write-Warn "Chrome no instalado. Omitiendo."; return $false }

    $extDir = "$INSTALL_DIR\chrome\$CHROME_ID"
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null

    Write-Step "Extrayendo archivos a $extDir..."
    try { Expand-Archive -Path $ZipPath -DestinationPath $extDir -Force }
    catch { Write-Err "Error al extraer ZIP: $_"; return $false }

    $policyDir = "$CHROME_X64_PATH\Policy\managed"
    if (!(Test-Path "$CHROME_X64_PATH\Local State")) { $policyDir = "$CHROME_X86_PATH\Policy\managed" }
    New-Item -ItemType Directory -Path $policyDir -Force | Out-Null

    $policyContent = @'
{
  "ExtensionSettings": {
    "kefplkpcljcdphiabegokfdpedadgbda": {
      "installation_mode": "force_installed",
      "update_url": "https://raw.githubusercontent.com/Deen0X/url-relay/main/chrome-updates.xml"
    }
  }
}
'@
    Set-Content -Path "$policyDir\url-relay.json" -Value $policyContent -Encoding UTF8
    Write-OK "Politica Chrome creada en $policyDir\url-relay.json"

    $desktop = [Environment]::GetFolderPath("Desktop")
    $chromeExe = Get-ChromePath
    if ($chromeExe -and $desktop) {
        $shortcutPath = "$desktop\URL Relay - Chrome.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $chromeExe
        $shortcut.Arguments = "--load-extension=`"$extDir`""
        $shortcut.Description = "Abre Chrome con URL Relay cargada"
        $shortcut.Save()
        Write-OK "Acceso directo en escritorio: URL Relay - Chrome.lnk"
    }

    Write-OK "Chrome: extension instalada en $extDir"
    Write-Warn "Abre Chrome usando el acceso directo 'URL Relay - Chrome' en tu escritorio."
    Write-Warn "En chrome://extensions, activa 'Modo desarrollador' UNA VEZ si es necesario."
    return $true
}

function Install-FirefoxExtension {
    param([string]$ZipPath)

    Write-Step "Instalando en Firefox..."
    if (!(Get-FirefoxPath)) { Write-Warn "Firefox no instalado. Omitiendo."; return $false }

    $profile = Get-FirefoxProfile
    if (!$profile) { Write-Err "No se encontro perfil de Firefox"; return $false }

    $extDir = "$profile\extensions"
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    $xpiPath = "$extDir\$FIREFOX_ID.xpi"

    Write-Step "Copiando extension a $xpiPath..."
    try { Copy-Item -Path $ZipPath -Destination $xpiPath -Force }
    catch { Write-Err "Error al copiar: $_"; return $false }

    Write-OK "Firefox: extension copiada a $xpiPath"
    Write-Warn "Reinicia Firefox. Aparecera un mensaje, haz clic en 'Permitir' (solo la primera vez)."
    return $true
}

# --- MAIN -----------------------------------------------------------

Clear-Host
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "    URL Relay - Instalador" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Admin) { Write-Warn "Ejecutando como administrador. No es necesario." }

# --- 1. Seleccionar navegador ---------------------------------------
if ($Browser -eq "Auto") {
    $hasChrome = [bool](Get-ChromePath)
    $hasFirefox = [bool](Get-FirefoxPath)

    if (!$hasChrome -and !$hasFirefox) {
        Write-Err "No se detecto Chrome ni Firefox instalados."
        Write-Host "Instala un navegador compatible y vuelve a ejecutar este script."
        exit 1
    }

    Write-Host "Navegadores detectados:"
    if ($hasChrome)  { Write-Host "  [C] Chrome" -ForegroundColor Green }
    if ($hasFirefox) { Write-Host "  [F] Firefox" -ForegroundColor Green }

    $selection = Read-Host "`nInstalar para ambos? (S/n)"
    if ($selection -eq "n" -or $selection -eq "N") {
        $sel2 = Read-Host "Cual? (C=Chrome, F=Firefox)"
        switch ($sel2.ToUpper()) {
            "C" { $Browser = "Chrome" }
            "F" { $Browser = "Firefox" }
            default { $Browser = "Auto" }
        }
    } else {
        $Browser = "Auto"
    }
}

# --- 2. Descargar ZIP(s) --------------------------------------------
$installChrome  = ($Browser -eq "Auto" -or $Browser -eq "Chrome" -or $Browser -eq "Edge")
$installFirefox = ($Browser -eq "Auto" -or $Browser -eq "Firefox")

$chromeZip  = $null
$firefoxZip = $null

if ($installChrome) {
    $chromeZip = Download-Release -AssetName "url-relay-chrome.zip"
    if (!$chromeZip) { $installChrome = $false }
}
if ($installFirefox) {
    $firefoxZip = Download-Release -AssetName "url-relay-firefox.zip"
    if (!$firefoxZip) { $installFirefox = $false }
}

# --- 3. Instalar ----------------------------------------------------
if ($installChrome)  { Install-ChromeExtension -ZipPath $chromeZip }
if ($installFirefox) { Install-FirefoxExtension -ZipPath $firefoxZip }

# --- 4. Resumen -----------------------------------------------------
Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "       INSTALACION COMPLETADA" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

if ($installChrome) {
    Write-Host "Chrome:"
    Write-Host "  1. Abre chrome://extensions/"
    Write-Host "  2. Activa 'Modo desarrollador' (esquina sup. derecha)"
    Write-Host "  3. Clic en 'Cargar extension sin empaquetar'"
    Write-Host "  4. Selecciona: $INSTALL_DIR\chrome\$CHROME_ID"
    Write-Host ""
}

if ($installFirefox) {
    Write-Host "Firefox:"
    Write-Host "  1. Reinicia Firefox (cierralo y abrelo de nuevo)"
    Write-Host "  2. Cuando aparezca el mensaje, haz clic en PERMITIR"
    Write-Host ""
}

$resp = Read-Host "Abrir carpeta de instalacion? (s/N)"
if ($resp -eq "s" -or $resp -eq "S") { Invoke-Item $INSTALL_DIR }

$resp = Read-Host "Abrir pagina de GitHub? (s/N)"
if ($resp -eq "s" -or $resp -eq "S") { Start-Process "https://github.com/$Repo" }
