# Build propre OVERSEER + copie installateurs sur le Bureau.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

$pkg = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
Write-Host "=== OVERSEER v$version - build release ===" -ForegroundColor Cyan

# Nettoyage pour éviter un frontend / binaire obsolète dans l'installateur
Write-Host "Nettoyage dist et bundles precedents..."
Remove-Item -Recurse -Force (Join-Path $projectRoot "dist") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $projectRoot "src-tauri\target\release\bundle") -ErrorAction SilentlyContinue

Write-Host "Compilation frontend..."
pnpm build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Compilation Tauri - installateurs NSIS et MSI..."
pnpm tauri build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Copie sur le Bureau..."
& (Join-Path $projectRoot "scripts\copy-installers-to-desktop.ps1")

$desktop = [Environment]::GetFolderPath("Desktop")
$readme = Join-Path $desktop "OVERSEER-$version-LISEZMOI.txt"
@"
OVERSEER v$version — installation
================================

1. Desinstallez toute ancienne version (Parametres Windows > Applications > OVERSEER).
2. Utilisez OVERSEER-$version-Windows-setup.exe (recommande).
   Alternative : OVERSEER-$version-Windows.msi
3. Au premier lancement : ecran d'avertissement > boot > interface.
4. Registre SCP > bouton « Importer Wikidot » pour ajouter des dossiers.

Build : $(Get-Date -Format "yyyy-MM-dd HH:mm")

Mises a jour auto : desactivees par defaut (Parametres).
"@ | Set-Content -Path $readme -Encoding UTF8

Write-Host "Termine. Fichiers sur le Bureau (v$version)." -ForegroundColor Green
