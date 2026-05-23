import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

export interface PlayerSite {
  site_id: string;
  name: string;
  designation: string;
  assigned_at: string;
  source: string;
}

export interface ClaimableSite {
  site_id: string;
  name: string;
  designation: string;
}

interface SiteAssignmentResult {
  sites: PlayerSite[];
  message: string;
  newly_assigned: string | null;
}

interface PlayerSitesState {
  assigned: PlayerSite[];
  claimable: ClaimableSite[];
  lastMessage: string | null;
  isLoading: boolean;

  load: () => Promise<void>;
  claim: (siteId: string) => Promise<void>;
  release: (siteId: string) => Promise<void>;
  setActiveSite: (siteId: string) => void;
  ensureSupervised: (siteId: string) => Promise<boolean>;
  maybeCouncilAssign: () => Promise<void>;
  getSiteIds: () => string[];
}

function syncActiveSiteToSettings(siteId: string) {
  useSettingsStore.getState().update("site_name", siteId);
}

function applyResult(result: SiteAssignmentResult): Partial<PlayerSitesState> {
  const next: Partial<PlayerSitesState> = {
    assigned: result.sites,
    lastMessage: result.message,
  };
  if (result.newly_assigned) {
    syncActiveSiteToSettings(result.newly_assigned);
  }
  return next;
}

export const usePlayerSitesStore = create<PlayerSitesState>((set, get) => ({
  assigned: [],
  claimable: [],
  lastMessage: null,
  isLoading: false,

  load: async () => {
    set({ isLoading: true });
    try {
      const [assigned, claimable] = await Promise.all([
        invoke<PlayerSite[]>("get_player_sites"),
        invoke<ClaimableSite[]>("get_claimable_sites"),
      ]);
      set({ assigned, claimable, isLoading: false });

      const active = useSettingsStore.getState().site_name;
      const ids = assigned.map((s) => s.site_id);
      if (assigned.length > 0 && !ids.includes(active)) {
        syncActiveSiteToSettings(assigned[0].site_id);
      }
    } catch (err) {
      console.error("[OVERSEER] load player sites failed:", err);
      set({ isLoading: false });
    }
  },

  claim: async (siteId) => {
    try {
      const result = await invoke<SiteAssignmentResult>("claim_site", { siteId });
      const claimable = await invoke<ClaimableSite[]>("get_claimable_sites");
      set({ ...applyResult(result), claimable });
    } catch (err) {
      set({ lastMessage: String(err) });
      throw err;
    }
  },

  release: async (siteId) => {
    try {
      const result = await invoke<SiteAssignmentResult>("release_site", { siteId });
      const claimable = await invoke<ClaimableSite[]>("get_claimable_sites");
      const active = useSettingsStore.getState().site_name;
      const patch = applyResult(result);
      set({ ...patch, claimable });
      if (siteId === active && result.sites.length > 0) {
        syncActiveSiteToSettings(result.sites[0].site_id);
      }
    } catch (err) {
      set({ lastMessage: String(err) });
      throw err;
    }
  },

  setActiveSite: (siteId) => {
    const ids = get().getSiteIds();
    if (!ids.includes(siteId)) return;
    syncActiveSiteToSettings(siteId);
  },

  ensureSupervised: async (siteId) => {
    try {
      const result = await invoke<SiteAssignmentResult>("ensure_site_supervised", {
        siteId,
      });
      const claimable = await invoke<ClaimableSite[]>("get_claimable_sites");
      set({ ...applyResult(result), claimable });
      return result.newly_assigned !== null;
    } catch (err) {
      console.warn("[OVERSEER] ensure_site_supervised:", err);
      return false;
    }
  },

  maybeCouncilAssign: async () => {
    try {
      const result = await invoke<SiteAssignmentResult>("maybe_council_assign_site");
      if (result.newly_assigned) {
        const claimable = await invoke<ClaimableSite[]>("get_claimable_sites");
        set({ ...applyResult(result), claimable });
      } else {
        set({ lastMessage: result.message });
      }
    } catch (err) {
      console.warn("[OVERSEER] maybe_council_assign_site:", err);
    }
  },

  getSiteIds: () => get().assigned.map((s) => s.site_id),
}));
