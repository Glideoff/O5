import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { SCPLogo } from "./SCPLogo";
import { playSound } from "../utils/audio";
import "../styles/boot.css";

type BootLineKind = "header" | "separator" | "info" | "ok" | "warn" | "error" | "welcome" | "continue";

interface BootLine {
  text: string;
  kind: BootLineKind;
  delayBefore: number;
  charDelay?: number;
  dynamic?: "ollama";
}

const SEPARATOR = "================================";

const STATIC_LINES: BootLine[] = [
  {
    text: "> Initialisation des systèmes...                       [OK]",
    kind: "ok",
    delayBefore: 250,
    charDelay: 8,
  },
  {
    text: "> Vérification des protocoles de sécurité...           [OK]",
    kind: "ok",
    delayBefore: 200,
    charDelay: 8,
  },
  {
    text: "> Connexion à la base de données SQLite...             [OK]",
    kind: "ok",
    delayBefore: 200,
    charDelay: 8,
  },
  {
    text: "> Chargement du registre SCP...        [██████████ 100%]",
    kind: "ok",
    delayBefore: 250,
    charDelay: 8,
  },
  {
    text: "> Vérification des confinements...                     [OK]",
    kind: "ok",
    delayBefore: 200,
    charDelay: 8,
  },
  {
    text: "> Statut : surveillance active",
    kind: "info",
    delayBefore: 150,
    charDelay: 8,
  },
  {
    text: "> Convocation du Conseil O5...                         [OK]",
    kind: "ok",
    delayBefore: 200,
    charDelay: 8,
  },
  {
    text: "> Module IA local (Ollama)...",
    kind: "info",
    delayBefore: 200,
    charDelay: 8,
    dynamic: "ollama",
  },
  {
    text: "> Chiffrement E2E activé                               [OK]",
    kind: "ok",
    delayBefore: 200,
    charDelay: 8,
  },
  {
    text: "> Bienvenue, O5-1.",
    kind: "welcome",
    delayBefore: 350,
    charDelay: 35,
  },
  { text: SEPARATOR, kind: "separator", delayBefore: 200, charDelay: 8 },
  {
    text: "APPUYEZ SUR ENTRÉE POUR CONTINUER",
    kind: "continue",
    delayBefore: 300,
    charDelay: 14,
  },
];

const BG_LOGS = `SCIPNET AUTH v4.2.1 — SESSION PENDING
> ROUTING VIA SECURE CHANNEL ████████
> LEVEL 5 CLEARANCE REQUIRED
> OVERSEER HANDSHAKE INITIATED
> MEMETIC FILTER: ACTIVE
> ANOMALOUS TRAFFIC: NONE DETECTED
> AWAITING OPERATOR INPUT...`;

interface BootSequenceProps {
  onDone: () => void;
}

export function BootSequence({ onDone }: BootSequenceProps) {
  const [lines, setLines] = useState<BootLine[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await invoke<boolean>("check_ollama_status");
        if (!cancelled) setOllamaOnline(ok);
      } catch {
        if (!cancelled) setOllamaOnline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => playSound("boot"), 200);
    return () => window.clearTimeout(t);
  }, []);

  const finish = () => {
    if (isFading) return;
    setIsFading(true);
    window.setTimeout(() => onDone(), 500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFading]);

  useEffect(() => {
    if (cancelledRef.current) return;
    if (currentIdx >= STATIC_LINES.length) {
      const t = window.setTimeout(() => finish(), 1500);
      return () => window.clearTimeout(t);
    }

    const target = STATIC_LINES[currentIdx];

    let line: BootLine = target;
    if (target.dynamic === "ollama") {
      if (ollamaOnline === null) {
        const t = window.setTimeout(() => setCurrentIdx((i) => i), 200);
        return () => window.clearTimeout(t);
      }
      line = ollamaOnline
        ? {
            ...target,
            text: "> Module IA local (Ollama)...                          [OK]",
            kind: "ok",
          }
        : {
            ...target,
            text: "> Module IA local (Ollama)...                  [HORS LIGNE]",
            kind: "warn",
          };
    }

    const timer = window.setTimeout(() => {
      setCurrentText("");
      let idx = 0;
      const tick = () => {
        if (cancelledRef.current) return;
        idx += 1;
        setCurrentText(line.text.slice(0, idx));
        if (idx < line.text.length) {
          window.setTimeout(tick, line.charDelay ?? 10);
        } else {
          if (!cancelledRef.current) {
            setLines((prev) => [...prev, line]);
            setCurrentText("");
            setCurrentIdx((i) => i + 1);

            if (line.kind === "warn" && line.dynamic === "ollama") {
              setLines((prev) => [
                ...prev,
                {
                  text: "> Fonctionnement en mode dégradé (génération IA désactivée).",
                  kind: "warn",
                  delayBefore: 0,
                  charDelay: 0,
                },
              ]);
            }
          }
        }
      };
      tick();
    }, line.delayBefore);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, ollamaOnline]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <div className={`boot-root${isFading ? " is-fading" : ""}`}>
      <div className="boot-root__bg-logs" aria-hidden>
        {BG_LOGS}
      </div>

      <div className="boot-frame">
        <div className="boot-frame__bracket boot-frame__bracket--top" aria-hidden />

        <header className="boot-header">
          <p className="boot-header__terminal">OVERSEER DIRECT ACCESS TERMINAL</p>
          <p className="boot-header__foundation">SCP FOUNDATION</p>
        </header>

        <div className="boot-logo-wrap">
          <SCPLogo size={96} />
        </div>

        <div className="boot-lockout-bar">ACCÈS O5 — PROTOCOLE ACTIF</div>

        <div className="boot-console">
          {lines.map((l, i) => (
            <div key={i} className={`boot-line boot-line--${l.kind}`}>
              {l.text}
            </div>
          ))}
          {currentIdx < STATIC_LINES.length && (
            <div className="boot-line">
              {currentText}
              <span className="boot-cursor">█</span>
            </div>
          )}
        </div>

        <div className="boot-frame__bracket boot-frame__bracket--bottom" aria-hidden />
      </div>
    </div>
  );
}
