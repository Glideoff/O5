import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

/**
 * Boutons de chrome custom (decorations: false dans tauri.conf.json).
 * Utilise les APIs window de Tauri v2.
 */
export function WindowControls() {
  const win = getCurrentWindow();

  return (
    <div className="window-controls">
      <button
        type="button"
        aria-label="Minimiser"
        title="Minimiser"
        onClick={() => void win.minimize()}
      >
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Agrandir / Restaurer"
        title="Agrandir / Restaurer"
        onClick={() => void win.toggleMaximize()}
      >
        <Square size={12} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="close"
        aria-label="Fermer"
        title="Fermer"
        onClick={() => void win.close()}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
