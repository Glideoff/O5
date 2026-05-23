//! Service Ollama — pont entre OVERSEER et le moteur LLM local.
//!
//! Cibler `http://localhost:11434`. Auto-détection du modèle préféré,
//! avec génération d'incidents Foundation au format JSON strict.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

use crate::database::DbState;
use crate::scp_wiki;

const OLLAMA_BASE: &str = "http://localhost:11434";

/// Ordre de préférence des modèles, du plus souhaitable au plus tolérable.
/// La détection prend le premier dont le nom commence par l'un de ces préfixes.
const PREFERRED_MODELS: &[&str] = &[
    "llama3.1", "llama3.2", "llama3", "mistral", "qwen2.5", "gemma2", "phi3",
];

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    /// Force Ollama à retourner du JSON strict.
    format: String,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Deserialize)]
struct ModelInfo {
    name: String,
}

/// Helper interne réutilisable : envoie un prompt à Ollama avec `format: "json"`
/// et renvoie la réponse brute (chaîne JSON validée).
///
/// Utilisé par les Tauri commands de ce module ET par `database::generate_scp_with_ai`.
pub async fn call_ollama_json(prompt: String) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let model = detect_model(&client).await?;

    let req = GenerateRequest {
        model,
        prompt,
        stream: false,
        format: "json".to_string(),
    };

    let response = client
        .post(format!("{}/api/generate", OLLAMA_BASE))
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Erreur HTTP Ollama : {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama a renvoyé un statut {}", response.status()));
    }

    let body: GenerateResponse = response
        .json()
        .await
        .map_err(|e| format!("Réponse Ollama invalide : {}", e))?;

    serde_json::from_str::<serde_json::Value>(&body.response).map_err(|e| {
        format!(
            "L'IA a renvoyé du contenu non-JSON ({}). Réponse brute : {}",
            e, body.response
        )
    })?;

    Ok(body.response)
}

/// Sélectionne le meilleur modèle disponible sur l'instance Ollama locale.
async fn detect_model(client: &Client) -> Result<String, String> {
    let response = client
        .get(format!("{}/api/tags", OLLAMA_BASE))
        .send()
        .await
        .map_err(|e| format!("Ollama injoignable : {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama a renvoyé un statut {} sur /api/tags",
            response.status()
        ));
    }

    let tags: TagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Réponse /api/tags illisible : {}", e))?;

    if tags.models.is_empty() {
        return Err(
            "Aucun modèle disponible sur Ollama. Exécute par exemple : ollama pull llama3.1".into(),
        );
    }

    for &pref in PREFERRED_MODELS {
        if let Some(m) = tags.models.iter().find(|m| m.name.starts_with(pref)) {
            return Ok(m.name.clone());
        }
    }

    // Aucun modèle préféré : on prend le premier disponible.
    Ok(tags.models[0].name.clone())
}

/// Construit le prompt système Foundation pour la génération d'incident.
fn build_prompt(scp_id: &str, site: &str, wiki_lore: &str) -> String {
    format!(
        "Tu es le système de rapport automatique de la SCP Foundation.\n\
Tu génères des rapports d'incidents de confinement en français.\n\
Respecte strictement les propriétés canoniques de l'objet ci-dessous (source Fondation SCP Wikidot).\n\
{wiki_lore}\
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :\n\
{{\n  \"incident_id\": \"INC-XXXX\" (où XXXX est un nombre aléatoire à 4 chiffres),\n  \
\"scp_id\": \"{scp_id}\",\n  \
\"site\": \"{site}\",\n  \
\"severity\": \"SAFE\" ou \"EUCLIDE\" ou \"KETER\",\n  \
\"title\": \"(titre court de l'incident, 5 à 10 mots)\",\n  \
\"description\": \"(2 ou 3 phrases narratives en style rapport officiel froid et factuel, avec des détails horrifiques subtils)\",\n  \
\"casualties\": \"(un nombre, ou 'AUCUNE', ou 'DONNÉES EXPURGÉES')\",\n  \
\"recommended_action\": \"(ordre court style militaire, une seule phrase)\",\n  \
\"containment_status\": \"BREACH\" ou \"CONTAINED\" ou \"MONITORING\",\n  \
\"timestamp\": \"(horodatage au format ISO 8601)\"\n}}\n\
\n\
Aucune explication, aucun préambule, aucun texte avant ou après le JSON."
    )
}

/// Génère un rapport d'incident Foundation via Ollama.
///
/// Retourne la string JSON brute renvoyée par le modèle, après validation
/// minimale qu'il s'agit de JSON parseable.
#[tauri::command]
pub async fn generate_incident(
    scp_id: String,
    site: String,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let wiki = scp_wiki::wiki_context_block(&state, &scp_id).await;
    call_ollama_json(build_prompt(&scp_id, &site, &wiki)).await
}

/// Vérifie qu'Ollama répond sur localhost:11434.
/// Timeout court (2s) pour ne pas bloquer le boot d'OVERSEER.
#[tauri::command]
pub async fn check_ollama_status() -> bool {
    let Ok(client) = Client::builder().timeout(Duration::from_secs(2)).build() else {
        return false;
    };

    client
        .get(format!("{}/api/tags", OLLAMA_BASE))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Construit le prompt pour un rapport de terrain MTF suite à une réponse O5.
fn build_field_report_prompt(
    incident_id: &str,
    scp_id: &str,
    site: &str,
    severity: &str,
    incident_description: &str,
    o5_response: &str,
    wiki_lore: &str,
) -> String {
    format!(
        "Tu es un agent MTF de terrain de la SCP Foundation, qui rédige son rapport \
post-intervention en français suite à un ordre d'un O5.\n\
\n\
Contexte :\n\
- Incident : {incident_id}\n\
- Objet : {scp_id} sur {site}\n\
- Classe : {severity}\n\
- Description initiale : {incident_description}\n\
- Ordre transmis par l'O5-1 : {o5_response}\n\
{wiki_lore}\
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :\n\
{{\n  \
\"agent\": \"(matricule fictif, ex: AGENT-7, MTF-Nu-7-04, etc.)\",\n  \
\"report\": \"(2 à 4 phrases de rapport de terrain factuel, ton militaire, ce que l'unité a exécuté et observé)\",\n  \
\"outcome\": \"SUCCESS\" ou \"PARTIAL\" ou \"FAILURE\",\n  \
\"casualties_update\": \"(nombre ou 'AUCUNE' ou 'DONNÉES EXPURGÉES')\",\n  \
\"containment_restored\": true ou false\n\
}}\n\
\n\
Aucun préambule, aucune explication hors-JSON."
    )
}

/// Génère un rapport de terrain (résolution) suite à une réponse O5.
/// La sortie JSON est validée puis renvoyée brute pour parsing côté frontend.
#[tauri::command]
pub async fn generate_field_report(
    incident_id: String,
    scp_id: String,
    site: String,
    severity: String,
    incident_description: String,
    o5_response: String,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let wiki = scp_wiki::wiki_context_block(&state, &scp_id).await;
    let prompt = build_field_report_prompt(
        &incident_id,
        &scp_id,
        &site,
        &severity,
        &incident_description,
        &o5_response,
        &wiki,
    );
    call_ollama_json(prompt).await
}

/// Construit le prompt de débat du Conseil O5.
///
/// `options_json` : chaîne JSON style `[{"id":"A","label":"...","description":"..."}]`
/// `council` : slice de tuples (id, codename, personnalité)
pub fn build_council_prompt(
    title: &str,
    description: &str,
    options_json: &str,
    council: &[(&str, &str, &str)],
) -> String {
    let council_block = council
        .iter()
        .map(|(id, code, perso)| format!("- {} (« {} ») — {}", id, code, perso))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
"Tu simules une séance du Conseil O5 de la SCP Foundation.\n\
Le Conseil compte 13 membres (O5-1 à O5-13). O5-1 est absent : son vote sera enregistré séparément.\n\
\n\
Motion en débat :\n\
- Titre : {title}\n\
- Description : {description}\n\
- Options disponibles (JSON) : {options_json}\n\
\n\
Membres du Conseil (avec personnalités) :\n\
{council_block}\n\
\n\
Pour CHACUN des 12 membres (O5-2 à O5-13), génère exactement UN statement de 1 à 3 phrases en français, fidèle à sa personnalité, ainsi qu'un vote pour l'une des options.\n\
\n\
Réponds UNIQUEMENT en JSON valide avec cette structure :\n\
{{\n  \"statements\": [\n    {{ \"o5_id\": \"O5-2\", \"content\": \"...\", \"vote\": \"A\" }},\n    {{ \"o5_id\": \"O5-3\", \"content\": \"...\", \"vote\": \"B\" }},\n    ... (toujours dans l'ordre O5-2 à O5-13, exactement 12 entrées)\n  ]\n}}\n\
\n\
Aucun préambule, aucune explication hors du JSON. Les `vote` doivent être un des `id` d'option ('A', 'B', etc.)."
    )
}

/// Construit le prompt pour la génération d'un nouvel SCP inédit.
pub fn build_scp_prompt() -> String {
    "Tu es le système de création documentaire de la SCP Foundation.\n\
Génère une fiche pour un nouvel objet SCP inédit en français.\n\
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :\n\
{\n  \
\"id\": \"SCP-XXXX\" (numéro à 4 chiffres entre 9000 et 9999, inédit),\n  \
\"name\": \"(nom court évocateur, ex : 'Le Miroir d'Octobre', 'L'Enfant des Tempêtes')\",\n  \
\"object_class\": \"SAFE\" ou \"EUCLIDE\" ou \"KETER\" ou \"THAUMIEL\",\n  \
\"site\": \"SITE-19\" ou \"SITE-██\" (gardez les blocs ██ pour les sites secrets),\n  \
\"containment_procedures\": \"(2 ou 3 phrases techniques de procédure de confinement, ton militaire et froid)\",\n  \
\"description\": \"(3 à 5 phrases narratives décrivant l'objet, ses propriétés anormales et son histoire d'acquisition, avec des détails troublants)\"\n}\n\
\n\
Aucun préambule, aucune explication hors du JSON."
        .to_string()
}

/// Construit le prompt pour générer un ou plusieurs effectifs Foundation.
///
/// `count` : nombre d'entrées demandées (1–10 recommandé par appel).
/// `site` : site d'affectation (ex. SITE-19).
/// `role_hint` : rôle forcé ou chaîne vide pour laisser l'IA varier.
pub fn build_personnel_prompt(count: u32, site: &str, role_hint: &str) -> String {
    let role_line = if role_hint.is_empty() {
        "Chaque entrée doit avoir un `role` parmi : \"O5\", \"MTF\", \"RESEARCHER\", \"CLASS_D\".\n\
Varie les rôles de façon réaliste pour un site Foundation (majorité MTF et chercheurs, quelques Classes D)."
            .to_string()
    } else {
        format!(
            "Toutes les entrées doivent avoir le rôle \"{role_hint}\" (sauf si impossible pour O5)."
        )
    };

    let single_schema = r#"{
  "id": "(matricule unique, ex: MTF-N7-04, DR-KLEIN, D-4821, jamais O5-1)",
  "codename": "(indicatif opérationnel ou D-XXXX)",
  "role": "O5" | "MTF" | "RESEARCHER" | "CLASS_D",
  "clearance_level": (0 pour CLASS_D, 1-4 selon le rôle, 5 uniquement pour O5),
  "site": "(site d'affectation)",
  "status": "ACTIVE"
}"#;

    if count <= 1 {
        format!(
            "Tu es le bureau RH classifié de la SCP Foundation.\n\
Génère UN dossier d'effectif fictif mais crédible en français.\n\
Site d'affectation obligatoire : {site}\n\
{role_line}\n\
\n\
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :\n\
{single_schema}\n\
\n\
Le champ `site` doit être exactement \"{site}\".\n\
Aucun préambule hors JSON."
        )
    } else {
        format!(
            "Tu es le bureau RH classifié de la SCP Foundation.\n\
Génère exactement {count} dossiers d'effectifs fictifs mais crédibles en français.\n\
Site d'affectation obligatoire pour tous : {site}\n\
{role_line}\n\
\n\
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :\n\
{{\n  \"personnel\": [\n    {single_schema},\n    ... ({count} entrées au total)\n  ]\n}}\n\
\n\
Chaque entrée doit avoir `site` = \"{site}\" et des `id` tous différents.\n\
Aucun préambule hors JSON."
        )
    }
}

/// Prompt pour traduire une motion adoptée en actions opérationnelles exécutables.
#[allow(clippy::too_many_arguments)]
pub fn build_council_resolution_prompt(
    motion_id: &str,
    title: &str,
    description: &str,
    category: &str,
    context: &str,
    winning_option_id: &str,
    winning_option_label: &str,
    incident_json: &str,
    scp_catalog: &str,
    sites_catalog: &str,
    wiki_lore: &str,
) -> String {
    format!(
        "Tu es le système d'exécution des décisions du Conseil O5 de la SCP Foundation.\n\
Une motion vient d'être adoptée. Tu dois produire un plan d'actions CONCRETES à appliquer immédiatement dans la base de données.\n\
\n\
Motion {motion_id} :\n\
- Titre : {title}\n\
- Catégorie : {category}\n\
- Description : {description}\n\
- Contexte : {context}\n\
- Option adoptée : {winning_option_id} — {winning_option_label}\n\
- Incident lié (JSON ou vide) : {incident_json}\n\
{wiki_lore}\
SCP existants : {scp_catalog}\n\
Sites Foundation : {sites_catalog}\n\
\n\
Réponds UNIQUEMENT en JSON valide :\n\
{{\n  \
\"summary\": \"(2-3 phrases en français : ce que le Conseil a ordonné et ce qui a été fait)\",\n  \
\"actions\": [\n    {{\n      \
\"type\": \"TRANSFER_SCP\" | \"CREATE_SITE\" | \"ASSIGN_SITE_TO_PLAYER\" | \"UPDATE_SCP_CLASS\" | \"UPDATE_SCP_CONTAINMENT_STATUS\" | \"UPDATE_CONTAINMENT_PROCEDURES\" | \"CREATE_SCP\" | \"STAFF_SITE\" | \"NO_OP\",\n      \
\"scp_id\": \"SCP-XXX\" (si pertinent),\n      \
\"site\": \"SITE-XX\" (si pertinent),\n      \
\"site_name\": \"nom lisible\",\n      \
\"site_designation\": \"description courte du site\",\n      \
\"object_class\": \"SAFE\" | \"EUCLIDE\" | \"KETER\" | \"THAUMIEL\" | \"APOLLYON\" | autre classe inventée,\n      \
\"containment_status\": \"CONTAINED\" | \"BREACH\" | \"PENDING\" | \"LOST\",\n      \
\"containment_procedures\": \"texte\",\n      \
\"name\": \"nom SCP si CREATE_SCP\",\n      \
\"description\": \"description si CREATE_SCP\",\n      \
\"note\": \"optionnel\"\n    }}\n  ]\n\
}}\n\
\n\
Règles :\n\
- Si la motion parle de créer un site pour un SCP, utilise CREATE_SITE puis ASSIGN_SITE_TO_PLAYER et TRANSFER_SCP.\n\
- Si reclassification, utilise UPDATE_SCP_CLASS (classes personnalisées autorisées).\n\
- Utilise le scp_id de l'incident lié quand le contexte est un INC-XXXX.\n\
- 1 à 6 actions maximum, toutes réalistes.\n\
- Aucun texte hors JSON."
    )
}

/// Liste les modèles disponibles sur Ollama. Utile pour la page Settings (Prompt 6.3).
#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(format!("{}/api/tags", OLLAMA_BASE))
        .send()
        .await
        .map_err(|e| format!("Ollama injoignable : {}", e))?;

    let tags: TagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Réponse Ollama invalide : {}", e))?;

    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
