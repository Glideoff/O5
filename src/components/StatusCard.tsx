import type { ThreatLevel } from "../types/incident";

interface StatusCardProps {
  title: string;
  value: string;
  subtext?: string;
  level: ThreatLevel;
}

export function StatusCard({ title, value, subtext, level }: StatusCardProps) {
  return (
    <div className={`status-card status-card--${level}`}>
      <div className="status-card__title">{title}</div>
      <div className="status-card__value">{value}</div>
      {subtext && <div className="status-card__subtext">{subtext}</div>}
    </div>
  );
}
