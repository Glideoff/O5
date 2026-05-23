//! Chiffrement symétrique AES-256-GCM pour la couche communications OVERSEER.
//!
//! - Clé symétrique 32 octets pré-partagée, stockée dans %APPDATA%/com.overseer.foundation/overseer.key
//! - Nonce aléatoire 12 octets par message
//! - Format wire : hex(nonce || ciphertext)
//!
//! NOTE : la PSK doit être recopiée manuellement entre instances OVERSEER pour
//! que les messages soient déchiffrables des deux côtés. Spec Phase 5.1.

use aes_gcm::{aead::Aead, Aes256Gcm, Key, KeyInit, Nonce};
use rand::RngCore;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const KEY_FILENAME: &str = "overseer.key";

/// Récupère le chemin du fichier clé pour cette installation Tauri.
pub fn key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir : {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(KEY_FILENAME))
}

/// Lit la clé sur disque, en génère une nouvelle si absente.
pub fn load_or_create_key(app: &AppHandle) -> Result<Vec<u8>, String> {
    let path = key_path(app)?;
    if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() == 32 {
            return Ok(bytes);
        }
        // Clé invalide : on régénère pour éviter de planter
        eprintln!(
            "[OVERSEER] Clé invalide ({} octets), régénération.",
            bytes.len()
        );
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::write(&path, key).map_err(|e| e.to_string())?;
    println!(
        "[OVERSEER] Nouvelle clé AES-256 générée → {}",
        path.display()
    );
    Ok(key.to_vec())
}

/// Chiffre `plaintext` avec la clé fournie. Sortie : hex(nonce||ciphertext).
pub fn encrypt(key: &[u8], plaintext: &str) -> Result<String, String> {
    if key.len() != 32 {
        return Err("Clé AES doit faire 32 octets.".into());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Chiffrement échoué : {}", e))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend(ciphertext);
    Ok(hex::encode(combined))
}

/// Déchiffre `encoded` (hex(nonce||ciphertext)) avec la clé fournie.
pub fn decrypt(key: &[u8], encoded: &str) -> Result<String, String> {
    if key.len() != 32 {
        return Err("Clé AES doit faire 32 octets.".into());
    }
    let bytes = hex::decode(encoded).map_err(|e| format!("Hex invalide : {}", e))?;
    if bytes.len() < 12 + 1 {
        return Err("Payload trop court pour AES-GCM.".into());
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Déchiffrement échoué : {}", e))?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

/// Importe une clé de liaison (magic link) et l'enregistre sur disque.
pub fn import_key(app: &AppHandle, key_bytes: Vec<u8>) -> Result<(), String> {
    if key_bytes.len() != 32 {
        return Err("La clé doit faire 32 octets.".into());
    }
    let path = key_path(app)?;
    std::fs::write(&path, &key_bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Empreinte courte de la clé (pour debug : afficher 8 chars en UI).
pub fn key_fingerprint(key: &[u8]) -> String {
    let hex = hex::encode(key);
    hex.chars().take(12).collect()
}
