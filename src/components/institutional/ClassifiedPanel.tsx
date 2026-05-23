import type { ReactNode } from "react";
import "../../styles/institutional.css";

interface ClassifiedPanelProps {
  children: ReactNode;
  className?: string;
}

/** Panneau classifié avec filigrane YEUX SEULEMENT. */
export function ClassifiedPanel({ children, className = "" }: ClassifiedPanelProps) {
  return (
    <div className={`classified-panel ${className}`.trim()}>
      <div className="classified-panel__watermark" aria-hidden>
        YEUX SEULEMENT
      </div>
      <div className="classified-panel__content">{children}</div>
    </div>
  );
}
