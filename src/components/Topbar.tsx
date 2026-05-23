import { usePlayerSitesStore } from "../stores/playerSitesStore";
import { useSettingsStore } from "../stores/settingsStore";
import { AIStatus } from "./AIStatus";
import { Clock } from "./Clock";
import { SCPLogo } from "./SCPLogo";
import { WindowControls } from "./WindowControls";
import { ConsultationCounter } from "./institutional/ConsultationCounter";

/**
 * Topbar OVERSEER. Toute la zone non-cliquable est draggable
 * (data-tauri-drag-region permet de déplacer la fenêtre sans chrome OS).
 */
export function Topbar() {
  const o5_id = useSettingsStore((s) => s.o5_id);
  const site_name = useSettingsStore((s) => s.site_name);
  const assigned = usePlayerSitesStore((s) => s.assigned);
  const setActiveSite = usePlayerSitesStore((s) => s.setActiveSite);

  return (
    <header className="overseer-topbar" data-tauri-drag-region>
      <div className="overseer-topbar__brand" data-tauri-drag-region>
        <SCPLogo size={30} />
        <div className="overseer-topbar__brand-text">
          <span className="overseer-topbar__brand-title">OVERSEER</span>
          <span className="overseer-topbar__brand-motto">Secure. Contain. Protect.</span>
        </div>
      </div>

      <div className="overseer-topbar__center" data-tauri-drag-region>
        <span>{o5_id}</span>
        <span className="overseer-topbar__diamond">◆</span>
        {assigned.length > 1 ? (
          <select
            className="overseer-topbar__site-select"
            value={site_name}
            onChange={(e) => setActiveSite(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {assigned.map((s) => (
              <option key={s.site_id} value={s.site_id}>
                {s.site_id}
              </option>
            ))}
          </select>
        ) : (
          <span>{site_name}</span>
        )}
        {assigned.length > 1 && (
          <span className="overseer-topbar__site-count" title="Sites supervisés">
            ({assigned.length})
          </span>
        )}
        <span className="overseer-topbar__diamond">◆</span>
        <span>CLEARANCE : LEVEL 5</span>
      </div>

      <div className="overseer-topbar__right">
        <ConsultationCounter />
        <AIStatus />
        <Clock />
        <WindowControls />
      </div>
    </header>
  );
}
