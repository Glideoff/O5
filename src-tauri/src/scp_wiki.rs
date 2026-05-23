//! Récupération des fiches SCP depuis [Fondation SCP](http://fondationscp.wikidot.com/).
//! Cache SQLite pour limiter les requêtes réseau + import vers le registre.

use rusqlite::{params, Connection, OptionalExtension};
use std::time::Duration;

use crate::database::{now_iso, DbState, Scp};

const WIKI_BASE: &str = "http://fondationscp.wikidot.com";
const CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 3600; // 7 jours
const MAX_LORE_CHARS: usize = 4_500;

pub fn ensure_wiki_cache_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS scp_wiki_cache (
            scp_id TEXT PRIMARY KEY,
            slug TEXT NOT NULL,
            content TEXT NOT NULL,
            source_url TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )",
        [],
    )
    .map(|_| ())
}

/// Slugs Wikidot à tenter pour un identifiant SCP.
pub fn wiki_slugs_for_scp_id(scp_id: &str) -> Vec<String> {
    let upper = scp_id.trim().to_uppercase();
    let mut slugs = Vec::new();

    if let Some(rest) = upper.strip_prefix("SCP-") {
        if rest.ends_with("-FR") {
            let num = rest.trim_end_matches("-FR");
            if !num.is_empty() {
                slugs.push(format!("scp-{}-fr", num.to_lowercase()));
            }
        } else {
            let num = rest.split('-').next().unwrap_or(rest);
            if !num.is_empty() {
                slugs.push(format!("scp-{}", num.to_lowercase()));
                slugs.push(format!("scp-{}-fr", num.to_lowercase()));
            }
        }
    }

    if slugs.is_empty() {
        slugs.push(scp_id.to_lowercase().replace('_', "-"));
    }

    slugs.dedup();
    slugs
}

fn wiki_url(slug: &str) -> String {
    format!("{}/{}", WIKI_BASE, slug.trim_start_matches('/'))
}

/// Extrait le texte utile d'une page HTML Wikidot.
fn html_to_lore_text(html: &str) -> String {
    let fragment = extract_page_content(html).unwrap_or(html);

    let mut text = fragment.to_string();
    // Scripts / styles
    while let Some(start) = text.find("<script") {
        if let Some(end) = text[start..].find("</script>") {
            text.replace_range(start..start + end + 9, "");
        } else {
            break;
        }
    }
    while let Some(start) = text.find("<style") {
        if let Some(end) = text[start..].find("</style>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text = text
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</li>", "\n");

    let mut out = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => {
                out.push(c);
            }
            _ => {}
        }
    }

    let mut cleaned = String::new();
    let mut prev_space = false;
    for line in out.lines() {
        let t = line.trim();
        if t.is_empty() {
            if !prev_space {
                cleaned.push('\n');
                prev_space = true;
            }
            continue;
        }
        // Filtre navigation Wikidot récurrente
        if t.starts_with("Cliquer ici pour")
            || t.contains("Creative Commons")
            || t == "≡"
            || t.starts_with("révision de page:")
        {
            continue;
        }
        cleaned.push_str(t);
        cleaned.push('\n');
        prev_space = false;
    }

    let lore = trim_lore_section(&cleaned);
    truncate_chars(lore, MAX_LORE_CHARS)
}

fn extract_page_content(html: &str) -> Option<&str> {
    for marker in [
        "id=\"page-content\"",
        "id='page-content'",
        "class=\"wiki-content\"",
    ] {
        if let Some(idx) = html.find(marker) {
            if let Some(start) = html[idx..].find('>') {
                let content_start = idx + start + 1;
                if let Some(end) = html[content_start..].find("<div id=\"page-rate") {
                    return Some(&html[content_start..content_start + end]);
                }
                if let Some(end) = html[content_start..].find("<div class=\"page-tags") {
                    return Some(&html[content_start..content_start + end]);
                }
                return Some(&html[content_start..]);
            }
        }
    }
    None
}

/// Garde la zone fiche SCP (à partir de « Objet no » ou « Procédures »).
fn trim_lore_section(text: &str) -> String {
    let lower = text.to_lowercase();
    let start = lower
        .find("objet no")
        .or_else(|| lower.find("objet n°"))
        .or_else(|| lower.find("procédures de confinement"))
        .or_else(|| lower.find("description :"))
        .unwrap_or(0);
    text[start..].trim().to_string()
}

fn truncate_chars(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max).collect();
    out.push_str("\n[… fiche tronquée pour le contexte IA …]");
    out
}

async fn http_get_wiki(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("OVERSEER/0.3 (+https://github.com; SCP Foundation fan tool)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Réseau wiki : {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Wiki HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Lecture page wiki : {}", e))
}

async fn fetch_live_lore(scp_id: &str) -> Result<(String, String, String), String> {
    let slugs = wiki_slugs_for_scp_id(scp_id);
    let mut last_err = String::from("Aucune page trouvée");

    for slug in slugs {
        let url = wiki_url(&slug);
        match http_get_wiki(&url).await {
            Ok(html) => {
                let lore = html_to_lore_text(&html);
                if lore.len() > 120 {
                    return Ok((lore, slug, url));
                }
                last_err = format!("Page {} trop courte", slug);
            }
            Err(e) => last_err = e,
        }
    }

    Err(last_err)
}

fn read_cache(conn: &Connection, scp_id: &str) -> Result<Option<(String, String)>, String> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT content, source_url, fetched_at FROM scp_wiki_cache WHERE scp_id = ?1",
            params![scp_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((content, url, fetched_at)) = row else {
        return Ok(None);
    };

    if cache_is_stale(&fetched_at) {
        return Ok(None);
    }

    Ok(Some((content, url)))
}

fn cache_is_stale(fetched_at: &str) -> bool {
    use std::time::{SystemTime, UNIX_EPOCH};
    let Ok(parsed) = parse_iso_secs(fetched_at) else {
        return true;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now.saturating_sub(parsed) > CACHE_MAX_AGE_SECS
}

fn parse_iso_secs(iso: &str) -> Result<u64, ()> {
    let s = iso.trim_end_matches('Z');
    if s.len() < 19 {
        return Err(());
    }
    let y: u64 = s[0..4].parse().map_err(|_| ())?;
    let mo: u64 = s[5..7].parse().map_err(|_| ())?;
    let d: u64 = s[8..10].parse().map_err(|_| ())?;
    let h: u64 = s[11..13].parse().map_err(|_| ())?;
    let mi: u64 = s[14..16].parse().map_err(|_| ())?;
    let se: u64 = s[17..19].parse().map_err(|_| ())?;
    Ok(y * 31_536_000 + mo * 2_592_000 + d * 86_400 + h * 3600 + mi * 60 + se)
}

fn write_cache(
    conn: &Connection,
    scp_id: &str,
    slug: &str,
    content: &str,
    source_url: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO scp_wiki_cache (scp_id, slug, content, source_url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scp_id) DO UPDATE SET
            slug = excluded.slug,
            content = excluded.content,
            source_url = excluded.source_url,
            fetched_at = excluded.fetched_at",
        params![scp_id, slug, content, source_url, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Texte de la fiche wiki (cache ou fetch). Retourne None si indisponible.
pub async fn get_scp_wiki_text(state: &DbState, scp_id: &str) -> Option<String> {
    let id = scp_id.trim().to_uppercase();
    if id.is_empty() {
        return None;
    }

    if let Ok(conn) = state.0.lock() {
        if let Ok(Some((content, _url))) = read_cache(&conn, &id) {
            if !content.is_empty() {
                return Some(content);
            }
        }
    }

    let fetched = fetch_live_lore(&id).await.ok()?;
    if let Ok(conn) = state.0.lock() {
        let _ = write_cache(&conn, &id, &fetched.1, &fetched.0, &fetched.2);
    }
    Some(fetched.0)
}

/// Bloc formaté pour injection dans les prompts Ollama.
pub async fn wiki_context_block(state: &DbState, scp_id: &str) -> String {
    match get_scp_wiki_text(state, scp_id).await {
        Some(lore) => format!(
            "\n\n——— FICHE SCP CANONIQUE (source : Fondation SCP Wikidot) ———\n{}\n——— FIN FICHE ———\n",
            lore
        ),
        None => String::new(),
    }
}

/// Force le rechargement depuis le wiki.
#[tauri::command]
pub async fn refresh_scp_wiki(
    scp_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<WikiLoreDto, String> {
    let id = scp_id.trim().to_uppercase();
    let (content, slug, url) = fetch_live_lore(&id).await?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let char_count = content.chars().count();
    write_cache(&conn, &id, &slug, &content, &url)?;
    Ok(WikiLoreDto {
        scp_id: id,
        source_url: url,
        char_count,
        content,
    })
}

#[derive(serde::Serialize)]
pub struct WikiLoreDto {
    pub scp_id: String,
    pub source_url: String,
    pub content: String,
    pub char_count: usize,
}

#[tauri::command]
pub async fn get_scp_wiki_lore(
    scp_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Option<WikiLoreDto>, String> {
    let id = scp_id.trim().to_uppercase();
    let content = get_scp_wiki_text(&state, &id).await;
    let Some(content) = content else {
        return Ok(None);
    };
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let url: String = conn
        .query_row(
            "SELECT source_url FROM scp_wiki_cache WHERE scp_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| wiki_url(&wiki_slugs_for_scp_id(&id)[0]));
    Ok(Some(WikiLoreDto {
        scp_id: id.clone(),
        source_url: url,
        char_count: content.chars().count(),
        content,
    }))
}

/* ==========================================================================
   Catalogue Wikidot + import registre
   ========================================================================== */

const SERIES_SLUGS: &[&str] = &[
    "scp-series-fr",
    "scp-series-2-fr",
    "scp-series-3-fr",
    "scp-series-4-fr",
    "scp-series-5-fr",
    "scp-series-6-fr",
];

/// SCP fréquemment consultés (secours si le wiki est indisponible).
const CURATED_SCP_IDS: &[&str] = &[
    "SCP-001", "SCP-002", "SCP-003", "SCP-004", "SCP-005", "SCP-006", "SCP-007", "SCP-008",
    "SCP-009", "SCP-010", "SCP-011", "SCP-012", "SCP-013", "SCP-014", "SCP-015", "SCP-016",
    "SCP-017", "SCP-018", "SCP-019", "SCP-020", "SCP-035", "SCP-049", "SCP-066", "SCP-073",
    "SCP-076", "SCP-079", "SCP-087", "SCP-096", "SCP-106", "SCP-173", "SCP-178", "SCP-205",
    "SCP-231", "SCP-239", "SCP-252", "SCP-300", "SCP-343", "SCP-409", "SCP-426", "SCP-447",
    "SCP-457", "SCP-500", "SCP-513", "SCP-610", "SCP-682", "SCP-701", "SCP-811", "SCP-914",
    "SCP-939", "SCP-966", "SCP-999", "SCP-1000", "SCP-1171", "SCP-1981", "SCP-3008",
    "SCP-5000", "SCP-6000",
];

#[derive(Debug, Clone, serde::Serialize)]
pub struct WikiCatalogEntry {
    pub id: String,
    pub slug: String,
}

#[derive(Debug, serde::Serialize)]
pub struct WikiImportResult {
    pub scp_id: String,
    pub ok: bool,
    pub scp: Option<Scp>,
    pub error: Option<String>,
}

struct ParsedScpFields {
    name: String,
    object_class: String,
    containment_procedures: String,
    description: String,
}

/// Normalise une saisie utilisateur en identifiant SCP canonique.
pub fn normalize_scp_id(input: &str) -> Option<String> {
    let raw = input.trim().to_uppercase();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("SCP-") {
        return Some(raw);
    }
    if raw.starts_with("SCP") {
        let rest = raw.trim_start_matches("SCP").trim_start_matches('-');
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit() || c == '-') {
            return Some(format!("SCP-{}", rest));
        }
    }
    if raw.chars().all(|c| c.is_ascii_digit()) {
        return Some(format!("SCP-{}", raw));
    }
    None
}

fn extract_scp_ids_from_html(html: &str) -> Vec<String> {
    let upper = html.to_uppercase();
    let mut ids = Vec::new();
    let mut search_from = 0usize;
    while let Some(rel) = upper[search_from..].find("SCP-") {
        let start = search_from + rel;
        let slice = &upper[start..];
        let mut end = 4usize;
        while end < slice.len() {
            let b = slice.as_bytes()[end];
            if b.is_ascii_digit() {
                end += 1;
            } else if b == b'-' && slice.len() >= end + 3 && &slice[end..end + 3] == "-FR" {
                end += 3;
                break;
            } else {
                break;
            }
        }
        if end > 4 {
            let id = slice[..end].to_string();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        search_from = start + 4;
    }
    ids.sort();
    ids
}

fn curated_catalog() -> Vec<WikiCatalogEntry> {
    CURATED_SCP_IDS
        .iter()
        .map(|id| WikiCatalogEntry {
            slug: wiki_slugs_for_scp_id(id)
                .first()
                .cloned()
                .unwrap_or_else(|| id.to_lowercase()),
            id: (*id).to_string(),
        })
        .collect()
}

async fn fetch_series_catalog() -> Vec<WikiCatalogEntry> {
    let mut ids = Vec::new();
    for slug in SERIES_SLUGS {
        let url = wiki_url(slug);
        if let Ok(html) = http_get_wiki(&url).await {
            for id in extract_scp_ids_from_html(&html) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if ids.is_empty() {
        return curated_catalog();
    }
    ids.sort();
    ids.into_iter()
        .map(|id| WikiCatalogEntry {
            slug: wiki_slugs_for_scp_id(&id)
                .first()
                .cloned()
                .unwrap_or_else(|| id.to_lowercase()),
            id,
        })
        .collect()
}

fn normalize_object_class(raw: &str) -> String {
    let t = raw.trim().to_uppercase();
    if t.contains("APOLLYON") || t.contains("APOLION") {
        return "APOLLYON".into();
    }
    if t.contains("THAUMIEL") {
        return "THAUMIEL".into();
    }
    if t.contains("KETER") {
        return "KETER".into();
    }
    if t.contains("EUCLID") || t.contains("EUCLIDE") {
        return "EUCLIDE".into();
    }
    if t.contains("SAFE") {
        return "SAFE".into();
    }
    if t.contains("NEUTRE") {
        return "NEUTRE".into();
    }
    if t.len() <= 24 && !t.is_empty() {
        return t;
    }
    "EUCLIDE".into()
}

fn section_index(lower: &str, markers: &[&str]) -> Option<usize> {
    markers
        .iter()
        .filter_map(|m| lower.find(m))
        .min()
}

fn parse_wiki_lore_to_fields(lore: &str, scp_id: &str) -> ParsedScpFields {
    let lower = lore.to_lowercase();
    let mut object_class = "EUCLIDE".to_string();
    let mut name = String::new();

    for line in lore.lines() {
        let l = line.trim();
        let ll = l.to_lowercase();
        if ll.contains("classe") && ll.contains(':') {
            if let Some((_, rest)) = l.split_once(':') {
                object_class = normalize_object_class(rest);
            }
        }
        if name.is_empty() {
            if ll.contains("surnom") && ll.contains(':') {
                if let Some((_, rest)) = l.split_once(':') {
                    name = rest.trim().to_string();
                }
            } else if ll.contains("appellation") && ll.contains(':') {
                if let Some((_, rest)) = l.split_once(':') {
                    name = rest.trim().to_string();
                }
            }
        }
    }

    if name.is_empty() {
        name = format!("Dossier {}", scp_id);
    }
    if name.len() > 120 {
        name = format!("{}…", name.chars().take(117).collect::<String>());
    }

    let proc_start = section_index(
        &lower,
        &[
            "procédures de confinement spéciales",
            "procédures de confinement",
            "procédures spéciales de confinement",
            "procédures spéciales",
        ],
    );
    let desc_start = section_index(
        &lower,
        &["description :", "description:", "description"],
    );

    let containment_procedures = match (proc_start, desc_start) {
        (Some(ps), Some(ds)) if ds > ps => lore[ps..ds].trim().to_string(),
        (Some(ps), None) => lore[ps..].trim().to_string(),
        _ => "Procédures non extraites automatiquement — consulter la fiche wiki.".into(),
    };

    let description = match desc_start {
        Some(ds) => lore[ds..].trim().to_string(),
        None => lore.chars().take(2000).collect(),
    };

    let containment_procedures = truncate_chars(containment_procedures, 2500);
    let description = truncate_chars(description, 2500);

    ParsedScpFields {
        name,
        object_class,
        containment_procedures,
        description,
    }
}

fn upsert_scp(conn: &Connection, scp: &Scp) -> Result<(), String> {
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
    Ok(())
}

async fn import_one_scp(state: &DbState, scp_id: &str) -> WikiImportResult {
    let id = match normalize_scp_id(scp_id) {
        Some(id) => id,
        None => {
            return WikiImportResult {
                scp_id: scp_id.to_string(),
                ok: false,
                scp: None,
                error: Some("Identifiant SCP invalide".into()),
            };
        }
    };

    let fetch = match fetch_live_lore(&id).await {
        Ok(v) => v,
        Err(e) => {
            return WikiImportResult {
                scp_id: id,
                ok: false,
                scp: None,
                error: Some(e),
            };
        }
    };

    let (lore, slug, url) = fetch;
    let fields = parse_wiki_lore_to_fields(&lore, &id);
    let scp = Scp {
        id: id.clone(),
        name: fields.name,
        object_class: fields.object_class,
        site: "SITE-19".to_string(),
        containment_procedures: fields.containment_procedures,
        description: fields.description,
        created_by: "WIKIDOT_IMPORT".to_string(),
        created_at: now_iso(),
        containment_status: "CONTAINED".to_string(),
    };

    match state.0.lock() {
        Ok(conn) => {
            if let Err(e) = write_cache(&conn, &id, &slug, &lore, &url) {
                return WikiImportResult {
                    scp_id: id,
                    ok: false,
                    scp: None,
                    error: Some(e),
                };
            }
            if let Err(e) = upsert_scp(&conn, &scp) {
                return WikiImportResult {
                    scp_id: id.clone(),
                    ok: false,
                    scp: None,
                    error: Some(e),
                };
            }
        }
        Err(e) => {
            return WikiImportResult {
                scp_id: id,
                ok: false,
                scp: None,
                error: Some(e.to_string()),
            };
        }
    }

    WikiImportResult {
        scp_id: scp.id.clone(),
        ok: true,
        scp: Some(scp),
        error: None,
    }
}

/// Liste des SCP référencés sur les pages « série » du wiki FR.
#[tauri::command]
pub async fn get_wikidot_scp_catalog() -> Result<Vec<WikiCatalogEntry>, String> {
    Ok(fetch_series_catalog().await)
}

/// Importe plusieurs dossiers SCP depuis Wikidot vers le registre local.
#[tauri::command]
pub async fn import_scps_from_wiki(
    scp_ids: Vec<String>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<WikiImportResult>, String> {
    let mut results = Vec::with_capacity(scp_ids.len());
    for (i, raw_id) in scp_ids.iter().enumerate() {
        results.push(import_one_scp(&state, raw_id).await);
        if i + 1 < scp_ids.len() {
            tokio::time::sleep(Duration::from_millis(350)).await;
        }
    }
    Ok(results)
}
