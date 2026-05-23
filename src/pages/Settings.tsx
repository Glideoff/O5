import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useUpdateStore } from "../stores/updateStore";
import { useInstitutionalStore } from "../stores/institutionalStore";
import "../styles/settings.css";

/* ==========================================================================
   Page Settings
   ========================================================================== */

export function Settings() {
  const s = useSettingsStore();
  const currentVersion = useUpdateStore((st) => st.currentVersion);
  const updateStatus = useUpdateStore((st) => st.status);
  const lastCheckedAt = useUpdateStore((st) => st.lastCheckedAt);
  const checkForUpdates = useUpdateStore((st) => st.checkForUpdates);
  const auditSummary = useInstitutionalStore((st) => st.auditSummary);
  const [models, setModels] = useState<string[]>([]);

  // Charge la liste des modèles Ollama au mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<string[]>("list_ollama_models");
        if (!cancelled) setModels(list);
      } catch {
        if (!cancelled) setModels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-page">
      <h1>Paramètres</h1>
      <div className="settings-page__sub">
        // Configuration sauvegardée automatiquement en local
      </div>

      {/* --- IDENTITÉ --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Identité Foundation</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Votre identifiant O5</label>
            <input
              className="settings-input"
              value={s.o5_id}
              onChange={(e) => s.update("o5_id", e.target.value)}
              placeholder="O5-1"
            />
            <div className="settings-field__hint">
              Affiché dans la topbar et utilisé pour signer vos ordres
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Site actif (affichage)</label>
            <input
              className="settings-input"
              value={s.site_name}
              readOnly
              placeholder="SITE-██"
            />
            <div className="settings-field__hint">
              Géré depuis Mes Sites — réclamation, retrait (min. 1) et site actif
            </div>
          </div>
        </div>
      </section>

      {/* --- INCIDENT ENGINE --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Incident Engine</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Fréquence des incidents</label>
            <select
              className="settings-select"
              value={s.incident_frequency}
              onChange={(e) =>
                s.update(
                  "incident_frequency",
                  e.target.value as "rare" | "normal" | "frequent",
                )
              }
            >
              <option value="rare">Rare (1 à 3h)</option>
              <option value="normal">Normal (20 à 60 min)</option>
              <option value="frequent">Fréquent (5 à 20 min)</option>
            </select>
            <div className="settings-field__hint">
              Pris en compte au prochain redémarrage du timer
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Sévérité maximale autorisée</label>
            <select
              className="settings-select"
              value={s.severity_max}
              onChange={(e) =>
                s.update(
                  "severity_max",
                  e.target.value as "SAFE" | "EUCLIDE" | "KETER",
                )
              }
            >
              <option value="SAFE">SAFE uniquement</option>
              <option value="EUCLIDE">Jusqu'à EUCLIDE</option>
              <option value="KETER">Jusqu'à KETER (par défaut)</option>
            </select>
            <div className="settings-field__hint">
              Filtre les incidents auto-générés au-delà de ce niveau
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Modèle Ollama</label>
            <select
              className="settings-select"
              value={s.ollama_model}
              onChange={(e) => s.update("ollama_model", e.target.value)}
            >
              <option value="auto">Auto-détection (recommandé)</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="settings-field__hint">
              {models.length === 0
                ? "Aucun modèle détecté — Ollama hors ligne ou aucun pull"
                : `${models.length} modèle${models.length > 1 ? "s" : ""} disponible${models.length > 1 ? "s" : ""}`}
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Langue des rapports IA</label>
            <select className="settings-select" value={s.ai_language} disabled>
              <option value="fr">Français</option>
            </select>
            <div className="settings-field__hint">
              Rapports Foundation générés en français
            </div>
          </div>
        </div>
      </section>

      {/* --- EFFECTIFS --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Effectifs par site</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Effectif minimum total</label>
            <input
              className="settings-input"
              type="number"
              min={10}
              max={500}
              value={s.site_min_total}
              onChange={(e) =>
                s.update("site_min_total", Math.max(10, Number(e.target.value) || 50))
              }
            />
            <div className="settings-field__hint">
              Chaque site doit compter au moins ce nombre d&apos;effectifs actifs (défaut : 50)
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field__label">Minimum hors Classes D</label>
            <input
              className="settings-input"
              type="number"
              min={5}
              max={200}
              value={s.site_min_non_class_d}
              onChange={(e) =>
                s.update(
                  "site_min_non_class_d",
                  Math.max(5, Number(e.target.value) || 20),
                )
              }
            />
            <div className="settings-field__hint">
              Garde MTF, chercheurs et O5 — les Classes D ne comptent pas dans ce quota (défaut : 20)
            </div>
          </div>
        </div>
      </section>

      {/* --- INTERFACE --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Interface</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Effet scanlines (CRT)</label>
            <div
              className={`settings-toggle${s.scanlines ? " is-on" : ""}`}
              onClick={() => s.update("scanlines", !s.scanlines)}
            >
              <div className="settings-toggle__track">
                <div className="settings-toggle__thumb" />
              </div>
              <span className="settings-toggle__label">
                {s.scanlines ? "Activé" : "Désactivé"}
              </span>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Intensité vignette</label>
            <div className="settings-slider">
              <input
                className="settings-slider__input"
                type="range"
                min={0}
                max={100}
                value={s.vignette_intensity}
                onChange={(e) =>
                  s.update("vignette_intensity", Number(e.target.value))
                }
              />
              <span className="settings-slider__value">
                {s.vignette_intensity}%
              </span>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Sons</label>
            <div
              className={`settings-toggle${s.sounds_enabled ? " is-on" : ""}`}
              onClick={() => s.update("sounds_enabled", !s.sounds_enabled)}
            >
              <div className="settings-toggle__track">
                <div className="settings-toggle__thumb" />
              </div>
              <span className="settings-toggle__label">
                {s.sounds_enabled ? "Activés (Phase 6.2)" : "Désactivés"}
              </span>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Volume sonore</label>
            <div className="settings-slider">
              <input
                className="settings-slider__input"
                type="range"
                min={0}
                max={100}
                value={s.sound_volume}
                disabled={!s.sounds_enabled}
                onChange={(e) =>
                  s.update("sound_volume", Number(e.target.value))
                }
              />
              <span className="settings-slider__value">
                {s.sound_volume}%
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* --- MISES À JOUR --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Mises à jour</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Version installée</label>
            <div className="settings-field__hint" style={{ color: "var(--accent-red-glow)" }}>
              OVERSEER v{currentVersion}
              {lastCheckedAt && (
                <span> — dernière vérif. {new Date(lastCheckedAt).toLocaleString("fr-FR")}</span>
              )}
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Mises à jour automatiques</label>
            <button
              type="button"
              className={`settings-toggle${s.auto_update ? " is-on" : ""}`}
              onClick={() => s.update("auto_update", !s.auto_update)}
            >
              <span className="settings-toggle__knob" />
              <span className="settings-toggle__label">
                {s.auto_update ? "Activé" : "Désactivé"}
              </span>
            </button>
            <div className="settings-field__hint">
              Si une version plus récente est publiée, téléchargement et installation
              automatiques puis redémarrage.
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Vérifier au démarrage</label>
            <button
              type="button"
              className={`settings-toggle${s.update_check_enabled ? " is-on" : ""}`}
              onClick={() => s.update("update_check_enabled", !s.update_check_enabled)}
            >
              <span className="settings-toggle__knob" />
              <span className="settings-toggle__label">
                {s.update_check_enabled ? "Activé" : "Désactivé"}
              </span>
            </button>
          </div>

          <div className="settings-field">
            <button
              type="button"
              className="settings-reset"
              style={{ marginTop: 4 }}
              onClick={() => void checkForUpdates({ silent: false, autoInstall: false })}
            >
              Vérifier maintenant
            </button>
            {updateStatus === "checking" && (
              <div className="settings-field__hint">// Recherche en cours…</div>
            )}
            {import.meta.env.DEV && (
              <div className="settings-field__hint">
                Les mises à jour ne fonctionnent qu&apos;avec l&apos;installateur de production
                (pas en mode dev).
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- RÉSEAU --- */}
      <section className="scp-panel settings-section">
        <h2 className="settings-section__title">Réseau</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <label className="settings-field__label">Port WebSocket OVERSEER</label>
            <input
              className="settings-input"
              type="number"
              min={1024}
              max={65535}
              value={s.ws_port}
              onChange={(e) => s.update("ws_port", Number(e.target.value))}
            />
            <div className="settings-field__hint">
              Défaut : 47474. En mode serveur, l&apos;hôte écoute sur ce port (magic link / LAN).
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field__label">Mode opérationnel</label>
            <select
              className="settings-select"
              value={s.network_mode}
              onChange={(e) =>
                s.update("network_mode", e.target.value as "server" | "client")
              }
            >
              <option value="server">Serveur (O5)</option>
              <option value="client">Client (Agent / MTF / Chercheur)</option>
            </select>
            <div className="settings-field__hint">
              Serveur : génère le magic link et accepte les connexions. Client : rejoint via lien
              sans ouvrir de port.
            </div>
          </div>
        </div>
      </section>

      <section className="scp-panel settings-section inst-audit-block">
        <div className="inst-audit-block__title">AUDIT — Les 30 derniers jours</div>
        <p className="inst-body-text" style={{ margin: 0 }}>
          Connexions : {auditSummary.connections} | Actions : {auditSummary.actions}{" "}
          | Incidents traités : {auditSummary.incidentsHandled}
          <br />
          Dernier audit : {auditSummary.lastAudit} — Aucune anomalie détectée.
        </p>
      </section>

      <div className="settings-footer">
        <span className="settings-saved-hint">// Sauvegardé automatiquement</span>
        <button
          type="button"
          className="settings-reset"
          onClick={() => {
            if (confirm("Réinitialiser tous les paramètres aux valeurs par défaut ?")) {
              s.reset();
            }
          }}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
