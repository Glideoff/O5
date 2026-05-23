import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

/** True si `available` est strictement plus récente que `current` (semver simple). */
function isNewerVersion(available: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(available);
  const c = parse(current);
  const len = Math.max(a.length, c.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const cv = c[i] ?? 0;
    if (av > cv) return true;
    if (av < cv) return false;
  }
  return false;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  notes: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  /** Mise à jour Tauri désactivée en dev (pas de binaire installé). */
  updatesEnabled: boolean;
  _pendingUpdate: Update | null;

  initVersion: () => Promise<void>;
  checkForUpdates: (opts?: { silent?: boolean; autoInstall?: boolean }) => Promise<void>;
  installPendingUpdate: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  currentVersion: "0.0.0",
  availableVersion: null,
  progress: 0,
  notes: null,
  lastError: null,
  lastCheckedAt: null,
  updatesEnabled: isTauri() && import.meta.env.PROD,
  _pendingUpdate: null,

  initVersion: async () => {
    if (!isTauri()) return;
    try {
      const v = await getVersion();
      set({ currentVersion: v });
    } catch {
      /* ignore */
    }
  },

  checkForUpdates: async (opts) => {
    const silent = opts?.silent ?? false;
    const settings = useSettingsStore.getState();
    const autoInstall = opts?.autoInstall ?? settings.auto_update;

    if (!get().updatesEnabled || !isTauri()) {
      return;
    }

    if (!settings.update_check_enabled) {
      return;
    }

    set({ status: "checking", lastError: null, progress: 0 });

    try {
      const update = await check();
      const now = new Date().toISOString();

      if (!update) {
        set({
          status: "up-to-date",
          availableVersion: null,
          notes: null,
          _pendingUpdate: null,
          lastCheckedAt: now,
        });
        return;
      }

      const current = get().currentVersion;
      if (!isNewerVersion(update.version, current)) {
        set({
          status: "up-to-date",
          availableVersion: null,
          notes: null,
          _pendingUpdate: null,
          lastCheckedAt: now,
        });
        return;
      }

      set({
        status: "available",
        availableVersion: update.version,
        notes: update.body ?? null,
        _pendingUpdate: update,
        lastCheckedAt: now,
      });

      if (autoInstall) {
        await get().installPendingUpdate();
      } else if (!silent) {
        /* l'UI affiche la bannière */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        status: "error",
        lastError: msg,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  },

  installPendingUpdate: async () => {
    const pending = get()._pendingUpdate;
    if (!pending || !get().updatesEnabled) return;

    set({ status: "downloading", progress: 0, lastError: null });

    try {
      let downloaded = 0;
      let contentLength = 0;

      await pending.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            set({ status: "downloading", progress: 0 });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              set({
                status: "downloading",
                progress: Math.min(100, Math.round((downloaded / contentLength) * 100)),
              });
            }
            break;
          case "Finished":
            set({ status: "installing", progress: 100 });
            break;
        }
      });

      await relaunch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: "error", lastError: msg });
    }
  },
}));
