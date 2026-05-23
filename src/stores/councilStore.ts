import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useIncidentStore } from "./incidentStore";
import { usePlayerSitesStore } from "./playerSitesStore";
import { useScpStore } from "./scpStore";
import type {
  CouncilVoteResult,
  Motion,
  MotionKind,
  MotionOption,
} from "../types/council";

interface CouncilState {
  motions: Motion[];
  selectedId: string | null;
  isLoading: boolean;
  isGenerating: boolean;
  isApplying: boolean;
  isCreating: boolean;
  lastError: string | null;

  loadAll: () => Promise<void>;
  selectMotion: (id: string | null) => void;
  createMotion: (input: {
    title: string;
    description: string;
    category: string;
    context?: string | null;
    options: MotionOption[];
    kind?: MotionKind;
  }) => Promise<Motion | null>;
  convokeCouncil: (motionId: string) => Promise<Motion | null>;
  castVote: (motionId: string, optionId: string) => Promise<CouncilVoteResult | null>;
}

async function refreshWorldState(): Promise<void> {
  await Promise.all([
    useScpStore.getState().loadAll(),
    usePlayerSitesStore.getState().load(),
    useIncidentStore.getState().loadIncidentsFromDb(),
  ]);
}

export const useCouncilStore = create<CouncilState>((set) => ({
  motions: [],
  selectedId: null,
  isLoading: false,
  isGenerating: false,
  isApplying: false,
  isCreating: false,
  lastError: null,

  loadAll: async () => {
    set({ isLoading: true, lastError: null });
    try {
      const motions = await invoke<Motion[]>("get_all_motions");
      set({ motions, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] loadAll motions failed:", msg);
      set({ isLoading: false, lastError: msg });
    }
  },

  selectMotion: (id) => set({ selectedId: id }),

  createMotion: async ({ title, description, category, context, options, kind }) => {
    set({ isCreating: true, lastError: null });
    try {
      const motion = await invoke<Motion>("create_motion", {
        title,
        description,
        category,
        context: context ?? null,
        options: JSON.stringify(options),
        kind: kind ?? "COUNCIL",
      });
      set((state) => ({
        motions: [motion, ...state.motions],
        selectedId: motion.id,
        isCreating: false,
      }));
      return motion;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] createMotion failed:", msg);
      set({ isCreating: false, lastError: msg });
      return null;
    }
  },

  convokeCouncil: async (motionId) => {
    set({ isGenerating: true, lastError: null });
    try {
      const updated = await invoke<Motion>("generate_council_debate", {
        motionId,
      });
      set((state) => ({
        motions: state.motions.map((m) => (m.id === motionId ? updated : m)),
        isGenerating: false,
      }));
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] convokeCouncil failed:", msg);
      set({ isGenerating: false, lastError: msg });
      return null;
    }
  },

  castVote: async (motionId, optionId) => {
    set({ isApplying: true, lastError: null });
    try {
      const result = await invoke<CouncilVoteResult>("cast_player_vote", {
        motionId,
        optionId,
      });
      set((state) => ({
        motions: state.motions.map((m) =>
          m.id === motionId ? result.motion : m,
        ),
        isApplying: false,
      }));
      await refreshWorldState();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] castVote failed:", msg);
      set({ isApplying: false, lastError: msg });
      return null;
    }
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerCouncilStore: typeof useCouncilStore })
    .overseerCouncilStore = useCouncilStore;
}
