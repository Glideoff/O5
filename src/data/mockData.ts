import type {
  ActivityLogEntry,
  Incident,
  Site,
} from "../types/incident";

const pad = (n: number) => n.toString().padStart(2, "0");

/**
 * Génère un horodatage ISO décalé de `minutesAgo` minutes par rapport à maintenant.
 */
function minutesAgo(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  return d.toISOString();
}

export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "INC-2847",
    scp_id: "SCP-682",
    site: "SITE-19",
    severity: "KETER",
    title: "Sortie de cellule confirmée",
    description:
      "L'objet a contourné le protocole de confinement par chimie. Trois MTF Nu-7 ont engagé l'objet en Secteur D. Combat en cours.",
    casualties: "DONNÉES EXPURGÉES",
    recommended_action: "Activer le protocole de confinement renforcé OMEGA.",
    containment_status: "BREACH",
    status: "ACTIVE",
    timestamp: minutesAgo(4),
  },
  {
    id: "INC-2846",
    scp_id: "SCP-049",
    site: "SITE-██",
    severity: "EUCLIDE",
    title: "Vocalisations anormales détectées",
    description:
      "Les capteurs audio rapportent une diction continue derrière la porte de confinement. L'objet semble adresser quelque chose au personnel.",
    casualties: "AUCUNE",
    recommended_action: "Renforcer l'isolation acoustique du Secteur B.",
    containment_status: "MONITORING",
    status: "PENDING_RESPONSE",
    timestamp: minutesAgo(18),
  },
  {
    id: "INC-2845",
    scp_id: "SCP-173",
    site: "SITE-██",
    severity: "EUCLIDE",
    title: "Défaillance d'éclairage Secteur C",
    description:
      "Coupure brève (1.4s) confirmée par les redondances. Aucun mouvement détecté à la reprise.",
    casualties: "AUCUNE",
    recommended_action: "Audit du circuit primaire dans 6h.",
    containment_status: "CONTAINED",
    status: "ACTIVE",
    timestamp: minutesAgo(42),
  },
  {
    id: "INC-2844",
    scp_id: "SCP-914",
    site: "SITE-19",
    severity: "SAFE",
    title: "Maintenance trimestrielle",
    description:
      "Calibration manuelle des engrenages effectuée par l'équipe technique. Aucune anomalie post-intervention.",
    casualties: "AUCUNE",
    recommended_action: "RAS — clôturer le ticket.",
    containment_status: "CONTAINED",
    status: "RESOLVED",
    o5_response: "Validé. Maintenir cycle de calibration.",
    resolved_at: minutesAgo(120),
    timestamp: minutesAgo(180),
  },
  {
    id: "INC-2843",
    scp_id: "SCP-999",
    site: "SITE-19",
    severity: "SAFE",
    title: "Sortie périodique de cellule",
    description:
      "L'objet s'est déplacé dans le couloir Est, distribuant des effets bénéfiques au personnel rencontré.",
    casualties: "AUCUNE",
    recommended_action: "Encourager — moral du personnel en hausse.",
    containment_status: "MONITORING",
    status: "RESOLVED",
    o5_response: "Toléré. Programme bien-être étendu.",
    resolved_at: minutesAgo(240),
    timestamp: minutesAgo(310),
  },
];

export const MOCK_SITES: Site[] = [
  {
    id: "SITE-19",
    device_name: "OVERSEER-PRIMARY",
    os: "Windows 11",
    ip: "10.0.0.1",
    status: "ONLINE",
    is_self: true,
    last_seen: new Date().toISOString(),
  },
  {
    id: "SITE-██",
    device_name: "REDACTED-NODE-A",
    os: "Linux 6.x",
    status: "OFFLINE",
    last_seen: minutesAgo(48),
  },
  {
    id: "SITE-██",
    device_name: "REDACTED-NODE-B",
    os: "Windows 10",
    status: "ALERT",
    last_seen: minutesAgo(2),
  },
];

export const MOCK_LOG_ENTRIES: ActivityLogEntry[] = [
  {
    id: "log-1",
    timestamp: minutesAgo(8),
    source: "O5-1",
    message: "Connexion établie. Bienvenue, Administrateur.",
  },
  {
    id: "log-2",
    timestamp: minutesAgo(8),
    source: "SYSTÈME",
    message: "Vérification des confinements... OK",
  },
  {
    id: "log-3",
    timestamp: minutesAgo(7),
    source: "DATABASE",
    message: "Synchronisation du registre SCP — 247 entrées.",
  },
  {
    id: "log-4",
    timestamp: minutesAgo(6),
    source: "AGENT",
    source_detail: "AGENT-7",
    message: "Rapport horaire Secteur B : RAS.",
  },
  {
    id: "log-5",
    timestamp: minutesAgo(4),
    source: "ALERTE",
    message: "SCP-682 — Activité chimique anormale, Secteur D.",
  },
  {
    id: "log-6",
    timestamp: minutesAgo(4),
    source: "SYSTÈME",
    message: "Déploiement MTF Nu-7 confirmé.",
  },
  {
    id: "log-7",
    timestamp: minutesAgo(2),
    source: "CHERCHEUR",
    source_detail: "DR-████",
    message: "Hypothèse 04-K écartée après expérience 47.",
  },
  {
    id: "log-8",
    timestamp: minutesAgo(1),
    source: "O5-1",
    message: "Confinement renforcé OMEGA — en attente de validation.",
  },
];

/**
 * Pool de phrases utilisé par le ticker du dashboard pour simuler l'activité.
 * Sera remplacé par un vrai flux d'événements en Phase 2/3.
 */
export const SIMULATED_LOG_POOL: Array<Omit<ActivityLogEntry, "id" | "timestamp">> =
  [
    {
      source: "SYSTÈME",
      message: "Heartbeat reçu de SITE-██.",
    },
    {
      source: "ALERTE",
      message: "Anomalie thermique détectée — Secteur F.",
    },
    {
      source: "AGENT",
      source_detail: "AGENT-12",
      message: "Patrouille périmètre Nord terminée.",
    },
    {
      source: "DATABASE",
      message: "Indexation du registre SCP — checkpoint OK.",
    },
    {
      source: "CHERCHEUR",
      source_detail: "DR-CLEF",
      message: "Échantillon 749-B placé en stase.",
    },
    {
      source: "SYSTÈME",
      message: "Rotation des clés de chiffrement appliquée.",
    },
    {
      source: "ALERTE",
      message: "SCP-173 — instabilité visuelle légère.",
    },
    {
      source: "AGENT",
      source_detail: "AGENT-7",
      message: "Rapport biométrique : RAS.",
    },
    {
      source: "SYSTÈME",
      message: "Sauvegarde incrémentale terminée (1.3 Go).",
    },
  ];

/**
 * Génère un ID séquentiel pour les nouvelles entrées de log.
 */
let _logCounter = 1000;
export function nextLogId(): string {
  _logCounter += 1;
  return `log-${_logCounter}`;
}

/**
 * Construit un horodatage ISO pour "maintenant".
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Format compact HH:MM:SS pour l'affichage log.
 */
export function formatLogTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Format "YYYY-██-██ HH:MM:SS" — esthétique Foundation pour les logs.
 */
export function formatLogTimeRedacted(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-██-██ ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
