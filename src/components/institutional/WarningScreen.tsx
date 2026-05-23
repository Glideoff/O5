import { useEffect, useState } from "react";
import "../../styles/institutional.css";

const LINES = [
  "",
  "AVERTISSEMENT — SYSTÈME RESTREINT",
  "",
  "Cet équipement est la propriété de la Fondation SCP.",
  "Son utilisation est réservée aux personnes autorisées.",
  "",
  "TOUTE activité sur ce système est surveillée,",
  "enregistrée et susceptible d'être auditée.",
  "",
  "L'accès non autorisé constitue une infraction pénale",
  "passible de [EXPURGÉ] conformément aux dispositions",
  "de l'accord ██/████-[EXPURGÉ].",
  "",
  "En continuant, vous attestez être habilité NIVEAU 4",
  "minimum et acceptez la surveillance de votre session.",
  "",
  "[ APPUYER SUR ENTRÉE POUR CONTINUER ]",
];

interface WarningScreenProps {
  onAck: () => void;
}

export function WarningScreen({ onAck }: WarningScreenProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [canContinue, setCanContinue] = useState(false);

  useEffect(() => {
    if (visibleCount >= LINES.length) {
      const t = window.setTimeout(() => setCanContinue(true), 400);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setVisibleCount((c) => c + 1), 300);
    return () => window.clearTimeout(t);
  }, [visibleCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canContinue) return;
      if (e.key === "Enter") {
        e.preventDefault();
        onAck();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canContinue, onAck]);

  return (
    <div className="warning-screen">
      <div className="warning-screen__frame">
        {LINES.slice(0, visibleCount).map((line, i) => (
          <div key={i} className="warning-screen__line">
            {line || "\u00A0"}
          </div>
        ))}
      </div>
    </div>
  );
}
