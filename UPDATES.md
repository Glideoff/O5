# Mises à jour automatiques OVERSEER

OVERSEER utilise le [plugin Tauri Updater](https://v2.tauri.app/plugin/updater/) : au démarrage (et toutes les 4 h), l’app compare sa version à un fichier `latest.json` hébergé sur GitHub Releases.

## Comportement dans l’app

- **Vérification** ~4 s après le boot, puis toutes les **4 heures**
- Si une version plus récente existe : **téléchargement + installation** automatiques (paramètre « Mises à jour automatiques » dans Paramètres)
- Redémarrage de l’application à la fin
- En **mode dev** (`pnpm tauri dev`), les mises à jour sont désactivées

## Configuration du dépôt GitHub

1. Modifiez l’URL dans `src-tauri/tauri.conf.json` :

```json
"endpoints": [
  "https://github.com/Glideoff/O5/releases/latest/download/latest.json"
]
```

2. Publiez une release avec le tag `vX.Y.Z` (ex. `v0.3.0`).

## Publier une mise à jour (vous, développeur)

### 1. Clé de signature (une seule fois)

Déjà générée localement dans `src-tauri/.tauri/overseer.key` (ne **jamais** committer).

La clé **publique** est dans `tauri.conf.json` → `plugins.updater.pubkey`.

Sauvegardez la clé privée en lieu sûr. Sans elle, plus aucune mise à jour possible pour les installs existantes.

### 2. Build signé

PowerShell :

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "src-tauri\.tauri\overseer.key" -Raw
pnpm tauri build
```

### 3. Générer `latest.json`

```powershell
node scripts/generate-latest-json.mjs `
  --version 0.3.0 `
  --base-url "https://github.com/Glideoff/O5/releases/download/v0.3.0"
```

### 4. Fichiers à attacher à la release GitHub

- Installateurs habituels (`.exe`, `.msi`, `.dmg`, etc.)
- Fichiers **`.sig`** à côté des binaires utilisés par l’updater (ex. `OVERSEER_0.3.0_x64-setup.exe` + `.sig`)
- **`latest.json`** à la racine des assets (nom exact pour l’endpoint `.../latest/download/latest.json`)

### CI GitHub Actions

Ajoutez le secret **`TAURI_SIGNING_PRIVATE_KEY`** (contenu du fichier `.key`) dans Settings → Secrets.

Le workflow `.github/workflows/release.yml` peut être étendu pour générer et publier `latest.json` automatiquement sur chaque tag `v*`.

## Incrémenter la version

Alignez les trois fichiers avant chaque release :

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`
