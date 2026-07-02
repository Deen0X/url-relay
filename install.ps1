#requires -version 5.1

<#
.SYNOPSIS
    URL Relay - Browser Extension Installer
    Descarga e instala la extensiÃ³n URL Relay para Chrome y Firefox.

.DESCRIPTION
    Este script descarga la Ãºltima versiÃ³n de URL Relay desde GitHub Releases,
    la extrae en una ubicaciÃ³n permanente y la registra en el navegador.
    No requiere permisos de administrador.

    Compatibilidad:
    - Windows 10/11
    - Chrome / Edge (Chromium) / Firefox

.PARAMETER Browser
    Fuerza la instalaciÃ³n para un navegador especÃ­fico:
    "Chrome", "Firefox", "Edge" o "Auto" (detecta automÃ¡ticamente, por defecto)

.PARAMETER Repo
    URL del repositorio GitHub (usuario/repo). Por defecto: el configurado abajo.

.PARAMETER Tag
    Tag de release especÃ­fico. Por defecto: "latest".

.EXAMPLE
    .\install.ps1
    EjecuciÃ³n interactiva con detecciÃ³n automÃ¡tica del navegador.

.EXAMPLE
    .\install.ps1 -Browser Firefox
    Instala solo para Firefox.

.EXAMPLE
    .\install.ps1 -Browser Chrome
    Instala solo para Chrome.
#>

param(
    [ValidateSet("Auto", "Chrome", "Firefox", "Edge")]
    [string]$Browser = "Auto",

    [string]$Repo = "Deen0X/url-relay",

    [string]$Tag = "latest"
)

# â”€â”€â”€ CONFIGURACIÃ“N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# CAMBIA ESTO ANTES DE DISTRIBUIR:
# $Repo = "tu-usuario/url-relay"
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

$CHROME_ID    = "kefplkpcljcdphiabegokfdpedadgbda"
$FIREFOX_ID   = "url-relay-kefplkpc@url-relay"
$APP_NAME     = "URL-Relay"
$INSTALL_DIR  = "$env:LOCALAPPDATA\$APP_NAME"

$CHROME_X64_PATH  = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$CHROME_X86_PATH  = "$env:LOCALAPPDATA\Google\Chrome SxS\User Data"
$EDGE_PATH        = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
$FIREFOX_PROFILES = "$env:APPDATA\Mozilla\Firefox\Profiles"

# â”€â”€â”€ FUNCIONES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Write-Step($msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
    Write-Host "  [ERR] $msg" -ForegroundColor Red
}

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
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-FirefoxPath {
    $paths = @(
        "${env:ProgramFiles}\Mozilla Firefox\firefox.exe",
        "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-FirefoxProfile {
    $iniPath = "$env:APPDATA\Mozilla\Firefox\profiles.ini"
    if (!(Test-Path $iniPath)) { return $null }

    $content = Get-Content $iniPath -Raw
    $default = $null
    $install = $null

    if ($content -match 'Default=(.+\.default-release)') {
        $default = $matches[1]
    }
    elseif ($content -match 'Default=(.+\.default)') {
        $default = $matches[1]
    }

    if ($content -match 'InstallDirectory=(.+)') {
        $install = $matches[1]
    }

    if ($default) {
        $profilePath = "$env:APPDATA\Mozilla\Firefox\Profiles\$default"
        if (Test-Path $profilePath) { return $profilePath }
    }
    if ($install) {
        $profilePath = "$env:APPDATA\Mozilla\Firefox\Profiles\$install"
        if (Test-Path $profilePath) { return $profilePath }
    }

    # fallback: buscar cualquier perfil
    $dirs = Get-ChildItem -Path $FIREFOX_PROFILES -Directory -ErrorAction SilentlyContinue
    if ($dirs) { return $dirs[0].FullName }

    return $null
}

function Get-ChromeUserData {
    $paths = @($CHROME_X64_PATH, $CHROME_X86_PATH, $EDGE_PATH)
    foreach ($p in $paths) {
        if (Test-Path "$p\Local State") { return $p }
    }
    return $null
}

function Download-Release {
    param([string]$AssetName)

    if ($Tag -eq "latest") {
        $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    }

    Write-Step "Consultando releases de $Repo..."
    try {
        $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "url-relay-installer" }
    } catch {
        Write-Err "No se pudo consultar GitHub: $_"
        return $null
    }

    $asset = $release.assets | Where-Object { $_.name -eq $AssetName }
    if (!$asset) {
        Write-Err "No se encontrÃ³ asset: $AssetName"
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

    if (!(Get-ChromePath)) {
        Write-Warn "Chrome no estÃ¡ instalado. Omitiendo."
        return $false
    }

    $extDir = "$INSTALL_DIR\chrome\$CHROME_ID"
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null

    Write-Step "Extrayendo archivos a $extDir..."
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $extDir -Force
    } catch {
        Write-Err "Error al extraer ZIP: $_"
        return $false
    }

    # Crear polÃ­tica Chrome para cargar la extensiÃ³n
    $policyDir = "$CHROME_X64_PATH\Policy\managed"
    if (!(Test-Path "$CHROME_X64_PATH\Local State")) {
        $policyDir = "$CHROME_X86_PATH\Policy\managed"
    }

    New-Item -ItemType Directory -Path $policyDir -Force | Out-Null

    $policy = @"
{
  "ExtensionSettings": {
    "$CHROME_ID": {
      "installation_mode": "force_installed",
      "update_url": "https://raw.githubusercontent.com/$Repo/main/chrome-updates.xml"
    }
  }
}
"@

    $policyPath = "$policyDir\url-relay.json"
    Set-Content -Path $policyPath -Value $policy -Encoding UTF8
    Write-OK "PolÃ­tica Chrome creada: $policyPath"

    # Crear Chrome Policies para que acepte la extensiÃ³n sin developer mode
    Write-Step "Configurando polÃ­ticas de Chrome..."

    # Crear acceso directo en escritorio con --load-extension (fallback)
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
        Write-OK "Acceso directo creado: $shortcutPath"
    }

    Write-OK "Chrome: extensiÃ³n instalada en $extDir"
    Write-Warn "NOTA: Chrome requiere que abras el navegador con el acceso directo creado"
    Write-Warn "      (URL Relay - Chrome.lnk) en tu escritorio para cargar la extensiÃ³n."
    Write-Warn "      En chrome://extensions aparecerÃ¡ como 'Cargada sin empaquetar'."
    Write-Warn "      Activa 'Modo desarrollador' UNA VEZ si ves el mensaje 'Desactivar modo desarrollador'."

    return $true
}

function Install-FirefoxExtension {
    param([string]$ZipPath)

    Write-Step "Instalando en Firefox..."

    if (!(Get-FirefoxPath)) {
        Write-Warn "Firefox no estÃ¡ instalado. Omitiendo."
        return $false
    }

    $profile = Get-FirefoxProfile
    if (!$profile) {
        Write-Err "No se encontrÃ³ perfil de Firefox en $FIREFOX_PROFILES"
        return $false
    }

    $extDir = "$profile\extensions"
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null

    # Firefox espera un XPI (que es un ZIP con otra extensiÃ³n)
    $xpiPath = "$extDir\$FIREFOX_ID.xpi"

    Write-Step "Copiando extensiÃ³n a $xpiPath..."
    try {
        Copy-Item -Path $ZipPath -Destination $xpiPath -Force
    } catch {
        Write-Err "Error al copiar: $_"
        return $false
    }

    Write-OK "Firefox: extensiÃ³n copiada a $xpiPath"
    Write-Warn "NOTA: Al reiniciar Firefox, aparecerÃ¡ un mensaje preguntando si"
    Write-Warn "      permites la extensiÃ³n. Haz clic en 'Permitir' (solo la primera vez)."

    return $true
}

# â”€â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Clear-Host
Write-Host "â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—" -ForegroundColor Cyan
Write-Host "â•‘        URL Relay - Instalador             â•‘" -ForegroundColor Cyan
Write-Host "â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Cyan
Write-Host ""

if (Test-Admin) {
    Write-Warn "Ejecutando como administrador. No es necesario."
}

# â”€â”€â”€ 1. Seleccionar navegador â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if ($Browser -eq "Auto") {
    $hasChrome = [bool](Get-ChromePath)
    $hasFirefox = [bool](Get-FirefoxPath)

    if (!$hasChrome -and !$hasFirefox) {
        Write-Err "No se detectÃ³ Chrome ni Firefox instalados."
        Write-Host "Instala primero un navegador compatible y vuelve a ejecutar este script."
        exit 1
    }

    Write-Host "Navegadores detectados:" -ForegroundColor White
    if ($hasChrome) { Write-Host "  [C] Chrome" -ForegroundColor Green }
    if ($hasFirefox) { Write-Host "  [F] Firefox" -ForegroundColor Green }

    $selection = Read-Host "`nÂ¿Instalar para ambos? (S/n)"
    if ($selection -eq "n" -or $selection -eq "N") {
        $selection = Read-Host "Â¿CuÃ¡l? (C=Chrome, F=Firefox)"
        switch ($selection.ToUpper()) {
            "C" { $Browser = "Chrome" }
            "F" { $Browser = "Firefox" }
            default { $Browser = "Auto" }
        }
    } else {
        $Browser = "Auto"
    }
}

# â”€â”€â”€ 2. Descargar ZIP(s) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

$installChrome = $Browser -eq "Auto" -or $Browser -eq "Chrome" -or $Browser -eq "Edge"
$installFirefox = $Browser -eq "Auto" -or $Browser -eq "Firefox"

$chromeZip = $null
$firefoxZip = $null

if ($installChrome) {
    $chromeZip = Download-Release -AssetName "url-relay-chrome.zip"
    if (!$chromeZip) { $installChrome = $false }
}

if ($installFirefox) {
    $firefoxZip = Download-Release -AssetName "url-relay-firefox.zip"
    if (!$firefoxZip) { $installFirefox = $false }
}

# â”€â”€â”€ 3. Instalar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if ($installChrome) {
    Install-ChromeExtension -ZipPath $chromeZip
}

if ($installFirefox) {
    Install-FirefoxExtension -ZipPath $firefoxZip
}

# â”€â”€â”€ 4. Resumen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host ""
Write-Host "â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—" -ForegroundColor Cyan
Write-Host "â•‘           INSTALACIÃ“N COMPLETADA          â•‘" -ForegroundColor Cyan
Write-Host "â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Cyan
Write-Host ""

if ($installChrome) {
    Write-Host "Chrome:"
    Write-Host "  1. Abre chrome://extensions/"
    Write-Host "  2. Activa 'Modo desarrollador' (esquina superior derecha)"
    Write-Host "  3. Haz clic en 'Cargar extensiÃ³n sin empaquetar'"
    Write-Host "  4. Selecciona: $INSTALL_DIR\chrome\$CHROME_ID"
    Write-Host "  O bien usa el acceso directo 'URL Relay - Chrome' en tu escritorio."
    Write-Host ""
}

if ($installFirefox) {
    Write-Host "Firefox:"
    Write-Host "  1. Reinicia Firefox (ciÃ©rralo y Ã¡brelo de nuevo)"
    Write-Host "  2. Cuando aparezca el mensaje 'Permitir extensiÃ³n', haz clic en PERMITIR"
    Write-Host "  3. VerÃ¡s la extensiÃ³n en about:addons"
    Write-Host ""
}

# Preguntar si abrir carpeta de instalaciÃ³n
$resp = Read-Host "Â¿Abrir carpeta de instalaciÃ³n? (s/N)"
if ($resp -eq "s" -or $resp -eq "S") {
    Invoke-Item $INSTALL_DIR
}

# Preguntar si abrir GitHub
$resp = Read-Host "Â¿Abrir pÃ¡gina de GitHub? (s/N)"
if ($resp -eq "s" -or $resp -eq "S") {
    Start-Process "https://github.com/$Repo"
}
