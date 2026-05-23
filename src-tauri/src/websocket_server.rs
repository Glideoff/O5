//! Serveur + client WebSocket OVERSEER (port 47474 par défaut).
//!
//! Architecture :
//! - Un seul état global (WsState) protégé par RwLock
//! - HashMap des peers connectés, chaque peer a un sender mpsc → tâche d'écriture WS
//! - Tâche d'écoute par peer qui parse les messages et émet des événements Tauri vers le frontend
//! - Encrypte/déchiffre via crate `crypto` (AES-256-GCM)
//!
//! Spec : tags JSON `type` (HANDSHAKE, MESSAGE, INCIDENT_BROADCAST, SITE_STATUS).

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, connect_async};

use crate::crypto;

/* ==========================================================================
Types JSON wire (compatible spec Phase 5.1)
========================================================================== */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    #[serde(rename = "HANDSHAKE")]
    Handshake {
        device_id: String,
        role: String,
        site: String,
    },
    #[serde(rename = "MESSAGE")]
    Message {
        from: String,
        to: String,
        content: String,
        encrypted: bool,
        timestamp: String,
    },
    #[serde(rename = "INCIDENT_BROADCAST")]
    IncidentBroadcast { incident: serde_json::Value },
    #[serde(rename = "SITE_STATUS")]
    SiteStatus { site: String, status: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct PeerInfo {
    pub site_id: String,
    pub role: String,
    pub addr: String,
    pub connected_at: String,
}

/* ==========================================================================
État global
========================================================================== */

struct ConnectedPeer {
    info: PeerInfo,
    tx: mpsc::UnboundedSender<String>,
}

pub struct WsState {
    peers: RwLock<HashMap<String, ConnectedPeer>>,
    key: RwLock<Vec<u8>>,
    local_site_id: String,
    local_role: String,
    app: AppHandle,
    /// Port d'écoute actif (0 = aucun).
    listening_port: AtomicU16,
    start_lock: Mutex<()>,
}

static STATE: OnceCell<Arc<WsState>> = OnceCell::new();

pub fn init_state(app: AppHandle, key: Vec<u8>, local_site_id: String) -> Arc<WsState> {
    let state = Arc::new(WsState {
        peers: RwLock::new(HashMap::new()),
        key: RwLock::new(key),
        local_site_id,
        local_role: "O5".to_string(),
        app,
        listening_port: AtomicU16::new(0),
        start_lock: Mutex::new(()),
    });
    let _ = STATE.set(state.clone());
    state
}

fn get_state() -> Result<Arc<WsState>, String> {
    global_state()
}

pub fn global_state() -> Result<Arc<WsState>, String> {
    STATE
        .get()
        .cloned()
        .ok_or_else(|| "WS state non initialisé".to_string())
}

pub async fn session_key(state: &WsState) -> Vec<u8> {
    state.key.read().await.clone()
}

pub async fn set_session_key(state: &WsState, key: Vec<u8>) -> Result<(), String> {
    if key.len() != 32 {
        return Err("La clé de liaison doit faire 32 octets.".into());
    }
    *state.key.write().await = key;
    Ok(())
}

pub fn listening_port(state: &WsState) -> u16 {
    state.listening_port.load(Ordering::SeqCst)
}

pub fn local_site_id(state: &WsState) -> String {
    state.local_site_id.clone()
}

pub fn app_handle(state: &WsState) -> AppHandle {
    state.app.clone()
}

/* ==========================================================================
Helpers
========================================================================== */

fn now_iso_simple() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{}", secs)
}

/// Envoie un WsMessage à un peer spécifique (par site_id).
async fn send_to_peer(state: &WsState, site_id: &str, msg: &WsMessage) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let peers = state.peers.read().await;
    let peer = peers
        .get(site_id)
        .ok_or_else(|| format!("Aucun peer connecté pour {}", site_id))?;
    peer.tx
        .send(json)
        .map_err(|e| format!("Envoi peer échoué : {}", e))?;
    Ok(())
}

/// Broadcast un WsMessage à tous les peers connectés.
async fn broadcast(state: &WsState, msg: &WsMessage) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let peers = state.peers.read().await;
    for (_, peer) in peers.iter() {
        let _ = peer.tx.send(json.clone());
    }
}

/* ==========================================================================
Handler de connexion (commun client/serveur)
========================================================================== */

async fn run_peer_loop<S>(
    ws_stream: tokio_tungstenite::WebSocketStream<S>,
    addr: SocketAddr,
    state: Arc<WsState>,
    initial_handshake_to_send: Option<WsMessage>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Écrivain : pompe le mpsc vers le WebSocket
    let writer_handle = tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            if write.send(Message::Text(payload)).await.is_err() {
                break;
            }
        }
    });

    let mut sent_our_handshake = false;

    // Envoi du handshake initial éventuel (côté client)
    if let Some(hs) = initial_handshake_to_send {
        if let Ok(j) = serde_json::to_string(&hs) {
            let _ = tx.send(j);
        }
        sent_our_handshake = true;
    }

    let mut current_site_id: Option<String> = None;

    while let Some(msg) = read.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(_) => break,
        };

        let parsed: WsMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[OVERSEER WS] payload illisible : {}", e);
                continue;
            }
        };

        match &parsed {
            WsMessage::Handshake {
                device_id,
                role,
                site,
            } => {
                let info = PeerInfo {
                    site_id: site.clone(),
                    role: role.clone(),
                    addr: addr.to_string(),
                    connected_at: now_iso_simple(),
                };
                {
                    let mut peers = state.peers.write().await;
                    peers.insert(
                        site.clone(),
                        ConnectedPeer {
                            info: info.clone(),
                            tx: tx.clone(),
                        },
                    );
                }
                current_site_id = Some(site.clone());
                let _ = state.app.emit("ws:peer-connected", info);
                eprintln!("[OVERSEER WS] {} ({}/{}) connecté.", site, role, device_id);

                if !sent_our_handshake {
                    sent_our_handshake = true;
                    let reply = WsMessage::Handshake {
                        device_id: gethostname::gethostname()
                            .into_string()
                            .unwrap_or_else(|_| "unknown".into()),
                        role: state.local_role.clone(),
                        site: state.local_site_id.clone(),
                    };
                    if let Ok(j) = serde_json::to_string(&reply) {
                        let _ = tx.send(j);
                    }
                }
            }

            WsMessage::Message {
                from,
                to,
                content,
                encrypted,
                timestamp,
            } => {
                // Si la conversation est chiffrée, on tente de déchiffrer.
                let key = state.key.read().await;
                let displayed = if *encrypted {
                    match crypto::decrypt(&key, content) {
                        Ok(t) => t,
                        Err(_) => "[DONNÉES CHIFFRÉES ██████████████]".to_string(),
                    }
                } else {
                    content.clone()
                };

                let _ = state.app.emit(
                    "ws:message",
                    serde_json::json!({
                        "from": from,
                        "to": to,
                        "content": displayed,
                        "encrypted": encrypted,
                        "timestamp": timestamp,
                    }),
                );
            }

            WsMessage::IncidentBroadcast { incident } => {
                let _ = state.app.emit("ws:incident-broadcast", incident);
            }

            WsMessage::SiteStatus { site, status } => {
                let _ = state.app.emit(
                    "ws:site-status",
                    serde_json::json!({ "site": site, "status": status }),
                );
            }
        }
    }

    // Cleanup
    if let Some(sid) = current_site_id {
        let mut peers = state.peers.write().await;
        peers.remove(&sid);
        let _ = state.app.emit(
            "ws:peer-disconnected",
            serde_json::json!({ "site_id": sid }),
        );
        eprintln!("[OVERSEER WS] {} déconnecté.", sid);
    }
    let _ = writer_handle;
}

/* ==========================================================================
Tauri commands
========================================================================== */

#[tauri::command]
pub async fn start_ws_server(port: u16) -> Result<String, String> {
    let state = get_state()?;
    let _guard = state.start_lock.lock().await;

    let active = state.listening_port.load(Ordering::SeqCst);
    if active == port {
        return Ok(format!("Serveur OVERSEER déjà actif sur 0.0.0.0:{}", port));
    }
    if active != 0 {
        return Err(format!(
            "Un serveur écoute déjà sur le port {}. Fermez l'autre instance OVERSEER ou changez le port dans Paramètres.",
            active
        ));
    }

    let bind = format!("0.0.0.0:{}", port);
    let listener = match TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("10048") || msg.to_lowercase().contains("address already in use") {
                return Err(format!(
                    "Le port {} est déjà utilisé (une autre instance OVERSEER ou une autre application). \
Fermez l'autre processus ou choisissez un autre port.",
                    port
                ));
            }
            return Err(format!("Bind {} échoué : {}", bind, e));
        }
    };

    state.listening_port.store(port, Ordering::SeqCst);
    eprintln!("[OVERSEER WS] Serveur en écoute sur {}", bind);

    let bind_log = bind.clone();
    tokio::spawn({
        let state = state.clone();
        async move {
            while let Ok((stream, addr)) = listener.accept().await {
                let state = state.clone();
                tokio::spawn(async move {
                    let ws = match accept_async(stream).await {
                        Ok(w) => w,
                        Err(e) => {
                            eprintln!("[OVERSEER WS] accept échoué : {}", e);
                            return;
                        }
                    };
                    run_peer_loop(ws, addr, state, None).await;
                });
            }
            state.listening_port.store(0, Ordering::SeqCst);
            eprintln!("[OVERSEER WS] Listener arrêté sur {}", bind_log);
        }
    });

    Ok(format!("Serveur OVERSEER actif sur {}", bind))
}

#[tauri::command]
pub fn get_ws_server_port() -> Result<u16, String> {
    let state = get_state()?;
    Ok(listening_port(&state))
}

#[tauri::command]
pub async fn connect_to_peer(addr: String) -> Result<String, String> {
    let state = get_state()?;
    let url = format!("ws://{}", addr);
    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Connexion à {} échouée : {}", url, e))?;

    let parsed_addr: SocketAddr = addr
        .parse()
        .map_err(|e| format!("Adresse invalide : {}", e))?;

    let handshake = WsMessage::Handshake {
        device_id: gethostname::gethostname()
            .into_string()
            .unwrap_or_else(|_| "unknown".into()),
        role: state.local_role.clone(),
        site: state.local_site_id.clone(),
    };

    tokio::spawn({
        let state = state.clone();
        async move {
            run_peer_loop(ws, parsed_addr, state, Some(handshake)).await;
        }
    });

    Ok(format!("Connexion lancée vers {}", url))
}

#[tauri::command]
pub async fn send_message(to: String, content: String) -> Result<(), String> {
    let state = get_state()?;
    let key = state.key.read().await;
    let encrypted_content = crypto::encrypt(&key, &content)?;
    let msg = WsMessage::Message {
        from: state.local_site_id.clone(),
        to: to.clone(),
        content: encrypted_content,
        encrypted: true,
        timestamp: now_iso_simple(),
    };
    send_to_peer(&state, &to, &msg).await
}

#[tauri::command]
pub async fn broadcast_message(content: String) -> Result<(), String> {
    let state = get_state()?;
    let key = state.key.read().await;
    let encrypted_content = crypto::encrypt(&key, &content)?;
    let msg = WsMessage::Message {
        from: state.local_site_id.clone(),
        to: "*".into(),
        content: encrypted_content,
        encrypted: true,
        timestamp: now_iso_simple(),
    };
    broadcast(&state, &msg).await;
    Ok(())
}

#[tauri::command]
pub async fn broadcast_incident(incident: serde_json::Value) -> Result<(), String> {
    let state = get_state()?;
    let msg = WsMessage::IncidentBroadcast { incident };
    broadcast(&state, &msg).await;
    Ok(())
}

#[tauri::command]
pub async fn get_connected_peers() -> Result<Vec<PeerInfo>, String> {
    let state = get_state()?;
    let peers = state.peers.read().await;
    Ok(peers.values().map(|p| p.info.clone()).collect())
}

#[tauri::command]
pub async fn get_key_fingerprint() -> Result<String, String> {
    let state = get_state()?;
    let key = state.key.read().await;
    Ok(crypto::key_fingerprint(&key))
}
