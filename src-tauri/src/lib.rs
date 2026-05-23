mod council_resolution;
mod crypto;
mod database;
mod magic_link;
mod network;
mod ollama;
mod player_sites;
mod scp_wiki;
mod websocket_server;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // DB SQLite
            let conn = database::init_database(app.handle())?;
            app.manage(database::DbState(Mutex::new(conn)));

            // Charge / génère la clé AES-256 partagée
            let key = crypto::load_or_create_key(app.handle())?;
            // Initialise l'état WS (lazy : pas de listener tant que start_ws_server n'est pas appelé)
            websocket_server::init_state(app.handle().clone(), key, "SITE-19".to_string());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::generate_incident,
            scp_wiki::get_scp_wiki_lore,
            scp_wiki::refresh_scp_wiki,
            scp_wiki::get_wikidot_scp_catalog,
            scp_wiki::import_scps_from_wiki,
            ollama::generate_field_report,
            ollama::check_ollama_status,
            ollama::list_ollama_models,
            database::get_all_scps,
            database::get_scp,
            database::save_incident,
            database::get_incidents,
            database::generate_scp_with_ai,
            database::update_scp_site,
            database::get_all_motions,
            database::get_motion,
            database::create_motion,
            database::generate_council_debate,
            database::cast_player_vote,
            network::scan_local_network,
            network::get_session_ip_suffix,
            network::get_known_sites,
            database::execute_sql,
            database::get_system_info,
            database::get_all_personnel,
            database::upsert_personnel,
            database::delete_personnel,
            database::get_site_staffing,
            database::get_all_sites_staffing,
            database::ensure_site_minimum_staffing,
            database::apply_incident_class_d_losses,
            database::generate_personnel_with_ai,
            player_sites::get_player_sites,
            player_sites::get_claimable_sites,
            player_sites::claim_site,
            player_sites::release_site,
            player_sites::auto_assign_site,
            player_sites::ensure_site_supervised,
            player_sites::maybe_council_assign_site,
            websocket_server::start_ws_server,
            websocket_server::get_ws_server_port,
            websocket_server::connect_to_peer,
            magic_link::create_magic_link,
            magic_link::join_magic_link,
            magic_link::get_link_endpoints,
            websocket_server::send_message,
            websocket_server::broadcast_message,
            websocket_server::broadcast_incident,
            websocket_server::get_connected_peers,
            websocket_server::get_key_fingerprint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
