import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Scp } from "../types/incident";

export interface WikiImportResult {
  scp_id: string;
  ok: boolean;
  scp?: Scp;
  error?: string;
}

interface ScpState {
  scps: Scp[];
  isLoading: boolean;
  isGenerating: boolean;
  isImporting: boolean;
  selectedId: string | null;
  lastError: string | null;
  /** Marque les IDs ajoutés depuis la dernière session pour l'animation slide-in. */
  newlyAdded: Set<string>;

  loadAll: () => Promise<void>;
  selectScp: (id: string | null) => void;
  generateNewScp: () => Promise<Scp | null>;
  importFromWiki: (scpIds: string[]) => Promise<WikiImportResult[]>;
  transferScp: (id: string, newSite: string) => Promise<void>;
  acknowledgeNewlyAdded: (id: string) => void;
}

export const useScpStore = create<ScpState>((set, get) => ({
  scps: [],
  isLoading: false,
  isGenerating: false,
  isImporting: false,
  selectedId: null,
  lastError: null,
  newlyAdded: new Set<string>(),

  loadAll: async () => {
    set({ isLoading: true, lastError: null });
    try {
      const scps = await invoke<Scp[]>("get_all_scps");
      set({ scps, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] loadAll SCPs failed:", msg);
      set({ isLoading: false, lastError: msg });
    }
  },

  selectScp: (id) => set({ selectedId: id }),

  importFromWiki: async (scpIds) => {
    if (scpIds.length === 0 || get().isImporting) return [];
    set({ isImporting: true, lastError: null });
    try {
      const results = await invoke<WikiImportResult[]>("import_scps_from_wiki", {
        scpIds,
      });
      const imported = results.filter((r) => r.ok && r.scp).map((r) => r.scp!);
      if (imported.length > 0) {
        set((state) => {
          const next = new Set(state.newlyAdded);
          const byId = new Map(state.scps.map((s) => [s.id, s]));
          for (const scp of imported) {
            byId.set(scp.id, scp);
            next.add(scp.id);
          }
          return {
            scps: Array.from(byId.values()).sort((a, b) =>
              a.id.localeCompare(b.id, undefined, { numeric: true }),
            ),
            isImporting: false,
            selectedId: imported[imported.length - 1]?.id ?? state.selectedId,
            newlyAdded: next,
          };
        });
        for (const scp of imported) {
          window.setTimeout(() => get().acknowledgeNewlyAdded(scp.id), 1500);
        }
      } else {
        set({ isImporting: false });
      }
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0 && imported.length === 0) {
        set({ lastError: failures[0]?.error ?? "Import échoué" });
      }
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isImporting: false, lastError: msg });
      return [];
    }
  },

  generateNewScp: async () => {
    if (get().isGenerating) return null;
    set({ isGenerating: true, lastError: null });
    try {
      const scp = await invoke<Scp>("generate_scp_with_ai");
      set((state) => {
        const next = new Set(state.newlyAdded);
        next.add(scp.id);
        return {
          scps: [scp, ...state.scps.filter((s) => s.id !== scp.id)],
          isGenerating: false,
          selectedId: scp.id,
          newlyAdded: next,
        };
      });
      // Auto-désincription de l'animation après son timing
      window.setTimeout(() => {
        get().acknowledgeNewlyAdded(scp.id);
      }, 1500);
      return scp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] generate_scp_with_ai failed:", msg);
      set({ isGenerating: false, lastError: msg });
      return null;
    }
  },

  transferScp: async (id, newSite) => {
    try {
      await invoke("update_scp_site", { id, newSite });
      set((state) => ({
        scps: state.scps.map((s) => (s.id === id ? { ...s, site: newSite } : s)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] transferScp failed:", msg);
      set({ lastError: msg });
    }
  },

  acknowledgeNewlyAdded: (id) => {
    set((state) => {
      if (!state.newlyAdded.has(id)) return state;
      const next = new Set(state.newlyAdded);
      next.delete(id);
      return { newlyAdded: next };
    });
  },
}));

/* Exposition debug en dev */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerScpStore: typeof useScpStore }).overseerScpStore =
    useScpStore;
}
