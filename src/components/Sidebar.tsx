import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { resolveAppVersion } from "../utils/version";
import { AccessLog } from "./institutional/AccessLog";
import {
  LayoutDashboard,
  AlertOctagon,
  Archive,
  Landmark,
  Network,
  Radio,
  Settings as SettingsIcon,
  Users,
  Vote,
  Terminal as TerminalIcon,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/incidents", label: "Incidents", icon: AlertOctagon },
  { to: "/registry", label: "Registre SCP", icon: Archive },
  { to: "/council", label: "Conseil O5", icon: Vote },
  { to: "/sites", label: "Mes Sites", icon: Landmark },
  { to: "/sitemap", label: "Carte Sites", icon: Network },
  { to: "/comms", label: "Communications", icon: Radio },
  { to: "/personnel", label: "Personnel", icon: Users },
  { to: "/terminal", label: "Terminal", icon: TerminalIcon },
  { to: "/settings", label: "Paramètres", icon: SettingsIcon },
];

export function Sidebar() {
  const [version, setVersion] = useState(import.meta.env.VITE_APP_VERSION ?? "…");

  useEffect(() => {
    void resolveAppVersion().then(setVersion);
  }, []);

  return (
    <aside className="overseer-sidebar">
      <div className="overseer-sidebar__heading">// Navigation</div>

      <nav className="overseer-sidebar__nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `overseer-sidebar__item${isActive ? " is-active" : ""}`
            }
          >
            <Icon size={14} strokeWidth={1.6} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <AccessLog />

      <footer className="overseer-sidebar__footer">
        <span className="overseer-sidebar__footer-line">OVERSEER v{version}</span>
        <span className="overseer-sidebar__footer-classif">TOP SECRET // SCI</span>
      </footer>
    </aside>
  );
}
