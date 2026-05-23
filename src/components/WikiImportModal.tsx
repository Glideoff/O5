import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useScpStore } from "../stores/scpStore";
import "../styles/wiki-import.css";

export interface WikiCatalogEntry {
  id: string;
  slug: string;
}

export interface WikiImportResult {
  scp_id: string;
  ok: boolean;
  scp?: import("../types/incident").Scp;
  error?: string;
}

interface WikiImportModalProps {
  open: boolean;
  onClose: () => void;
  existingIds: Set<string>;
}

export function WikiImportModal({ open, onClose, existingIds }: WikiImportModalProps) {
  const importFromWiki = useScpStore((s) => s.importFromWiki);
  const isImporting = useScpStore((s) => s.isImporting);

  const [catalog, setCatalog] = useState<WikiCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualId, setManualId] = useState("");
  const [lastResults, setLastResults] = useState<WikiImportResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setLastResults(null);
    setSelected(new Set());
    setFilter("");
    setManualId("");
    void loadCatalog();
  }, [open]);

  const loadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const entries = await invoke<WikiCatalogEntry[]>("get_wikidot_scp_catalog");
      setCatalog(entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCatalogError(msg);
    } finally {
      setCatalogLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (e) =>
        e.id.toLowerCase().includes(needle) || e.slug.toLowerCase().includes(needle),
    );
  }, [catalog, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((e) => {
        if (!existingIds.has(e.id)) next.add(e.id);
      });
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const addManual = () => {
    const raw = manualId.trim().toUpperCase();
    if (!raw) return;
    const id = raw.startsWith("SCP-") ? raw : `SCP-${raw.replace(/^SCP/, "")}`;
    setSelected((prev) => new Set(prev).add(id));
    setManualId("");
  };

  const handleImport = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const results = await importFromWiki(ids);
    setLastResults(results);
    setSelected(new Set());
  };

  if (!open) return null;

  const okCount = lastResults?.filter((r) => r.ok).length ?? 0;
  const failCount = lastResults ? lastResults.length - okCount : 0;

  return (
    <div className="wiki-import-overlay" role="dialog" aria-modal="true">
      <div className="wiki-import-modal">
        <header className="wiki-import-modal__header">
          <div>
            <h2>Import Wikidot</h2>
            <p className="wiki-import-modal__sub">
              Sélectionnez un ou plusieurs dossiers SCP (fondationscp.wikidot.com)
            </p>
          </div>
          <button type="button" className="wiki-import-modal__close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="wiki-import-modal__toolbar">
          <input
            type="search"
            className="wiki-import-modal__search"
            placeholder="Filtrer (ex. SCP-173, 682…)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="wiki-import-modal__manual">
            <input
              type="text"
              placeholder="SCP-XXX manuel"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
            />
            <button type="button" onClick={addManual}>
              Ajouter
            </button>
          </div>
          <button type="button" onClick={() => void loadCatalog()} disabled={catalogLoading}>
            {catalogLoading ? "Chargement…" : "Actualiser liste"}
          </button>
          <button type="button" onClick={selectAllVisible}>
            Tout (visibles)
          </button>
          <button type="button" onClick={clearSelection}>
            Effacer
          </button>
        </div>

        {catalogError && (
          <div className="wiki-import-modal__error">// Catalogue : {catalogError}</div>
        )}

        <div className="wiki-import-modal__selection">
          {selected.size > 0
            ? `${selected.size} dossier(s) sélectionné(s)`
            : "// Cochez les SCP à importer"}
        </div>

        <div className="wiki-import-modal__list">
          {catalogLoading && filtered.length === 0 && (
            <div className="wiki-import-modal__empty">// Chargement du catalogue wiki…</div>
          )}
          {!catalogLoading && filtered.length === 0 && (
            <div className="wiki-import-modal__empty">// Aucun résultat.</div>
          )}
          {filtered.map((entry) => {
            const inRegistry = existingIds.has(entry.id);
            const checked = selected.has(entry.id);
            return (
              <label
                key={entry.id}
                className={`wiki-import-row${inRegistry ? " wiki-import-row--exists" : ""}${checked ? " wiki-import-row--checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={inRegistry || isImporting}
                  onChange={() => toggle(entry.id)}
                />
                <span className="wiki-import-row__id">{entry.id}</span>
                {inRegistry && (
                  <span className="wiki-import-row__badge">Déjà au registre</span>
                )}
              </label>
            );
          })}
        </div>

        {lastResults && (
          <div className="wiki-import-modal__results">
            // Import terminé — {okCount} succès, {failCount} échec(s)
            {lastResults
              .filter((r) => !r.ok)
              .slice(0, 5)
              .map((r) => (
                <div key={r.scp_id} className="wiki-import-modal__fail-line">
                  {r.scp_id} : {r.error}
                </div>
              ))}
          </div>
        )}

        <footer className="wiki-import-modal__footer">
          <button type="button" onClick={onClose} disabled={isImporting}>
            Fermer
          </button>
          <button
            type="button"
            className="wiki-import-modal__import"
            disabled={selected.size === 0 || isImporting}
            onClick={() => void handleImport()}
          >
            {isImporting
              ? `// Import en cours (${selected.size})…`
              : `Importer ${selected.size} dossier(s)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
