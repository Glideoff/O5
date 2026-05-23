import { useUpdateStore } from "../stores/updateStore";
import "../styles/update-banner.css";

/**
 * Bannière de mise à jour (style SCIPNET) — visible quand une version plus récente est détectée.
 */
export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const availableVersion = useUpdateStore((s) => s.availableVersion);
  const progress = useUpdateStore((s) => s.progress);
  const notes = useUpdateStore((s) => s.notes);
  const lastError = useUpdateStore((s) => s.lastError);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const installPendingUpdate = useUpdateStore((s) => s.installPendingUpdate);

  if (status === "idle" || status === "up-to-date" || status === "checking") {
    return null;
  }

  if (status === "error") {
    return (
      <div className="update-banner update-banner--error" role="status">
        <span className="update-banner__label">// MISE À JOUR</span>
        <span className="update-banner__msg">{lastError}</span>
        <button
          type="button"
          className="update-banner__btn"
          onClick={() => void checkForUpdates({ silent: false })}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (status === "downloading" || status === "installing") {
    return (
      <div className="update-banner update-banner--progress" role="status">
        <span className="update-banner__label">
          {status === "installing" ? "INSTALLATION…" : "TÉLÉCHARGEMENT…"}
        </span>
        <div className="update-banner__bar">
          <div
            className="update-banner__bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="update-banner__pct">{progress}%</span>
      </div>
    );
  }

  if (status === "available" && availableVersion) {
    return (
      <div className="update-banner update-banner--available" role="status">
        <div className="update-banner__main">
          <span className="update-banner__label">// MISE À JOUR DISPONIBLE</span>
          <span className="update-banner__msg">
            v{currentVersion} → v{availableVersion}
            {notes ? ` — ${notes.slice(0, 120)}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="update-banner__btn update-banner__btn--primary"
          onClick={() => void installPendingUpdate()}
        >
          Installer maintenant
        </button>
      </div>
    );
  }

  return null;
}
