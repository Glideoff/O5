import { useEffect } from "react";
import { usePlayerSitesStore } from "../stores/playerSitesStore";
import { useSettingsStore } from "../stores/settingsStore";
import "../styles/mysites.css";

const SOURCE_LABELS: Record<string, string> = {
  PLAYER: "Initiative O5",
  AUTO: "Affectation Foundation",
  COUNCIL: "Décision Conseil",
};

export function MySites() {
  const assigned = usePlayerSitesStore((s) => s.assigned);
  const claimable = usePlayerSitesStore((s) => s.claimable);
  const lastMessage = usePlayerSitesStore((s) => s.lastMessage);
  const isLoading = usePlayerSitesStore((s) => s.isLoading);
  const load = usePlayerSitesStore((s) => s.load);
  const claim = usePlayerSitesStore((s) => s.claim);
  const release = usePlayerSitesStore((s) => s.release);
  const setActiveSite = usePlayerSitesStore((s) => s.setActiveSite);
  const activeSite = useSettingsStore((s) => s.site_name);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mysites-page">
      <header className="mysites-header">
        <div>
          <h1>Mes Sites</h1>
          <span className="mysites-header__meta">
            {assigned.length} installation{assigned.length > 1 ? "s" : ""} sous mandat O5
            · minimum 1 requis
          </span>
        </div>
        <div className="mysites-header__active">
          Site actif : <strong>{activeSite}</strong>
        </div>
      </header>

      {lastMessage && (
        <div className="scp-panel mysites-notice">
          <span className="mysites-notice__prefix">// FONDATION —</span> {lastMessage}
        </div>
      )}

      <div className="mysites-grid">
        <section className="scp-panel mysites-section">
          <h2 className="mysites-section__title">Supervision active</h2>
          {isLoading && assigned.length === 0 ? (
            <p className="mysites-empty">// Chargement des mandats...</p>
          ) : (
            <ul className="mysites-list">
              {assigned.map((site) => {
                const isActive = site.site_id === activeSite;
                const canRelease = assigned.length > 1;
                return (
                  <li
                    key={site.site_id}
                    className={`mysites-card${isActive ? " is-active" : ""}`}
                  >
                    <div className="mysites-card__head">
                      <span className="mysites-card__id">{site.site_id}</span>
                      {isActive && (
                        <span className="mysites-card__badge">ACTIF</span>
                      )}
                    </div>
                    <div className="mysites-card__name">{site.name}</div>
                    <div className="mysites-card__desc">{site.designation}</div>
                    <div className="mysites-card__meta">
                      {SOURCE_LABELS[site.source] ?? site.source} · {site.assigned_at}
                    </div>
                    <div className="mysites-card__actions">
                      {!isActive && (
                        <button
                          type="button"
                          className="mysites-btn mysites-btn--primary"
                          onClick={() => setActiveSite(site.site_id)}
                        >
                          Activer
                        </button>
                      )}
                      <button
                        type="button"
                        className="mysites-btn mysites-btn--danger"
                        disabled={!canRelease}
                        title={
                          canRelease
                            ? "Se retirer de ce site"
                            : "Vous devez garder au moins un site"
                        }
                        onClick={() => void release(site.site_id)}
                      >
                        Se retirer
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="scp-panel mysites-section">
          <h2 className="mysites-section__title">Sites récupérables</h2>
          <p className="mysites-section__hint">
            Vous pouvez réclamer vous-même la supervision d&apos;un secteur disponible.
            La Foundation peut aussi vous en affecter de nouveaux sans vote.
          </p>
          {claimable.length === 0 ? (
            <p className="mysites-empty">// Aucun site disponible à la réclamation</p>
          ) : (
            <ul className="mysites-list">
              {claimable.map((site) => (
                <li key={site.site_id} className="mysites-card mysites-card--claim">
                  <div className="mysites-card__id">{site.site_id}</div>
                  <div className="mysites-card__name">{site.name}</div>
                  <div className="mysites-card__desc">{site.designation}</div>
                  <button
                    type="button"
                    className="mysites-btn mysites-btn--claim"
                    onClick={() => void claim(site.site_id)}
                  >
                    Réclamer la supervision
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
