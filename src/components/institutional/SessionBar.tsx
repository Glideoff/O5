import { useEffect, useState } from "react";
import { useInstitutionalStore, formatCountdown } from "../../stores/institutionalStore";
import { useSettingsStore } from "../../stores/settingsStore";
import "../../styles/institutional.css";

export function SessionBar() {
  const sessionId = useInstitutionalStore((s) => s.sessionId);
  const sessionExpiresAt = useInstitutionalStore((s) => s.sessionExpiresAt);
  const ipSuffix = useInstitutionalStore((s) => s.ipSuffix);
  const sessionExpired = useInstitutionalStore((s) => s.sessionExpired);
  const tickSession = useInstitutionalStore((s) => s.tickSession);
  const getSessionRemainingMs = useInstitutionalStore((s) => s.getSessionRemainingMs);
  const extendSession = useInstitutionalStore((s) => s.extendSession);
  const o5_id = useSettingsStore((s) => s.o5_id);

  const [remaining, setRemaining] = useState(() => getSessionRemainingMs());

  useEffect(() => {
    const id = window.setInterval(() => {
      tickSession();
      setRemaining(getSessionRemainingMs());
    }, 1000);
    return () => window.clearInterval(id);
  }, [tickSession, getSessionRemainingMs]);

  const hasSession = sessionExpiresAt != null;
  const expired =
    hasSession && (sessionExpired || remaining <= 0);

  return (
    <>
      <div className="session-bar" role="status">
        <span>SESSION : {sessionId ?? "████-████-????"}</span>
        <span className="session-bar__sep">|</span>
        <span>UTILISATEUR : {o5_id}</span>
        <span className="session-bar__sep">|</span>
        <span>HABILITATION : NIVEAU 5 — CONFIRMÉE</span>
        <span className="session-bar__sep">|</span>
        <span>IP : ██.███.██.{ipSuffix}</span>
        <span className="session-bar__sep">|</span>
        <span>
          {expired
            ? "EXPIRE DANS : SESSION EXPIRÉE"
            : `EXPIRE DANS : ${formatCountdown(remaining)}`}
        </span>
        <span className="session-bar__sep">|</span>
        <span className="session-bar__warn">
          CETTE SESSION EST ENREGISTRÉE ET SURVEILLÉE
        </span>
      </div>
      {expired && (
        <div className="session-expired-overlay">
          <div className="session-expired-overlay__box">
            <p className="session-expired-overlay__title">
              SESSION EXPIRÉE — RECONNEXION REQUISE
            </p>
            <p className="session-expired-overlay__body">
              Votre session a atteint la limite de durée autorisée. Toute action
              ultérieure requiert une prolongation enregistrée.
            </p>
            <button
              type="button"
              className="session-expired-overlay__btn"
              onClick={() => extendSession()}
            >
              PROLONGER LA SESSION
            </button>
          </div>
        </div>
      )}
    </>
  );
}
