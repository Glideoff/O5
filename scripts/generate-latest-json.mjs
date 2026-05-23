#!/usr/bin/env node
/**
 * Génère latest.json pour le plugin Tauri updater à partir des artefacts signés.
 *
 * Usage (après `pnpm tauri build` avec TAURI_SIGNING_PRIVATE_KEY) :
 *   node scripts/generate-latest-json.mjs --version 0.3.0 --base-url https://github.com/USER/REPO/releases/download/v0.3.0
 *
 * Windows : cherche OVERSEER_*_x64-setup.exe.sig dans src-tauri/target/release/bundle/nsis/
 * macOS   : *.app.tar.gz.sig dans bundle/macos/
 * Linux   : *.AppImage.sig dans bundle/appimage/
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const target = path.join(root, "src-tauri", "target");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const version = arg("--version", process.env.OVERSEER_VERSION || "0.0.0");
const baseUrl = arg("--base-url", process.env.OVERSEER_UPDATE_BASE_URL || "");
const outPath = arg("--out", path.join(root, "latest.json"));

if (!baseUrl) {
  console.error("Indiquez --base-url (URL du dossier release GitHub, sans slash final).");
  process.exit(1);
}

function readSig(sigPath) {
  if (!fs.existsSync(sigPath)) return null;
  return fs.readFileSync(sigPath, "utf8").trim();
}

function findFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const hit = files.find((f) => pattern.test(f) && !f.endsWith(".sig"));
  return hit ? path.join(dir, hit) : null;
}

const platforms = {};

const winDir = path.join(target, "release", "bundle", "nsis");
const winExe = findFile(winDir, /setup\.exe$/i) || findFile(winDir, /OVERSEER.*\.exe$/i);
if (winExe) {
  const sig = readSig(`${winExe}.sig`);
  if (sig) {
    platforms["windows-x86_64"] = {
      url: `${baseUrl}/${path.basename(winExe)}`,
      signature: sig,
    };
  }
}

const macDir = path.join(target, "release", "bundle", "macos");
const macGz = findFile(macDir, /\.tar\.gz$/i);
if (macGz) {
  const sig = readSig(`${macGz}.sig`);
  if (sig) {
    platforms["darwin-aarch64"] = {
      url: `${baseUrl}/${path.basename(macGz)}`,
      signature: sig,
    };
    platforms["darwin-x86_64"] = platforms["darwin-aarch64"];
  }
}

const linuxDir = path.join(target, "release", "bundle", "appimage");
const appImage = findFile(linuxDir, /\.AppImage$/i);
if (appImage) {
  const sig = readSig(`${appImage}.sig`);
  if (sig) {
    platforms["linux-x86_64"] = {
      url: `${baseUrl}/${path.basename(appImage)}`,
      signature: sig,
    };
  }
}

if (Object.keys(platforms).length === 0) {
  console.error("Aucun artefact signé trouvé. Lancez d'abord : pnpm tauri build");
  process.exit(1);
}

const manifest = {
  version,
  notes: `OVERSEER ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log("Écrit :", outPath);
console.log(JSON.stringify(manifest, null, 2));
