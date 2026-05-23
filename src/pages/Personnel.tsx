import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import "../styles/personnel.css";

interface Personnel {
  id: string;
  codename: string;
  role: string;
  clearance_level: number;
  site: string;
  status: string;
}

interface SiteStaffing {
  site: string;
  total_active: number;
  non_class_d_active: number;
  class_d_active: number;
  min_total: number;
  min_non_class_d: number;
  meets_min_total: boolean;
  meets_min_non_class_d: boolean;
}

const ROLES = ["O5", "MTF", "RESEARCHER", "CLASS_D"] as const;
const STATUSES = ["ACTIVE", "INACTIVE", "KIA", "MISSING"] as const;
const SITES = ["SITE-17", "SITE-19", "SITE-██", "SITE-██-2"] as const;
const CLEARANCE_LEVELS = [0, 1, 2, 3, 4, 5] as const;

const EMPTY_DRAFT: Personnel = {
  id: "",
  codename: "",
  role: "MTF",
  clearance_level: 2,
  site: "SITE-19",
  status: "ACTIVE",
};

export function Personnel() {
  const settings = useSettingsStore();
  const [list, setList] = useState<Personnel[]>([]);
  const [staffing, setStaffing] = useState<SiteStaffing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Personnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState<string>("ALL");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiRole, setAiRole] = useState<string>("");
  const [aiSite, setAiSite] = useState("SITE-19");

  const load = async () => {
    try {
      const res = await invoke<Personnel[]>("get_all_personnel");
      setList(res);
      const stats = await invoke<SiteStaffing[]>("get_all_sites_staffing", {
        minTotal: settings.site_min_total,
        minNonClassD: settings.site_min_non_class_d,
      });
      setStaffing(stats);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void load();
  }, [settings.site_min_total, settings.site_min_non_class_d]);

  const isNew = draft && !list.some((p) => p.id === draft.id);

  const filteredList = useMemo(() => {
    if (siteFilter === "ALL") return list;
    return list.filter((p) => p.site === siteFilter);
  }, [list, siteFilter]);

  const openNew = () => {
    setDraft({ ...EMPTY_DRAFT, site: aiSite });
    setSelectedId(null);
  };

  const selectExisting = (p: Personnel) => {
    setSelectedId(p.id);
    setDraft({ ...p });
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.id.trim() || !draft.codename.trim()) {
      setError("ID et codename requis");
      return;
    }
    setError(null);
    try {
      await invoke("upsert_personnel", { person: draft });
      await load();
      setSelectedId(draft.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const onDelete = async () => {
    if (!draft || isNew) return;
    if (!confirm(`Supprimer définitivement ${draft.id} ?`)) return;
    try {
      await invoke("delete_personnel", { id: draft.id });
      setDraft(null);
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const onGenerateAi = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const created = await invoke<Personnel[]>("generate_personnel_with_ai", {
        site: aiSite,
        count: 5,
        role: aiRole || null,
      });
      await load();
      if (created.length > 0) {
        selectExisting(created[0]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const onTopUpSite = async (site: string) => {
    setError(null);
    try {
      await invoke("ensure_site_minimum_staffing", {
        site,
        minTotal: settings.site_min_total,
        minNonClassD: settings.site_min_non_class_d,
      });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const counts = list.reduce<Record<string, number>>((acc, p) => {
    if (p.status === "ACTIVE") {
      acc[p.role] = (acc[p.role] ?? 0) + 1;
    }
    return acc;
  }, {});

  const understaffed = staffing.filter(
    (s) => !s.meets_min_total || !s.meets_min_non_class_d,
  );

  return (
    <div className="personnel-page">
      <header className="personnel-header">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1>Personnel</h1>
          <span className="personnel-header__count">
            {list.filter((p) => p.status === "ACTIVE").length} actifs · O5:
            {counts.O5 ?? 0} · MTF:{counts.MTF ?? 0} · Recherche:
            {counts.RESEARCHER ?? 0} · D:{counts.CLASS_D ?? 0}
          </span>
        </div>
        <div className="personnel-header__actions">
          <button
            type="button"
            className="personnel-header__ai"
            disabled={isGenerating}
            onClick={() => void onGenerateAi()}
          >
            {isGenerating ? "// Recrutement..." : "◈ Recruter via IA (×5)"}
          </button>
          <button type="button" className="personnel-header__new" onClick={openNew}>
            + Nouvel effectif
          </button>
        </div>
      </header>

      <div className="personnel-ai-bar scp-panel">
        <span className="personnel-ai-bar__label">Recrutement IA — site</span>
        <select
          className="personnel-form__select"
          value={aiSite}
          onChange={(e) => setAiSite(e.target.value)}
        >
          {SITES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="personnel-ai-bar__label">rôle (optionnel)</span>
        <select
          className="personnel-form__select"
          value={aiRole}
          onChange={(e) => setAiRole(e.target.value)}
        >
          <option value="">Mix réaliste</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="personnel-ai-bar__hint">
          Minimums : {settings.site_min_total} effectifs / site ·{" "}
          {settings.site_min_non_class_d} hors Classe D
        </span>
      </div>

      {understaffed.length > 0 && (
        <div className="personnel-alert scp-panel">
          <strong>// ALERTE EFFECTIFS</strong>
          <ul>
            {understaffed.map((s) => (
              <li key={s.site}>
                {s.site} : {s.total_active}/{s.min_total} actifs (
                {s.non_class_d_active}/{s.min_non_class_d} hors Classe D)
                <button
                  type="button"
                  className="personnel-alert__btn"
                  onClick={() => void onTopUpSite(s.site)}
                >
                  Compléter
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="scp-panel" style={{ borderColor: "var(--accent-red)" }}>
          <strong style={{ color: "var(--accent-red-glow)" }}>// Erreur :</strong>{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
            {error}
          </span>
        </div>
      )}

      <div className="personnel-body">
        <div className="scp-panel personnel-table-wrapper">
          <div className="personnel-table-toolbar">
            <label>
              Site
              <select
                className="personnel-form__select"
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
              >
                <option value="ALL">Tous les sites</option>
                {SITES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <table className="personnel-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Codename</th>
                <th>Rôle</th>
                <th>Niveau</th>
                <th>Site</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((p) => (
                <tr
                  key={p.id}
                  className={p.id === selectedId ? "is-selected" : ""}
                  onClick={() => selectExisting(p)}
                >
                  <td style={{ color: "var(--accent-white)" }}>{p.id}</td>
                  <td>{p.codename}</td>
                  <td>
                    <span className={`role-pill role-pill--${p.role}`}>{p.role}</span>
                  </td>
                  <td style={{ color: "var(--accent-cyan)" }}>L{p.clearance_level}</td>
                  <td>{p.site}</td>
                  <td>
                    <span className={`status-pill status-pill--${p.status}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredList.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      color: "var(--text-muted)",
                      textAlign: "center",
                      padding: 20,
                    }}
                  >
                    // Aucun effectif pour ce filtre
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="scp-panel">
          {staffing.length > 0 && (
            <div className="personnel-staffing-summary">
              {staffing.map((s) => (
                <div
                  key={s.site}
                  className={
                    s.meets_min_total && s.meets_min_non_class_d
                      ? "personnel-staffing-row is-ok"
                      : "personnel-staffing-row is-warn"
                  }
                >
                  <span>{s.site}</span>
                  <span>
                    {s.total_active}/{s.min_total} · hors D {s.non_class_d_active}/
                    {s.min_non_class_d}
                  </span>
                </div>
              ))}
            </div>
          )}

          {draft ? (
            <form className="personnel-form" onSubmit={onSave}>
              <div className="personnel-form__heading">
                {isNew ? "Nouvel effectif" : `${draft.id} — édition`}
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Identifiant</label>
                <input
                  className="personnel-form__input"
                  value={draft.id}
                  disabled={!isNew}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  placeholder="MTF-N7-04"
                />
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Codename</label>
                <input
                  className="personnel-form__input"
                  value={draft.codename}
                  onChange={(e) => setDraft({ ...draft, codename: e.target.value })}
                  placeholder="AGENT-7"
                />
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Rôle</label>
                <select
                  className="personnel-form__select"
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Niveau d'habilitation</label>
                <select
                  className="personnel-form__select"
                  value={draft.clearance_level}
                  onChange={(e) =>
                    setDraft({ ...draft, clearance_level: Number(e.target.value) })
                  }
                >
                  {CLEARANCE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      Niveau {l}
                      {l === 5 ? " (O5)" : ""}
                      {l === 0 ? " (Classe D)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Site d'affectation</label>
                <select
                  className="personnel-form__select"
                  value={draft.site}
                  onChange={(e) => setDraft({ ...draft, site: e.target.value })}
                >
                  {SITES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="personnel-form__field">
                <label className="personnel-form__label">Statut</label>
                <select
                  className="personnel-form__select"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="personnel-form__actions">
                {!isNew && (
                  <button
                    type="button"
                    className="personnel-form__btn personnel-form__btn--delete"
                    onClick={onDelete}
                  >
                    Supprimer
                  </button>
                )}
                <button
                  type="button"
                  className="personnel-form__btn personnel-form__btn--cancel"
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(null);
                  }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="personnel-form__btn personnel-form__btn--save"
                  disabled={!draft.id.trim() || !draft.codename.trim()}
                >
                  {isNew ? "Enregistrer" : "Sauvegarder"}
                </button>
              </div>
            </form>
          ) : (
            <div
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                textAlign: "center",
                padding: 24,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontSize: "0.72rem",
              }}
            >
              // Sélectionnez une ligne ou créez-en une
              <p style={{ marginTop: 12, fontSize: "0.65rem", lineHeight: 1.6 }}>
                Les incidents résolus déclarent des Classes D en KIA.
                <br />
                MTF et chercheurs ne sont pas touchés automatiquement.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
