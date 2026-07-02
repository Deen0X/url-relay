<#
.SYNOPSIS
    Build script para crear los ZIPs de release de URL Relay.
    Genera url-relay-chrome.zip y url-relay-firefox.zip listos para GitHub Releases.
#>

$CHROME_SRC = "$PSScriptRoot\chrome"
$FIREFOX_SRC = "$PSScriptRoot\firefox"
$DIST_DIR = "$PSScriptRoot\dist"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "     URL Relay - Build Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (!(Test-Path $CHROME_SRC) -or !(Test-Path $FIREFOX_SRC)) {
    Write-Host "  [ERR] No se encuentran los directorios chrome/ y firefox/" -ForegroundColor Red
    Write-Host "  Ejecuta este script desde el directorio url-relay/" -ForegroundColor Red
    exit 1
}

if (Test-Path $DIST_DIR) { Remove-Item -Path $DIST_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $DIST_DIR -Force | Out-Null

Write-Host "==> Empaquetando Chrome..." -ForegroundColor Cyan
$chromeDist = "$DIST_DIR\chrome"
Copy-Item -Path $CHROME_SRC -Destination $chromeDist -Recurse -Force
$exclude = @("*.gitkeep", ".gitignore")
Get-ChildItem -Path $chromeDist -Recurse -Include $exclude | Remove-Item -Force -ErrorAction SilentlyContinue
$chromeZip = "$DIST_DIR\url-relay-chrome.zip"
Compress-Archive -Path "$chromeDist\*" -DestinationPath $chromeZip -Force
Write-Host "  [OK] $chromeZip" -ForegroundColor Green

Write-Host "==> Empaquetando Firefox..." -ForegroundColor Cyan
$firefoxDist = "$DIST_DIR\firefox"
Copy-Item -Path $FIREFOX_SRC -Destination $firefoxDist -Recurse -Force
Get-ChildItem -Path $firefoxDist -Recurse -Include $exclude | Remove-Item -Force -ErrorAction SilentlyContinue
$firefoxZip = "$DIST_DIR\url-relay-firefox.zip"
Compress-Archive -Path "$firefoxDist\*" -DestinationPath $firefoxZip -Force
Write-Host "  [OK] $firefoxZip" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "             BUILD COMPLETADO" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Get-ChildItem $DIST_DIR -Filter "*.zip" | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB)
    Write-Host "  $($_.Name) ($($size) KB)" -ForegroundColor Green
}
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor Yellow
Write-Host "  1. Crea un repo en GitHub: https://github.com/new"
Write-Host "  2. Sube el codigo y crea un Release"
Write-Host "  3. Sube los ZIPs como assets del Release"
Write-Host "  4. Configura REPO en install.ps1 e install.sh"
