import { useEffect, useState } from "react";

const pad = (n: number) => n.toString().padStart(2, "0");

/**
 * Horloge temps réel format Foundation :
 *   YYYY-██-██ | HH:MM:SS
 * Année réelle, mois et jour expurgés (cf. esthétique SCP).
 */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const year = now.getFullYear();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <div className="overseer-topbar__clock" title={now.toISOString()}>
      <span>{year}-</span>
      <span className="overseer-topbar__clock-redacted">██</span>
      <span>-</span>
      <span className="overseer-topbar__clock-redacted">██</span>
      <span>&nbsp;|&nbsp;</span>
      <span>{time}</span>
    </div>
  );
}
