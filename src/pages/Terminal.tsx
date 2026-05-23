import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import "../styles/terminal.css";

type LineKind = "in" | "out" | "err" | "system" | "table";

interface TermLine {
  id: string;
  kind: LineKind;
  text?: string;
  table?: { columns: string[]; rows: unknown[][] };
}

interface SqlResultSet {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

interface SystemInfo {
  overseer_version: string;
  os: string;
  hostname: string;
  db_path: string;
  scp_count: number;
  incident_count: number;
  motion_count: number;
  site_count: number;
  personnel_count: number;
}

const WELCOME: TermLine[] = [
  { id: "w1", kind: "system", text: "OVERSEER TERMINAL — Niveau d'accès O5" },
  {
    id: "w2",
    kind: "system",
    text: "Tape 'help' pour la liste des commandes. Ctrl+L : clear.",
  },
];

function nextId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function Terminal() {
  const [lines, setLines] = useState<TermLine[]>(WELCOME);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const append = (line: Omit<TermLine, "id">) =>
    setLines((prev) => [...prev, { ...line, id: nextId() }]);

  const runCommand = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    append({ kind: "in", text: `O5> ${cmd}` });
    setHistory((h) => [...h, cmd]);
    setHistoryIdx(-1);

    const lower = cmd.toLowerCase();

    if (lower === "help" || lower === "?") {
      append({
        kind: "out",
        text: [
          "Commandes intégrées :",
          "  help                 — cette aide",
          "  clear                — efface l'écran",
          "  info                 — diagnostics système",
          "  version              — version OVERSEER",
          "  scps                 — liste des SCPs (raccourci SQL)",
          "  incidents            — 20 derniers incidents (raccourci SQL)",
          "  motions              — liste des motions",
          "  personnel            — effectifs Foundation",
          "  sites                — sites connus",
          "",
          "Requêtes SQL libres (SELECT/PRAGMA/EXPLAIN/WITH uniquement) :",
          "  SELECT name, object_class FROM scps WHERE object_class = 'KETER'",
          "  PRAGMA table_info(incidents)",
        ].join("\n"),
      });
      return;
    }

    if (lower === "clear" || lower === "cls") {
      setLines(WELCOME);
      return;
    }

    if (lower === "version") {
      try {
        const info = await invoke<SystemInfo>("get_system_info");
        append({
          kind: "out",
          text: `OVERSEER v${info.overseer_version} — Niveau 5 / O5 EYES ONLY`,
        });
      } catch {
        append({ kind: "out", text: "OVERSEER — Niveau 5 / O5 EYES ONLY" });
      }
      return;
    }

    if (lower === "info") {
      try {
        const info = await invoke<SystemInfo>("get_system_info");
        append({
          kind: "out",
          text: [
            `[OS]            ${info.os}`,
            `[Hostname]      ${info.hostname}`,
            `[Version]       OVERSEER v${info.overseer_version}`,
            `[DB]            ${info.db_path}`,
            `[SCPs]          ${info.scp_count}`,
            `[Incidents]     ${info.incident_count}`,
            `[Motions]       ${info.motion_count}`,
            `[Sites]         ${info.site_count}`,
            `[Personnel]     ${info.personnel_count}`,
          ].join("\n"),
        });
      } catch (e) {
        append({ kind: "err", text: `Erreur info : ${String(e)}` });
      }
      return;
    }

    // Raccourcis : commandes → SQL équivalentes
    const SHORTCUTS: Record<string, string> = {
      scps: "SELECT id, name, object_class, site, containment_status FROM scps ORDER BY id",
      incidents:
        "SELECT id, scp_id, severity, status, site, title FROM incidents ORDER BY timestamp DESC LIMIT 20",
      motions:
        "SELECT id, title, category, status, result FROM motions ORDER BY created_at DESC LIMIT 20",
      personnel:
        "SELECT id, codename, role, clearance_level, site, status FROM personnel ORDER BY clearance_level DESC, id",
      sites: "SELECT id, device_name, os, ip, status, last_seen FROM sites ORDER BY id",
    };
    const sql = SHORTCUTS[lower] ?? cmd;

    try {
      const res = await invoke<SqlResultSet>("execute_sql", { query: sql });
      if (res.row_count === 0) {
        append({ kind: "out", text: "(0 ligne)" });
      } else {
        append({ kind: "table", table: { columns: res.columns, rows: res.rows } });
        append({ kind: "system", text: `(${res.row_count} ligne${res.row_count > 1 ? "s" : ""})` });
      }
    } catch (e) {
      append({ kind: "err", text: `Erreur : ${String(e)}` });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const cmd = input;
      setInput("");
      void runCommand(cmd);
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const newIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(history[newIdx] ?? "");
    } else if (e.key === "ArrowDown") {
      if (historyIdx < 0) return;
      e.preventDefault();
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(newIdx);
        setInput(history[newIdx] ?? "");
      }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setLines(WELCOME);
    }
  };

  return (
    <div className="term-page">
      <div className="term-page__output" ref={scrollRef}>
        {lines.map((l) => (
          <div key={l.id} className={`term-line term-line--${l.kind === "table" ? "out" : l.kind}`}>
            {l.kind === "table" && l.table ? (
              <TableView columns={l.table.columns} rows={l.table.rows} />
            ) : (
              l.text
            )}
          </div>
        ))}
      </div>

      <div className="term-input-row">
        <span className="term-prompt">O5{">"}</span>
        <input
          ref={inputRef}
          className="term-input"
          value={input}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}

function TableView({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <table className="term-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j}>{formatCell(v)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
