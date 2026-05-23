import { useEffect, useMemo, useState } from "react";
import { ClassifiedPanel } from "../components/institutional/ClassifiedPanel";
import { RedactedParagraph } from "../components/institutional/Redacted";
import { formatLogTime } from "../data/mockData";
import { useIncidentStore } from "../stores/incidentStore";
import type {
  FieldReportOutcome,
  Incident,
  IncidentStatus,
} from "../types/incident";
import "../styles/incidents.css";

/* ==========================================================================
   Page principale
   ========================================================================== */

export function Incidents() {
  const incidents = useIncidentStore((s) => s.incidents);
  const activeIncidentId = useIncidentStore((s) => s.activeIncidentId);
  const selectIncident = useIncidentStore((s) => s.selectIncident);
  const generateIncident = useIncidentStore((s) => s.generateIncident);
  const isGenerating = useIncidentStore((s) => s.isGenerating);

  // Sélectionne automatiquement le premier incident actif si rien n'est sélectionné.
  useEffect(() => {
    if (activeIncidentId) return;
    const firstActive = incidents.find(
      (i) => i.status === "ACTIVE" || i.status === "PENDING_RESPONSE",
    );
    if (firstActive) selectIncident(firstActive.id);
    else if (incidents.length > 0) selectIncident(incidents[0].id);
  }, [activeIncidentId, incidents, selectIncident]);

  const selected = useMemo(
    () => incidents.find((i) => i.id === activeIncidentId) ?? null,
    [incidents, activeIncidentId],
  );

  return (
    <div className="incidents-page">
      <header className="incidents-page__header">
        <h1>Incidents</h1>
        <button
          type="button"
          className="incidents-page__generate"
          disabled={isGenerating}
          onClick={() => void generateIncident()}
        >
          {isGenerating ? "// Rapport en cours..." : "+ Déclarer incident"}
        </button>
      </header>

      <div className="incidents-page__body">
        <div className="scp-panel">
          <IncidentList
            incidents={incidents}
            selectedId={activeIncidentId}
            onSelect={selectIncident}
          />
        </div>
        <div className="scp-panel">
          <IncidentDetail incident={selected} />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   IncidentList
   ========================================================================== */

const STATUS_DOT_CLASS: Record<IncidentStatus, string> = {
  ACTIVE: "incident-list__status-dot--active",
  PENDING_RESPONSE: "incident-list__status-dot--pending",
  RESOLVED: "incident-list__status-dot--resolved",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  ACTIVE: "● ACTIF",
  PENDING_RESPONSE: "◐ EN COURS",
  RESOLVED: "✓ RÉSOLU",
};

const STATUS_ITEM_CLASS: Record<IncidentStatus, string> = {
  ACTIVE: "is-active",
  PENDING_RESPONSE: "is-pending",
  RESOLVED: "is-resolved",
};

interface IncidentListProps {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function IncidentList({ incidents, selectedId, onSelect }: IncidentListProps) {
  return (
    <div className="incident-list">
      <header className="incident-feed__header">
        <h2>Dossiers</h2>
        <span className="incident-feed__count">{incidents.length}</span>
      </header>
      <ul className="incident-list__list">
        {incidents.map((incident) => {
          const isSelected = incident.id === selectedId;
          return (
            <li
              key={incident.id}
              className={`incident-list__item ${STATUS_ITEM_CLASS[incident.status]}${isSelected ? " is-selected" : ""}`}
              onClick={() => onSelect(incident.id)}
            >
              <span className={`scp-badge ${incident.severity.toLowerCase()}`}>
                {incident.severity}
              </span>
              <div className="incident-list__main">
                <div className="incident-list__top">
                  <span className="incident-list__scp">{incident.scp_id}</span>
                  <span className="incident-list__title">{incident.title}</span>
                </div>
                <div className="incident-list__meta">
                  <span>{incident.site}</span>
                  <span>·</span>
                  <span>{formatLogTime(incident.timestamp)}</span>
                </div>
              </div>
              <span
                className={`incident-list__status-dot ${STATUS_DOT_CLASS[incident.status]}`}
              >
                {STATUS_LABEL[incident.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ==========================================================================
   IncidentDetail — style dossier classifié + interface O5
   ========================================================================== */

interface IncidentDetailProps {
  incident: Incident | null;
}

const OUTCOME_CLASS: Record<FieldReportOutcome, string> = {
  SUCCESS: "incident-detail__field-outcome--success",
  PARTIAL: "incident-detail__field-outcome--partial",
  FAILURE: "incident-detail__field-outcome--failure",
};

const OUTCOME_LABEL: Record<FieldReportOutcome, string> = {
  SUCCESS: "SUCCÈS",
  PARTIAL: "PARTIEL",
  FAILURE: "ÉCHEC",
};

function IncidentDetail({ incident }: IncidentDetailProps) {
  const respond = useIncidentStore((s) => s.respondToIncident);
  const isAwaiting = useIncidentStore(
    (s) => incident && s._awaitingFieldReport.has(incident.id),
  );

  const [draft, setDraft] = useState("");

  // Réinitialise le brouillon quand on change de dossier.
  useEffect(() => {
    setDraft("");
  }, [incident?.id]);

  if (!incident) {
    return (
      <div className="incident-detail">
        <div className="incident-detail__empty">
          // S&Eacute;LECTIONNEZ UN DOSSIER &Agrave; GAUCHE
        </div>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await respond(incident.id, draft.trim());
    setDraft("");
  };

  const canEdit = incident.status === "ACTIVE";

  return (
    <ClassifiedPanel className="incident-detail">
      <div className="incident-detail__inner">
        <header className="incident-detail__header">
          <div className="incident-detail__head-line">
            <span className="incident-detail__num">
              RAPPORT D&rsquo;INCIDENT N&deg; {incident.id}
            </span>
            <span className={`scp-badge ${incident.severity.toLowerCase()}`}>
              {incident.severity}
            </span>
          </div>
          <div className="incident-detail__sub">
            <span className="incident-detail__sub-classif">CLASSIFICATION</span>
            &nbsp;: <span className="redacted">██████████████</span>
            &nbsp;&nbsp;·&nbsp;&nbsp;
            <span>SITE : {incident.site}</span>
            &nbsp;·&nbsp;
            <span>
              DATE : <span className="redacted">██-██-████</span>{" "}
              {formatLogTime(incident.timestamp)}
            </span>
          </div>
        </header>

        <section className="incident-detail__section">
          <div className="incident-detail__section-title">Objet</div>
          <div className="incident-detail__section-body">
            <strong style={{ color: "var(--accent-white)" }}>
              {incident.scp_id}
            </strong>{" "}
            &mdash; {incident.title}
          </div>
        </section>

        <section className="incident-detail__section">
          <div className="incident-detail__section-title">
            Description de l&rsquo;incident
          </div>
          {incident.description ? (
            <RedactedParagraph text={incident.description} />
          ) : (
            <div className="incident-detail__section-body">
              <span className="redacted">
                ████████████████████████████████████████
              </span>
            </div>
          )}
        </section>

        <p className="inst-footer-notice inst-urgent">
          Cet incident et votre réponse ont été transmis au Comité O5 et archivés
          sous ref. ████████. Toute falsification constitue une infraction au
          protocole ██.
        </p>

        <div className="incident-detail__inline-fields">
          <section className="incident-detail__section">
            <div className="incident-detail__section-title">Victimes</div>
            <div className="incident-detail__section-body">
              {incident.casualties}
            </div>
          </section>
          <section className="incident-detail__section">
            <div className="incident-detail__section-title">
              Statut confinement
            </div>
            <div className="incident-detail__section-body">
              {incident.containment_status}
            </div>
          </section>
        </div>

        <section className="incident-detail__section">
          <div className="incident-detail__section-title">
            Action recommand&eacute;e
          </div>
          <div className="incident-detail__section-body">
            {incident.recommended_action || "—"}
          </div>
        </section>

        {/* --- Bloc réponse O5 --- */}
        <section className="incident-detail__o5">
          <div className="incident-detail__o5-title">
            R&Eacute;PONSE O5-1
          </div>

          {incident.o5_response ? (
            <div className="incident-detail__o5-saved">
              &gt; {incident.o5_response}
            </div>
          ) : canEdit ? (
            <form className="incident-detail__form" onSubmit={onSubmit}>
              <textarea
                className="incident-detail__textarea"
                placeholder="Saisissez vos ordres, O5-1..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              <div className="incident-detail__form-row">
                <span className="incident-detail__hint">
                  Transmission s&eacute;curis&eacute;e &mdash; AES-256
                </span>
                <button
                  type="submit"
                  className="incident-detail__submit"
                  disabled={!draft.trim()}
                >
                  Transmettre &#9654;
                </button>
              </div>
            </form>
          ) : (
            <div className="incident-detail__hint">
              // Aucune r&eacute;ponse requise &mdash; dossier {incident.status}
            </div>
          )}
        </section>

        {/* --- Bloc rapport de terrain --- */}
        {isAwaiting && (
          <div className="incident-detail__awaiting blink-cursor">
            Rapport de terrain en cours de transmission
          </div>
        )}

        {incident.field_report && (
          <section className="incident-detail__field-report">
            <div className="incident-detail__field-title">
              <span>Rapport de terrain</span>
              <span className="incident-detail__field-agent">
                &mdash; {incident.field_report.agent}
              </span>
            </div>
            <div className="incident-detail__field-body">
              {incident.field_report.report}
            </div>
            <div className="incident-detail__field-meta">
              <span
                className={OUTCOME_CLASS[incident.field_report.outcome]}
              >
                ISSUE : {OUTCOME_LABEL[incident.field_report.outcome]}
              </span>
              <span>· VICTIMES : {incident.field_report.casualties_update}</span>
              <span>
                · CONFINEMENT :{" "}
                {incident.field_report.containment_restored
                  ? "RESTAUR\u00c9"
                  : "INSTABLE"}
              </span>
            </div>
          </section>
        )}
      </div>
    </ClassifiedPanel>
  );
}

