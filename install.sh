#!/usr/bin/env bash
# URL Relay - Browser Extension Installer (Linux)
# Descarga la última versión desde GitHub Releases y la instala en Chrome/Chromium/Firefox.
set -euo pipefail

# ─── CONFIGURACIÓN ────────────────────────────────────────────
# CAMBIA ESTO ANTES DE DISTRIBUIR:
REPO="Deen0X/url-relay"
TAG="latest"
# ──────────────────────────────────────────────────────────────

CHROME_ID="kefplkpcljcdphiabegokfdpedadgbda"
FIREFOX_ID="url-relay-kefplkpc@url-relay"
APP_NAME="url-relay"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { echo -e "${CYAN}==>${NC} $1"; }
ok()    { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()   { echo -e "  ${RED}[ERR]${NC} $1"; }

cleanup() {
    [ -n "$TMPDIR" ] && rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ─── DETECTAR NAVEGADORES ─────────────────────────────────

detect_chrome() {
    if command -v google-chrome &>/dev/null; then
        echo "/usr/bin/google-chrome"
    elif command -v google-chrome-stable &>/dev/null; then
        echo "/usr/bin/google-chrome-stable"
    elif command -v chromium &>/dev/null; then
        echo "/usr/bin/chromium"
    elif command -v chromium-browser &>/dev/null; then
        echo "/usr/bin/chromium-browser"
    else
        echo ""
    fi
}

detect_firefox() {
    if command -v firefox &>/dev/null; then
        echo "/usr/bin/firefox"
    else
        echo ""
    fi
}

get_firefox_profile() {
    local profiles_dir="$HOME/.mozilla/firefox"
    if [ ! -d "$profiles_dir" ]; then
        echo ""
        return
    fi
    local ini="$profiles_dir/profiles.ini"
    if [ -f "$ini" ]; then
        local default
        default=$(grep -E "^Default=" "$ini" | head -1 | cut -d= -f2)
        if [ -n "$default" ] && [ -d "$profiles_dir/$default" ]; then
            echo "$profiles_dir/$default"
            return
        fi
    fi
    # fallback: buscar cualquier perfil
    local dir
    dir=$(find "$profiles_dir" -maxdepth 1 -type d -name "*.default*" | head -1)
    if [ -n "$dir" ]; then
        echo "$dir"
        return
    fi
    echo ""
}

# ─── DESCARGAR RELEASE ─────────────────────────────────

download_release() {
    local asset_name="$1"
    local out_path="$TMPDIR/$asset_name"

    if [ "$TAG" = "latest" ]; then
        api_url="https://api.github.com/repos/$REPO/releases/latest"
    else
        api_url="https://api.github.com/repos/$REPO/releases/tags/$TAG"
    fi

    step "Consultando releases de $REPO..."
    local release_json
    release_json=$(curl -sS -H "User-Agent: url-relay-installer" "$api_url" 2>/dev/null || true)

    if ! echo "$release_json" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        err "No se pudo consultar GitHub"
        echo ""
        return
    fi

    local url
    url=$(echo "$release_json" | python3 -c "
import json,sys
r = json.load(sys.stdin)
for a in r.get('assets', []):
    if a['name'] == '$asset_name':
        print(a['browser_download_url'])
" 2>/dev/null)

    if [ -z "$url" ]; then
        err "No se encontró asset: $asset_name"
        echo ""
        return
    fi

    step "Descargando $asset_name..."
    curl -sSL -o "$out_path" -H "User-Agent: url-relay-installer" "$url"
    if [ $? -ne 0 ]; then
        err "Error en descarga"
        echo ""
        return
    fi

    echo "$out_path"
}

# ─── INSTALAR EN CHROME ─────────────────────────────────

install_chrome() {
    local zip_path="$1"
    local chrome_bin
    chrome_bin=$(detect_chrome)
    if [ -z "$chrome_bin" ]; then
        warn "Chrome/Chromium no detectado. Omitiendo."
        return 1
    fi
    ok "Chrome detectado: $chrome_bin"

    local ext_dir="$HOME/.local/share/$APP_NAME/chrome/$CHROME_ID"
    mkdir -p "$ext_dir"

    step "Extrayendo archivos a $ext_dir..."
    unzip -o -q "$zip_path" -d "$ext_dir"

    # Crear política Chrome
    local config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
    local policy_dir="$config_home/google-chrome/Policy/managed"
    if [ ! -d "$policy_dir" ]; then
        # Chromium
        policy_dir="$config_home/chromium/Policy/managed"
    fi
    mkdir -p "$policy_dir"

    cat > "$policy_dir/url-relay.json" <<EOF
{
  "ExtensionSettings": {
    "$CHROME_ID": {
      "installation_mode": "force_installed",
      "update_url": "https://raw.githubusercontent.com/$REPO/main/chrome-updates.xml"
    }
  }
}
EOF
    ok "Política Chrome creada: $policy_dir/url-relay.json"

    # Acceso directo .desktop
    local desktop_dir="$HOME/.local/share/applications"
    mkdir -p "$desktop_dir"
    cat > "$desktop_dir/url-relay-chrome.desktop" <<EOF
[Desktop Entry]
Name=URL Relay - Chrome
Comment=Abre Chrome con URL Relay cargada
Exec=$chrome_bin --load-extension="$ext_dir" %U
Terminal=false
Type=Application
Icon=google-chrome
Categories=Network;
EOF
    chmod +x "$desktop_dir/url-relay-chrome.desktop"
    ok "Acceso directo creado: url-relay-chrome.desktop"

    echo ""
    step "Resumen Chrome:"
    ok "Extensión instalada en: $ext_dir"
    warn "Abre Chrome desde el acceso directo 'URL Relay - Chrome' en tu menú de aplicaciones."
    warn "O ejecuta: $chrome_bin --load-extension=\"$ext_dir\""
    warn "En chrome://extensions verás la extensión. Activa 'Modo desarrollador' UNA VEZ si es necesario."
}

# ─── INSTALAR EN FIREFOX ────────────────────────────────

install_firefox() {
    local zip_path="$1"
    local firefox_bin
    firefox_bin=$(detect_firefox)
    if [ -z "$firefox_bin" ]; then
        warn "Firefox no detectado. Omitiendo."
        return 1
    fi
    ok "Firefox detectado: $firefox_bin"

    local profile
    profile=$(get_firefox_profile)
    if [ -z "$profile" ]; then
        err "No se encontró perfil de Firefox en ~/.mozilla/firefox"
        warn "Asegúrate de haber ejecutado Firefox al menos una vez."
        return 1
    fi
    ok "Perfil Firefox: $profile"

    local ext_dir="$profile/extensions"
    mkdir -p "$ext_dir"
    local xpi_path="$ext_dir/$FIREFOX_ID.xpi"

    step "Copiando extensión a $xpi_path..."
    cp "$zip_path" "$xpi_path"
    ok "Extensión copiada."

    echo ""
    step "Resumen Firefox:"
    ok "Extensión instalada en: $xpi_path"
    warn "Reinicia Firefox. Cuando aparezca el mensaje 'Permitir extensión', haz clic en PERMITIR."
    warn "Solo se pide una vez. Después, verás la extensión en about:addons."
}

# ─── MAIN ────────────────────────────────────────────────

clear
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}     URL Relay - Instalador (Linux)${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

TMPDIR=$(mktemp -d)

# Detectar navegadores
HAS_CHROME=$(detect_chrome)
HAS_FIREFOX=$(detect_firefox)

if [ -z "$HAS_CHROME" ] && [ -z "$HAS_FIREFOX" ]; then
    err "No se detectó Chrome/Chromium ni Firefox instalados."
    echo "Instala un navegador compatible y vuelve a ejecutar este script."
    exit 1
fi

echo "Navegadores detectados:"
[ -n "$HAS_CHROME" ] && echo -e "  ${GREEN}[C] Chrome/Chromium${NC}"
[ -n "$HAS_FIREFOX" ] && echo -e "  ${GREEN}[F] Firefox${NC}"
echo ""

# Preguntar selección
read -r -p "¿Instalar para ambos? (S/n): " selection
if [[ "$selection" =~ ^[nN]$ ]]; then
    read -r -p "¿Cuál? (C=Chrome, F=Firefox): " sel
    case "${sel^^}" in
        C) INSTALL_CHROME=true; INSTALL_FIREFOX=false ;;
        F) INSTALL_CHROME=false; INSTALL_FIREFOX=true ;;
        *) INSTALL_CHROME=true; INSTALL_FIREFOX=true ;;
    esac
else
    INSTALL_CHROME=true
    INSTALL_FIREFOX=true
fi

# Descargar e instalar
CHROME_ZIP=""
FIREFOX_ZIP=""

if [ "$INSTALL_CHROME" = true ] && [ -n "$HAS_CHROME" ]; then
    CHROME_ZIP=$(download_release "url-relay-chrome.zip")
fi

if [ "$INSTALL_FIREFOX" = true ] && [ -n "$HAS_FIREFOX" ]; then
    FIREFOX_ZIP=$(download_release "url-relay-firefox.zip")
fi

[ -n "$CHROME_ZIP" ] && install_chrome "$CHROME_ZIP"
[ -n "$FIREFOX_ZIP" ] && install_firefox "$FIREFOX_ZIP"

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}      INSTALACIÓN COMPLETADA${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

read -r -p "¿Abrir página de GitHub? (s/N): " resp
if [[ "$resp" =~ ^[sS]$ ]]; then
    xdg-open "https://github.com/$REPO" 2>/dev/null || true
fi
