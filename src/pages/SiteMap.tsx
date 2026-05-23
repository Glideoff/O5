import { useEffect, useMemo, useState } from "react";
import { useSitesStore } from "../stores/sitesStore";
import type { NetworkDevice } from "../types/network";
import "../styles/sitemap.css";

const HEX_RADIUS = 38;        // rayon hexagone d'un nœud
const SELF_HEX_RADIUS = 52;   // rayon hexagone du self (plus grand)
const ORBIT_RADIUS = 160;     // distance des pairs autour du self

/* ==========================================================================
   Helpers géométriques
   ========================================================================== */

function hexPolygon(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2; // commence en haut
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Coordonnées d'un pair autour du self (cercle équidistant). */
function peerPosition(
  index: number,
  total: number,
  centerX: number,
  centerY: number,
  radius: number,
): { x: number; y: number } {
  if (total === 0) return { x: centerX, y: centerY };
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  };
}

/* ==========================================================================
   Page principale
   ========================================================================== */

export function SiteMap() {
  const devices = useSitesStore((s) => s.devices);
  const isScanning = useSitesStore((s) => s.isScanning);
  const lastScanAt = useSitesStore((s) => s.lastScanAt);
  const lastError = useSitesStore((s) => s.lastError);
  const loadKnown = useSitesStore((s) => s.loadKnown);
  const scan = useSitesStore((s) => s.scan);

  // Charge l'état connu au mount.
  useEffect(() => {
    void loadKnown();
  }, [loadKnown]);

  const self = useMemo(() => devices.find((d) => d.is_self) ?? null, [devices]);
  const peers = useMemo(() => devices.filter((d) => !d.is_self), [devices]);

  return (
    <div className="sitemap-page">
      <header className="sitemap-header">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1>Carte des Sites</h1>
          <span className="sitemap-header__meta">
            {devices.length} appareil{devices.length > 1 ? "s" : ""}{" "}
            {lastScanAt ? `· dernier scan ${new Date(lastScanAt).toLocaleTimeString("fr-FR")}` : "· non scanné"}
          </span>
        </div>
        <button
          type="button"
          className="sitemap-header__scan"
          disabled={isScanning}
          onClick={() => void scan()}
        >
          {isScanning ? "// SCAN EN COURS..." : "▶ Scanner le réseau"}
        </button>
      </header>

      {lastError && (
        <div className="scp-panel" style={{ borderColor: "var(--accent-red)" }}>
          <strong style={{ color: "var(--accent-red-glow)" }}>// Erreur :</strong>{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
            {lastError}
          </span>
        </div>
      )}

      <SiteMapCanvas
        self={self}
        peers={peers}
        isScanning={isScanning}
        hasScanned={lastScanAt !== null || devices.length > 0}
      />
    </div>
  );
}

/* ==========================================================================
   Canvas SVG
   ========================================================================== */

interface SiteMapCanvasProps {
  self: NetworkDevice | null;
  peers: NetworkDevice[];
  isScanning: boolean;
  hasScanned: boolean;
}

function SiteMapCanvas({ self, peers, isScanning, hasScanned }: SiteMapCanvasProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  // Viewport 800x500 (responsive via viewBox SVG)
  const VW = 800;
  const VH = 500;
  const cx = VW / 2;
  const cy = VH / 2;

  const peerPositions = useMemo(() => {
    return peers.map((p, i) => ({
      device: p,
      pos: peerPosition(i, peers.length, cx, cy, ORBIT_RADIUS),
    }));
  }, [peers, cx, cy]);

  const hoveredDevice =
    hoveredId === self?.site_id
      ? self
      : peerPositions.find((p) => p.device.site_id === hoveredId)?.device ?? null;

  return (
    <div className="scp-panel sitemap-canvas">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        className="sitemap-canvas__svg"
      >
        {/* --- Radar pendant le scan --- */}
        {isScanning && (
          <g className="sitemap-radar">
            <circle cx={cx} cy={cy} r={ORBIT_RADIUS + 80} className="sitemap-radar__ring" />
            <circle cx={cx} cy={cy} r={ORBIT_RADIUS + 40} className="sitemap-radar__ring" />
            <circle cx={cx} cy={cy} r={ORBIT_RADIUS} className="sitemap-radar__ring" />
            <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <g className="sitemap-radar__sweep" style={{ transformOrigin: `${cx}px ${cy}px` }}>
                <path
                  d={`M ${cx} ${cy} L ${cx + ORBIT_RADIUS + 80} ${cy} A ${ORBIT_RADIUS + 80} ${ORBIT_RADIUS + 80} 0 0 1 ${cx + (ORBIT_RADIUS + 80) * Math.cos(Math.PI / 4)} ${cy + (ORBIT_RADIUS + 80) * Math.sin(Math.PI / 4)} Z`}
                  className="sitemap-radar__bg"
                />
              </g>
            </g>
          </g>
        )}

        {/* --- Edges (lignes de connexion) --- */}
        {self &&
          peerPositions.map((p) => (
            <line
              key={`edge-${p.device.site_id}`}
              x1={cx}
              y1={cy}
              x2={p.pos.x}
              y2={p.pos.y}
              className="sitemap-edge"
            />
          ))}

        {/* --- Peers --- */}
        {peerPositions.map((p) => (
          <SiteNode
            key={p.device.site_id}
            device={p.device}
            cx={p.pos.x}
            cy={p.pos.y}
            radius={HEX_RADIUS}
            onHover={(id, e) => {
              setHoveredId(id);
              if (e) setTipPos({ x: e.clientX, y: e.clientY });
            }}
          />
        ))}

        {/* --- Self au centre --- */}
        {self && (
          <SiteNode
            device={self}
            cx={cx}
            cy={cy}
            radius={SELF_HEX_RADIUS}
            onHover={(id, e) => {
              setHoveredId(id);
              if (e) setTipPos({ x: e.clientX, y: e.clientY });
            }}
          />
        )}
      </svg>

      {/* Empty / no scan yet */}
      {!self && !isScanning && (
        <div className="sitemap-canvas__empty">
          <div>// AUCUN APPAREIL D&Eacute;TECT&Eacute;</div>
          <div>Lance &laquo; Scanner le r&eacute;seau &raquo;</div>
        </div>
      )}
      {!self && isScanning && hasScanned && (
        <div className="sitemap-canvas__empty">
          <div>// SCAN /24 :47474 EN COURS...</div>
        </div>
      )}

      {hoveredDevice && tipPos && (
        <div
          className="sitemap-canvas__tooltip"
          style={{
            left: Math.min(tipPos.x + 12, window.innerWidth - 240),
            top: Math.min(tipPos.y + 12, window.innerHeight - 100),
          }}
        >
          <span className="sitemap-canvas__tooltip-id">{hoveredDevice.site_id}</span>
          {hoveredDevice.hostname} · {hoveredDevice.os}
          <br />
          {hoveredDevice.ip} · v{hoveredDevice.overseer_version}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   SiteNode (hexagone)
   ========================================================================== */

interface SiteNodeProps {
  device: NetworkDevice;
  cx: number;
  cy: number;
  radius: number;
  onHover: (id: string | null, e: React.MouseEvent | null) => void;
}

function SiteNode({ device, cx, cy, radius, onHover }: SiteNodeProps) {
  const statusClass =
    device.status === "ONLINE"
      ? "sitenode--online"
      : device.status === "ALERT"
        ? "sitenode--alert"
        : "sitenode--offline";

  const selfClass = device.is_self ? " sitenode--self" : "";

  const dotClass =
    device.status === "ONLINE"
      ? "sitenode__dot--online"
      : device.status === "ALERT"
        ? "sitenode__dot--alert"
        : "sitenode__dot--offline";

  return (
    <g
      className={`sitenode ${statusClass}${selfClass}`}
      onMouseEnter={(e) => onHover(device.site_id, e)}
      onMouseMove={(e) => onHover(device.site_id, e)}
      onMouseLeave={() => onHover(null, null)}
      style={{ cursor: "pointer" }}
    >
      <polygon
        points={hexPolygon(cx, cy, radius)}
        className="sitenode__shape"
      />
      <circle
        cx={cx + radius * 0.55}
        cy={cy - radius * 0.55}
        r={5}
        className={`sitenode__dot ${dotClass}`}
      />
      <text x={cx} y={cy - 4} className="sitenode__label">
        {device.site_id}
      </text>
      <text x={cx} y={cy + 12} className="sitenode__sub">
        {device.os}
      </text>
      {device.is_self && (
        <text x={cx} y={cy + radius + 18} className="sitenode__here">
          ← Vous êtes ici
        </text>
      )}
    </g>
  );
}
