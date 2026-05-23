interface SCPLogoProps {
  /** Hauteur en px (largeur auto, ratio 1:1). */
  size?: number;
  className?: string;
}

const LOGO_SRC = "/assets/scp-foundation-logo.png";

/**
 * Emblème SCP Foundation (PNG fond transparent, traits blancs).
 */
export function SCPLogo({ size = 28, className = "" }: SCPLogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="SCP Foundation"
      className={`scp-logo scp-logo--emblem ${className}`.trim()}
      style={{ width: size, height: size }}
      width={size}
      height={size}
      draggable={false}
    />
  );
}
