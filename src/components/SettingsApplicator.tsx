import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * Composant invisible monté tôt qui synchronise les settings visuels avec le DOM :
 *   - classe `no-scanlines` sur <body> selon settings.scanlines
 *   - CSS var --vignette-opacity selon settings.vignette_intensity
 */
export function SettingsApplicator() {
  const scanlines = useSettingsStore((s) => s.scanlines);
  const vignette = useSettingsStore((s) => s.vignette_intensity);

  useEffect(() => {
    document.body.classList.toggle("no-scanlines", !scanlines);
  }, [scanlines]);

  useEffect(() => {
    // Map 0-100 → opacity 0-0.85 (max raisonnable)
    const opacity = Math.max(0, Math.min(1, vignette / 100 * 0.85));
    document.documentElement.style.setProperty(
      "--vignette-opacity",
      opacity.toFixed(3),
    );
  }, [vignette]);

  return null;
}
