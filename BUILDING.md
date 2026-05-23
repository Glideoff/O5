# BUILDING OVERSEER

Document classifié — Niveau O5 / OVERSEER EYES ONLY

Ce document décrit les chemins de build pour générer des installateurs OVERSEER sur Windows, macOS et Linux.

---

## Prérequis communs

- **Node.js** ≥ 20 (LTS)
- **pnpm** ≥ 9 (`npm install -g pnpm`)
- **Rust** ≥ 1.75 stable (`rustup default stable`)

Installer les dépendances frontend après clone :

```bash
pnpm install
```

---

## Windows (déjà testé ✓)

### Prérequis Windows

- **Visual Studio Build Tools 2022** avec composant "Desktop development with C++"
- **WebView2 Runtime** (préinstallé sur Windows 11, sinon téléchargeable chez Microsoft)
- **Rust target** : `x86_64-pc-windows-msvc` (par défaut)

### Commandes

```powershell
# Dev (hot reload)
pnpm tauri dev

# Build production → 2 artefacts (MSI + NSIS)
pnpm build:win
# ou
pnpm tauri build
```

### Sortie

```text
src-tauri/target/release/
├── o5.exe                                              # binaire pur (~15 MB)
└── bundle/
    ├── msi/OVERSEER_0.2.0_x64_fr-FR.msi               # installateur Windows Installer (FR)
    └── nsis/OVERSEER_0.2.0_x64-setup.exe              # installateur NSIS (FR)
```

L'NSIS est plus léger (3.8 MB), le MSI plus standard pour les déploiements entreprise (5.5 MB).

---

## macOS

### Prérequis macOS

- **macOS** ≥ 10.15 Catalina
- **Xcode Command Line Tools** : `xcode-select --install`
- **Rust targets** :
  ```bash
  rustup target add aarch64-apple-darwin   # Apple Silicon (M1/M2/M3...)
  rustup target add x86_64-apple-darwin    # Intel
  ```

### Commandes

```bash
# Dev local (hot reload)
pnpm tauri dev

# Build production — architecture native
pnpm tauri build

# Build universel (un .dmg qui marche sur Intel ET Apple Silicon)
pnpm tauri build --target universal-apple-darwin

# Build spécifique ARM (M1/M2/M3)
pnpm tauri build --target aarch64-apple-darwin

# Build spécifique Intel
pnpm tauri build --target x86_64-apple-darwin
```

### Sortie

```text
src-tauri/target/<target>/release/bundle/
├── macos/OVERSEER.app                                  # bundle .app brut
└── dmg/OVERSEER_0.2.0_<arch>.dmg                       # installateur disque
```

### ⚠️ Note signing / notarization

Sans certificat Apple Developer (99 $/an), le `.dmg` est utilisable mais l'utilisateur final aura un avertissement "OVERSEER n'a pas pu être ouvert car son développeur ne peut pas être vérifié" au premier lancement. Pour passer outre :

> Clic-droit sur OVERSEER.app → Ouvrir → "Ouvrir quand même"

Une seule fois suffit.

Pour une distribution propre, configurer dans `tauri.conf.json` :

```jsonc
"macOS": {
  "signingIdentity": "Developer ID Application: Ton Nom (TEAMID)",
  "providerShortName": "TEAMID"
}
```

Et exporter les variables d'environnement avant `pnpm tauri build` :

```bash
export APPLE_ID="ton@email.com"
export APPLE_PASSWORD="app-specific-password"  # depuis appleid.apple.com
export APPLE_TEAM_ID="TEAMID"
```

Tauri s'occupera de la notarization automatiquement.

---

## Linux

### Prérequis Linux (Ubuntu/Debian)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Commandes

```bash
pnpm tauri build
```

### Sortie

```text
src-tauri/target/release/bundle/
├── deb/overseer_0.1.0_amd64.deb                        # Debian/Ubuntu
├── rpm/overseer-0.1.0-1.x86_64.rpm                     # Fedora/RHEL (si rpm-build installé)
└── appimage/overseer_0.1.0_amd64.AppImage              # universel Linux
```

---

## Build multi-plateforme automatique via GitHub Actions

Le repo contient `.github/workflows/release.yml`. Pour déclencher un build complet de tous les OS :

### Méthode 1 — Push d'un tag

```bash
git tag v0.2.0
git push origin v0.2.0
```

Au bout de **~15 minutes**, une **Release brouillon** apparaît dans l'onglet Releases de GitHub avec :

- `OVERSEER_0.2.0_x64_fr-FR.msi` (Windows MSI)
- `OVERSEER_0.2.0_x64-setup.exe` (Windows NSIS)
- `OVERSEER_0.2.0_aarch64.dmg` (macOS Apple Silicon)
- `OVERSEER_0.2.0_x64.dmg` (macOS Intel)
- `overseer_0.2.0_amd64.deb` (Linux Debian)
- `overseer_0.2.0_amd64.AppImage` (Linux universel)

Vérifie le contenu et clique "Publish release".

### Méthode 2 — Manuel depuis l'interface GitHub

Actions → "OVERSEER — Release builds" → **Run workflow**

### Signing macOS via GitHub Actions

Décommente les variables d'env dans `release.yml` puis ajoute les secrets dans **Settings → Secrets and variables → Actions** :

- `APPLE_CERTIFICATE` (base64 du `.p12` exporté de Keychain)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY` (ex: "Developer ID Application: Ton Nom (TEAMID)")
- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

Les builds macOS seront alors signés ET notarisés automatiquement.

---

## Tableau récapitulatif des artefacts

| OS | Format | Taille typique | Use case |
|---|---|---|---|
| Windows | `.msi` | ~5.5 MB | Déploiement entreprise, Group Policy |
| Windows | `-setup.exe` | ~3.8 MB | Distribution grand public |
| macOS ARM | `.dmg` | ~8 MB | M1/M2/M3 |
| macOS Intel | `.dmg` | ~9 MB | Mac Intel pré-2020 |
| macOS universel | `.dmg` | ~16 MB | Un seul fichier pour les deux archis |
| Linux | `.deb` | ~7 MB | Ubuntu, Debian, Mint |
| Linux | `.AppImage` | ~80 MB | Distribution universelle Linux |
| Linux | `.rpm` | ~7 MB | Fedora, RHEL, openSUSE |

---

## Dépannage

### "WebView2 runtime not found" (Windows)

Télécharger l'evergreen bootstrapper : <https://developer.microsoft.com/microsoft-edge/webview2/>

### "Could not find tool: dpkg-deb" (Linux)

```bash
sudo apt-get install dpkg
```

### "rpm-build not found" (Linux)

```bash
sudo dnf install rpm-build   # Fedora
```

### Build macOS échoue avec "linking with cc failed"

```bash
xcode-select --install
```

### Cache Rust corrompu

```bash
cd src-tauri && cargo clean
```

---

## Variables d'environnement Tauri utiles

| Variable | Effet |
|---|---|
| `TAURI_DEBUG=true` | Build avec symbols debug même en release |
| `TAURI_BUNDLE_TARGETS=msi,nsis` | Limite les formats générés |
| `WEBVIEW2_RUNTIME_PATH=...` | WebView2 portable au lieu de runtime système |

---

*OVERSEER — Secure. Contain. Protect.*
