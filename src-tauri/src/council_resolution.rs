//! Exécution des décisions du Conseil O5 — effets réels sur SCP, sites, effectifs.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::database::{
    now_iso, rand_u32, top_up_site_staffing, DbState, Incident, Motion, SITE_MIN_NON_CLASS_D,
    SITE_MIN_TOTAL,
};
use crate::ollama;
use crate::player_sites;

#[derive(Debug, Serialize, Clone)]
pub struct EffectReport {
    pub action_type: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct CouncilVoteResult {
    pub motion: Motion,
    pub resolution_summary: Option<String>,
    pub resolution_effects: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResolutionPlan {
    summary: String,
    actions: Vec<ResolutionAction>,
}

#[derive(Debug, Deserialize)]
struct ResolutionAction {
    #[serde(rename = "type")]
    action_type: String,
    #[serde(default)]
    scp_id: Option<String>,
    #[serde(default)]
    site: Option<String>,
    #[serde(default)]
    site_name: Option<String>,
    #[serde(default)]
    site_designation: Option<String>,
    #[serde(default)]
    object_class: Option<String>,
    #[serde(default)]
    containment_status: Option<String>,
    #[serde(default)]
    containment_procedures: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

struct ResolutionContext {
    winning_label: String,
    incident: Option<Incident>,
    incident_json: String,
    scp_catalog: String,
    sites_catalog: String,
}

fn gather_resolution_context(
    conn: &Connection,
    motion: &Motion,
    winning_option_id: &str,
) -> Result<ResolutionContext, String> {
    let winning_label = winning_option_label(motion, winning_option_id);
    let incident = load_context_incident(conn, motion.context.as_deref());
    let scp_ids = list_scp_ids(conn)?;
    let sites = list_foundation_site_ids(conn)?;
    let incident_json = incident
        .as_ref()
        .map(|i| {
            serde_json::json!({
                "id": i.id,
                "scp_id": i.scp_id,
                "site": i.site,
                "severity": i.severity,
                "title": i.title,
            })
            .to_string()
        })
        .unwrap_or_else(|| "{}".into());
    Ok(ResolutionContext {
        winning_label,
        incident,
        incident_json,
        scp_catalog: scp_ids.join(", "),
        sites_catalog: sites.join(", "),
    })
}

async fn plan_council_resolution(
    motion: &Motion,
    winning_option_id: &str,
    ctx: &ResolutionContext,
    wiki_lore: &str,
) -> ResolutionPlan {
    let prompt = ollama::build_council_resolution_prompt(
        &motion.id,
        &motion.title,
        &motion.description,
        &motion.category,
        motion.context.as_deref().unwrap_or("—"),
        winning_option_id,
        &ctx.winning_label,
        &ctx.incident_json,
        &ctx.scp_catalog,
        &ctx.sites_catalog,
        wiki_lore,
    );

    match ollama::call_ollama_json(prompt).await {
        Ok(json) => parse_resolution_plan(&json),
        Err(e) => {
            eprintln!("[OVERSEER] Résolution IA échouée, heuristiques : {}", e);
            heuristic_plan(motion, winning_option_id, &ctx.winning_label, &ctx.incident)
        }
    }
}

pub async fn apply_council_resolution(
    state: &DbState,
    motion: &Motion,
    winning_option_id: &str,
) -> Result<(String, Vec<EffectReport>), String> {
    let ctx = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        gather_resolution_context(&conn, motion, winning_option_id)?
    };
    let incident = ctx.incident.clone();
    let wiki_lore = if let Some(ref inc) = ctx.incident {
        crate::scp_wiki::wiki_context_block(state, &inc.scp_id).await
    } else {
        String::new()
    };
    let plan = plan_council_resolution(motion, winning_option_id, &ctx, &wiki_lore).await;

    let mut reports = Vec::new();
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        for action in &plan.actions {
            reports.push(execute_action(&conn, action, &incident));
        }
    }

    Ok((plan.summary, reports))
}

fn winning_option_label(motion: &Motion, option_id: &str) -> String {
    let Ok(opts) = serde_json::from_str::<serde_json::Value>(&motion.options) else {
        return option_id.to_string();
    };
    if let Some(arr) = opts.as_array() {
        for o in arr {
            if o.get("id").and_then(|v| v.as_str()) == Some(option_id) {
                let label = o.get("label").and_then(|v| v.as_str()).unwrap_or(option_id);
                let desc = o.get("description").and_then(|v| v.as_str()).unwrap_or("");
                return format!("{} — {}", label, desc);
            }
        }
    }
    option_id.to_string()
}

fn load_context_incident(conn: &Connection, context: Option<&str>) -> Option<Incident> {
    let ctx = context?.trim();
    if ctx.is_empty() || !ctx.starts_with("INC-") {
        return None;
    }
    conn.query_row(
        "SELECT id, scp_id, site, severity, title, description, casualties, recommended_action,
                containment_status, o5_response, field_report, status, timestamp, resolved_at
         FROM incidents WHERE id = ?1",
        params![ctx],
        |row| {
            Ok(Incident {
                id: row.get(0)?,
                scp_id: row.get(1)?,
                site: row.get(2)?,
                severity: row.get(3)?,
                title: row.get(4)?,
                description: row.get(5)?,
                casualties: row.get(6)?,
                recommended_action: row.get(7)?,
                containment_status: row.get(8)?,
                o5_response: row.get(9)?,
                field_report: row.get(10)?,
                status: row.get(11)?,
                timestamp: row.get(12)?,
                resolved_at: row.get(13)?,
            })
        },
    )
    .ok()
}

fn list_scp_ids(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM scps ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn list_foundation_site_ids(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM foundation_sites ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn parse_resolution_plan(json: &str) -> ResolutionPlan {
    if let Ok(plan) = serde_json::from_str::<ResolutionPlan>(json) {
        if !plan.actions.is_empty() {
            return plan;
        }
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
        if let Some(actions) = v.get("actions").and_then(|a| a.as_array()) {
            let parsed: Vec<ResolutionAction> = actions
                .iter()
                .filter_map(|a| serde_json::from_value(a.clone()).ok())
                .collect();
            let summary = v
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("Décision du Conseil enregistrée.")
                .to_string();
            if !parsed.is_empty() {
                return ResolutionPlan {
                    summary,
                    actions: parsed,
                };
            }
        }
    }
    ResolutionPlan {
        summary: "Aucune action structurée extraite.".into(),
        actions: vec![ResolutionAction {
            action_type: "NO_OP".into(),
            scp_id: None,
            site: None,
            site_name: None,
            site_designation: None,
            object_class: None,
            containment_status: None,
            containment_procedures: None,
            name: None,
            description: None,
            note: Some("Plan vide".into()),
        }],
    }
}

fn heuristic_plan(
    motion: &Motion,
    option_id: &str,
    winning_label: &str,
    incident: &Option<Incident>,
) -> ResolutionPlan {
    let mut actions = Vec::new();
    let lower = format!(
        "{} {} {}",
        motion.title.to_lowercase(),
        motion.description.to_lowercase(),
        winning_label.to_lowercase()
    );

    if let Some(inc) = incident {
        if lower.contains("transfert") || lower.contains("transfer") || lower.contains("site") {
            let new_site = extract_site_from_text(winning_label)
                .or_else(|| extract_site_from_text(&motion.description))
                .unwrap_or_else(|| "SITE-██-2".to_string());
            actions.push(ResolutionAction {
                action_type: "TRANSFER_SCP".into(),
                scp_id: Some(inc.scp_id.clone()),
                site: Some(new_site),
                site_name: None,
                site_designation: None,
                object_class: None,
                containment_status: None,
                containment_procedures: None,
                name: None,
                description: None,
                note: None,
            });
        }
        if lower.contains("keter") || lower.contains("reclass") {
            actions.push(ResolutionAction {
                action_type: "UPDATE_SCP_CLASS".into(),
                scp_id: Some(inc.scp_id.clone()),
                site: None,
                site_name: None,
                site_designation: None,
                object_class: Some("KETER".into()),
                containment_status: None,
                containment_procedures: None,
                name: None,
                description: None,
                note: None,
            });
        }
        if lower.contains("brèche") || lower.contains("breach") {
            actions.push(ResolutionAction {
                action_type: "UPDATE_SCP_CONTAINMENT_STATUS".into(),
                scp_id: Some(inc.scp_id.clone()),
                site: None,
                site_name: None,
                site_designation: None,
                object_class: None,
                containment_status: Some("BREACH".into()),
                containment_procedures: None,
                name: None,
                description: None,
                note: None,
            });
        }
    }

    if lower.contains("nouveau site")
        || lower.contains("créer un site")
        || lower.contains("create site")
    {
        let site_id = extract_site_from_text(winning_label)
            .unwrap_or_else(|| format!("SITE-{}", (rand_u32() % 80) + 20));
        actions.push(ResolutionAction {
            action_type: "CREATE_SITE".into(),
            scp_id: None,
            site: Some(site_id.clone()),
            site_name: Some(site_id.replace("SITE-", "Site-")),
            site_designation: Some("Site créé par décision du Conseil O5".into()),
            object_class: None,
            containment_status: None,
            containment_procedures: None,
            name: None,
            description: None,
            note: None,
        });
        actions.push(ResolutionAction {
            action_type: "ASSIGN_SITE_TO_PLAYER".into(),
            scp_id: None,
            site: Some(site_id),
            site_name: None,
            site_designation: None,
            object_class: None,
            containment_status: None,
            containment_procedures: None,
            name: None,
            description: None,
            note: None,
        });
    }

    if actions.is_empty() {
        actions.push(ResolutionAction {
            action_type: "NO_OP".into(),
            scp_id: None,
            site: None,
            site_name: None,
            site_designation: None,
            object_class: None,
            containment_status: None,
            containment_procedures: None,
            name: None,
            description: None,
            note: Some(format!(
                "Option {} — aucune heuristique correspondante",
                option_id
            )),
        });
    }

    ResolutionPlan {
        summary: format!(
            "Décision {} appliquée (mode procédural). {}",
            option_id, winning_label
        ),
        actions,
    }
}

fn extract_site_from_text(text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        let w = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '█');
        if w.starts_with("SITE-") || w.starts_with("AREA-") || w.starts_with("OUTPOST-") {
            return Some(w.to_string());
        }
    }
    None
}

fn execute_action(
    conn: &Connection,
    action: &ResolutionAction,
    incident: &Option<Incident>,
) -> EffectReport {
    let t = action.action_type.to_uppercase().replace(' ', "_");
    match t.as_str() {
        "TRANSFER_SCP" | "MOVE_SCP" | "RELOCATE_SCP" => {
            let scp_id = action
                .scp_id
                .clone()
                .or_else(|| incident.as_ref().map(|i| i.scp_id.clone()));
            let site = action.site.clone().filter(|s| !s.is_empty());
            match (scp_id, site) {
                (Some(id), Some(site)) => match conn
                    .execute("UPDATE scps SET site = ?1 WHERE id = ?2", params![site, id])
                {
                    Ok(n) if n > 0 => EffectReport {
                        action_type: t.clone(),
                        status: "OK".into(),
                        detail: format!("{} transféré vers {}", id, site),
                    },
                    Ok(_) => EffectReport {
                        action_type: t.clone(),
                        status: "SKIPPED".into(),
                        detail: format!("SCP {} introuvable", id),
                    },
                    Err(e) => EffectReport {
                        action_type: t.clone(),
                        status: "FAILED".into(),
                        detail: e.to_string(),
                    },
                },
                _ => EffectReport {
                    action_type: t.clone(),
                    status: "SKIPPED".into(),
                    detail: "scp_id ou site manquant".into(),
                },
            }
        }
        "CREATE_SITE" | "REGISTER_SITE" => {
            let site_id = action
                .site
                .clone()
                .unwrap_or_else(|| format!("SITE-{}", rand_u32() % 900 + 100));
            let name = action.site_name.clone().unwrap_or_else(|| site_id.clone());
            let designation = action
                .site_designation
                .clone()
                .unwrap_or_else(|| "Installation Foundation — mandat Conseil O5".into());
            match conn.execute(
                "INSERT OR IGNORE INTO foundation_sites (id, name, designation) VALUES (?1, ?2, ?3)",
                params![site_id, name, designation],
            ) {
                Ok(_) => EffectReport {
                    action_type: t.clone(),
                    status: "OK".into(),
                    detail: format!("Site {} enregistré au catalogue Foundation", site_id),
                },
                Err(e) => EffectReport {
                    action_type: t.clone(),
                    status: "FAILED".into(),
                    detail: e.to_string(),
                },
            }
        }
        "ASSIGN_SITE_TO_PLAYER" | "ASSIGN_PLAYER_SITE" | "MANDATE_SITE" => {
            let site_id = action.site.clone().filter(|s| !s.is_empty());
            match site_id {
                Some(id) => {
                    let _ = player_sites::assign_site_internal(conn, &id, "COUNCIL");
                    let _ = top_up_site_staffing(conn, &id, SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D);
                    EffectReport {
                        action_type: t.clone(),
                        status: "OK".into(),
                        detail: format!("{} ajouté à votre mandat de supervision", id),
                    }
                }
                None => EffectReport {
                    action_type: t.clone(),
                    status: "SKIPPED".into(),
                    detail: "site manquant".into(),
                },
            }
        }
        "UPDATE_SCP_CLASS" | "RECLASSIFY_SCP" | "SET_SCP_CLASS" => {
            let scp_id = action
                .scp_id
                .clone()
                .or_else(|| incident.as_ref().map(|i| i.scp_id.clone()));
            let class = action
                .object_class
                .clone()
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| "KETER".into());
            match scp_id {
                Some(id) => match conn.execute(
                    "UPDATE scps SET object_class = ?1 WHERE id = ?2",
                    params![class.to_uppercase(), id],
                ) {
                    Ok(n) if n > 0 => EffectReport {
                        action_type: t.clone(),
                        status: "OK".into(),
                        detail: format!("{} reclassé {}", id, class),
                    },
                    Ok(_) => EffectReport {
                        action_type: t.clone(),
                        status: "SKIPPED".into(),
                        detail: format!("SCP {} introuvable", id),
                    },
                    Err(e) => EffectReport {
                        action_type: t.clone(),
                        status: "FAILED".into(),
                        detail: e.to_string(),
                    },
                },
                None => EffectReport {
                    action_type: t.clone(),
                    status: "SKIPPED".into(),
                    detail: "scp_id manquant".into(),
                },
            }
        }
        "UPDATE_SCP_CONTAINMENT_STATUS" | "SET_CONTAINMENT_STATUS" => {
            let scp_id = action
                .scp_id
                .clone()
                .or_else(|| incident.as_ref().map(|i| i.scp_id.clone()));
            let status = action
                .containment_status
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "BREACH".into());
            let status_upper = status.to_uppercase();
            let normalized = match status_upper.as_str() {
                "BREACH" => "BREACH",
                "CONTAINED" => "CONTAINED",
                "PENDING" => "PENDING",
                "LOST" => "LOST",
                "MONITORING" => "CONTAINED",
                other => other,
            };
            match scp_id {
                Some(id) => match conn.execute(
                    "UPDATE scps SET containment_status = ?1 WHERE id = ?2",
                    params![normalized, id],
                ) {
                    Ok(n) if n > 0 => EffectReport {
                        action_type: t.clone(),
                        status: "OK".into(),
                        detail: format!("{} → statut {}", id, normalized),
                    },
                    Ok(_) => EffectReport {
                        action_type: t.clone(),
                        status: "SKIPPED".into(),
                        detail: format!("SCP {} introuvable", id),
                    },
                    Err(e) => EffectReport {
                        action_type: t.clone(),
                        status: "FAILED".into(),
                        detail: e.to_string(),
                    },
                },
                None => EffectReport {
                    action_type: t.clone(),
                    status: "SKIPPED".into(),
                    detail: "scp_id manquant".into(),
                },
            }
        }
        "UPDATE_CONTAINMENT_PROCEDURES" | "UPDATE_SCP_PROCEDURES" => {
            let scp_id = action.scp_id.clone();
            let proc = action.containment_procedures.clone();
            match (scp_id, proc) {
                (Some(id), Some(p)) if !p.is_empty() => match conn.execute(
                    "UPDATE scps SET containment_procedures = ?1 WHERE id = ?2",
                    params![p, id],
                ) {
                    Ok(n) if n > 0 => EffectReport {
                        action_type: t.clone(),
                        status: "OK".into(),
                        detail: format!("Procédures de {} mises à jour", id),
                    },
                    Ok(_) => EffectReport {
                        action_type: t.clone(),
                        status: "SKIPPED".into(),
                        detail: format!("SCP {} introuvable", id),
                    },
                    Err(e) => EffectReport {
                        action_type: t.clone(),
                        status: "FAILED".into(),
                        detail: e.to_string(),
                    },
                },
                _ => EffectReport {
                    action_type: t.clone(),
                    status: "SKIPPED".into(),
                    detail: "scp_id ou procédures manquants".into(),
                },
            }
        }
        "CREATE_SCP" | "REGISTER_SCP" => {
            let id = action
                .scp_id
                .clone()
                .unwrap_or_else(|| format!("SCP-{}", (rand_u32() % 1000) + 9000));
            let name = action
                .name
                .clone()
                .unwrap_or_else(|| "Objet du Conseil".into());
            let class = action
                .object_class
                .clone()
                .unwrap_or_else(|| "EUCLIDE".into());
            let site = action.site.clone().unwrap_or_else(|| "SITE-19".into());
            let proc = action
                .containment_procedures
                .clone()
                .unwrap_or_else(|| "Procédures établies par décision du Conseil O5.".into());
            let desc = action
                .description
                .clone()
                .unwrap_or_else(|| "Objet créé suite à une motion du Conseil O5.".into());
            let now = now_iso();
            match conn.execute(
                "INSERT OR REPLACE INTO scps
                    (id, name, object_class, site, containment_procedures, description, created_by, created_at, containment_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'COUNCIL', ?7, 'CONTAINED')",
                params![id, name, class.to_uppercase(), site, proc, desc, now],
            ) {
                Ok(_) => EffectReport {
                    action_type: t.clone(),
                    status: "OK".into(),
                    detail: format!("Dossier {} créé ({})", id, class),
                },
                Err(e) => EffectReport {
                    action_type: t.clone(),
                    status: "FAILED".into(),
                    detail: e.to_string(),
                },
            }
        }
        "STAFF_SITE" | "TOP_UP_STAFFING" | "REINFORCE_PERSONNEL" => {
            let site = action.site.clone().unwrap_or_else(|| "SITE-19".into());
            match top_up_site_staffing(conn, &site, SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D) {
                Ok(_) => EffectReport {
                    action_type: t.clone(),
                    status: "OK".into(),
                    detail: format!("Effectifs de {} complétés", site),
                },
                Err(e) => EffectReport {
                    action_type: t.clone(),
                    status: "FAILED".into(),
                    detail: e.to_string(),
                },
            }
        }
        "NO_OP" | "NONE" => EffectReport {
            action_type: t.clone(),
            status: "OK".into(),
            detail: action
                .note
                .clone()
                .unwrap_or_else(|| "Aucun changement opérationnel".into()),
        },
        other => EffectReport {
            action_type: other.to_string(),
            status: "SKIPPED".into(),
            detail: "Type d'action non reconnu".into(),
        },
    }
}

pub fn save_resolution_on_motion(
    conn: &Connection,
    motion_id: &str,
    summary: &str,
    reports: &[EffectReport],
) -> Result<(), String> {
    let effects_json = serde_json::to_string(reports).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE motions SET resolution_summary = ?1, resolution_effects = ?2 WHERE id = ?3",
        params![summary, effects_json, motion_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
