import { useId, useState, type ReactNode } from "react";
import "../../styles/institutional.css";

function randomReq(): string {
  return `REQ-████-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

interface RedactedProps {
  level: 1 | 2 | 3;
  reason?: string;
  children?: string;
  /** Largeur du bloc niveau 2 (caractères approximatifs). */
  blockWidth?: number;
}

export function Redacted({ level, reason, children, blockWidth = 24 }: RedactedProps) {
  const [showTip, setShowTip] = useState(false);
  const tipId = useId();

  if (level === 3) {
    return (
      <span className="redacted redacted--l3">
        [DONNÉES SUPPRIMÉES PAR ORDRE DU COMITÉ O5]
      </span>
    );
  }

  if (level === 2) {
    return (
      <span
        className="redacted redacted--l2"
        style={{ width: `${blockWidth}ch` }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        aria-describedby={showTip ? tipId : undefined}
      >
        {showTip && (
          <span className="redacted__popup" id={tipId} role="tooltip">
            Ce contenu requiert une habilitation [EXPURGÉ].
            <br />
            Demande d&apos;accès ref. : {randomReq()}
            {reason ? ` — ${reason}` : ""}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className="redacted redacted--l1"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      aria-describedby={showTip ? tipId : undefined}
    >
      {children ?? "██████"}
      {showTip && (
        <span className="redacted__tooltip" id={tipId} role="tooltip">
          ACCÈS REFUSÉ — HABILITATION INSUFFISANTE
        </span>
      )}
    </span>
  );
}

/** Paragraphe avec expurgation automatique (~35 %). */
export function RedactedParagraph({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  let redactNext = false;
  const out: ReactNode[] = [];

  parts.forEach((part, i) => {
    if (!part.trim()) {
      out.push(part);
      return;
    }
    if (Math.random() < 0.12) redactNext = true;
    if (redactNext) {
      const lvl = (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3;
      out.push(<Redacted key={i} level={lvl} blockWidth={12 + Math.floor(Math.random() * 16)} />);
      redactNext = false;
    } else {
      out.push(<span key={i}>{part}</span>);
    }
  });

  return <p className="inst-body-text">{out}</p>;
}
