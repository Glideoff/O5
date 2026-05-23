import { useInstitutionalStore } from "../../stores/institutionalStore";
import "../../styles/institutional.css";

export function AccessLog() {
  const entries = useInstitutionalStore((s) => s.accessLog);

  return (
    <div className="access-log">
      <div className="access-log__title">■ JOURNAL D&apos;ACCÈS</div>
      <div className="access-log__scroll">
        {entries.length === 0 ? (
          <div className="access-log__empty">// En attente d&apos;activité…</div>
        ) : (
          [...entries].reverse().slice(0, 12).map((e) => (
            <div key={e.id} className="access-log__line">
              <span className="access-log__time">[{e.time}]</span>{" "}
              <span className="access-log__user">{e.user}</span>
              {" — "}
              <span className="access-log__msg">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
