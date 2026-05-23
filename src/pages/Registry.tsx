import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { WikiImportModal } from "../components/WikiImportModal";
import { ClassifiedPanel } from "../components/institutional/ClassifiedPanel";
import { RedactedParagraph } from "../components/institutional/Redacted";
import { useInstitutionalStore } from "../stores/institutionalStore";
import { useIncidentStore } from "../stores/incidentStore";
import { useScpStore } from "../stores/scpStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  SCP_OBJECT_CLASSES,
  type Incident,
  type Scp,
  type SCPObjectClass,
} from "../types/incident";
import "../styles/registry.css";

/* ==========================================================================
   Page principale
   ========================================================================== */

type ClassFilter = "ALL" | SCPObjectClass;
type SiteFilter = "ALL" | string;
type StatusFilter = "ALL" | string;

const POSSIBLE_SITES = ["SITE-17", "SITE-19", "SITE-██", "SITE-██-2"];

export function Registry() {
  const scps = useScpStore((s) => s.scps);
  const isLoading = useScpStore((s) => s.isLoading);
  const isGenerating = useScpStore((s) => s.isGenerating);
  const selectedId = useScpStore((s) => s.selectedId);
  const lastError = useScpStore((s) => s.lastError);
  const newlyAdded = useScpStore((s) => s.newlyAdded);
  const loadAll = useScpStore((s) => s.loadAll);
  const selectScp = useScpStore((s) => s.selectScp);
  const generateNewScp = useScpStore((s) => s.generateNewScp);
  const isImporting = useScpStore((s) => s.isImporting);

  const [wikiImportOpen, setWikiImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<ClassFilter>("ALL");
  const [siteFilter, setSiteFilter] = useState<SiteFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scps.filter((scp) => {
      if (
        needle &&
        !scp.id.toLowerCase().includes(needle) &&
        !scp.name.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (classFilter !== "ALL" && scp.object_class !== classFilter) return false;
      if (siteFilter !== "ALL" && scp.site !== siteFilter) return false;
      if (statusFilter !== "ALL" && scp.containment_status !== statusFilter)
        return false;
      return true;
    });
  }, [scps, search, classFilter, siteFilter, statusFilter]);

  const selected = useMemo(
    () => scps.find((s) => s.id === selectedId) ?? null,
    [scps, selectedId],
  );

  const siteOptions = useMemo(() => {
    const set = new Set<string>(POSSIBLE_SITES);
    scps.forEach((s) => s.site && set.add(s.site));
    return Array.from(set).sort();
  }, [scps]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>(["CONTAINED", "BREACH", "PENDING", "LOST"]);
    scps.forEach((s) => s.containment_status && set.add(s.containment_status));
    return Array.from(set).sort();
  }, [scps]);

  return (
    <div className="registry-page">
      <header className="registry-header">
        <div>
          <div className="registry-header__title">
            <h1>Registre SCP</h1>
            <span className="registry-header__count">
              {filtered.length} / {scps.length} dossiers
            </span>
          </div>
          <div className="registry-header__filters">
            <input
              type="text"
              className="registry-search"
              placeholder="Rechercher (id ou nom)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="registry-select"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value as ClassFilter)}
            >
              <option value="ALL">Classe : toutes</option>
              {SCP_OBJECT_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="registry-select"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value as SiteFilter)}
            >
              <option value="ALL">Site : tous</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="registry-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="ALL">Statut : tous</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="registry-header__actions">
          <button
            type="button"
            className="registry-import-wiki"
            disabled={isImporting}
            onClick={() => setWikiImportOpen(true)}
          >
            {isImporting ? "// Import wiki…" : "Importer Wikidot"}
          </button>
          <button
            type="button"
            className="registry-generate"
            disabled={isGenerating}
            onClick={() => void generateNewScp()}
          >
            {isGenerating ? "// Archivage dossier..." : "+ Nouveau dossier SCP"}
          </button>
        </div>
      </header>

      <WikiImportModal
        open={wikiImportOpen}
        onClose={() => setWikiImportOpen(false)}
        existingIds={new Set(scps.map((s) => s.id))}
      />

      {lastError && (
        <div className="scp-panel" style={{ borderColor: "var(--accent-red)" }}>
          <strong style={{ color: "var(--accent-red-glow)" }}>// Erreur :</strong>{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
            {lastError}
          </span>
        </div>
      )}

      <div className="registry-body">
        <div className="registry-grid-wrapper">
          {isLoading && (
            <div className="registry-empty">// Chargement du registre...</div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="registry-empty">// Aucun dossier ne correspond.</div>
          )}

          <div className="registry-grid">
            {isGenerating && (
              <div className="scp-card-skeleton">
                // Rédaction du dossier...
                <span className="blink-cursor"> </span>
              </div>
            )}
            {filtered.map((scp) => (
              <SCPCard
                key={scp.id}
                scp={scp}
                isSelected={scp.id === selectedId}
                isNew={newlyAdded.has(scp.id)}
                onClick={() => {
                  selectScp(scp.id);
                  useInstitutionalStore.getState().incrementConsultation();
                  useInstitutionalStore
                    .getState()
                    .logAccess(`Consultation : ${scp.id} — Dossier ouvert`);
                }}
              />
            ))}
          </div>
        </div>

        <div className="scp-panel scp-detail-panel">
          <SCPDetail scp={selected} siteOptions={siteOptions} />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   SCPCard
   ========================================================================== */

function classModifier(objectClass: string): string {
  const lower = objectClass.toLowerCase();
  if (lower === "euclide" || lower === "euclid") return "scp-card--euclide";
  if (lower === "keter") return "scp-card--keter";
  if (lower === "thaumiel") return "scp-card--thaumiel";
  if (lower === "apollyon") return "scp-card--apollyon";
  if (lower === "safe") return "scp-card--safe";
  return "";
}

interface SCPCardProps {
  scp: Scp;
  isSelected: boolean;
  isNew: boolean;
  onClick: () => void;
}

function SCPCard({ scp, isSelected, isNew, onClick }: SCPCardProps) {
  return (
    <div
      className={`scp-card ${classModifier(scp.object_class)}${isSelected ? " is-selected" : ""}${isNew ? " is-new" : ""}`}
      onClick={onClick}
    >
      {scp.created_by === "AI_GENERATED" && (
        <span className="scp-card__ai-badge">IA</span>
      )}
      {scp.created_by === "WIKIDOT_IMPORT" && (
        <span className="scp-card__ai-badge scp-card__wiki-badge">WIKI</span>
      )}
      <div className="scp-card__id">{scp.id}</div>
      <span className={`scp-badge ${scp.object_class.toLowerCase()}`}>
        {scp.object_class}
      </span>
      <div className="scp-card__name">{scp.name}</div>
      <div className="scp-card__meta">
        <span>{scp.site || "SITE-██"}</span>
        <span className="scp-card__meta-dot">·</span>
        <span>{scp.containment_status}</span>
      </div>
    </div>
  );
}

/* ==========================================================================
   SCPDetail
   ========================================================================== */

interface WikiLoreDto {
  scp_id: string;
  source_url: string;
  content: string;
  char_count: number;
}

function ScpWikiSection({ scpId }: { scpId: string }) {
  const [lore, setLore] = useState<WikiLoreDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLore(null);
    setError(null);
    setLoading(true);
    void invoke<WikiLoreDto | null>("get_scp_wiki_lore", { scpId })
      .then((res) => {
        if (!cancelled) setLore(res);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scpId]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<WikiLoreDto>("refresh_scp_wiki", { scpId });
      setLore(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="scp-detail__section scp-detail__wiki">
      <div className="scp-detail__section-title scp-detail__wiki-head">
        <span>Fiche wiki (Fondation SCP)</span>
        <button
          type="button"
          className="scp-detail__wiki-refresh"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Chargement…" : "Actualiser"}
        </button>
      </div>
      {error && (
        <div className="scp-detail__wiki-error">// {error}</div>
      )}
      {!error && loading && !lore && (
        <div className="scp-detail__wiki-loading">
          // Récupération depuis fondationscp.wikidot.com…
        </div>
      )}
      {!error && lore && (
        <>
          <a
            className="scp-detail__wiki-link"
            href={lore.source_url}
            target="_blank"
            rel="noreferrer"
          >
            {lore.source_url}
          </a>
          <pre className="scp-detail__wiki-body">{lore.content}</pre>
        </>
      )}
      {!error && !loading && !lore && (
        <div className="scp-detail__wiki-empty">
          // Fiche introuvable sur le wiki pour cet identifiant.
        </div>
      )}
    </section>
  );
}

interface SCPDetailProps {
  scp: Scp | null;
  siteOptions: string[];
}

function SCPDetail({ scp, siteOptions }: SCPDetailProps) {
  const transferScp = useScpStore((s) => s.transferScp);
  const incidents = useIncidentStore((s) => s.incidents);
  const o5_id = useSettingsStore((s) => s.o5_id);

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");

  useEffect(() => {
    setShowTransfer(false);
    setTransferTarget("");
  }, [scp?.id]);

  if (!scp) {
    return (
      <div className="scp-detail-empty">
        // S&Eacute;LECTIONNEZ UN DOSSIER &Agrave; GAUCHE
      </div>
    );
  }

  const linkedIncidents: Incident[] = incidents.filter(
    (i) => i.scp_id === scp.id,
  );

  const onTransferConfirm = async () => {
    if (!transferTarget || transferTarget === scp.site) {
      setShowTransfer(false);
      return;
    }
    await transferScp(scp.id, transferTarget);
    setShowTransfer(false);
  };

  const accessStamp = new Date().toLocaleString("fr-FR", { hour12: false });

  return (
    <ClassifiedPanel>
      <header className="scp-detail__header">
        <div className="scp-detail__title-row">
          <span className="scp-detail__id">{scp.id}</span>
          <span className={`scp-badge ${scp.object_class.toLowerCase()}`}>
            {scp.object_class}
          </span>
          {scp.created_by === "AI_GENERATED" && (
            <span className="scp-card__ai-badge" style={{ position: "static" }}>
              IA
            </span>
          )}
          {scp.created_by === "WIKIDOT_IMPORT" && (
            <span className="scp-card__ai-badge scp-card__wiki-badge" style={{ position: "static" }}>
              WIKI
            </span>
          )}
        </div>
        <div className="scp-detail__name">{scp.name}</div>
        <div className="scp-detail__meta">
          <span>SITE : {scp.site}</span>
          <span>·</span>
          <span>STATUT : {scp.containment_status}</span>
          <span>·</span>
          <span>ORIGINE : {scp.created_by}</span>
        </div>
      </header>

      <section className="scp-detail__section">
        <div className="inst-section-title">
          Proc&eacute;dures de confinement sp&eacute;ciales
        </div>
        <RedactedParagraph text={scp.containment_procedures} />
      </section>

      <section className="scp-detail__section">
        <div className="inst-section-title">Description</div>
        <RedactedParagraph text={scp.description} />
      </section>

      <ScpWikiSection scpId={scp.id} />

      <section className="scp-detail__incidents">
        <div className="scp-detail__section-title">
          Historique d&rsquo;incidents li&eacute;s ({linkedIncidents.length})
        </div>
        {linkedIncidents.length === 0 ? (
          <div className="scp-detail__incidents-empty">// Aucun incident enregistr&eacute;.</div>
        ) : (
          <ul className="scp-detail__incidents-list">
            {linkedIncidents.slice(0, 8).map((i) => (
              <li
                key={i.id}
                className={`scp-detail__incident-line scp-detail__incident-line--${i.status}`}
              >
                <span className="scp-detail__incident-line-id">{i.id}</span>
                <span>{i.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="scp-detail__actions">
        {!showTransfer ? (
          <button
            type="button"
            className="scp-detail__transfer"
            onClick={() => setShowTransfer(true)}
          >
            ⇄ Transf&eacute;rer vers un autre site
          </button>
        ) : (
          <div className="scp-detail__transfer-row">
            <select
              className="registry-select"
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {siteOptions
                .filter((s) => s !== scp.site)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="scp-detail__transfer"
              onClick={() => void onTransferConfirm()}
            >
              Confirmer
            </button>
            <button
              type="button"
              className="scp-detail__transfer"
              style={{ borderColor: "var(--text-muted)", color: "var(--text-muted)" }}
              onClick={() => setShowTransfer(false)}
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      <footer className="inst-footer-notice">
        Accès enregistré le {accessStamp} — {o5_id}
        <br />
        Ce document ne doit pas quitter les systèmes sécurisés de la Fondation.
        <br />
        Distribution : Liste BIGOT uniquement.
      </footer>
    </ClassifiedPanel>
  );
}
