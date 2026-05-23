import { create } from "zustand";
import { persist } from "zustand/middleware";

export type IncidentFrequency = "rare" | "normal" | "frequent";
export type IncidentSeverityMax = "SAFE" | "EUCLIDE" | "KETER";
export type NetworkMode = "server" | "client";
export type AiLanguage = "fr" | "en";

export interface SettingsState {
  /* Identité Foundation */
  o5_id: string;
  site_name: string;

  /* Incident Engine */
  incident_frequency: IncidentFrequency;
  severity_max: IncidentSeverityMax;
  ollama_model: string; // 'auto' ou nom de modèle précis

  /* Interface */
  scanlines: boolean;
  vignette_intensity: number; // 0-100
  sounds_enabled: boolean;
  sound_volume: number; // 0-100
  ai_language: AiLanguage;

  /* Réseau */
  ws_port: number;
  network_mode: NetworkMode;

  /* Mises à jour */
  auto_update: boolean;
  update_check_enabled: boolean;

  /* Effectifs par site */
  site_min_total: number;
  site_min_non_class_d: number;

  /* Actions */
  update: <K extends keyof Omit<SettingsState, "update" | "reset">>(
    key: K,
    value: SettingsState[K],
  ) => void;
  reset: () => void;
}

const DEFAULTS: Omit<SettingsState, "update" | "reset"> = {
  o5_id: "O5-1",
  site_name: "SITE-██",
  incident_frequency: "normal",
  severity_max: "KETER",
  ollama_model: "auto",
  scanlines: true,
  vignette_intensity: 55,
  sounds_enabled: true,
  sound_volume: 30,
  ai_language: "fr",
  ws_port: 47474,
  network_mode: "server",
  auto_update: false,
  update_check_enabled: true,
  site_min_total: 50,
  site_min_non_class_d: 20,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      update: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "overseer-settings",
      // Ne pas persister les actions
      partialize: (state) => {
        const { update: _u, reset: _r, ...rest } = state;
        return rest;
      },
    },
  ),
);

/* ==========================================================================
   Helpers dérivés
   ========================================================================== */

export function frequencyToBoundsSeconds(
  freq: IncidentFrequency,
): { min: number; max: number } {
  switch (freq) {
    case "rare":
      return { min: 60 * 60, max: 3 * 60 * 60 };
    case "frequent":
      return { min: 5 * 60, max: 20 * 60 };
    case "normal":
    default:
      return { min: 20 * 60, max: 60 * 60 };
  }
}

export function severityAllowed(
  level: "SAFE" | "EUCLIDE" | "KETER",
  max: IncidentSeverityMax,
): boolean {
  const order: Record<string, number> = { SAFE: 0, EUCLIDE: 1, KETER: 2 };
  return order[level] <= order[max];
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerSettings: typeof useSettingsStore }).overseerSettings =
    useSettingsStore;
}
