/**
 * Types métier OVERSEER — alignés sur la spec Prompt 2.2 / 3.1.
 */

export type SCPObjectClass =
  | "SAFE"
  | "EUCLIDE"
  | "KETER"
  | "THAUMIEL"
  | "APOLLYON";

export const SCP_OBJECT_CLASSES: SCPObjectClass[] = [
  "SAFE",
  "EUCLIDE",
  "KETER",
  "THAUMIEL",
  "APOLLYON",
];

export type ScpContainmentStatus = "CONTAINED" | "BREACH" | "PENDING" | "LOST";

export interface Scp {
  id: string;
  name: string;
  object_class: string; // SCPObjectClass mais permissif (IA peut écrire libre)
  site: string;
  containment_procedures: string;
  description: string;
  created_by: "FOUNDATION" | "AI_GENERATED" | string;
  created_at: string;
  containment_status: string;
}

export type IncidentSeverity = "SAFE" | "EUCLIDE" | "KETER";

export type ContainmentStatus = "BREACH" | "CONTAINED" | "MONITORING";

export type IncidentStatus = "ACTIVE" | "PENDING_RESPONSE" | "RESOLVED";

export type FieldReportOutcome = "SUCCESS" | "PARTIAL" | "FAILURE";

export interface FieldReport {
  agent: string;
  report: string;
  outcome: FieldReportOutcome;
  casualties_update: string;
  containment_restored: boolean;
}

export interface Incident {
  id: string;
  scp_id: string;
  site: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  casualties: string;
  recommended_action: string;
  containment_status: ContainmentStatus;
  o5_response?: string;
  field_report?: FieldReport;
  resolved_at?: string;
  status: IncidentStatus;
  timestamp: string;
}

export type SiteStatusLevel = "ONLINE" | "OFFLINE" | "ALERT";

export interface Site {
  id: string;
  device_name: string;
  os: string;
  ip?: string;
  status: SiteStatusLevel;
  is_self?: boolean;
  last_seen?: string;
}

export type LogSource =
  | "O5-1"
  | "SYSTÈME"
  | "ALERTE"
  | "AGENT"
  | "CHERCHEUR"
  | "DATABASE";

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  source: LogSource;
  source_detail?: string;
  message: string;
}

export type ThreatLevel = "nominal" | "elevated" | "critical";
