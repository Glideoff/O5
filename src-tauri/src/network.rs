//! Scan réseau OVERSEER — détection des sites Foundation pairs.
//!
//! Mécanique : pour chaque IP du /24 local, tentative de connexion TCP rapide
//! sur le port 47474 (réservé OVERSEER). Toute IP qui répond est un site pair.
//! L'IP locale (self) est toujours inclus, baptisé SITE-19 (primaire Foundation).

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;
use tauri::State;
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::database::DbState;

const OVERSEER_PORT: u16 = 47474;
const SCAN_TIMEOUT: Duration = Duration::from_millis(700);
/// Site primaire = celui qui tourne sur cette machine.
const SELF_SITE_ID: &str = "SITE-19";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Device {
    pub site_id: String,
    pub ip: String,
    pub hostname: String,
    pub os: String,
    pub overseer_version: String,
    pub status: String,
    pub is_self: bool,
    pub last_seen: String,
}

fn now_iso_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{}", secs)
}

fn detect_os_label() -> String {
    let os = std::env::consts::OS;
    match os {
        "windows" => "Windows".into(),
        "macos" => "macOS".into(),
        "linux" => "Linux".into(),
        other => other.to_string(),
    }
}

fn hostname_string() -> String {
    gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "unknown".into())
}

/// Tente une connexion TCP vers `ip:port` avec timeout. Retourne true si succès.
async fn probe(ip: String) -> Option<String> {
    let target = format!("{}:{}", ip, OVERSEER_PORT);
    match timeout(SCAN_TIMEOUT, TcpStream::connect(&target)).await {
        Ok(Ok(_)) => Some(ip),
        _ => None,
    }
}

/// Upsert d'un site dans la table `sites`.
fn upsert_site(state: &State<'_, DbState>, device: &Device) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sites (id, device_name, os, ip, status, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            device_name = excluded.device_name,
            os = excluded.os,
            ip = excluded.ip,
            status = excluded.status,
            last_seen = excluded.last_seen",
        params![
            device.site_id,
            device.hostname,
            device.os,
            device.ip,
            device.status,
            device.last_seen,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Trois derniers octets affichables de l'IP locale (barre de session).
#[tauri::command]
pub fn get_session_ip_suffix() -> Result<String, String> {
    let local = local_ip_address::local_ip()
        .map_err(|e| format!("IP locale : {}", e))?;
    let s = local.to_string();
    let suffix = s.split('.').next_back().unwrap_or("0");
    Ok(suffix.to_string())
}

/// Liste les sites déjà enregistrés en base.
#[tauri::command]
pub fn get_known_sites(state: State<'_, DbState>) -> Result<Vec<Device>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, device_name, os, ip, status, last_seen FROM sites ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Device {
                site_id: r.get::<_, String>(0)?,
                hostname: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                os: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ip: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                status: r.get::<_, String>(4)?,
                last_seen: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                overseer_version: "0.1".into(),
                is_self: false,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

/// Scanne le réseau /24 local pour détecter d'autres instances OVERSEER (port 47474).
/// Retourne tous les sites connus + self.
#[tauri::command]
pub async fn scan_local_network(state: State<'_, DbState>) -> Result<Vec<Device>, String> {
    let now = now_iso_simple();

    // 1. IP locale
    let local =
        local_ip_address::local_ip().map_err(|e| format!("IP locale introuvable : {}", e))?;
    let local_ip_str = local.to_string();
    let host = hostname_string();
    let os = detect_os_label();

    // 2. Calcul du /24
    let octets = match local {
        IpAddr::V4(v4) => v4.octets(),
        IpAddr::V6(_) => return Err("IPv6 non supporté pour le scan.".into()),
    };
    let base = format!("{}.{}.{}", octets[0], octets[1], octets[2]);

    // 3. Self (toujours présent, SITE-19)
    let self_device = Device {
        site_id: SELF_SITE_ID.into(),
        ip: local_ip_str.clone(),
        hostname: host.clone(),
        os: os.clone(),
        overseer_version: env!("CARGO_PKG_VERSION").into(),
        status: "ONLINE".into(),
        is_self: true,
        last_seen: now.clone(),
    };
    upsert_site(&state, &self_device)?;

    // 4. Scan TCP /24 (en excluant self)
    let mut tasks = Vec::new();
    for i in 1..255u8 {
        let candidate = format!("{}.{}", base, i);
        if candidate == local_ip_str {
            continue;
        }
        tasks.push(tokio::spawn(probe(candidate)));
    }

    let mut peers: Vec<Device> = Vec::new();
    let mut next_peer_idx = 0usize;
    for t in tasks {
        if let Ok(Some(ip)) = t.await {
            next_peer_idx += 1;
            // Auto-naming SITE-██-N (style redacted)
            let device = Device {
                site_id: format!("SITE-██-{}", next_peer_idx),
                ip,
                hostname: "REDACTED".into(),
                os: "INCONNU".into(),
                overseer_version: "?".into(),
                status: "ONLINE".into(),
                is_self: false,
                last_seen: now.clone(),
            };
            let _ = upsert_site(&state, &device);
            peers.push(device);
        }
    }

    // 5. Renvoie self + peers découverts
    let mut all = vec![self_device];
    all.extend(peers);
    Ok(all)
}
