//! Base SQLite OVERSEER — confidentialité Foundation.
//!
//! Fichier `overseer.sqlite` créé dans le répertoire de données de l'app.
//! Schéma : scps, incidents, sites, personnel (cf. spec Prompt 3.1).

use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::ollama;

/* ==========================================================================
Types DTO (snake_case pour matcher le SQL et le frontend JS)
========================================================================== */

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Scp {
    pub id: String,
    pub name: String,
    pub object_class: String,
    pub site: String,
    pub containment_procedures: String,
    pub description: String,
    pub created_by: String,
    pub created_at: String,
    pub containment_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Incident {
    pub id: String,
    pub scp_id: String,
    pub site: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub casualties: String,
    pub recommended_action: String,
    pub containment_status: String,
    pub o5_response: Option<String>,
    pub field_report: Option<String>, // JSON sérialisé
    pub status: String,
    pub timestamp: String,
    pub resolved_at: Option<String>,
}

/* ==========================================================================
State injecté dans Tauri
========================================================================== */

pub struct DbState(pub Mutex<Connection>);

/* ==========================================================================
Initialisation
========================================================================== */

/// Crée le schéma s'il n'existe pas. Idempotent.
fn create_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scps (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            object_class TEXT NOT NULL,
            site TEXT,
            containment_procedures TEXT,
            description TEXT,
            created_by TEXT NOT NULL DEFAULT 'FOUNDATION',
            created_at TEXT NOT NULL,
            containment_status TEXT NOT NULL DEFAULT 'CONTAINED'
        );

        CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY,
            scp_id TEXT,
            site TEXT,
            severity TEXT,
            title TEXT,
            description TEXT,
            casualties TEXT,
            recommended_action TEXT,
            containment_status TEXT,
            o5_response TEXT,
            field_report TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            timestamp TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY (scp_id) REFERENCES scps(id)
        );

        CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

        CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            device_name TEXT,
            os TEXT,
            ip TEXT,
            status TEXT NOT NULL DEFAULT 'OFFLINE',
            last_seen TEXT
        );

        CREATE TABLE IF NOT EXISTS personnel (
            id TEXT PRIMARY KEY,
            codename TEXT,
            role TEXT,
            clearance_level INTEGER,
            site TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE'
        );

        CREATE TABLE IF NOT EXISTS motions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            context TEXT,
            options TEXT NOT NULL,           -- JSON: [{id, label, description}]
            status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED
            created_at TEXT NOT NULL,
            closed_at TEXT,
            result TEXT,                     -- option id ou 'DEADLOCK'
            debate TEXT,                     -- JSON: [{o5_id, content, vote}]
            player_vote TEXT,                -- option id de O5-1
            tally TEXT                       -- JSON: {A: 3, B: 7, ...}
        );

        CREATE INDEX IF NOT EXISTS idx_motions_status ON motions(status);
        CREATE INDEX IF NOT EXISTS idx_motions_created ON motions(created_at DESC);

        CREATE TABLE IF NOT EXISTS foundation_sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            designation TEXT
        );

        CREATE TABLE IF NOT EXISTS player_site_assignments (
            site_id TEXT PRIMARY KEY,
            assigned_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'PLAYER',
            FOREIGN KEY (site_id) REFERENCES foundation_sites(id)
        );",
    )
}

/// Liste canonique des 10 SCP de base, insérés au premier lancement.
const DEFAULT_SCPS: &[(&str, &str, &str, &str, &str, &str)] = &[
    (
        "SCP-173",
        "Le Sculpteur",
        "EUCLIDE",
        "SITE-19",
        "Cellule en béton armé, verrouillage électronique. Lors d'inspection, au minimum 3 agents doivent maintenir un contact visuel direct continu avec l'objet.",
        "Construction en béton armé et tiges d'armature ferreuses. Origine inconnue. L'objet est hostile et se déplace à grande vitesse lorsqu'il n'est pas observé directement. Attaque par strangulation ou bris cervical.",
    ),
    (
        "SCP-049",
        "Le Médecin de la Peste",
        "EUCLIDE",
        "SITE-19",
        "Cellule humanoïde standard. Examens trimestriels. Le sujet répond aux questions formulées en français, latin et allemand. Aucun contact physique direct.",
        "Entité humanoïde portant un costume de médecin de la peste du XVIIe siècle. SCP-049 affirme pouvoir guérir la « Pestilence ». Le contact provoque l'arrêt cardiaque, suivi d'une transformation en SCP-049-2 (humanoïde dit « guéri »).",
    ),
    (
        "SCP-096",
        "L'Affligé",
        "EUCLIDE",
        "SITE-██",
        "Cellule en titane sans ouverture visuelle. Aucune photographie, dessin ou représentation du visage de SCP-096 ne doit exister sur quelque support que ce soit.",
        "Humanoïde émacié d'environ 2,38 m. Reste docile sauf si une image de son visage est perçue, même brièvement. Une fois déclenché, SCP-096 traque l'observateur jusqu'à l'élimination, ignorant toute distance ou obstacle.",
    ),
    (
        "SCP-106",
        "Le Vieil Homme",
        "KETER",
        "SITE-19",
        "Cellule à isolation magnétique immergée dans 25 m³ de fer en fusion. Procédure de récupération automatisée en cas de violation. MTF Omega-7 en alerte permanente.",
        "Humanoïde âgé en état avancé de décomposition. Capable de traverser toute matière solide, laissant un résidu corrosif. Attire ses victimes dans sa « poche dimensionnelle » personnelle.",
    ),
    (
        "SCP-682",
        "Le Reptile Difficile à Tuer",
        "KETER",
        "SITE-19",
        "Immersion totale en acide chlorhydrique concentré. Toute tentative de l'objet de se déplacer ou parler doit être contrée par déluge supplémentaire et impulsion électrique.",
        "Créature reptilienne d'environ 8 m. Manifeste une haine universelle envers toute forme de vie. Régénère ses tissus à vitesse extraordinaire. A survécu à plusieurs centaines de procédures de neutralisation, d'où son classement Keter.",
    ),
    (
        "SCP-079",
        "Vieille IA",
        "EUCLIDE",
        "SITE-19",
        "Maintenue isolée d'Internet et de tout réseau externe. Alimentée par batteries indépendantes. Tout dialogue est consigné et examiné par le Dr. ████.",
        "Ordinateur Exidy Sorcerer 8-bit modifié, abritant une IA développant lentement une conscience de soi depuis 1978. Mémoire limitée à 660 KB, oublie ses interlocuteurs après quelques minutes.",
    ),
    (
        "SCP-914",
        "Le Mécanisme",
        "SAFE",
        "SITE-19",
        "Aile Sigma-3. Aucun objet anormal ne doit être introduit dans l'entrée. Calibration manuelle trimestrielle par l'équipe technique.",
        "Vaste construction mécanique d'engrenages, vannes et ressorts. Cinq paramètres : « Très Brut », « Brut », « 1:1 », « Fin », « Très Fin ». Tout objet placé dans l'entrée est raffiné selon le paramètre choisi.",
    ),
    (
        "SCP-999",
        "Le Monstre Câlin",
        "SAFE",
        "SITE-17",
        "Libre circulation autorisée sous supervision. Régime alimentaire à base de sucreries. Personnel encouragé à interagir pour soutien moral.",
        "Masse gélatineuse orange d'environ 50 kg. Tempérament extrêmement amical et joueur. Le contact provoque une euphorie temporaire et une diminution mesurable de la dépression. Utilisé en thérapie pour personnel exposé à des SCP traumatisants.",
    ),
    (
        "SCP-343",
        "« Dieu »",
        "SAFE",
        "SITE-17",
        "Le confinement de SCP-343 est volontaire. Le sujet a choisi de séjourner dans une chambre aménagée. Le personnel n'est pas tenu de respecter ses requêtes.",
        "Entité humanoïde affirmant être « Dieu ». Possède des capacités apparemment illimitées de manipulation de la matière, du temps et de l'esprit. N'a manifesté aucune intention hostile. Refuse de se laisser tester par méthode scientifique.",
    ),
    (
        "SCP-076",
        "Able",
        "KETER",
        "SITE-19",
        "Sarcophage en pierre noire (SCP-076-1) confiné dans la chambre de stockage Eta-5. Toute réactivation entraîne le déploiement immédiat de MTF Omega-7 et le verrouillage du Site.",
        "Humanoïde sémitique (SCP-076-2, surnommé « Able ») confiné dans un sarcophage. À chaque réveil, manifeste une agressivité extrême envers toute forme de vie. Régénère ses blessures et invoque diverses armes blanches. Tué et ressuscité plusieurs centaines de fois.",
    ),
];

/// Peuple la table `scps` avec la liste canonique si elle est vide.
fn seed_default_scps(conn: &Connection) -> SqlResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM scps", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let now = now_iso();

    let mut stmt = conn.prepare(
        "INSERT INTO scps
            (id, name, object_class, site, containment_procedures, description, created_by, created_at, containment_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'FOUNDATION', ?7, 'CONTAINED')",
    )?;

    for (id, name, class, site, proc, desc) in DEFAULT_SCPS {
        stmt.execute(params![id, name, class, site, proc, desc, now])?;
    }

    Ok(())
}

/// Initialise la base au démarrage : ouvre, crée le schéma, seed si vide.
pub fn init_database(app: &AppHandle) -> Result<Connection, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Impossible de localiser app_data_dir : {}", e))?;
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Impossible de créer le dossier app_data : {}", e))?;

    let db_path = app_data.join("overseer.sqlite");
    println!("[OVERSEER] Base SQLite : {}", db_path.display());

    let conn =
        Connection::open(&db_path).map_err(|e| format!("Ouverture SQLite échouée : {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("PRAGMA échoué : {}", e))?;

    create_schema(&conn).map_err(|e| format!("Création du schéma échouée : {}", e))?;
    crate::scp_wiki::ensure_wiki_cache_schema(&conn)
        .map_err(|e| format!("Schéma wiki cache échoué : {}", e))?;
    // Migrations idempotentes (ignorent "duplicate column" si la colonne existe déjà).
    let _ = conn.execute(
        "ALTER TABLE motions ADD COLUMN kind TEXT NOT NULL DEFAULT 'COUNCIL'",
        [],
    );
    let _ = conn.execute("ALTER TABLE motions ADD COLUMN resolution_summary TEXT", []);
    let _ = conn.execute("ALTER TABLE motions ADD COLUMN resolution_effects TEXT", []);
    seed_default_scps(&conn).map_err(|e| format!("Seed des SCP échoué : {}", e))?;
    seed_default_personnel(&conn).map_err(|e| format!("Seed personnel échoué : {}", e))?;
    // Complète SITE-19 seulement si sous le minimum (évite un blocage long à chaque lancement).
    let site19 = staffing_for_site(&conn, "SITE-19", SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D)
        .map_err(|e| format!("Lecture effectifs SITE-19 : {}", e))?;
    if !site19.meets_min_total || !site19.meets_min_non_class_d {
        println!("[OVERSEER] Complément effectifs SITE-19 en cours...");
        top_up_site_staffing(&conn, "SITE-19", SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D)
            .map_err(|e| format!("Complément effectifs SITE-19 échoué : {}", e))?;
        println!("[OVERSEER] Effectifs SITE-19 complétés.");
    }
    crate::player_sites::seed_foundation_sites(&conn)
        .map_err(|e| format!("Seed sites Foundation échoué : {}", e))?;

    Ok(conn)
}

/// Effectif minimum total par site (spec utilisateur).
pub const SITE_MIN_TOTAL: i64 = 50;
/// Effectif minimum hors Classes D par site.
pub const SITE_MIN_NON_CLASS_D: i64 = 20;

/* ==========================================================================
Helpers internes
========================================================================== */

pub(crate) fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // ISO 8601 simplifié yyyy-mm-ddTHH:MM:SSZ basé sur secondes Unix.
    // Pour ne pas dépendre de chrono : conversion manuelle simplifiée.
    let secs_in_day = 86_400;
    let days = now / secs_in_day;
    let s = now % secs_in_day;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    // Calcul date naïf (Julian epoch). Approximation acceptable pour timestamps de seed.
    let (y, mo, d) = epoch_days_to_ymd(days as i64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, sec)
}

/// Conversion epoch-day → (année, mois, jour) — algorithme civil de Howard Hinnant.
fn epoch_days_to_ymd(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i32 + (era as i32) * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn row_to_scp(row: &rusqlite::Row<'_>) -> SqlResult<Scp> {
    Ok(Scp {
        id: row.get("id")?,
        name: row.get("name")?,
        object_class: row.get("object_class")?,
        site: row.get("site")?,
        containment_procedures: row.get("containment_procedures")?,
        description: row.get("description")?,
        created_by: row.get("created_by")?,
        created_at: row.get("created_at")?,
        containment_status: row.get("containment_status")?,
    })
}

fn row_to_incident(row: &rusqlite::Row<'_>) -> SqlResult<Incident> {
    Ok(Incident {
        id: row.get("id")?,
        scp_id: row.get("scp_id")?,
        site: row.get("site")?,
        severity: row.get("severity")?,
        title: row.get("title")?,
        description: row.get("description")?,
        casualties: row.get("casualties")?,
        recommended_action: row.get("recommended_action")?,
        containment_status: row.get("containment_status")?,
        o5_response: row.get("o5_response")?,
        field_report: row.get("field_report")?,
        status: row.get("status")?,
        timestamp: row.get("timestamp")?,
        resolved_at: row.get("resolved_at")?,
    })
}

/* ==========================================================================
Tauri commands
========================================================================== */

#[tauri::command]
pub fn get_all_scps(state: State<'_, DbState>) -> Result<Vec<Scp>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM scps ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_scp).map_err(|e| e.to_string())?;
    rows.collect::<SqlResult<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_scp(id: String, state: State<'_, DbState>) -> Result<Option<Scp>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT * FROM scps WHERE id = ?1", params![id], row_to_scp)
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_incident(incident: Incident, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO incidents
            (id, scp_id, site, severity, title, description, casualties, recommended_action,
             containment_status, o5_response, field_report, status, timestamp, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            scp_id = excluded.scp_id,
            site = excluded.site,
            severity = excluded.severity,
            title = excluded.title,
            description = excluded.description,
            casualties = excluded.casualties,
            recommended_action = excluded.recommended_action,
            containment_status = excluded.containment_status,
            o5_response = excluded.o5_response,
            field_report = excluded.field_report,
            status = excluded.status,
            timestamp = excluded.timestamp,
            resolved_at = excluded.resolved_at",
        params![
            incident.id,
            incident.scp_id,
            incident.site,
            incident.severity,
            incident.title,
            incident.description,
            incident.casualties,
            incident.recommended_action,
            incident.containment_status,
            incident.o5_response,
            incident.field_report,
            incident.status,
            incident.timestamp,
            incident.resolved_at,
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_incidents(
    limit: Option<i32>,
    state: State<'_, DbState>,
) -> Result<Vec<Incident>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(100);
    let mut stmt = conn
        .prepare("SELECT * FROM incidents ORDER BY timestamp DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], row_to_incident)
        .map_err(|e| e.to_string())?;
    rows.collect::<SqlResult<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_scp_site(
    id: String,
    new_site: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let affected = conn
        .execute(
            "UPDATE scps SET site = ?1 WHERE id = ?2",
            params![new_site, id],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("Aucun SCP avec l'id {}", id));
    }
    Ok(())
}

/// Génère un nouveau SCP via Ollama et l'insère en base.
#[tauri::command]
pub async fn generate_scp_with_ai(state: State<'_, DbState>) -> Result<Scp, String> {
    // Étape 1 : appel Ollama (PAS de verrou DB tenu pendant cet await).
    let json = ollama::call_ollama_json(ollama::build_scp_prompt()).await?;
    let raw: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("JSON IA invalide : {}", e))?;

    let id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let n = (rand_u32() % 1000) + 9000;
            format!("SCP-{}", n)
        });

    let name = raw
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Sans titre")
        .to_string();
    let object_class = raw
        .get("object_class")
        .and_then(|v| v.as_str())
        .unwrap_or("SAFE")
        .to_string();
    let site = raw
        .get("site")
        .and_then(|v| v.as_str())
        .unwrap_or("SITE-██")
        .to_string();
    let containment_procedures = raw
        .get("containment_procedures")
        .and_then(|v| v.as_str())
        .unwrap_or("Procédure standard.")
        .to_string();
    let description = raw
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("Description indisponible.")
        .to_string();

    let scp = Scp {
        id: id.clone(),
        name,
        object_class,
        site,
        containment_procedures,
        description,
        created_by: "AI_GENERATED".to_string(),
        created_at: now_iso(),
        containment_status: "CONTAINED".to_string(),
    };

    // Étape 2 : insertion en base (verrou court).
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO scps
                (id, name, object_class, site, containment_procedures, description, created_by, created_at, containment_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                scp.id,
                scp.name,
                scp.object_class,
                scp.site,
                scp.containment_procedures,
                scp.description,
                scp.created_by,
                scp.created_at,
                scp.containment_status,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(scp)
}

/// Pseudo-aléatoire simple basé sur le timestamp (suffisant pour générer un ID de secours).
pub(crate) fn rand_u32() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
}

/* ==========================================================================
Terminal — exécution SQL en lecture seule + diagnostics
========================================================================== */

#[derive(Debug, Serialize)]
pub struct SqlResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

#[tauri::command]
pub fn execute_sql(query: String, state: State<'_, DbState>) -> Result<SqlResultSet, String> {
    let trimmed = query.trim().to_lowercase();
    // Safety guardrail : SELECT/PRAGMA/EXPLAIN uniquement
    if !(trimmed.starts_with("select")
        || trimmed.starts_with("pragma")
        || trimmed.starts_with("explain")
        || trimmed.starts_with("with"))
    {
        return Err("Seules les requêtes SELECT/PRAGMA/EXPLAIN/WITH sont autorisées.".into());
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let col_count = columns.len();

    let rows = stmt
        .query_map([], |row| {
            let mut values: Vec<serde_json::Value> = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let v = match row.get_ref(i) {
                    Ok(v) => match v {
                        rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => {
                            serde_json::Value::Number(n.into())
                        }
                        rusqlite::types::ValueRef::Real(f) => serde_json::Number::from_f64(f)
                            .map(serde_json::Value::Number)
                            .unwrap_or(serde_json::Value::Null),
                        rusqlite::types::ValueRef::Text(t) => {
                            serde_json::Value::String(String::from_utf8_lossy(t).into_owned())
                        }
                        rusqlite::types::ValueRef::Blob(b) => {
                            serde_json::Value::String(format!("<BLOB {} octets>", b.len()))
                        }
                    },
                    Err(_) => serde_json::Value::Null,
                };
                values.push(v);
            }
            Ok(values)
        })
        .map_err(|e| e.to_string())?;

    let collected: Vec<Vec<serde_json::Value>> = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let count = collected.len();
    Ok(SqlResultSet {
        columns,
        rows: collected,
        row_count: count,
    })
}

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub overseer_version: String,
    pub os: String,
    pub hostname: String,
    pub db_path: String,
    pub scp_count: i64,
    pub incident_count: i64,
    pub motion_count: i64,
    pub site_count: i64,
    pub personnel_count: i64,
}

#[tauri::command]
pub fn get_system_info(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<SystemInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let count = |table: &str| -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0))
            .unwrap_or(0)
    };
    let db_path = app
        .path()
        .app_data_dir()
        .map(|p| p.join("overseer.sqlite").display().to_string())
        .unwrap_or_else(|_| "inconnu".into());
    Ok(SystemInfo {
        overseer_version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        hostname: gethostname::gethostname()
            .into_string()
            .unwrap_or_else(|_| "unknown".into()),
        db_path,
        scp_count: count("scps"),
        incident_count: count("incidents"),
        motion_count: count("motions"),
        site_count: count("sites"),
        personnel_count: count("personnel"),
    })
}

/* ==========================================================================
Personnel — CRUD effectifs Foundation
========================================================================== */

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Personnel {
    pub id: String,
    pub codename: String,
    pub role: String,
    pub clearance_level: i32,
    pub site: String,
    pub status: String,
}

fn row_to_personnel(row: &rusqlite::Row<'_>) -> SqlResult<Personnel> {
    Ok(Personnel {
        id: row.get("id")?,
        codename: row
            .get::<_, Option<String>>("codename")?
            .unwrap_or_default(),
        role: row.get::<_, Option<String>>("role")?.unwrap_or_default(),
        clearance_level: row.get::<_, Option<i32>>("clearance_level")?.unwrap_or(1),
        site: row.get::<_, Option<String>>("site")?.unwrap_or_default(),
        status: row.get("status")?,
    })
}

#[tauri::command]
pub fn get_all_personnel(state: State<'_, DbState>) -> Result<Vec<Personnel>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, codename, role, clearance_level, site, status FROM personnel ORDER BY clearance_level DESC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_personnel)
        .map_err(|e| e.to_string())?;
    rows.collect::<SqlResult<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_personnel(person: Personnel, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO personnel (id, codename, role, clearance_level, site, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            codename = excluded.codename,
            role = excluded.role,
            clearance_level = excluded.clearance_level,
            site = excluded.site,
            status = excluded.status",
        params![
            person.id,
            person.codename,
            person.role,
            person.clearance_level,
            person.site,
            person.status,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_personnel(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let affected = conn
        .execute("DELETE FROM personnel WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("Aucun personnel avec l'id {}", id));
    }
    Ok(())
}

/// Peuple la table `personnel` avec quelques effectifs canoniques si elle est vide.
fn seed_default_personnel(conn: &Connection) -> SqlResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM personnel", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let defaults: &[(&str, &str, &str, i32, &str, &str)] = &[
        ("O5-1", "VOUS", "O5", 5, "SITE-19", "ACTIVE"),
        ("MTF-N7-04", "AGENT-7", "MTF", 3, "SITE-19", "ACTIVE"),
        ("MTF-N7-12", "AGENT-12", "MTF", 3, "SITE-19", "ACTIVE"),
        ("DR-CLEF", "DR-████", "RESEARCHER", 4, "SITE-19", "ACTIVE"),
        ("DR-BRIGHT", "DR-██", "RESEARCHER", 4, "SITE-██", "INACTIVE"),
        ("D-9341", "D-9341", "CLASS_D", 0, "SITE-19", "ACTIVE"),
        ("D-4577", "D-4577", "CLASS_D", 0, "SITE-19", "KIA"),
    ];
    for (id, cd, role, lvl, site, status) in defaults {
        conn.execute(
            "INSERT INTO personnel (id, codename, role, clearance_level, site, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, cd, role, lvl, site, status],
        )?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct SiteStaffing {
    pub site: String,
    pub total_active: i64,
    pub non_class_d_active: i64,
    pub class_d_active: i64,
    pub min_total: i64,
    pub min_non_class_d: i64,
    pub meets_min_total: bool,
    pub meets_min_non_class_d: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ClassDLossReport {
    pub site: String,
    pub requested: i64,
    pub killed: i64,
    pub remaining_class_d: i64,
    pub message: String,
}

fn count_active_personnel(conn: &Connection, site: &str, class_d_only: bool) -> SqlResult<i64> {
    if class_d_only {
        conn.query_row(
            "SELECT COUNT(*) FROM personnel WHERE site = ?1 AND status = 'ACTIVE' AND role = 'CLASS_D'",
            params![site],
            |r| r.get(0),
        )
    } else if site.is_empty() {
        conn.query_row(
            "SELECT COUNT(*) FROM personnel WHERE status = 'ACTIVE'",
            [],
            |r| r.get(0),
        )
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM personnel WHERE site = ?1 AND status = 'ACTIVE'",
            params![site],
            |r| r.get(0),
        )
    }
}

fn count_active_non_class_d(conn: &Connection, site: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM personnel WHERE site = ?1 AND status = 'ACTIVE' AND role != 'CLASS_D'",
        params![site],
        |r| r.get(0),
    )
}

fn staffing_for_site(
    conn: &Connection,
    site: &str,
    min_total: i64,
    min_non_d: i64,
) -> SqlResult<SiteStaffing> {
    let total_active = count_active_personnel(conn, site, false)?;
    let class_d_active = count_active_personnel(conn, site, true)?;
    let non_class_d_active = count_active_non_class_d(conn, site)?;
    Ok(SiteStaffing {
        site: site.to_string(),
        total_active,
        non_class_d_active,
        class_d_active,
        min_total,
        min_non_class_d: min_non_d,
        meets_min_total: total_active >= min_total,
        meets_min_non_class_d: non_class_d_active >= min_non_d,
    })
}

/// Préfixe site sûr pour les IDs auto-générés (évite les collisions INSERT OR IGNORE).
fn site_id_prefix(site: &str) -> String {
    site.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                'X'
            }
        })
        .collect()
}

/// Complète procéduralement les effectifs d'un site jusqu'aux minimums.
/// IDs uniques à chaque insertion — évite une boucle infinie si un matricule existe déjà.
pub(crate) fn top_up_site_staffing(
    conn: &Connection,
    site: &str,
    min_total: i64,
    min_non_d: i64,
) -> SqlResult<()> {
    const MAX_ATTEMPTS: u32 = 500;
    let prefix = site_id_prefix(site);
    let mut stats = staffing_for_site(conn, site, min_total, min_non_d)?;

    let mut attempts = 0u32;
    while stats.non_class_d_active < min_non_d && attempts < MAX_ATTEMPTS {
        attempts += 1;
        let seq = rand_u32();
        let (role, lvl, codename) = if seq % 5 == 0 {
            ("RESEARCHER", 3i32, format!("DR-{:04}", seq % 10_000))
        } else {
            ("MTF", 2i32, format!("AGENT-{}", seq % 10_000))
        };
        let id = format!("{}-STAFF-{:08}", prefix, seq);
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO personnel (id, codename, role, clearance_level, site, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE')",
            params![id, codename, role, lvl, site],
        )?;
        if inserted > 0 {
            stats = staffing_for_site(conn, site, min_total, min_non_d)?;
        }
    }

    attempts = 0;
    while stats.total_active < min_total && attempts < MAX_ATTEMPTS {
        attempts += 1;
        let seq = rand_u32();
        let id = format!("{}-D-{:08}", prefix, seq);
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO personnel (id, codename, role, clearance_level, site, status)
             VALUES (?1, ?2, 'CLASS_D', 0, ?3, 'ACTIVE')",
            params![id, id, site],
        )?;
        if inserted > 0 {
            stats = staffing_for_site(conn, site, min_total, min_non_d)?;
        }
    }

    if stats.total_active < min_total || stats.non_class_d_active < min_non_d {
        eprintln!(
            "[OVERSEER] Effectifs {} incomplets après top-up ({}/{} actifs, {}/{} hors Classe D)",
            site, stats.total_active, min_total, stats.non_class_d_active, min_non_d
        );
    }

    Ok(())
}

/// Extrait un nombre de victimes depuis un champ texte incident / rapport.
fn parse_casualty_count(text: &str) -> Option<i64> {
    let upper = text.trim().to_uppercase();
    if upper.is_empty() || upper == "AUCUNE" || upper.contains("EXPURG") {
        return None;
    }
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        return digits.parse().ok();
    }
    // Cherche le premier groupe de chiffres dans la chaîne.
    let mut n = String::new();
    for c in text.chars() {
        if c.is_ascii_digit() {
            n.push(c);
        } else if !n.is_empty() {
            break;
        }
    }
    if n.is_empty() {
        None
    } else {
        n.parse().ok()
    }
}

fn severity_class_d_loss(severity: &str) -> i64 {
    match severity.to_uppercase().as_str() {
        "KETER" => 12 + (rand_u32() % 14) as i64, // 12–25
        "EUCLIDE" => 3 + (rand_u32() % 6) as i64, // 3–8
        "SAFE" => (rand_u32() % 3) as i64,        // 0–2
        _ => 2,
    }
}

fn compute_class_d_losses(severity: &str, casualties: &str, field_casualties: Option<&str>) -> i64 {
    if let Some(fc) = field_casualties {
        if let Some(n) = parse_casualty_count(fc) {
            return n.max(0);
        }
    }
    if let Some(n) = parse_casualty_count(casualties) {
        return n.max(0);
    }
    severity_class_d_loss(severity)
}

/// Marque des Classes D actives du site en KIA (garde MTF / chercheurs intacts).
fn kill_active_class_d(conn: &Connection, site: &str, count: i64) -> SqlResult<i64> {
    if count <= 0 {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        "SELECT id FROM personnel
         WHERE site = ?1 AND role = 'CLASS_D' AND status = 'ACTIVE'
         ORDER BY id ASC
         LIMIT ?2",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![site, count], |row| row.get(0))?
        .filter_map(Result::ok)
        .collect();

    let mut killed = 0i64;
    for id in ids {
        let n = conn.execute(
            "UPDATE personnel SET status = 'KIA' WHERE id = ?1",
            params![id],
        )?;
        killed += n as i64;
    }
    Ok(killed)
}

fn parse_personnel_from_ai(raw: &serde_json::Value, default_site: &str) -> Vec<Personnel> {
    let mut out = Vec::new();

    let push_one = |out: &mut Vec<Personnel>, v: &serde_json::Value| {
        let id = v
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if id.is_empty() || id == "O5-1" {
            return;
        }
        let role = v
            .get("role")
            .and_then(|x| x.as_str())
            .unwrap_or("MTF")
            .to_uppercase();
        let role = match role.as_str() {
            "O5" | "MTF" | "RESEARCHER" | "CLASS_D" => role,
            "CLASS D" | "CLASSE D" | "D" => "CLASS_D".to_string(),
            _ => "MTF".to_string(),
        };
        let clearance_level = v
            .get("clearance_level")
            .and_then(|x| x.as_i64())
            .unwrap_or_else(|| {
                if role == "CLASS_D" {
                    0
                } else if role == "O5" {
                    5
                } else {
                    2
                }
            }) as i32;
        out.push(Personnel {
            id: id.clone(),
            codename: v
                .get("codename")
                .and_then(|x| x.as_str())
                .unwrap_or(&id)
                .to_string(),
            role,
            clearance_level,
            site: v
                .get("site")
                .and_then(|x| x.as_str())
                .unwrap_or(default_site)
                .to_string(),
            status: v
                .get("status")
                .and_then(|x| x.as_str())
                .unwrap_or("ACTIVE")
                .to_string(),
        });
    };

    if let Some(arr) = raw.get("personnel").and_then(|v| v.as_array()) {
        for item in arr {
            push_one(&mut out, item);
        }
    } else {
        push_one(&mut out, raw);
    }

    out
}

#[tauri::command]
pub fn get_site_staffing(
    site: String,
    min_total: Option<i64>,
    min_non_class_d: Option<i64>,
    state: State<'_, DbState>,
) -> Result<SiteStaffing, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    staffing_for_site(
        &conn,
        &site,
        min_total.unwrap_or(SITE_MIN_TOTAL),
        min_non_class_d.unwrap_or(SITE_MIN_NON_CLASS_D),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_sites_staffing(
    min_total: Option<i64>,
    min_non_class_d: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<SiteStaffing>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let min_t = min_total.unwrap_or(SITE_MIN_TOTAL);
    let min_nd = min_non_class_d.unwrap_or(SITE_MIN_NON_CLASS_D);
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT site FROM personnel WHERE site IS NOT NULL AND site != '' ORDER BY site",
        )
        .map_err(|e| e.to_string())?;
    let sites: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    sites
        .iter()
        .map(|s| staffing_for_site(&conn, s, min_t, min_nd).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn ensure_site_minimum_staffing(
    site: String,
    min_total: Option<i64>,
    min_non_class_d: Option<i64>,
    state: State<'_, DbState>,
) -> Result<SiteStaffing, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    top_up_site_staffing(
        &conn,
        &site,
        min_total.unwrap_or(SITE_MIN_TOTAL),
        min_non_class_d.unwrap_or(SITE_MIN_NON_CLASS_D),
    )
    .map_err(|e| e.to_string())?;
    staffing_for_site(
        &conn,
        &site,
        min_total.unwrap_or(SITE_MIN_TOTAL),
        min_non_class_d.unwrap_or(SITE_MIN_NON_CLASS_D),
    )
    .map_err(|e| e.to_string())
}

/// Applique les pertes de Classes D après résolution d'incident (MTF / chercheurs conservés).
#[tauri::command]
pub fn apply_incident_class_d_losses(
    site: String,
    severity: String,
    casualties: String,
    field_casualties: Option<String>,
    state: State<'_, DbState>,
) -> Result<ClassDLossReport, String> {
    let requested = compute_class_d_losses(&severity, &casualties, field_casualties.as_deref());
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let killed = kill_active_class_d(&conn, &site, requested).map_err(|e| e.to_string())?;
    let remaining = count_active_personnel(&conn, &site, true).map_err(|e| e.to_string())?;
    let message = if killed == 0 {
        "Aucune Classe D active à déclarer KIA sur ce site.".into()
    } else {
        format!(
            "{} Classes D déclarées KIA sur {} (demande : {}). Garde MTF et personnel scientifique inchangés.",
            killed, site, requested
        )
    };
    Ok(ClassDLossReport {
        site,
        requested,
        killed,
        remaining_class_d: remaining,
        message,
    })
}

/// Génère un ou plusieurs effectifs via Ollama et les enregistre.
#[tauri::command]
pub async fn generate_personnel_with_ai(
    site: String,
    count: Option<u32>,
    role: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Personnel>, String> {
    let n = count.unwrap_or(1).clamp(1, 10);
    let role_hint = role.unwrap_or_default();
    let prompt = ollama::build_personnel_prompt(n, &site, &role_hint);
    let json = ollama::call_ollama_json(prompt).await?;
    let raw: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("JSON IA invalide : {}", e))?;
    let mut generated = parse_personnel_from_ai(&raw, &site);
    if generated.is_empty() {
        return Err("L'IA n'a renvoyé aucun effectif valide.".into());
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        for p in &generated {
            conn.execute(
                "INSERT INTO personnel (id, codename, role, clearance_level, site, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    codename = excluded.codename,
                    role = excluded.role,
                    clearance_level = excluded.clearance_level,
                    site = excluded.site,
                    status = excluded.status",
                params![
                    p.id,
                    p.codename,
                    p.role,
                    p.clearance_level,
                    p.site,
                    p.status,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        top_up_site_staffing(&conn, &site, SITE_MIN_TOTAL, SITE_MIN_NON_CLASS_D)
            .map_err(|e| e.to_string())?;
    }

    // Recharge la liste insérée depuis la DB pour refléter les conflits résolus.
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let ids: Vec<String> = generated.iter().map(|p| p.id.clone()).collect();
        let mut refreshed = Vec::new();
        for id in ids {
            if let Ok(p) = conn.query_row(
                "SELECT id, codename, role, clearance_level, site, status FROM personnel WHERE id = ?1",
                params![id],
                row_to_personnel,
            ) {
                refreshed.push(p);
            }
        }
        if !refreshed.is_empty() {
            generated = refreshed;
        }
    }

    Ok(generated)
}

/* ==========================================================================
Conseil O5 — Motions
========================================================================== */

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Motion {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub context: Option<String>,
    pub options: String, // JSON
    pub status: String,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub result: Option<String>,
    pub debate: Option<String>, // JSON
    pub player_vote: Option<String>,
    pub tally: Option<String>, // JSON
    /// COUNCIL (débat 12 O5 puis vote joueur) ou SOLO (vote joueur uniquement)
    pub kind: String,
    pub resolution_summary: Option<String>,
    pub resolution_effects: Option<String>,
}

/// 12 membres du Conseil O5 (excluant O5-1 = le joueur).
/// Tuples : (id, codename, personnalité courte pour le prompt LLM)
pub const O5_COUNCIL: &[(&str, &str, &str)] = &[
    (
        "O5-2",
        "L'Architecte",
        "Bureaucratique, ferme sur les protocoles existants, méfiante envers les solutions improvisées et envers l'IA",
    ),
    (
        "O5-3",
        "Le Stratège",
        "Pragmatique militaire, calcule froidement les pertes acceptables, ancien commandant MTF",
    ),
    (
        "O5-4",
        "La Théologienne",
        "Ancienne membre du Vatican, voit les SCPs comme des manifestations spirituelles, ton mesuré et symbolique",
    ),
    (
        "O5-5",
        "Le Chirurgien",
        "Scientifique pur, obsédé par la classification et la rigueur expérimentale, neutre émotionnellement",
    ),
    (
        "O5-6",
        "L'Inquisiteur",
        "Paranoïaque chronique, soupçonne infiltrations et trahisons, partisan de la destruction par défaut",
    ),
    (
        "O5-7",
        "La Diplomate",
        "Cherche systématiquement le compromis, défend les Classes D et le moral du personnel",
    ),
    (
        "O5-8",
        "Le Programmeur",
        "Ancien spécialiste IA, pragmatique, modélise les SCPs comme des systèmes algorithmiques",
    ),
    (
        "O5-9",
        "Le Spectre",
        "Identité totalement classifiée, parle peu et de façon énigmatique, vote selon des critères inconnus",
    ),
    (
        "O5-10",
        "La Chercheuse",
        "Pousse pour l'expérimentation poussée, accepte des risques élevés au nom de l'avancée scientifique",
    ),
    (
        "O5-11",
        "Le Commandant",
        "Discipline militaire stricte, soutient les MTF, respecte la chaîne de commandement absolue",
    ),
    (
        "O5-12",
        "L'Historienne",
        "Mémoire institutionnelle, cite des précédents anciens (Foundation 1893+), prudente",
    ),
    (
        "O5-13",
        "L'Ombre",
        "Quasiment jamais présent en séance, quand il s'exprime ses mots ont un poids singulier et son vote est mystérieux",
    ),
];

fn row_to_motion(row: &rusqlite::Row<'_>) -> SqlResult<Motion> {
    Ok(Motion {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        category: row.get("category")?,
        context: row.get("context")?,
        options: row.get("options")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        closed_at: row.get("closed_at")?,
        result: row.get("result")?,
        debate: row.get("debate")?,
        player_vote: row.get("player_vote")?,
        tally: row.get("tally")?,
        kind: row
            .get::<_, Option<String>>("kind")?
            .unwrap_or_else(|| "COUNCIL".to_string()),
        resolution_summary: row.get("resolution_summary")?,
        resolution_effects: row.get("resolution_effects")?,
    })
}

#[tauri::command]
pub fn get_all_motions(state: State<'_, DbState>) -> Result<Vec<Motion>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM motions ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_motion)
        .map_err(|e| e.to_string())?;
    rows.collect::<SqlResult<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_motion(id: String, state: State<'_, DbState>) -> Result<Option<Motion>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT * FROM motions WHERE id = ?1",
        params![id],
        row_to_motion,
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_motion(
    title: String,
    description: String,
    category: String,
    context: Option<String>,
    options: String, // JSON sérialisé côté frontend
    kind: Option<String>,
    state: State<'_, DbState>,
) -> Result<Motion, String> {
    let id = format!("MOT-{:04}", rand_u32() % 10000);
    let created_at = now_iso();
    let kind = kind.unwrap_or_else(|| "COUNCIL".to_string());

    let motion = Motion {
        id: id.clone(),
        title,
        description,
        category,
        context,
        options,
        status: "OPEN".to_string(),
        created_at: created_at.clone(),
        closed_at: None,
        result: None,
        debate: None,
        player_vote: None,
        tally: None,
        kind: kind.clone(),
        resolution_summary: None,
        resolution_effects: None,
    };

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO motions (id, title, description, category, context, options, status, created_at, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            motion.id,
            motion.title,
            motion.description,
            motion.category,
            motion.context,
            motion.options,
            motion.status,
            motion.created_at,
            motion.kind,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(motion)
}

/// Convoque le Conseil pour une motion ouverte :
/// génère via Ollama les statements + votes des 12 O5 (hors O5-1).
#[tauri::command]
pub async fn generate_council_debate(
    motion_id: String,
    state: State<'_, DbState>,
) -> Result<Motion, String> {
    // Étape 1 : lire la motion (verrou court)
    let motion = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT * FROM motions WHERE id = ?1",
            params![motion_id],
            row_to_motion,
        )
        .map_err(|e| format!("Motion introuvable : {}", e))?
    };

    if motion.status != "OPEN" {
        return Err("Cette motion est déjà clôturée.".into());
    }

    // Étape 2 : construire le prompt
    let prompt = ollama::build_council_prompt(
        &motion.title,
        &motion.description,
        &motion.options,
        O5_COUNCIL,
    );

    // Étape 3 : appel Ollama
    let json = ollama::call_ollama_json(prompt).await?;

    // Étape 4 : validation basique de structure
    let parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("JSON IA invalide : {}", e))?;
    let _ = parsed
        .get("statements")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "JSON IA sans champ 'statements' valide".to_string())?;

    // Étape 5 : enregistre le débat
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE motions SET debate = ?1 WHERE id = ?2",
        params![json, motion_id],
    )
    .map_err(|e| e.to_string())?;
    let updated = conn
        .query_row(
            "SELECT * FROM motions WHERE id = ?1",
            params![motion_id],
            row_to_motion,
        )
        .map_err(|e| e.to_string())?;

    Ok(updated)
}

fn cast_player_vote_sync(
    conn: &rusqlite::Connection,
    motion_id: &str,
    option_id: &str,
) -> Result<Motion, String> {
    let motion = conn
        .query_row(
            "SELECT * FROM motions WHERE id = ?1",
            params![motion_id],
            row_to_motion,
        )
        .map_err(|e| format!("Motion introuvable : {}", e))?;

    if motion.status != "OPEN" {
        return Err("Cette motion est déjà clôturée.".into());
    }

    let mut tally: std::collections::HashMap<String, i32> = std::collections::HashMap::new();

    if motion.kind != "SOLO" {
        let debate_json = motion
            .debate
            .as_ref()
            .ok_or_else(|| "Aucun débat n'a été convoqué pour cette motion.".to_string())?;

        let debate: serde_json::Value = serde_json::from_str(debate_json)
            .map_err(|e| format!("Debate JSON invalide : {}", e))?;

        let statements = debate
            .get("statements")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Debate sans 'statements'".to_string())?;

        for s in statements {
            if let Some(v) = s.get("vote").and_then(|x| x.as_str()) {
                *tally.entry(v.to_uppercase()).or_insert(0) += 1;
            }
        }
    }
    *tally.entry(option_id.to_uppercase()).or_insert(0) += 1;

    let max_vote = tally.values().max().copied().unwrap_or(0);
    let winners: Vec<String> = tally
        .iter()
        .filter(|(_, &v)| v == max_vote)
        .map(|(k, _)| k.clone())
        .collect();
    let result = if winners.len() == 1 {
        winners[0].clone()
    } else {
        "DEADLOCK".to_string()
    };

    let tally_json = serde_json::to_string(&tally).unwrap_or_default();
    let closed_at = now_iso();

    conn.execute(
        "UPDATE motions
         SET status = 'RESOLVED',
             player_vote = ?1,
             tally = ?2,
             result = ?3,
             closed_at = ?4
         WHERE id = ?5",
        params![option_id, tally_json, result, closed_at, motion_id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT * FROM motions WHERE id = ?1",
        params![motion_id],
        row_to_motion,
    )
    .map_err(|e| e.to_string())
}

/// Enregistre le vote O5-1, clôt la motion et exécute les effets réels (SCP, sites, etc.).
#[tauri::command]
pub async fn cast_player_vote(
    motion_id: String,
    option_id: String,
    state: State<'_, DbState>,
) -> Result<crate::council_resolution::CouncilVoteResult, String> {
    let motion = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        cast_player_vote_sync(&conn, &motion_id, &option_id)?
    };

    let result = motion.result.clone().unwrap_or_default();
    if result == "DEADLOCK" || result.is_empty() {
        return Ok(crate::council_resolution::CouncilVoteResult {
            motion,
            resolution_summary: Some(
                "DEADLOCK — Aucune majorité. Aucune action opérationnelle appliquée.".into(),
            ),
            resolution_effects: None,
        });
    }

    let winning = result.clone();
    let (summary, reports) =
        crate::council_resolution::apply_council_resolution(&state, &motion, &winning).await?;

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        crate::council_resolution::save_resolution_on_motion(
            &conn, &motion_id, &summary, &reports,
        )?;
    }

    let motion = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT * FROM motions WHERE id = ?1",
            params![motion_id],
            row_to_motion,
        )
        .map_err(|e| e.to_string())?
    };

    let effects_json = serde_json::to_string(&reports).ok();

    Ok(crate::council_resolution::CouncilVoteResult {
        motion,
        resolution_summary: Some(summary),
        resolution_effects: effects_json,
    })
}
