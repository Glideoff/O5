import { useMemo } from "react";
import { ActivityLog } from "../components/ActivityLog";
import { IncidentFeed } from "../components/IncidentFeed";
import { SiteStatus } from "../components/SiteStatus";
import { StatusCard } from "../components/StatusCard";
import { MOCK_SITES } from "../data/mockData";
import { useIncidentStore } from "../stores/incidentStore";
import type { Incident, ThreatLevel } from "../types/incident";
import "../styles/dashboard.css";

/**
 * Calcule le niveau de menace global à partir des incidents actifs.
 *   - aucun incident actif       → NOMINAL
 *   - au moins un EUCLIDE actif  → ELEVATED
 *   - au moins un KETER actif    → BREACH (critique)
 */
function computeThreat(incidents: Incident[]): {
  level: ThreatLevel;
  label: string;
} {
  const active = incidents.filter(
    (i) => i.status === "ACTIVE" || i.status === "PENDING_RESPONSE",
  );
  if (active.some((i) => i.severity === "KETER")) {
    return { level: "critical", label: "BREACH" };
  }
  if (active.some((i) => i.severity === "EUCLIDE")) {
    return { level: "elevated", label: "ELEVATED" };
  }
  return { level: "nominal", label: "NOMINAL" };
}

export function Dashboard() {
  const incidents = useIncidentStore((s) => s.incidents);
  const sites = MOCK_SITES;

  const threat = useMemo(() => computeThreat(incidents), [incidents]);
  const activeCount = useMemo(
    () =>
      incidents.filter(
        (i) => i.status === "ACTIVE" || i.status === "PENDING_RESPONSE",
      ).length,
    [incidents],
  );
  const onlineCount = useMemo(
    () => sites.filter((s) => s.status === "ONLINE").length,
    [sites],
  );

  return (
    <div className="dashboard">
      <div className="dashboard__heading">
        <h1>Dashboard O5</h1>
        <span className="dashboard__heading-sub">
          // SYNTH&Egrave;SE OP&Eacute;RATIONNELLE EN TEMPS R&Eacute;EL
        </span>
      </div>

      <div className="dashboard__row-status">
        <StatusCard
          title="Niveau de menace global"
          value={threat.label}
          subtext={
            threat.level === "critical"
              ? "Confinement renforc\u00e9 actif"
              : threat.level === "elevated"
                ? "Vigilance accrue"
                : "Tous syst\u00e8mes nominaux"
          }
          level={threat.level}
        />
        <StatusCard
          title="Confinements actifs"
          value={activeCount.toString().padStart(2, "0")}
          subtext={`${incidents.length} dossiers ouverts`}
          level={
            activeCount === 0
              ? "nominal"
              : activeCount >= 3
                ? "critical"
                : "elevated"
          }
        />
        <StatusCard
          title="Sites en ligne"
          value={`${onlineCount} / ${sites.length}`}
          subtext="Maillage Foundation"
          level={
            onlineCount === sites.length
              ? "nominal"
              : onlineCount === 0
                ? "critical"
                : "elevated"
          }
        />
      </div>

      <div className="dashboard__incidents">
        <IncidentFeed incidents={incidents} limit={5} />
      </div>

      <div className="dashboard__sites">
        <SiteStatus sites={sites} />
      </div>

      <div className="dashboard__log">
        <ActivityLog />
      </div>
    </div>
  );
}
