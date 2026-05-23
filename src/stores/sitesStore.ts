import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { NetworkDevice } from "../types/network";

interface SitesState {
  devices: NetworkDevice[];
  isScanning: boolean;
  lastScanAt: string | null;
  lastError: string | null;

  loadKnown: () => Promise<void>;
  scan: () => Promise<void>;
}

export const useSitesStore = create<SitesState>((set) => ({
  devices: [],
  isScanning: false,
  lastScanAt: null,
  lastError: null,

  loadKnown: async () => {
    try {
      const devices = await invoke<NetworkDevice[]>("get_known_sites");
      set({ devices });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] loadKnown sites failed:", msg);
      set({ lastError: msg });
    }
  },

  scan: async () => {
    set({ isScanning: true, lastError: null });
    try {
      const devices = await invoke<NetworkDevice[]>("scan_local_network");
      set({
        devices,
        isScanning: false,
        lastScanAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] scan failed:", msg);
      set({ isScanning: false, lastError: msg });
    }
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerSitesStore: typeof useSitesStore }).overseerSitesStore =
    useSitesStore;
}
