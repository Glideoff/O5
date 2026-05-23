# Copie les installateurs OVERSEER sur le Bureau Windows.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pkgPath = Join-Path $projectRoot "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$version = $pkg.version
$bundleDir = Join-Path $projectRoot "src-tauri\target\release\bundle"
$desktop = [Environment]::GetFolderPath("Desktop")

if (-not (Test-Path $bundleDir)) {
    Write-Error "Dossier bundle introuvable. Lancez: pnpm run build:release"
}

# Retirer les anciens installateurs du Bureau pour eviter la confusion
Get-ChildItem -Path $desktop -Filter "OVERSEER-*-Windows*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Suppression ancien: $($_.Name)"
    Remove-Item $_.FullName -Force
}

$nsis = Get-ChildItem -Path (Join-Path $bundleDir "nsis") -Filter "*setup.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$msi = Get-ChildItem -Path (Join-Path $bundleDir "msi") -Filter "*.msi" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $nsis -and -not $msi) {
    Write-Error "Aucun installateur trouve dans $bundleDir"
}

if ($nsis) {
    $dest = Join-Path $desktop "OVERSEER-$version-Windows-setup.exe"
    Copy-Item -Path $nsis.FullName -Destination $dest -Force
    Write-Host "OK: $dest ($([math]::Round($nsis.Length / 1MB, 1)) Mo)"
}

if ($msi) {
    $dest = Join-Path $desktop "OVERSEER-$version-Windows.msi"
    Copy-Item -Path $msi.FullName -Destination $dest -Force
    Write-Host "OK: $dest ($([math]::Round($msi.Length / 1MB, 1)) Mo)"
}

$macNote = Join-Path $desktop "OVERSEER-$version-macOS - a generer sur Mac.txt"
@"
OVERSEER v$version — installateur macOS
=====================================

Les installateurs macOS (.dmg) ne peuvent pas etre compiles depuis Windows.

Sur un Mac :
  git clone https://github.com/Glideoff/O5.git
  cd O5 && pnpm install && pnpm tauri build

Fichier genere : src-tauri/target/release/bundle/dmg/
"@ | Set-Content -Path $macNote -Encoding UTF8

Write-Host "Note Mac: $macNote"
