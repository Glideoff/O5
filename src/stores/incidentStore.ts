import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { create } from "zustand";
import { playSound } from "../utils/audio";
import {
  frequencyToBoundsSeconds,
  severityAllowed,
  useSettingsStore,
} from "./settingsStore";
import { usePlayerSitesStore } from "./playerSitesStore";
import {
  recordIncidentHandled,
  useInstitutionalStore,
} from "./institutionalStore";
import type {
  FieldReport,
  FieldReportOutcome,
  Incident,
  IncidentSeverity,
} from "../types/incident";

/* ==========================================================================
   Configuration
   ========================================================================== */

// Bornes par défaut (fallback si jamais settings indisponible) — alignées
// sur le profil "normal" du Settings store.
const DEFAULT_MIN_SECONDS = 20 * 60;
const DEFAULT_MAX_SECONDS = 60 * 60;

const RANDOM_SCPS = [
  "SCP-173",
  "SCP-049",
  "SCP-096",
  "SCP-106",
  "SCP-682",
  "SCP-079",
  "SCP-914",
  "SCP-999",
  "SCP-343",
  "SCP-076",
] as const;

const INCIDENT_DEADLINE_KEY = "overseer:next-incident-at";

function readIncidentDeadlineMs(): number | null {
  try {
    const raw = sessionStorage.getItem(INCIDENT_DEADLINE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeIncidentDeadlineMs(at: number): void {
  try {
    sessionStorage.setItem(INCIDENT_DEADLINE_KEY, String(at));
  } catch {
    /* sessionStorage indisponible */
  }
}

/** Planifie le prochain incident auto et retourne l'horodatage cible (ms). */
function scheduleNextIncidentDeadline(): number {
  const at = Date.now() + randomDelaySeconds() * 1000;
  writeIncidentDeadlineMs(at);
  return at;
}

/** Assure une échéance future en session (survit aux changements de page). */
function ensureIncidentDeadline(): number {
  const existing = readIncidentDeadlineMs();
  if (existing != null && existing > Date.now()) {
    return existing;
  }
  return scheduleNextIncidentDeadline();
}

function pickIncidentSite(): string {
  const playerIds = usePlayerSitesStore.getState().getSiteIds();
  if (playerIds.length > 0) {
    return pickRandom(playerIds);
  }
  const fromSettings = useSettingsStore.getState().site_name;
  return fromSettings.trim() || "SITE-19";
}

/* ==========================================================================
   Types
   ========================================================================== */

type NavigateFn = (path: string) => void;

interface IncidentState {
  incidents: Incident[];
  activeIncidentId: string | null;
  isGenerating: boolean;

  /* --- Internes (non utilisés par l'UI directement) ------------------------ */
  _navigateTo: NavigateFn | null;
  _timerHandle: number | null;
  _lastError: string | null;
  _awaitingFieldReport: Set<string>;

  /* --- Actions ------------------------------------------------------------- */
  setNavigator: (fn: NavigateFn) => void;
  selectIncident: (id: string | null) => void;
  /** Génère un nouvel incident via Ollama. Si scp_id/site omis, choisis aléatoirement. */
  generateIncident: (scpId?: string, site?: string) => Promise<Incident | null>;
  /** Enregistre la réponse O5 puis génère un rapport de terrain (RESOLVED in fine). */
  respondToIncident: (id: string, response: string) => Promise<void>;
  /** Marque l'incident comme résolu. */
  resolveIncident: (id: string) => Promise<void>;
  /** Charge les incidents depuis SQLite. */
  loadIncidentsFromDb: () => Promise<void>;
  /** Indique si on attend un rapport de terrain pour cet incident. */
  isAwaitingFieldReport: (id: string) => boolean;
  /** Démarre le timer périodique d'incidents automatiques. */
  startIncidentTimer: () => void;
  /** Arrête le timer. */
  stopIncidentTimer: () => void;
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function randomDelaySeconds(): number {
  // Lit la fréquence configurée à chaque tirage → réactif au changement de settings.
  let min = DEFAULT_MIN_SECONDS;
  let max = DEFAULT_MAX_SECONDS;
  try {
    const freq = useSettingsStore.getState().incident_frequency;
    const bounds = frequencyToBoundsSeconds(freq);
    min = bounds.min;
    max = bounds.max;
  } catch {
    /* settings indisponible → fallback */
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ensureSeverity(value: unknown): IncidentSeverity {
  if (value === "SAFE" || value === "EUCLIDE" || value === "KETER") return value;
  return "SAFE";
}

function ensureContainmentStatus(
  value: unknown,
): Incident["containment_status"] {
  if (value === "BREACH" || value === "CONTAINED" || value === "MONITORING")
    return value;
  return "MONITORING";
}

function ensureOutcome(value: unknown): FieldReportOutcome {
  if (value === "SUCCESS" || value === "PARTIAL" || value === "FAILURE")
    return value;
  return "PARTIAL";
}

function normalizeFieldReport(raw: Record<string, unknown>): FieldReport {
  return {
    agent: typeof raw.agent === "string" ? raw.agent : "AGENT-██",
    report:
      typeof raw.report === "string" && raw.report.length > 0
        ? raw.report
        : "Rapport indisponible.",
    outcome: ensureOutcome(raw.outcome),
    casualties_update:
      typeof raw.casualties_update === "string"
        ? raw.casualties_update
        : "DONNÉES EXPURGÉES",
    containment_restored: raw.containment_restored === true,
  };
}

/** Normalise un objet partiel venant d'Ollama en Incident bien formé. */
function normalizeIncident(
  raw: Record<string, unknown>,
  scpIdFallback: string,
  siteFallback: string,
): Incident {
  const id =
    typeof raw.incident_id === "string"
      ? raw.incident_id
      : `INC-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, "0")}`;
  return {
    id,
    scp_id: typeof raw.scp_id === "string" ? raw.scp_id : scpIdFallback,
    site: typeof raw.site === "string" ? raw.site : siteFallback,
    severity: ensureSeverity(raw.severity),
    title:
      typeof raw.title === "string" && raw.title.length > 0
        ? raw.title
        : "Incident sans titre",
    description: typeof raw.description === "string" ? raw.description : "",
    casualties: typeof raw.casualties === "string" ? raw.casualties : "AUCUNE",
    recommended_action:
      typeof raw.recommended_action === "string" ? raw.recommended_action : "",
    containment_status: ensureContainmentStatus(raw.containment_status),
    status: "ACTIVE",
    timestamp:
      typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
  };
}

/** Payload aligné sur `database::Incident` (Rust / SQLite). */
interface DbIncident {
  id: string;
  scp_id: string;
  site: string;
  severity: string;
  title: string;
  description: string;
  casualties: string;
  recommended_action: string;
  containment_status: string;
  o5_response: string | null;
  field_report: string | null;
  status: string;
  timestamp: string;
  resolved_at: string | null;
}

function ensureIncidentStatus(value: unknown): Incident["status"] {
  if (value === "ACTIVE" || value === "PENDING_RESPONSE" || value === "RESOLVED")
    return value;
  return "ACTIVE";
}

function incidentToDb(incident: Incident): DbIncident {
  return {
    id: incident.id,
    scp_id: incident.scp_id,
    site: incident.site,
    severity: incident.severity,
    title: incident.title,
    description: incident.description,
    casualties: incident.casualties,
    recommended_action: incident.recommended_action,
    containment_status: incident.containment_status,
    o5_response: incident.o5_response ?? null,
    field_report: incident.field_report
      ? JSON.stringify(incident.field_report)
      : null,
    status: incident.status,
    timestamp: incident.timestamp,
    resolved_at: incident.resolved_at ?? null,
  };
}

function incidentFromDb(row: DbIncident): Incident {
  let field_report: FieldReport | undefined;
  if (row.field_report) {
    try {
      field_report = normalizeFieldReport(
        JSON.parse(row.field_report) as Record<string, unknown>,
      );
    } catch {
      /* rapport illisible — ignoré */
    }
  }
  return {
    id: row.id,
    scp_id: row.scp_id,
    site: row.site,
    severity: ensureSeverity(row.severity),
    title: row.title,
    description: row.description,
    casualties: row.casualties,
    recommended_action: row.recommended_action,
    containment_status: ensureContainmentStatus(row.containment_status),
    o5_response: row.o5_response ?? undefined,
    field_report,
    status: ensureIncidentStatus(row.status),
    timestamp: row.timestamp,
    resolved_at: row.resolved_at ?? undefined,
  };
}

async function persistIncident(incident: Incident): Promise<void> {
  await invoke("save_incident", { incident: incidentToDb(incident) });
}

/* ==========================================================================
   Side-effects pour incidents KETER
   ========================================================================== */

async function handleKeterSideEffects(
  incident: Incident,
  navigateTo: NavigateFn | null,
): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: `[KETER] ${incident.scp_id} — Brèche confirmée`,
        body: incident.title,
      });
    }
  } catch (err) {
    console.warn("[OVERSEER] Notification KETER échouée:", err);
  }

  // Force la navigation vers /incidents (HashRouter → /#/incidents).
  if (navigateTo) {
    navigateTo("/incidents");
  }

  // Broadcast WebSocket à tous les peers connectés (best-effort, ignore si pas serveur).
  try {
    await invoke("broadcast_incident", { incident });
  } catch {
    /* serveur WS pas démarré ou pas de peers — silencieux */
  }

  // Auto-création d'une motion d'urgence pour le Conseil O5.
  // Le joueur la verra apparaître en haut de /council et pourra convoquer le débat.
  try {
    const optionsForKeter = [
      {
        id: "A",
        label: "Neutralisation extrême",
        description:
          "Déploiement MTF Omega-7 avec autorisation d'usage de procédure 14-Omega.",
      },
      {
        id: "B",
        label: "Confinement renforcé immédiat",
        description:
          "Verrouillage du secteur, déluge automatisé, renfort de garde tournante 24/24.",
      },
      {
        id: "C",
        label: "Évacuation et observation à distance",
        description:
          "Repli du personnel non essentiel, observation aérienne, dossier escalade vers O5.",
      },
    ];
    await invoke("create_motion", {
      title: `Réponse à incident ${incident.id} — ${incident.scp_id}`,
      description: `Incident KETER en cours sur ${incident.site}. Contexte : ${incident.description}\n\nVictimes : ${incident.casualties}. Statut confinement : ${incident.containment_status}.\n\nAction recommandée terrain : ${incident.recommended_action}`,
      category: "CONTAINMENT",
      context: incident.id,
      options: JSON.stringify(optionsForKeter),
      kind: "COUNCIL",
    });
  } catch (err) {
    console.warn("[OVERSEER] Auto-création de motion KETER échouée:", err);
  }
}

/* ==========================================================================
   Store
   ========================================================================== */

export const useIncidentStore = create<IncidentState>((set, get) => ({
  incidents: [],
  activeIncidentId: null,
  isGenerating: false,

  _navigateTo: null,
  _timerHandle: null,
  _lastError: null,
  _awaitingFieldReport: new Set<string>(),

  setNavigator: (fn) => set({ _navigateTo: fn }),

  selectIncident: (id) => set({ activeIncidentId: id }),

  isAwaitingFieldReport: (id) => get()._awaitingFieldReport.has(id),

  loadIncidentsFromDb: async () => {
    try {
      const rows = await invoke<DbIncident[]>("get_incidents", { limit: 200 });
      const incidents = rows.map(incidentFromDb);
      set({ incidents });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] loadIncidentsFromDb échoué:", msg);
      set({ _lastError: msg });
    }
  },

  generateIncident: async (scpId, site) => {
    const chosenScp = scpId ?? pickRandom(RANDOM_SCPS);
    const chosenSite = site ?? pickIncidentSite();

    if (get().isGenerating) {
      console.warn("[OVERSEER] generateIncident déjà en cours, requête ignorée.");
      return null;
    }

    set({ isGenerating: true, _lastError: null });

    try {
      const json = await invoke<string>("generate_incident", {
        scpId: chosenScp,
        site: chosenSite,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(json) as Record<string, unknown>;
      } catch (e) {
        throw new Error(`JSON IA invalide : ${(e as Error).message}`);
      }

      const incident = normalizeIncident(parsed, chosenScp, chosenSite);

      try {
        await usePlayerSitesStore.getState().ensureSupervised(incident.site);
      } catch {
        /* best-effort */
      }

      // Filtre par sévérité max configurée dans Settings.
      try {
        const max = useSettingsStore.getState().severity_max;
        if (!severityAllowed(incident.severity, max)) {
          console.info(
            `[OVERSEER] Incident ${incident.id} (${incident.severity}) filtré par Settings.severity_max=${max}.`,
          );
          set({ isGenerating: false });
          scheduleNextIncidentDeadline();
          return null;
        }
      } catch {
        /* settings indisponible → on laisse passer */
      }

      set((state) => ({
        incidents: [incident, ...state.incidents],
        isGenerating: false,
      }));

      try {
        await persistIncident(incident);
      } catch (err) {
        console.error("[OVERSEER] save_incident (nouveau) échoué:", err);
      }

      // Son selon la sévérité
      if (incident.severity === "KETER") {
        playSound("keter");
        void handleKeterSideEffects(incident, get()._navigateTo);
      } else {
        playSound("breach");
      }

      scheduleNextIncidentDeadline();
      return incident;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] generateIncident a échoué:", msg);
      set({ isGenerating: false, _lastError: msg });
      scheduleNextIncidentDeadline();
      return null;
    }
  },

  respondToIncident: async (id, response) => {
    const incident = get().incidents.find((i) => i.id === id);
    if (!incident) return;

    useInstitutionalStore
      .getState()
      .logAccess(`Action : Ordre transmis ref. ${id}`);
    recordIncidentHandled();

    // Étape 1 : enregistre la réponse + passe en PENDING_RESPONSE.
    const pending: Incident = {
      ...incident,
      o5_response: response,
      status: "PENDING_RESPONSE",
    };
    set((state) => ({
      incidents: state.incidents.map((i) => (i.id === id ? pending : i)),
      _awaitingFieldReport: new Set([...state._awaitingFieldReport, id]),
    }));
    try {
      await persistIncident(pending);
    } catch (err) {
      console.error("[OVERSEER] save_incident (PENDING) échoué:", err);
    }

    // Étape 2 : génère un rapport de terrain via Ollama.
    try {
      const json = await invoke<string>("generate_field_report", {
        incidentId: incident.id,
        scpId: incident.scp_id,
        site: incident.site,
        severity: incident.severity,
        incidentDescription: incident.description,
        o5Response: response,
      });

      const parsed = JSON.parse(json) as Record<string, unknown>;
      const fieldReport = normalizeFieldReport(parsed);
      const resolvedAt = new Date().toISOString();
      const resolved: Incident = {
        ...pending,
        field_report: fieldReport,
        status: "RESOLVED",
        resolved_at: resolvedAt,
      };

      set((state) => {
        const next = new Set(state._awaitingFieldReport);
        next.delete(id);
        return {
          incidents: state.incidents.map((i) => (i.id === id ? resolved : i)),
          _awaitingFieldReport: next,
        };
      });
      try {
        await persistIncident(resolved);
      } catch (err) {
        console.error("[OVERSEER] save_incident (RESOLVED) échoué:", err);
      }
      playSound("resolved");

      // Pertes Classes D uniquement — garde MTF / chercheurs préservés.
      try {
        const { useSettingsStore } = await import("./settingsStore");
        const settings = useSettingsStore.getState();
        const lossReport = await invoke<{
          killed: number;
          message: string;
        }>("apply_incident_class_d_losses", {
          site: incident.site,
          severity: incident.severity,
          casualties: incident.casualties,
          fieldCasualties:
            typeof parsed.casualties_update === "string"
              ? parsed.casualties_update
              : null,
        });
        if (lossReport.killed > 0) {
          console.info("[OVERSEER] Pertes Classes D :", lossReport.message);
        }
        await invoke("ensure_site_minimum_staffing", {
          site: incident.site,
          minTotal: settings.site_min_total,
          minNonClassD: settings.site_min_non_class_d,
        });
      } catch (err) {
        console.warn("[OVERSEER] Pertes / complément effectifs échoué:", err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OVERSEER] generate_field_report a échoué:", msg);
      set((state) => {
        const next = new Set(state._awaitingFieldReport);
        next.delete(id);
        return { _awaitingFieldReport: next, _lastError: msg };
      });
    }
  },

  resolveIncident: async (id) => {
    const incident = get().incidents.find((i) => i.id === id);
    if (!incident) return;

    const resolved: Incident = {
      ...incident,
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
    };
    set((state) => ({
      incidents: state.incidents.map((i) => (i.id === id ? resolved : i)),
    }));
    try {
      await persistIncident(resolved);
    } catch (err) {
      console.error("[OVERSEER] save_incident (resolve) échoué:", err);
    }
    playSound("resolved");

    try {
      const { useSettingsStore } = await import("./settingsStore");
      const settings = useSettingsStore.getState();
      await invoke("apply_incident_class_d_losses", {
        site: incident.site,
        severity: incident.severity,
        casualties: incident.casualties,
        fieldCasualties: null,
      });
      await invoke("ensure_site_minimum_staffing", {
        site: incident.site,
        minTotal: settings.site_min_total,
        minNonClassD: settings.site_min_non_class_d,
      });
    } catch (err) {
      console.warn("[OVERSEER] resolveIncident — pertes effectifs:", err);
    }
  },

  startIncidentTimer: () => {
    const existing = get()._timerHandle;
    if (existing) return;

    ensureIncidentDeadline();

    const handle = window.setInterval(() => {
      const deadline = readIncidentDeadlineMs();
      if (deadline == null || deadline > Date.now()) return;
      void get().generateIncident();
    }, 1000);

    set({ _timerHandle: handle });
  },

  stopIncidentTimer: () => {
    const existing = get()._timerHandle;
    if (existing) {
      window.clearInterval(existing);
      set({ _timerHandle: null });
    }
  },
}));

/* ==========================================================================
   Sélecteurs utilitaires (évite les re-renders inutiles)
   ========================================================================== */

export const selectActiveIncidents = (state: IncidentState): Incident[] =>
  state.incidents.filter(
    (i) => i.status === "ACTIVE" || i.status === "PENDING_RESPONSE",
  );

export const selectActiveIncident = (state: IncidentState): Incident | null => {
  if (!state.activeIncidentId) return null;
  return state.incidents.find((i) => i.id === state.activeIncidentId) ?? null;
};

/* ==========================================================================
   Exposition debug (dev uniquement)
   Ouvre la console DevTools de la fenêtre Tauri et tape :
     overseerStore.getState()
     overseerStore.getState().generateIncident("SCP-682", "SITE-19")
     sessionStorage.getItem("overseer:next-incident-at")
   ========================================================================== */

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { overseerStore: typeof useIncidentStore }).overseerStore =
    useIncidentStore;
}
