import type { Site, SiteStatusLevel } from "../types/incident";

interface SiteStatusProps {
  sites: Site[];
}

const STATUS_LABEL: Record<SiteStatusLevel, string> = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  ALERT: "ALERT",
};

export function SiteStatus({ sites }: SiteStatusProps) {
  const online = sites.filter((s) => s.status === "ONLINE").length;

  return (
    <div className="scp-panel site-status">
      <header className="site-status__header">
        <h2>Sites Foundation</h2>
        <span className="site-status__count">
          {online} / {sites.length}
        </span>
      </header>

      <ul className="site-status__list">
        {sites.map((site, idx) => (
          <li
            key={`${site.id}-${idx}`}
            className={`site-status__item site-status__item--${site.status.toLowerCase()}`}
          >
            <span
              className={`site-status__dot site-status__dot--${site.status.toLowerCase()}`}
              aria-hidden
            />
            <div className="site-status__main">
              <div className="site-status__id">
                {site.id}
                {site.is_self && (
                  <span className="site-status__self">(ce poste)</span>
                )}
              </div>
              <div className="site-status__meta">
                {site.device_name} · {site.os}
              </div>
            </div>
            <span className="site-status__label">
              {STATUS_LABEL[site.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
