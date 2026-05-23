import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettingsStore } from "./settingsStore";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export interface AccessLogEntry {
  id: string;
  time: string;
  user: string;
  message: string;
}

export interface DocumentMeta {
  ref: string;
  classification: string;
  created: string;
  prepared: string;
  approved: string;
  distribution: string;
}

export interface AuditSummary {
  connections: number;
  actions: number;
  incidentsHandled: number;
  lastAudit: string;
}

interface InstitutionalState {
  sessionId: string | null;
  sessionStart: number | null;
  sessionExpiresAt: number | null;
  sessionExpired: boolean;
  ipSuffix: string;
  consultationsThisMonth: number;
  actionCount: number;
  accessLog: AccessLogEntry[];
  documentMeta: DocumentMeta | null;
  auditSummary: AuditSummary;

  initSession: () => void;
  extendSession: () => void;
  tickSession: () => void;
  setIpSuffix: (suffix: string) => void;
  logAccess: (message: string, opts?: { system?: boolean }) => void;
  incrementConsultation: () => void;
  incrementAction: () => void;
  ensureDocumentMeta: () => DocumentMeta;
  getSessionRemainingMs: () => number;
}

function randomHex(len: number): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function formatSessionId(): string {
  return `████-████-${randomHex(4)}`;
}

function randomDocRef(): string {
  const year = new Date().getFullYear();
  const num = String(Math.floor(10000 + Math.random() * 90000));
  const rev = Math.floor(1 + Math.random() * 4);
  return `DOC/SCF-${year}/${num}/REV.${rev}`;
}

function formatRedactedDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `██/${mm.slice(0, 1)}█/${d.getFullYear()}`;
}

function formatAuditDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/██/████`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour12: false });
}

function createDocumentMeta(): DocumentMeta {
  return {
    ref: randomDocRef(),
    classification: "TOP SECRET // SCI",
    created: formatRedactedDate(),
    prepared: "[EXPURGÉ]",
    approved: "[DONNÉES SUPPRIMÉES]",
    distribution: "LISTE BIGOT ALPHA-12 SEULEMENT",
  };
}

function defaultAudit(): AuditSummary {
  const stored = localStorage.getItem("overseer:audit-stats");
  if (stored) {
    try {
      return JSON.parse(stored) as AuditSummary;
    } catch {
      /* ignore */
    }
  }
  return {
    connections: 1,
    actions: 0,
    incidentsHandled: 0,
    lastAudit: formatAuditDate(),
  };
}

export const useInstitutionalStore = create<InstitutionalState>()(
  persist(
    (set, get) => ({
      sessionId: null,
      sessionStart: null,
      sessionExpiresAt: null,
      sessionExpired: false,
      ipSuffix: "███",
      consultationsThisMonth: 0,
      actionCount: 0,
      accessLog: [],
      documentMeta: null,
      auditSummary: defaultAudit(),

      initSession: () => {
        const existing = get().sessionId;
        if (existing) return;
        const now = Date.now();
        const o5 = useSettingsStore.getState().o5_id;
        const id = formatSessionId();
        set({
          sessionId: id,
          sessionStart: now,
          sessionExpiresAt: now + SESSION_DURATION_MS,
          sessionExpired: false,
        });
        get().logAccess(`${o5} — Connexion établie. Session: ${id}`);
        const audit = { ...get().auditSummary, connections: get().auditSummary.connections + 1 };
        localStorage.setItem("overseer:audit-stats", JSON.stringify(audit));
        set({ auditSummary: audit });
      },

      extendSession: () => {
        if (!get().sessionId) {
          get().initSession();
          return;
        }
        const now = Date.now();
        set({
          sessionExpiresAt: now + SESSION_DURATION_MS,
          sessionExpired: false,
        });
        get().logAccess(
          `${useSettingsStore.getState().o5_id} — Prolongation de session autorisée — Enregistré`,
        );
      },

      tickSession: () => {
        const exp = get().sessionExpiresAt;
        if (!exp) return;
        if (Date.now() >= exp) {
          set({ sessionExpired: true });
        }
      },

      setIpSuffix: (suffix) => set({ ipSuffix: suffix }),

      logAccess: (message, opts) => {
        const user = opts?.system ? "SYSTÈME" : useSettingsStore.getState().o5_id;
        const entry: AccessLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          time: nowTime(),
          user,
          message: message.includes("Enregistré") ? message : `${message} — Enregistré`,
        };
        set((s) => ({
          accessLog: [...s.accessLog.slice(-80), entry],
          actionCount: opts?.system ? s.actionCount : s.actionCount + 1,
        }));
        if (!opts?.system) {
          const audit = { ...get().auditSummary, actions: get().auditSummary.actions + 1 };
          localStorage.setItem("overseer:audit-stats", JSON.stringify(audit));
          set({ auditSummary: audit });
        }
      },

      incrementConsultation: () => {
        set((s) => ({ consultationsThisMonth: s.consultationsThisMonth + 1 }));
        get().incrementAction();
      },

      incrementAction: () => {
        set((s) => ({ actionCount: s.actionCount + 1 }));
      },

      ensureDocumentMeta: () => {
        const existing = get().documentMeta;
        if (existing) return existing;
        const meta = createDocumentMeta();
        set({ documentMeta: meta });
        return meta;
      },

      getSessionRemainingMs: () => {
        const exp = get().sessionExpiresAt;
        if (!exp) return 0;
        return Math.max(0, exp - Date.now());
      },
    }),
    {
      name: "overseer-institutional",
      partialize: (s) => ({
        consultationsThisMonth: s.consultationsThisMonth,
        auditSummary: s.auditSummary,
        documentMeta: s.documentMeta,
      }),
    },
  ),
);

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function formatElapsed(ms: number): string {
  return formatCountdown(ms);
}

const PAGE_LABELS: Record<string, string> = {
  "/": "DASHBOARD",
  "/incidents": "INCIDENTS",
  "/registry": "REGISTRE SCP",
  "/council": "CONSEIL O5",
  "/sites": "MES SITES",
  "/sitemap": "CARTE SITES",
  "/comms": "COMMUNICATIONS",
  "/personnel": "PERSONNEL",
  "/terminal": "TERMINAL",
  "/settings": "PARAMÈTRES",
};

export function pathToPageLabel(path: string): string {
  return PAGE_LABELS[path] ?? (path.toUpperCase().replace(/^\//, "") || "INCONNU");
}

export function recordIncidentHandled(): void {
  const audit = { ...useInstitutionalStore.getState().auditSummary };
  audit.incidentsHandled += 1;
  localStorage.setItem("overseer:audit-stats", JSON.stringify(audit));
  useInstitutionalStore.setState({ auditSummary: audit });
}
