import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type Status = "unknown" | "online" | "offline";

const POLL_INTERVAL_MS = 10_000;

/**
 * Indicateur permanent de l'état du moteur IA local (Ollama).
 * Poll silencieux toutes les 10s — verbiage volontairement minimal.
 */
export function AIStatus() {
  const [status, setStatus] = useState<Status>("unknown");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const ok = await invoke<boolean>("check_ollama_status");
        if (!cancelled) setStatus(ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };

    void check();
    const id = window.setInterval(() => void check(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <span className={`ai-status ai-status--${status}`} title={`Ollama : ${status}`}>
      <span className="ai-status__dot" aria-hidden />
      IA&nbsp;: {status === "unknown" ? "..." : status.toUpperCase()}
    </span>
  );
}
