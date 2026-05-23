import { useEffect, useMemo, useState } from "react";
import { formatLogTime } from "../data/mockData";
import { getO5 } from "../data/o5Council";
import { useCouncilStore } from "../stores/councilStore";
import {
  parseMotionDebate,
  parseMotionOptions,
  parseMotionTally,
  parseResolutionEffects,
  type Motion,
  type MotionOption,
} from "../types/council";
import "../styles/council.css";

const CATEGORIES = [
  "CONTAINMENT",
  "MTF_DEPLOYMENT",
  "ETHICS",
  "EXPERIMENT",
  "PROTOCOL",
  "OTHER",
] as const;

const OPTION_LETTERS = ["A", "B", "C", "D"];

/* ==========================================================================
   Page principale
   ========================================================================== */

export function Council() {
  const motions = useCouncilStore((s) => s.motions);
  const selectedId = useCouncilStore((s) => s.selectedId);
  const isLoading = useCouncilStore((s) => s.isLoading);
  const lastError = useCouncilStore((s) => s.lastError);
  const loadAll = useCouncilStore((s) => s.loadAll);
  const selectMotion = useCouncilStore((s) => s.selectMotion);

  const [showForm, setShowForm] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Re-poll motions toutes les 10s pour capter les motions auto-créées (KETER → /council)
  useEffect(() => {
    const id = window.setInterval(() => void loadAll(), 10_000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  const selected = useMemo(
    () => motions.find((m) => m.id === selectedId) ?? null,
    [motions, selectedId],
  );

  const openCount = motions.filter((m) => m.status === "OPEN").length;

  return (
    <div className="council-page">
      <header className="council-header">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1>Conseil O5</h1>
          <span className="council-header__count">
            {openCount} motion{openCount > 1 ? "s" : ""} ouverte
            {openCount > 1 ? "s" : ""} · {motions.length} totales
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="council-header__new"
            onClick={() => {
              setShowStats(!showStats);
              setShowForm(false);
            }}
            style={{ color: "var(--accent-amber)", borderColor: "var(--accent-amber)" }}
          >
            {showStats ? "Fermer stats" : "Statistiques"}
          </button>
          <button
            type="button"
            className="council-header__new"
            onClick={() => {
              setShowForm(true);
              setShowStats(false);
            }}
          >
            + Nouvelle motion
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

      <div className="council-body">
        <div className="scp-panel motion-list">
          {isLoading && (
            <div className="motion-list__empty">// Chargement...</div>
          )}
          {!isLoading && motions.length === 0 && (
            <div className="motion-list__empty">
              // Aucune motion. Cr&eacute;ez la premi&egrave;re.
            </div>
          )}
          {motions.map((m) => (
            <MotionListItem
              key={m.id}
              motion={m}
              isSelected={m.id === selectedId}
              onClick={() => {
                setShowForm(false);
                selectMotion(m.id);
              }}
            />
          ))}
        </div>

        <div className="scp-panel motion-detail">
          {showStats ? (
            <CouncilStats motions={motions} />
          ) : showForm ? (
            <MotionForm onDone={() => setShowForm(false)} />
          ) : selected ? (
            <MotionDetail motion={selected} />
          ) : (
            <div className="motion-detail__empty">
              // S&Eacute;LECTIONNEZ UNE MOTION OU CR&Eacute;EZ-EN UNE
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   List item
   ========================================================================== */

interface MotionListItemProps {
  motion: Motion;
  isSelected: boolean;
  onClick: () => void;
}

function MotionListItem({ motion, isSelected, onClick }: MotionListItemProps) {
  const isOpen = motion.status === "OPEN";
  const isDeadlock = motion.result === "DEADLOCK";

  const dotClass = isOpen
    ? "motion-list__dot--open"
    : isDeadlock
      ? "motion-list__dot--deadlock"
      : "motion-list__dot--resolved";

  const itemClass = `motion-list__item${isSelected ? " is-selected" : ""}${isOpen && !isSelected ? " is-open" : ""}`;

  return (
    <div className={itemClass} onClick={onClick}>
      <span className={`motion-list__dot ${dotClass}`} aria-hidden />
      <div className="motion-list__main">
        <div className="motion-list__id">
          {motion.id}
          {motion.kind === "SOLO" && (
            <span
              style={{
                marginLeft: 6,
                fontSize: "0.55rem",
                color: "var(--accent-amber)",
                border: "1px solid var(--accent-amber)",
                padding: "0 4px",
                borderRadius: 2,
                letterSpacing: "0.15em",
              }}
            >
              SOLO
            </span>
          )}
        </div>
        <div className="motion-list__title">{motion.title}</div>
        <div className="motion-list__status">
          {motion.status === "OPEN"
            ? `OUVERTE · ${motion.category}`
            : isDeadlock
              ? "DEADLOCK"
              : `R\u00c9SOLUE \u2192 ${motion.result}`}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Detail
   ========================================================================== */

interface MotionDetailProps {
  motion: Motion;
}

function MotionDetail({ motion }: MotionDetailProps) {
  const convoke = useCouncilStore((s) => s.convokeCouncil);
  const castVote = useCouncilStore((s) => s.castVote);
  const isGenerating = useCouncilStore((s) => s.isGenerating);
  const isApplying = useCouncilStore((s) => s.isApplying);

  const options = useMemo(() => parseMotionOptions(motion), [motion]);
  const debate = useMemo(() => parseMotionDebate(motion), [motion]);
  const tally = useMemo(() => parseMotionTally(motion), [motion]);
  const effects = useMemo(() => parseResolutionEffects(motion), [motion]);

  const statusForPill =
    motion.status === "RESOLVED" && motion.result === "DEADLOCK"
      ? "DEADLOCK"
      : motion.status;

  return (
    <div>
      <header className="motion-detail__header">
        <div className="motion-detail__head-row">
          <span className="motion-detail__id">{motion.id}</span>
          <span
            className={`motion-detail__status-pill motion-detail__status-pill--${statusForPill}`}
          >
            {motion.status === "OPEN"
              ? "OUVERTE"
              : motion.result === "DEADLOCK"
                ? "DEADLOCK"
                : `RÉSOLUE → ${motion.result}`}
          </span>
        </div>
        <div className="motion-detail__title">{motion.title}</div>
        <div className="motion-detail__meta">
          {motion.category} · CR&Eacute;&Eacute;E {formatLogTime(motion.created_at)}
          {motion.context ? ` · contexte : ${motion.context}` : null}
        </div>
      </header>

      <section className="motion-detail__section">
        <div className="motion-detail__section-title">Description</div>
        <div className="motion-detail__section-body">{motion.description}</div>
      </section>

      <section className="motion-detail__section">
        <div className="motion-detail__section-title">Options soumises au vote</div>
        <div className="motion-options">
          {options.map((opt) => {
            const isWinner =
              motion.status === "RESOLVED" &&
              motion.result === opt.id &&
              motion.result !== "DEADLOCK";
            const count = tally[opt.id] ?? 0;
            return (
              <div
                key={opt.id}
                className={`motion-option ${isWinner ? "motion-option--winner" : ""}`}
              >
                <span className="motion-option__id">{opt.id}</span>
                <div>
                  <div className="motion-option__label">{opt.label}</div>
                  {opt.description && (
                    <div className="motion-option__desc">{opt.description}</div>
                  )}
                </div>
                {motion.status === "RESOLVED" && (
                  <span className="motion-option__count">{count} voix</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Bouton de convocation : COUNCIL uniquement (SOLO va direct au vote) */}
      {motion.status === "OPEN" && motion.kind === "COUNCIL" && !debate && (
        <>
          <button
            type="button"
            className="motion-detail__convoke"
            disabled={isGenerating}
            onClick={() => void convoke(motion.id)}
          >
            {isGenerating ? "// Séance en cours..." : "Convoquer le conseil ▶"}
          </button>
          {isGenerating && (
            <div className="motion-detail__generating">
              // Les membres O5-2 à O5-13 délibèrent...
            </div>
          )}
        </>
      )}

      {debate && (
        <section className="motion-detail__section">
          <div className="motion-detail__section-title">Débat ({debate.statements.length} interventions)</div>
          <div className="debate-timeline">
            {debate.statements.map((s, idx) => (
              <DebateStatement key={`${s.o5_id}-${idx}`} statement={s} />
            ))}
          </div>
        </section>
      )}

      {/* Vote du joueur : pour COUNCIL après débat, pour SOLO directement */}
      {motion.status === "OPEN" && (motion.kind === "SOLO" || debate) && (
        <div className="player-vote">
          <div className="player-vote__title">
            {motion.kind === "SOLO" ? "D\u00e9cision directe O5-1" : "Votre vote (O5-1) \u2014 d\u00e9cisif"}
          </div>
          {isApplying && (
            <div className="motion-detail__generating">
              // Exécution des ordres du Conseil en cours...
            </div>
          )}
          <div className="player-vote__options">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="player-vote__option"
                disabled={isApplying}
                onClick={() => void castVote(motion.id, opt.id)}
              >
                {opt.id} — {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {motion.status === "RESOLVED" && (
        <div
          className={`motion-result ${motion.result === "DEADLOCK" ? "motion-result--deadlock" : ""}`}
        >
          <div className="motion-result__title">Décision finale</div>
          <div className="motion-result__value">
            {motion.result === "DEADLOCK"
              ? "DEADLOCK — Aucune option majoritaire"
              : `Option ${motion.result} adoptée`}
          </div>
          {motion.resolution_summary && (
            <div className="motion-resolution__summary">{motion.resolution_summary}</div>
          )}
          {effects.length > 0 && (
            <ul className="motion-resolution__effects">
              {effects.map((fx, i) => (
                <li
                  key={`${fx.action_type}-${i}`}
                  className={`motion-resolution__fx motion-resolution__fx--${fx.status.toLowerCase()}`}
                >
                  <span className="motion-resolution__fx-type">{fx.action_type}</span>
                  <span>{fx.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {motion.player_vote && (
            <div
              style={{
                marginTop: 6,
                fontSize: "0.65rem",
                color: "var(--text-secondary)",
              }}
            >
              Votre vote : {motion.player_vote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DebateStatement({
  statement,
}: {
  statement: { o5_id: string; content: string; vote: string };
}) {
  const member = getO5(statement.o5_id);
  return (
    <div className="debate-statement">
      <div className="debate-statement__o5">
        <span>{statement.o5_id}</span>
        {member && (
          <span className="debate-statement__o5-codename">
            « {member.codename} »
          </span>
        )}
      </div>
      <div className="debate-statement__content">{statement.content}</div>
      <span className="debate-statement__vote">Vote : {statement.vote}</span>
    </div>
  );
}

/* ==========================================================================
   Form
   ========================================================================== */

interface MotionFormProps {
  onDone: () => void;
}

function MotionForm({ onDone }: MotionFormProps) {
  const create = useCouncilStore((s) => s.createMotion);
  const isCreating = useCouncilStore((s) => s.isCreating);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("CONTAINMENT");
  const [context, setContext] = useState("");
  const [isSolo, setIsSolo] = useState(false);
  const [options, setOptions] = useState<MotionOption[]>([
    { id: "A", label: "" },
    { id: "B", label: "" },
  ]);

  const updateOption = (idx: number, patch: Partial<MotionOption>) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    );
  };

  const addOption = () => {
    if (options.length >= OPTION_LETTERS.length) return;
    setOptions((prev) => [
      ...prev,
      { id: OPTION_LETTERS[prev.length], label: "" },
    ]);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((o, i) => ({ ...o, id: OPTION_LETTERS[i] })),
    );
  };

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    options.every((o) => o.label.trim().length > 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const motion = await create({
      title: title.trim(),
      description: description.trim(),
      category,
      context: context.trim() || null,
      options,
      kind: isSolo ? "SOLO" : "COUNCIL",
    });
    if (motion) onDone();
  };

  return (
    <form className="motion-form" onSubmit={onSubmit}>
      <header className="motion-detail__header" style={{ marginBottom: 4 }}>
        <div className="motion-detail__head-row">
          <span className="motion-detail__id">NOUVELLE MOTION</span>
        </div>
        <div className="motion-detail__meta">
          // À transmettre au Conseil — minimum 2 options
        </div>
      </header>

      <div className="motion-form__field">
        <label className="motion-form__label">Titre</label>
        <input
          className="motion-form__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Transfert de SCP-682 vers SITE-██-2"
        />
      </div>

      <div className="motion-form__field">
        <label className="motion-form__label">Description</label>
        <textarea
          className="motion-form__textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contexte de la motion, contraintes, enjeux..."
        />
      </div>

      <div className="motion-form__field">
        <label className="motion-form__label">Catégorie</label>
        <select
          className="motion-form__select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="motion-form__field">
        <label className="motion-form__label">
          Contexte facultatif (id SCP, id incident)
        </label>
        <input
          className="motion-form__input"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Ex: SCP-682 ou INC-2847"
        />
      </div>

      <div className="motion-form__field">
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            userSelect: "none",
            fontFamily: "var(--font-mono)",
            fontSize: "0.72rem",
            letterSpacing: "0.1em",
            color: "var(--text-primary)",
          }}
        >
          <input
            type="checkbox"
            checked={isSolo}
            onChange={(e) => setIsSolo(e.target.checked)}
          />
          Décision rapide O5-1 (SOLO, sans débat du Conseil)
        </label>
        <span className="settings-field__hint" style={{ marginTop: 4 }}>
          {isSolo
            ? "Vous décidez seul, sans génération IA — instantané."
            : "12 O5 délibèreront avant votre vote décisif (30-90s via Ollama)."}
        </span>
      </div>

      <div className="motion-form__field">
        <label className="motion-form__label">Options à soumettre au vote</label>
        <div className="motion-form__options">
          {options.map((opt, idx) => (
            <div key={opt.id} className="motion-form__option-row">
              <span className="motion-form__option-id">{opt.id}</span>
              <input
                className="motion-form__input"
                value={opt.label}
                onChange={(e) =>
                  updateOption(idx, { label: e.target.value })
                }
                placeholder={`Option ${opt.id}...`}
              />
              <button
                type="button"
                className="motion-form__option-remove"
                onClick={() => removeOption(idx)}
                disabled={options.length <= 2}
              >
                ✕
              </button>
            </div>
          ))}
          {options.length < OPTION_LETTERS.length && (
            <button
              type="button"
              className="motion-form__option-add"
              onClick={addOption}
            >
              + Ajouter une option
            </button>
          )}
        </div>
      </div>

      <div className="motion-form__actions">
        <button
          type="button"
          className="motion-form__cancel"
          onClick={onDone}
        >
          Annuler
        </button>
        <button
          type="submit"
          className="motion-form__submit"
          disabled={!canSubmit || isCreating}
        >
          {isCreating ? "Enregistrement..." : "Créer la motion"}
        </button>
      </div>
    </form>
  );
}

/* ==========================================================================
   Statistiques des O5 — bilan transversal des votes
   ========================================================================== */

interface CouncilStatsProps {
  motions: Motion[];
}

function CouncilStats({ motions }: CouncilStatsProps) {
  const resolved = motions.filter(
    (m) => m.status === "RESOLVED" && m.kind === "COUNCIL",
  );

  const stats = new Map<string, { total: number; votes: Record<string, number> }>();

  for (const m of resolved) {
    const debate = parseMotionDebate(m);
    if (!debate) continue;
    for (const s of debate.statements) {
      if (!stats.has(s.o5_id)) {
        stats.set(s.o5_id, { total: 0, votes: {} });
      }
      const entry = stats.get(s.o5_id)!;
      entry.total += 1;
      entry.votes[s.vote] = (entry.votes[s.vote] ?? 0) + 1;
    }
  }

  const sortedStats = Array.from(stats.entries()).sort(
    (a, b) => b[1].total - a[1].total,
  );

  return (
    <div>
      <header className="motion-detail__header">
        <div className="motion-detail__head-row">
          <span className="motion-detail__id">STATISTIQUES DU CONSEIL</span>
        </div>
        <div className="motion-detail__meta">
          {resolved.length} motion{resolved.length > 1 ? "s" : ""} COUNCIL r&eacute;solue
          {resolved.length > 1 ? "s" : ""} analys&eacute;e
          {resolved.length > 1 ? "s" : ""}
        </div>
      </header>

      {sortedStats.length === 0 ? (
        <div
          style={{
            padding: 24,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.78rem",
            textAlign: "center",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          // Aucune motion COUNCIL r&eacute;solue. Convoquez et r&eacute;solvez pour
          alimenter les stats.
        </div>
      ) : (
        <table className="term-table" style={{ width: "100%", marginTop: 10 }}>
          <thead>
            <tr>
              <th>O5</th>
              <th>Codename</th>
              <th>Participations</th>
              <th>R&eacute;partition des votes</th>
            </tr>
          </thead>
          <tbody>
            {sortedStats.map(([o5_id, data]) => {
              const member = getO5(o5_id);
              const breakdown = Object.entries(data.votes)
                .sort((a, b) => b[1] - a[1])
                .map(([opt, n]) => `${opt}: ${n}`)
                .join("  \u2022  ");
              return (
                <tr key={o5_id}>
                  <td style={{ color: "var(--accent-white)" }}>{o5_id}</td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {member?.codename ?? "\u2014"}
                  </td>
                  <td style={{ color: "var(--accent-cyan)" }}>{data.total}</td>
                  <td style={{ color: "var(--accent-amber)" }}>{breakdown}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {resolved.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="motion-detail__section-title">
            R&eacute;sultats globaux par motion (20 derni&egrave;res)
          </div>
          <table className="term-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Motion</th>
                <th>Type</th>
                <th>R&eacute;solution</th>
                <th>Ton vote</th>
              </tr>
            </thead>
            <tbody>
              {resolved.slice(0, 20).map((m) => (
                <tr key={m.id}>
                  <td style={{ color: "var(--accent-cyan)" }}>{m.id}</td>
                  <td>{m.category}</td>
                  <td
                    style={{
                      color:
                        m.result === "DEADLOCK"
                          ? "var(--accent-red-glow)"
                          : "var(--accent-green)",
                    }}
                  >
                    {m.result}
                  </td>
                  <td style={{ color: "var(--text-primary)" }}>
                    {m.player_vote ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
