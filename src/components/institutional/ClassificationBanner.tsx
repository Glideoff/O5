import "../../styles/institutional.css";

const TEXT =
  "TOP SECRET // SCI // FONDATION — YEUX SEULEMENT // ORCON // NOFORN";

interface ClassificationBannerProps {
  position: "top" | "bottom";
}

export function ClassificationBanner({ position }: ClassificationBannerProps) {
  return (
    <div
      className={`classification-banner classification-banner--${position}`}
      role="presentation"
      aria-hidden
    >
      {TEXT}
    </div>
  );
}
