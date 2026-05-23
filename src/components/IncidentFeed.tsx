import type { Incident, IncidentStatus } from "../types/incident";
import { formatLogTime } from "../data/mockData";

interface IncidentFeedProps {
  incidents: Incident[];
  limit?: number;
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  ACTIVE: "ACTIF",
  PENDING_RESPONSE: "EN COURS",
  RESOLVED: "RÉSOLU",
};

const STATUS_CLASS: Record<IncidentStatus, string> = {
  ACTIVE: "is-active",
  PENDING_RESPONSE: "is-pending",
  RESOLVED: "is-resolved",
};

export function IncidentFeed({ incidents, limit = 5 }: IncidentFeedProps) {
  const visible = incidents.slice(0, limit);

  return (
    <div className="scp-panel incident-feed">
      <header className="incident-feed__header">
        <h2>Incidents récents</h2>
        <span className="incident-feed__count">
          {visible.length} / {incidents.length}
        </span>
      </header>

      <ul className="incident-feed__list">
        {visible.map((incident) => (
          <li
            key={incident.id}
            className={`incident-feed__item ${STATUS_CLASS[incident.status]}`}
          >
            <div className="incident-feed__row-1">
              <span className={`scp-badge ${incident.severity.toLowerCase()}`}>
                {incident.severity}
              </span>
              <span className="incident-feed__scp">{incident.scp_id}</span>
              <span className="incident-feed__title">{incident.title}</span>
            </div>
            <div className="incident-feed__row-2">
              <span className="incident-feed__site">{incident.site}</span>
              <span className="incident-feed__dot">·</span>
              <span className="incident-feed__time">
                {formatLogTime(incident.timestamp)}
              </span>
              <span
                className={`incident-feed__status incident-feed__status--${STATUS_CLASS[incident.status]}`}
              >
                {STATUS_LABEL[incident.status]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
