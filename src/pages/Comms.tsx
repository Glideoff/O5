import { useEffect, useMemo, useRef, useState } from "react";
import { useCommsStore } from "../stores/commsStore";
import { useSettingsStore } from "../stores/settingsStore";
import "../styles/comms.css";

const BROADCAST_KEY = "*";

/* ==========================================================================
   Page principale
   ========================================================================== */

export function Comms() {
  const peers = useCommsStore((s) => s.peers);
  const threads = useCommsStore((s) => s.threads);
  const selectedThread = useCommsStore((s) => s.selectedThread);
  const serverStatus = useCommsStore((s) => s.serverStatus);
  const lastError = useCommsStore((s) => s.lastError);
  const keyFingerprint = useCommsStore((s) => s.keyFingerprint);
  const wireListeners = useCommsStore((s) => s.wireListeners);
  const refreshPeers = useCommsStore((s) => s.refreshPeers);
  const refreshFingerprint = useCommsStore((s) => s.refreshFingerprint);
  const startServer = useCommsStore((s) => s.startServer);
  const connectPeer = useCommsStore((s) => s.connectPeer);
  const magicLink = useCommsStore((s) => s.magicLink);
  const createMagicLink = useCommsStore((s) => s.createMagicLink);
  const joinMagicLink = useCommsStore((s) => s.joinMagicLink);
  const selectThread = useCommsStore((s) => s.selectThread);
  const sendMessage = useCommsStore((s) => s.sendMessage);
  const broadcast = useCommsStore((s) => s.broadcast);

  const wsPort = useSettingsStore((s) => s.ws_port);
  const networkMode = useSettingsStore((s) => s.network_mode);

  const [connectAddr, setConnectAddr] = useState("");
  const [pasteLink, setPasteLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  // Init : branche les listeners + refresh peers + fingerprint au mount
  useEffect(() => {
    void wireListeners();
    void refreshPeers();
    void refreshFingerprint();
  }, [wireListeners, refreshPeers, refreshFingerprint]);

  // Sélectionne par défaut le broadcast si rien
  useEffect(() => {
    if (!selectedThread) selectThread(BROADCAST_KEY);
  }, [selectedThread, selectThread]);

  const allThreadKeys = useMemo(() => {
    const set = new Set<string>([BROADCAST_KEY]);
    peers.forEach((p) => set.add(p.site_id));
    Object.keys(threads).forEach((k) => set.add(k));
    return Array.from(set);
  }, [peers, threads]);

  const currentThread = threads[selectedThread ?? BROADCAST_KEY] ?? [];
  const canTransmit =
    serverStatus === "running" || peers.length > 0;

  const copyMagicLink = async () => {
    if (!magicLink?.link) return;
    try {
      await navigator.clipboard.writeText(magicLink.link);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="comms-page">
      <header className="comms-header">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1>Communications</h1>
          <div className="comms-header__meta">
            <span>
              Mode :{" "}
              <span style={{ color: "var(--accent-cyan)" }}>{networkMode}</span>
            </span>
            <span>
              Serveur :{" "}
              <span
                style={{
                  color:
                    serverStatus === "running"
                      ? "var(--accent-green)"
                      : serverStatus === "error"
                        ? "var(--accent-red-glow)"
                        : "var(--text-secondary)",
                }}
              >
                {serverStatus.toUpperCase()}
              </span>
            </span>
            {keyFingerprint && (
              <span className="comms-header__crypto">
                AES-256 ✓ {keyFingerprint}
              </span>
            )}
          </div>
        </div>

        <div className="comms-header__connect-row">
          {serverStatus !== "running" && (
            <button
              type="button"
              className="comms-header__btn"
              onClick={() => void startServer(wsPort)}
            >
              ▶ Démarrer serveur :{wsPort}
            </button>
          )}
          <input
            className="comms-header__input"
            placeholder="ip:port (ex 192.168.1.42:47474)"
            value={connectAddr}
            onChange={(e) => setConnectAddr(e.target.value)}
          />
          <button
            type="button"
            className="comms-header__btn comms-header__btn--ghost"
            onClick={() => {
              if (!connectAddr.trim()) return;
              void connectPeer(connectAddr.trim());
            }}
          >
            Connecter
          </button>
        </div>
      </header>

      {lastError && (
        <div className="scp-panel" style={{ borderColor: "var(--accent-red)" }}>
          <strong style={{ color: "var(--accent-red-glow)" }}>// Erreur :</strong>{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
            {lastError}
          </span>
        </div>
      )}

      <section className="scp-panel comms-magic">
        <div className="comms-magic__title">// Liaison distante (Magic Link)</div>
        <div className="comms-magic__grid">
          <div className="comms-magic__col">
            <div className="comms-magic__label">Hôte (O5 / mode serveur)</div>
            <p className="comms-magic__hint">
              Générez un lien et envoyez-le à l&apos;autre PC (Discord, mail…). L&apos;hôte doit
              autoriser le port {wsPort} (pare-feu + redirection box si Internet).
            </p>
            <button
              type="button"
              className="comms-header__btn"
              disabled={linkBusy}
              onClick={() => {
                setLinkBusy(true);
                void createMagicLink(wsPort)
                  .catch(() => undefined)
                  .finally(() => setLinkBusy(false));
              }}
            >
              {linkBusy ? "Génération…" : "Générer magic link"}
            </button>
            {magicLink && (
              <div className="comms-magic__result">
                <div className="comms-magic__meta">
                  <span>Public : {magicLink.public_ip ?? "—"}</span>
                  <span>LAN : {magicLink.local_ip}</span>
                  <span>Port : {magicLink.port}</span>
                </div>
                <textarea
                  className="comms-magic__link"
                  readOnly
                  rows={3}
                  value={magicLink.link}
                />
                <button
                  type="button"
                  className="comms-header__btn comms-header__btn--ghost"
                  onClick={() => void copyMagicLink()}
                >
                  Copier le lien
                </button>
                {magicLink.hint && (
                  <p className="comms-magic__hint">{magicLink.hint}</p>
                )}
              </div>
            )}
          </div>
          <div className="comms-magic__col">
            <div className="comms-magic__label">Invité (mode client)</div>
            <p className="comms-magic__hint">
              Collez le lien reçu — pas besoin d&apos;ouvrir un port sur ce PC.
            </p>
            <textarea
              className="comms-magic__link"
              placeholder="overseer://pair/…"
              rows={3}
              value={pasteLink}
              onChange={(e) => setPasteLink(e.target.value)}
            />
            <button
              type="button"
              className="comms-header__btn"
              disabled={linkBusy || !pasteLink.trim()}
              onClick={() => {
                setLinkBusy(true);
                void joinMagicLink(pasteLink)
                  .then(() => setPasteLink(""))
                  .catch(() => undefined)
                  .finally(() => setLinkBusy(false));
              }}
            >
              Rejoindre via magic link
            </button>
          </div>
        </div>
      </section>

      <div className="comms-body">
        <div className="scp-panel contact-list">
          <div className="contact-list__heading">// Correspondants</div>
          <div className="contact-list__items">
            {/* Broadcast toujours en haut */}
            <ContactItem
              siteId={BROADCAST_KEY}
              displayId="BROADCAST"
              role="ALL CHANNELS"
              online
              isSelected={selectedThread === BROADCAST_KEY}
              onSelect={() => selectThread(BROADCAST_KEY)}
            />
            {peers.length === 0 ? (
              <div className="contact-list__empty">// Aucun pair connecté</div>
            ) : (
              peers.map((p) => (
                <ContactItem
                  key={p.site_id}
                  siteId={p.site_id}
                  displayId={p.site_id}
                  role={p.role}
                  online
                  isSelected={selectedThread === p.site_id}
                  onSelect={() => selectThread(p.site_id)}
                />
              ))
            )}
            {/* Threads orphelins (peer déconnecté mais messages persistés) */}
            {allThreadKeys
              .filter(
                (k) =>
                  k !== BROADCAST_KEY &&
                  !peers.some((p) => p.site_id === k),
              )
              .map((k) => (
                <ContactItem
                  key={k}
                  siteId={k}
                  displayId={k}
                  role="OFFLINE"
                  online={false}
                  isSelected={selectedThread === k}
                  onSelect={() => selectThread(k)}
                />
              ))}
          </div>
        </div>

        <div className="scp-panel thread">
          <header className="thread__header">
            <h2 className="thread__title">
              {selectedThread === BROADCAST_KEY
                ? "BROADCAST (tous canaux)"
                : selectedThread ?? "—"}
            </h2>
            <span className="thread__meta">
              {currentThread.length} message
              {currentThread.length > 1 ? "s" : ""}
            </span>
          </header>

          <ThreadView messages={currentThread} />

          <SendBar
            disabled={!selectedThread || !canTransmit}
            onSend={(text) => {
              if (selectedThread === BROADCAST_KEY) {
                void broadcast(text);
              } else if (selectedThread) {
                void sendMessage(selectedThread, text);
              }
            }}
            placeholder={
              selectedThread === BROADCAST_KEY
                ? "> Diffuser à tous les sites..."
                : `> Message privé à ${selectedThread}...`
            }
          />

          <div className="thread__crypto-hint">
            ◆ Chiffrement AES-256 ✓ — Transmission sécurisée
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Sub-components
   ========================================================================== */

interface ContactItemProps {
  siteId: string;
  displayId: string;
  role: string;
  online: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function ContactItem({
  displayId,
  role,
  online,
  isSelected,
  onSelect,
}: ContactItemProps) {
  return (
    <div
      className={`contact-item${isSelected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span
        className={`contact-item__dot contact-item__dot--${online ? "online" : "offline"}`}
      />
      <div className="contact-item__main">
        <div className="contact-item__id">{displayId}</div>
        <div className="contact-item__meta">{role}</div>
      </div>
    </div>
  );
}

interface ThreadViewProps {
  messages: ReturnType<typeof useCommsStore.getState>["threads"][string];
}

function ThreadView({ messages }: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!messages || messages.length === 0) {
    return (
      <div className="thread__messages" ref={scrollRef}>
        <div className="thread__empty">// Aucun message sur ce canal</div>
      </div>
    );
  }

  return (
    <div className="thread__messages" ref={scrollRef}>
      {messages.map((m) => {
        const isBroadcast =
          m.from === "FOUNDATION" && m.to === "*" && !m.encrypted;
        const classNames = ["message"];
        if (m.is_local) classNames.push("is-local");
        if (isBroadcast) classNames.push("is-broadcast");
        return (
          <div key={m.id} className={classNames.join(" ")}>
            {!isBroadcast && (
              <div className="message__header">
                <span>
                  DE :{" "}
                  <span className="message__from">{m.from}</span>
                </span>
                <span>À : {m.to}</span>
                <span>{formatTimeShort(m.timestamp)}</span>
                <span className="message__classif">
                  CONFIDENTIEL — NIVEAU 4
                </span>
              </div>
            )}
            <div className="message__body">{m.content}</div>
          </div>
        );
      })}
    </div>
  );
}

interface SendBarProps {
  disabled: boolean;
  onSend: (text: string) => void;
  placeholder: string;
}

function SendBar({ disabled, onSend, placeholder }: SendBarProps) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="thread__send">
      <span className="thread__send-prompt">{"❯"}</span>
      <input
        className="thread__send-input"
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="thread__send-btn"
        disabled={disabled || !draft.trim()}
        onClick={submit}
      >
        Transmettre
      </button>
    </div>
  );
}

function formatTimeShort(iso: string): string {
  // Le timestamp peut être ISO ou notre @secs
  if (iso.startsWith("@")) return iso;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("fr-FR", { hour12: false });
  } catch {
    return iso;
  }
}
