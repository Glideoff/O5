import { useEffect, useRef, useState } from "react";
import {
  MOCK_LOG_ENTRIES,
  SIMULATED_LOG_POOL,
  formatLogTimeRedacted,
  nextLogId,
  nowIso,
} from "../data/mockData";
import type { ActivityLogEntry, LogSource } from "../types/incident";

const MAX_ENTRIES = 100;

const SOURCE_CLASS: Record<LogSource, string> = {
  "O5-1": "activity-log__source--o5",
  SYSTÈME: "activity-log__source--system",
  ALERTE: "activity-log__source--alert",
  AGENT: "activity-log__source--agent",
  CHERCHEUR: "activity-log__source--researcher",
  DATABASE: "activity-log__source--db",
};

function formatSource(entry: ActivityLogEntry): string {
  if (entry.source_detail) return entry.source_detail;
  return entry.source;
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>(MOCK_LOG_ENTRIES);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll vers le bas à chaque nouvelle entrée.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Ticker mock : ajoute une entrée aléatoire toutes les 6-10 secondes.
  // Sera remplacé par un vrai flux d'événements en Phase 2/3.
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const delay = 6_000 + Math.floor(Math.random() * 4_000);
      window.setTimeout(() => {
        if (cancelled) return;
        const pick =
          SIMULATED_LOG_POOL[
            Math.floor(Math.random() * SIMULATED_LOG_POOL.length)
          ];
        setEntries((prev) => {
          const next: ActivityLogEntry = {
            ...pick,
            id: nextLogId(),
            timestamp: nowIso(),
          };
          const combined = [...prev, next];
          return combined.length > MAX_ENTRIES
            ? combined.slice(combined.length - MAX_ENTRIES)
            : combined;
        });
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="scp-panel activity-log">
      <header className="activity-log__header">
        <h2>Journal d'activité</h2>
        <span className="activity-log__meta">{entries.length} / {MAX_ENTRIES}</span>
      </header>

      <div className="activity-log__scroll" ref={scrollRef}>
        {entries.map((entry) => (
          <div key={entry.id} className="activity-log__line">
            <span className="activity-log__time">
              [{formatLogTimeRedacted(entry.timestamp)}]
            </span>
            <span
              className={`activity-log__source ${SOURCE_CLASS[entry.source]}`}
            >
              {formatSource(entry)}
            </span>
            <span className="activity-log__arrow">&gt;</span>
            <span className="activity-log__message">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
