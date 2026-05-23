import { useEffect, useRef, useState } from "react";
import { useInstitutionalStore } from "../../stores/institutionalStore";
import { useSettingsStore } from "../../stores/settingsStore";
import "../../styles/institutional.css";

const IDLE_MS = 5 * 60 * 1000;

function randomLogRef(): string {
  return `LOG-████${Math.random().toString(16).slice(2, 5).toUpperCase()}`;
}

export function SurveillanceBridge() {
  const logAccess = useInstitutionalStore((s) => s.logAccess);
  const o5_id = useSettingsStore((s) => s.o5_id);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    const resetIdle = () => {
      if (idle) {
        logAccess(`${o5_id} — Reprise après inactivité (Ref. ${randomLogRef()})`);
      }
      setIdle(false);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        setIdle(true);
        logAccess(`${o5_id} — Pause inactivité détectée — Enregistré`);
      }, IDLE_MS);
    };
    resetIdle();
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("mousedown", resetIdle);
    window.addEventListener("mousemove", resetIdle);
    return () => {
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("mousedown", resetIdle);
      window.removeEventListener("mousemove", resetIdle);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [idle, logAccess, o5_id]);

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      const ref = randomLogRef();
      logAccess(`${o5_id} — Tentative de copie. Ref. ${ref}`, { system: false });
      setCopyNotice(`ACTION ENREGISTRÉE — Tentative de copie. Ref. ${ref}`);
      window.setTimeout(() => setCopyNotice(null), 5000);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [logAccess, o5_id]);

  return (
    <>
      {copyNotice && (
        <div className="surveillance-toast" role="status">
          {copyNotice}
        </div>
      )}
      {idle && (
        <div className="idle-overlay">
          <div className="idle-overlay__box">
            <p className="idle-overlay__title">SESSION EN PAUSE — INACTIVITÉ DÉTECTÉE</p>
            <p className="idle-overlay__body">
              Appuyez sur une touche pour reprendre.
              <br />
              Cette pause a été enregistrée (Ref. ████)
            </p>
          </div>
        </div>
      )}
    </>
  );
}
