//! Liaison à distance entre deux PC OVERSEER via « magic link ».
//!
//! Le lien encode l'hôte, le port, l'empreinte de clé AES et la clé hex pour que
//! les deux instances partagent le même canal chiffré. L'hôte doit être joignable
//! (IP publique + redirection de port, VPN type Tailscale, ou même LAN).

use crate::crypto;
use crate::websocket_server;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const LINK_PREFIX: &str = "overseer://pair/";
const LINK_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicLinkPayload {
    pub v: u8,
    /// Hôte de connexion (IP publique de préférence, sinon LAN).
    pub h: String,
    pub p: u16,
    /// Empreinte clé (12 hex) pour vérification visuelle.
    pub fp: String,
    /// Clé AES-256 (64 hex).
    pub k: String,
    pub site: String,
    /// IP locale de l'hôte (info).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lan: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MagicLinkDto {
    pub link: String,
    pub host: String,
    pub port: u16,
    pub local_ip: String,
    pub public_ip: Option<String>,
    pub fingerprint: String,
    pub site_id: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JoinMagicLinkResult {
    pub connected_to: String,
    pub fingerprint: String,
    pub key_imported: bool,
}

fn local_ip_string() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| format!("IP locale introuvable : {}", e))
}

async fn fetch_public_ip() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;
    let text = client
        .get("https://api.ipify.org")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() || trimmed.contains(' ') {
        None
    } else {
        Some(trimmed)
    }
}

fn encode_link(payload: &MagicLinkPayload) -> Result<String, String> {
    let json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    Ok(format!("{}{}", LINK_PREFIX, hex::encode(json)))
}

fn decode_link(link: &str) -> Result<MagicLinkPayload, String> {
    let trimmed = link.trim();
    let hex_part = trimmed
        .strip_prefix(LINK_PREFIX)
        .or_else(|| trimmed.strip_prefix("overseer://pair?data="))
        .unwrap_or(trimmed);
    let bytes = hex::decode(hex_part.trim()).map_err(|e| format!("Lien invalide (hex) : {}", e))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Lien invalide (JSON) : {}", e))
}

fn parse_key_hex(hex_key: &str) -> Result<Vec<u8>, String> {
    let key = hex::decode(hex_key.trim()).map_err(|e| format!("Clé hex invalide : {}", e))?;
    if key.len() != 32 {
        return Err("La clé du lien doit faire 32 octets (64 caractères hex).".into());
    }
    Ok(key)
}

/// Génère un magic link pour qu'un autre PC se connecte à cette instance.
#[tauri::command]
pub async fn create_magic_link(port: u16) -> Result<MagicLinkDto, String> {
    let ws = ws_state()?;
    websocket_server::start_ws_server(port).await?;

    let key = websocket_server::session_key(&ws).await;
    let fp = crypto::key_fingerprint(&key);
    let key_hex = hex::encode(&key);

    let local_ip = local_ip_string()?;
    let public_ip = fetch_public_ip().await;
    let host = public_ip.clone().unwrap_or_else(|| local_ip.clone());
    let site_id = websocket_server::local_site_id(&ws);

    let payload = MagicLinkPayload {
        v: LINK_VERSION,
        h: host.clone(),
        p: port,
        fp: fp.clone(),
        k: key_hex,
        site: site_id.clone(),
        lan: Some(local_ip.clone()),
    };

    let link = encode_link(&payload)?;
    let hint = if public_ip.is_some() {
        "Partagez ce lien en privé. Sur l'hôte : autorisez le port TCP dans le pare-feu Windows \
et configurez une redirection de port sur votre box (NAT) vers ce PC, si vous êtes derrière une box."
            .into()
    } else {
        "IP publique non détectée : le lien utilise l'IP locale — valable uniquement sur le même réseau. \
Pour Internet, vérifiez votre connexion ou saisissez manuellement l'IP publique."
            .into()
    };

    Ok(MagicLinkDto {
        link,
        host,
        port,
        local_ip,
        public_ip,
        fingerprint: fp,
        site_id,
        hint,
    })
}

/// Rejoint un site distant à partir d'un magic link (importe la clé + connexion WS).
#[tauri::command]
pub async fn join_magic_link(link: String) -> Result<JoinMagicLinkResult, String> {
    let payload = decode_link(&link)?;
    if payload.v != LINK_VERSION {
        return Err(format!(
            "Version de lien non supportée (v{}, attendu v{}).",
            payload.v, LINK_VERSION
        ));
    }

    let key = parse_key_hex(&payload.k)?;
    let ws = ws_state()?;

    let session = websocket_server::session_key(&ws).await;
    let current_fp = crypto::key_fingerprint(&session);
    let key_imported = current_fp != payload.fp;
    if key_imported {
        crypto::import_key(&websocket_server::app_handle(&ws), key.clone())?;
        websocket_server::set_session_key(&ws, key).await?;
    }

    let addr = format!("{}:{}", payload.h, payload.p);
    websocket_server::connect_to_peer(addr.clone()).await?;

    Ok(JoinMagicLinkResult {
        connected_to: addr,
        fingerprint: payload.fp,
        key_imported,
    })
}

/// Retourne les infos réseau utiles pour une connexion manuelle.
#[tauri::command]
pub async fn get_link_endpoints(port: u16) -> Result<MagicLinkDto, String> {
    let ws = ws_state()?;
    let key = websocket_server::session_key(&ws).await;
    let fp = crypto::key_fingerprint(&key);
    let local_ip = local_ip_string()?;
    let public_ip = fetch_public_ip().await;
    let host = public_ip.clone().unwrap_or_else(|| local_ip.clone());
    Ok(MagicLinkDto {
        link: String::new(),
        host,
        port,
        local_ip,
        public_ip,
        fingerprint: fp,
        site_id: websocket_server::local_site_id(&ws),
        hint: String::new(),
    })
}

fn ws_state() -> Result<std::sync::Arc<websocket_server::WsState>, String> {
    websocket_server::global_state()
}
