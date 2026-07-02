# URL Relay — Instalación Zero-Touch

Este directorio contiene los scripts para empaquetar y distribuir la extensión
URL Relay fuera de las tiendas oficiales, mediante instalación directa desde
GitHub Releases.

## Estructura

```
url-relay/
├── build.ps1               # Empaqueta los ZIPs para release
├── install.ps1              # Instalador Windows (PowerShell)
├── install.sh               # Instalador Linux (bash)
├── chrome-updates.xml       # Manifiesto de actualizaciones para Chrome
└── dist/                    # ZIPs generados (gitignored)
```

## Cómo usar

### 1. Crear repositorio en GitHub

```
https://github.com/Deen0X/url-relay
```

### 2. Configurar los scripts

Editar `install.ps1` y `install.sh` y cambiar:

```powershell
$Repo = "TU_USUARIO/url-relay"
```

Editar `chrome-updates.xml` y cambiar la URL a tu repositorio.

### 3. Generar los ZIPs

```powershell
cd url-relay
.\build.ps1
```

Esto genera:

| Archivo | Contenido |
|---------|-----------|
| `dist/url-relay-chrome.zip` | Extensión Chrome (con `key` fija en manifest.json) |
| `dist/url-relay-firefox.zip` | Extensión Firefox (con `gecko.id` fijo) |

### 4. Crear Release en GitHub

1. Sube el código a GitHub
2. Crea un nuevo Release con tag `v1.0.0`
3. Sube los ZIPs como assets del Release
4. Añade el instalador como script aparte

### 5. Distribución

El usuario ejecuta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -Uri https://github.com/Deen0X/url-relay/releases/latest/download/install.ps1 -OutFile $env:TEMP\install.ps1; & $env:TEMP\install.ps1"
```

O descarga el script y lo ejecuta directamente.

## Extension ID

Los IDs son fijos y únicos para esta extensión:

| Navegador | ID |
|-----------|----|
| Chrome | `kefplkpcljcdphiabegokfdpedadgbda` |
| Firefox | `url-relay-kefplkpc@url-relay` |

## Actualizaciones

### Chrome
Las políticas creadas por el instalador incluyen `update_url` apuntando a
`chrome-updates.xml` en GitHub. Cuando subas una nueva versión:

1. Edita `chrome-updates.xml` con la nueva versión y URL del asset
2. Crea un nuevo Release en GitHub con los ZIPs actualizados
3. Chrome detectará la actualización automáticamente

### Firefox
Firefox actualiza las extensiones desde `about:addons` cuando detecta
que ha cambiado el addon ID. La extensión se actualiza reinstalando.

---

## Nota sobre Chrome

Chrome no permite sideloading sin developer mode de forma nativa.
El instalador extrae la extensión y crea un acceso directo con `--load-extension`.
El usuario debe hacer clic en "Modo desarrollador" en `chrome://extensions` UNA VEZ.
Después, la extensión se carga automáticamente al iniciar Chrome desde ese acceso directo.

Firefox es más flexible: solo requiere confirmar "Permitir" un mensaje al reiniciar.
