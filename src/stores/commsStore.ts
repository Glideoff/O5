import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { playSound } from "../utils/audio";
import type { ChatMessage, Peer } from "../types/comms";

export interface MagicLinkInfo {
  link: string;
  host: string;
  port: number;
  local_ip: string;
  public_ip: string | null;
  fingerprint: string;
  site_id: string;
  hint: string;
}

interface CommsState {
  peers: Peer[];
  /** Messages indexés par site_id du correspondant (broadcast = "*"). */
  threads: Record<string, ChatMessage[]>;
  selectedThread: string | null;
  serverStatus: "idle" | "starting" | "running" | "error";
  lastError: string | null;
  keyFingerprint: string | null;
  magicLink: MagicLinkInfo | null;
  /** Indique si les listeners Tauri ont déjà été branchés. */
  _wired: boolean;

  wireListeners: () => Promise<void>;
  startServer: (port: number) => Promise<void>;
  connectPeer: (addr: string) => Promise<void>;
  createMagicLink: (port: number) => Promise<MagicLinkInfo>;
  joinMagicLink: (link: string) => Promise<void>;
  refreshPeers: () => Promise<void>;
  refreshFingerprint: () => Promise<void>;
  selectThread: (siteId: string | null) => void;
  sendMessage: (to: string, content: string) => Promise<void>;
  broadcast: (content: string) => Promise<void>;
}

function nextMsgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushMessage(
  prev: Record<string, ChatMessage[]>,
  threadKey: string,
  msg: ChatMessage,
): Record<string, ChatMessage[]> {
  const arr = prev[threadKey] ?? [];
  return { ...prev, [threadKey]: [...arr, msg] };
}

export const useCommsStore = create<CommsState>((set, get) => ({
  peers: [],
  threads: {},
  selectedThread: null,
  serverStatus: "idle",
  lastError: null,
  keyFingerprint: null,
  magicLink: null,
  _wired: false,

  wireListeners: async () => {
    if (get()._wired) return;
    set({ _wired: true });

    await listen<Peer>("ws:peer-connected", (e) => {
      set((state) => {
        const exists = state.peers.some((p) => p.site_id === e.payload.site_id);
        return exists
          ? state
          : { peers: [...state.peers, e.payload] };
      });
    });

    await listen<{ site_id: string }>("ws:peer-disconnected", (e) => {
      set((state) => ({
        peers: state.peers.filter((p) => p.site_id !== e.payload.site_id),
      }));
    });

    await listen<{
      from: string;
      to: string;
      content: string;
      encrypted: boolean;
      timestamp: string;
    }>("ws:message", (e) => {
      const msg: ChatMessage = {
        id: nextMsgId(),
        from: e.payload.from,
        to: e.payload.to,
        content: e.payload.content,
        encrypted: e.payload.encrypted,
        timestamp: e.payload.timestamp,
        is_local: false,
      };
      const threadKey = e.payload.to === "*" ? "*" : e.payload.from;
      set((state) => ({ threads: pushMessage(state.threads, threadKey, msg) }));
      playSound("message");
    });

    await listen<unknown>("ws:incident-broadcast", (e) => {
      // Push une notification de type "alerte fondation" dans le thread broadcast
      const inc = e.payload as { id?: string; scp_id?: string; title?: string };
      const text = `════ ALERTE FONDATION ════\nINCIDENT ${inc.id ?? "INC-?"} : ${inc.scp_id ?? "SCP-?"} — ${inc.title ?? "BRÈCHE ACTIVE"}\n══════════════════════════`;
      const msg: ChatMessage = {
        id: nextMsgId(),
        from: "FOUNDATION",
        to: "*",
        content: text,
        encrypted: false,
        timestamp: new Date().toISOString(),
        is_local: false,
      };
      set((state) => ({ threads: pushMessage(state.threads, "*", msg) }));
    });
  },

  startServer: async (port) => {
    set({ serverStatus: "starting", lastError: null });
    try {
      const active = await invoke<number>("get_ws_server_port");
      if (active === port) {
        set({ serverStatus: "running" });
        return;
      }
      await invoke<string>("start_ws_server", { port });
      set({ serverStatus: "running" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] start_ws_server failed:", msg);
      set({ serverStatus: "error", lastError: msg });
    }
  },

  createMagicLink: async (port) => {
    set({ lastError: null });
    try {
      const info = await invoke<MagicLinkInfo>("create_magic_link", { port });
      set({ magicLink: info, serverStatus: "running" });
      await get().refreshFingerprint();
      return info;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: msg });
      throw err;
    }
  },

  joinMagicLink: async (link) => {
    set({ lastError: null });
    try {
      await invoke<{ connected_to: string; fingerprint: string; key_imported: boolean }>(
        "join_magic_link",
        { link: link.trim() },
      );
      await get().refreshFingerprint();
      await get().refreshPeers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: msg });
      throw err;
    }
  },

  connectPeer: async (addr) => {
    try {
      await invoke<string>("connect_to_peer", { addr });
      // Le peer apparaitra via l'event ws:peer-connected
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: msg });
    }
  },

  refreshPeers: async () => {
    try {
      const peers = await invoke<Peer[]>("get_connected_peers");
      set({ peers });
    } catch (err) {
      console.error("[OVERSEER] refreshPeers failed:", err);
    }
  },

  refreshFingerprint: async () => {
    try {
      const fp = await invoke<string>("get_key_fingerprint");
      set({ keyFingerprint: fp });
    } catch (err) {
      console.error("[OVERSEER] refreshFingerprint failed:", err);
    }
  },

  selectThread: (siteId) => set({ selectedThread: siteId }),

  sendMessage: async (to, content) => {
    try {
      await invoke("send_message", { to, content });
      const msg: ChatMessage = {
        id: nextMsgId(),
        from: "ME",
        to,
        content,
        encrypted: true,
        timestamp: new Date().toISOString(),
        is_local: true,
      };
      set((state) => ({ threads: pushMessage(state.threads, to, msg) }));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      set({ lastError: m });
    }
  },

  broadcast: async (content) => {
    try {
      await invoke("broadcast_message", { content });
      const msg: ChatMessage = {
        id: nextMsgId(),
        from: "ME",
        to: "*",
        content,
        encrypted: true,
        timestamp: new Date().toISOString(),
        is_local: true,
      };
      set((state) => ({ threads: pushMessage(state.threads, "*", msg) }));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      set({ lastError: m });
    }
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerComms: typeof useCommsStore }).overseerComms =
    useCommsStore;
}
