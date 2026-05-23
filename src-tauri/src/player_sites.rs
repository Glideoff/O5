//! Supervision multi-sites O5 — affectations, réclamation et retrait.

use rusqlite::{params, Connection, Result as SqlResult};
use serde::Serialize;
use tauri::State;

use crate::database::{
    now_iso, top_up_site_staffing, DbState, SITE_MIN_NON_CLASS_D, SITE_MIN_TOTAL,
};

const DEFAULT_PLAYER_SITE: &str = "SITE-19";

const FOUNDATION_SITES: &[(&str, &str, &str)] = &[
    (
        "SITE-19",
        "Site-19",
        "Installation principale — confinement majeur",
    ),
    ("SITE-17", "Site-17", "Secteur thérapeutique et objets Safe"),
    (
        "SITE-██",
        "Site-██",
        "Emplacement classifié — accès O5 uniquement",
    ),
    (
        "SITE-██-2",
        "Site-██-2",
        "Annexe nord — stockage longue durée",
    ),
    (
        "SITE-63",
        "Site-63",
        "Détention humanoïdes et entités sociales",
    ),
    ("SITE-LV-1", "Site-LV-1", "Zone de luxe — couverture civile"),
    (
        "AREA-12",
        "Area-12",
        "Secteur industriel — tests de confinement",
    ),
    (
        "AREA-51",
        "Area-51",
        "Couverture gouvernementale — rumeurs autorisées",
    ),
    (
        "SITE-██-DEEP",
        "Site-██-DEEP",
        "Niveaux souterrains — accès restreint",
    ),
    (
        "OUTPOST-77",
        "Outpost-77",
        "Avant-poste mobile — surveillance régionale",
    ),
];

#[derive(Debug, Serialize, Clone)]
pub struct PlayerSite {
    pub site_id: String,
    pub name: String,
    pub designation: String,
    pub assigned_at: String,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ClaimableSite {
    pub site_id: String,
    pub name: String,
    pub designation: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SiteAssignmentResult {
    pub sites: Vec<PlayerSite>,
    pub message: String,
    pub newly_assigned: Option<String>,
}

pub fn seed_foundation_sites(conn: &Connection) -> SqlResult<()> {
    for (id, name, designation) in FOUNDATION_SITES {
        conn.execute(
            "INSERT OR IGNORE INTO foundation_sites (id, name, designation) VALUES (?1, ?2, ?3)",
            params![id, name, designation],
        )?;
    }

    let assigned: i64 =
        conn.query_row("SELECT COUNT(*) FROM player_site_assignments", [], |r| {
            r.get(0)
        })?;
    if assigned == 0 {
        conn.execute(
            "INSERT INTO player_site_assignments (site_id, assigned_at, source)
             VALUES (?1, ?2, 'PLAYER')",
            params![DEFAULT_PLAYER_SITE, now_iso()],
        )?;
        let _ = top_up_site_staffing(
            conn,
            DEFAULT_PLAYER_SITE,
            SITE_MIN_TOTAL,
            SITE_MIN_NON_CLASS_D,
        );
    }
    Ok(())
}

fn count_player_sites(conn: &Connection) -> SqlResult<i64> {
    conn.query_row("SELECT COUNT(*) FROM player_site_assignments", [], |r| {
        r.get(0)
    })
}

fn is_assigned(conn: &Connection, site_id: &str) -> SqlResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM player_site_assignments WHERE site_id = ?1",
        params![site_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn foundation_site_exists(conn: &Connection, site_id: &str) -> SqlResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM foundation_sites WHERE id = ?1",
        params![site_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub(crate) fn assign_site_internal(
    conn: &Connection,
    site_id: &str,
    source: &str,
) -> SqlResult<()> {
    if !foundation_site_exists(conn, site_id)? {
        return Ok(());
    }
    if is_assigned(conn, site_id)? {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO player_site_assignments (site_id, assigned_at, source)
         VALUES (?1, ?2, ?3)",
        params![site_id, now_iso(), source],
    )?;
    let _ = top_up_site_staffing(conn, site_id, SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D);
    Ok(())
}

fn row_to_player_site(row: &rusqlite::Row<'_>) -> SqlResult<PlayerSite> {
    Ok(PlayerSite {
        site_id: row.get(0)?,
        name: row.get(1)?,
        designation: row.get(2)?,
        assigned_at: row.get(3)?,
        source: row.get(4)?,
    })
}

pub fn list_player_sites(conn: &Connection) -> SqlResult<Vec<PlayerSite>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.name, f.designation, p.assigned_at, p.source
         FROM player_site_assignments p
         JOIN foundation_sites f ON f.id = p.site_id
         ORDER BY p.assigned_at ASC",
    )?;
    let rows = stmt.query_map([], row_to_player_site)?;
    rows.collect()
}

pub fn list_claimable_sites(conn: &Connection) -> SqlResult<Vec<ClaimableSite>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.name, f.designation
         FROM foundation_sites f
         WHERE f.id NOT IN (SELECT site_id FROM player_site_assignments)
         ORDER BY f.id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ClaimableSite {
            site_id: row.get(0)?,
            name: row.get(1)?,
            designation: row.get(2)?,
        })
    })?;
    rows.collect()
}

#[tauri::command]
pub fn get_player_sites(state: State<'_, DbState>) -> Result<Vec<PlayerSite>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_player_sites(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_claimable_sites(state: State<'_, DbState>) -> Result<Vec<ClaimableSite>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_claimable_sites(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn claim_site(
    site_id: String,
    state: State<'_, DbState>,
) -> Result<SiteAssignmentResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if !foundation_site_exists(&conn, &site_id).map_err(|e| e.to_string())? {
        return Err(format!("Site inconnu : {}", site_id));
    }
    if is_assigned(&conn, &site_id).map_err(|e| e.to_string())? {
        return Err(format!("Vous supervisez déjà {}", site_id));
    }
    assign_site_internal(&conn, &site_id, "PLAYER").map_err(|e| e.to_string())?;
    let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
    Ok(SiteAssignmentResult {
        message: format!("Supervision de {} activée par votre initiative.", site_id),
        newly_assigned: Some(site_id),
        sites,
    })
}

#[tauri::command]
pub fn release_site(
    site_id: String,
    state: State<'_, DbState>,
) -> Result<SiteAssignmentResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let total = count_player_sites(&conn).map_err(|e| e.to_string())?;
    if total <= 1 {
        return Err(
            "Impossible de vous retirer ce site : vous devez superviser au moins une installation."
                .into(),
        );
    }
    if !is_assigned(&conn, &site_id).map_err(|e| e.to_string())? {
        return Err(format!("Vous ne supervisez pas {}", site_id));
    }
    conn.execute(
        "DELETE FROM player_site_assignments WHERE site_id = ?1",
        params![site_id],
    )
    .map_err(|e| e.to_string())?;
    let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
    Ok(SiteAssignmentResult {
        message: format!(
            "Supervision de {} retirée. {} site(s) sous votre autorité.",
            site_id,
            sites.len()
        ),
        newly_assigned: None,
        sites,
    })
}

/// Affectation automatique (Conseil, incidents) — sans confirmation.
#[tauri::command]
pub fn auto_assign_site(
    site_id: Option<String>,
    source: Option<String>,
    state: State<'_, DbState>,
) -> Result<SiteAssignmentResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let src = source.as_deref().unwrap_or("AUTO");
    let target = if let Some(id) = site_id {
        id
    } else {
        let claimable = list_claimable_sites(&conn).map_err(|e| e.to_string())?;
        if claimable.is_empty() {
            let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
            return Ok(SiteAssignmentResult {
                sites,
                message: "Aucun site disponible pour affectation automatique.".into(),
                newly_assigned: None,
            });
        }
        let idx = (crate::database::rand_u32() as usize) % claimable.len();
        claimable[idx].site_id.clone()
    };

    if is_assigned(&conn, &target).map_err(|e| e.to_string())? {
        let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
        return Ok(SiteAssignmentResult {
            sites,
            message: format!("{} est déjà sous votre supervision.", target),
            newly_assigned: None,
        });
    }

    assign_site_internal(&conn, &target, src).map_err(|e| e.to_string())?;
    let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
    Ok(SiteAssignmentResult {
        message: format!(
            "Affectation {} imposée par la Foundation ({}) — sans vote requis.",
            target, src
        ),
        newly_assigned: Some(target.clone()),
        sites,
    })
}

/// Garantit que le site d'un incident est supervisé (affectation silencieuse si besoin).
#[tauri::command]
pub fn ensure_site_supervised(
    site_id: String,
    state: State<'_, DbState>,
) -> Result<SiteAssignmentResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if is_assigned(&conn, &site_id).map_err(|e| e.to_string())? {
        let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
        return Ok(SiteAssignmentResult {
            sites,
            message: format!("{} déjà supervisé.", site_id),
            newly_assigned: None,
        });
    }
    if foundation_site_exists(&conn, &site_id).map_err(|e| e.to_string())? {
        assign_site_internal(&conn, &site_id, "AUTO").map_err(|e| e.to_string())?;
        let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
        return Ok(SiteAssignmentResult {
            message: format!(
                "La Foundation vous a affecté {} suite à activité sur ce secteur.",
                site_id
            ),
            newly_assigned: Some(site_id),
            sites,
        });
    }
    // Site hors catalogue (ex. SITE-██ généré par l'IA) — on l'ajoute au catalogue puis on affecte.
    conn.execute(
        "INSERT OR IGNORE INTO foundation_sites (id, name, designation)
         VALUES (?1, ?1, 'Site enregistré dynamiquement')",
        params![site_id],
    )
    .map_err(|e| e.to_string())?;
    assign_site_internal(&conn, &site_id, "AUTO").map_err(|e| e.to_string())?;
    let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
    Ok(SiteAssignmentResult {
        message: format!("Nouveau secteur {} ajouté à votre mandat.", site_id),
        newly_assigned: Some(site_id),
        sites,
    })
}

/// Tirage aléatoire : le Conseil peut vous assigner un site après un vote (~30 %).
#[tauri::command]
pub fn maybe_council_assign_site(
    state: State<'_, DbState>,
) -> Result<SiteAssignmentResult, String> {
    if crate::database::rand_u32() % 100 >= 30 {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let sites = list_player_sites(&conn).map_err(|e| e.to_string())?;
        return Ok(SiteAssignmentResult {
            sites,
            message: "Aucune réaffectation de site par le Conseil.".into(),
            newly_assigned: None,
        });
    }
    auto_assign_site(None, Some("COUNCIL".into()), state)
}
