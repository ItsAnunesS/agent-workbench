#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth_page;
mod desktop;
mod openai;
mod worker;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Environment {
    id: String,
    name: String,
    color: String,
    instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Project {
    id: String,
    environment_id: String,
    name: String,
    path: String,
    memory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    id: String,
    content: String,
    created_at: String,
    #[serde(default = "default_role")]
    role: String,
    #[serde(default)]
    status: Option<String>,
}

fn default_role() -> String {
    "user".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Conversation {
    id: String,
    environment_id: String,
    project_id: Option<String>,
    mode: String,
    title: String,
    messages: Vec<Message>,
    created_at: String,
    source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Workspace {
    version: u32,
    environments: Vec<Environment>,
    projects: Vec<Project>,
    conversations: Vec<Conversation>,
}

fn initial_workspace() -> Workspace {
    Workspace {
        version: 1,
        environments: vec![
            Environment {
                id: "personal".into(),
                name: "Pessoal".into(),
                color: "violet".into(),
                instructions: String::new(),
            },
            Environment {
                id: "work".into(),
                name: "Trabalho".into(),
                color: "blue".into(),
                instructions: String::new(),
            },
        ],
        projects: vec![],
        conversations: vec![],
    }
}

fn validate_workspace(workspace: &Workspace) -> Result<(), String> {
    if workspace.version != 1 || workspace.environments.is_empty() {
        return Err("Formato de dados inválido.".into());
    }
    let mut environment_ids = std::collections::HashSet::new();
    for environment in &workspace.environments {
        if environment.id.is_empty()
            || !environment_ids.insert(&environment.id)
            || environment.name.trim().is_empty()
            || environment.name.chars().count() > 80
            || !["violet", "blue", "green", "orange"].contains(&environment.color.as_str())
            || environment.instructions.chars().count() > 100_000
        {
            return Err("Ambiente inválido.".into());
        }
    }
    let mut project_ids = std::collections::HashSet::new();
    for project in &workspace.projects {
        if project.id.is_empty()
            || !project_ids.insert(&project.id)
            || !environment_ids.contains(&project.environment_id)
            || project.name.trim().is_empty()
            || project.name.chars().count() > 80
            || project.path.len() > 4096
            || project.memory.chars().count() > 100_000
        {
            return Err("Projeto inválido.".into());
        }
    }
    let mut conversation_ids = std::collections::HashSet::new();
    for conversation in &workspace.conversations {
        if conversation.id.is_empty()
            || !conversation_ids.insert(&conversation.id)
            || !environment_ids.contains(&conversation.environment_id)
            || !["chat", "worker"].contains(&conversation.mode.as_str())
            || conversation.title.trim().is_empty()
            || conversation.title.chars().count() > 100
        {
            return Err("Conversa inválida.".into());
        }
        if let Some(project_id) = &conversation.project_id {
            if !workspace.projects.iter().any(|project| {
                &project.id == project_id && project.environment_id == conversation.environment_id
            }) {
                return Err("O projeto pertence a outro ambiente.".into());
            }
        }
        let mut message_ids = std::collections::HashSet::new();
        for message in &conversation.messages {
            if message.id.is_empty()
                || !message_ids.insert(&message.id)
                || message.content.trim().is_empty()
                || message.content.chars().count() > 2_000_000
                || !["user", "assistant"].contains(&message.role.as_str())
                || message
                    .status
                    .as_deref()
                    .is_some_and(|status| !["completed", "interrupted", "failed"].contains(&status))
            {
                return Err("Mensagem inválida.".into());
            }
        }
        if let Some(source_id) = &conversation.source_id {
            if conversation.mode != "worker"
                || !workspace.conversations.iter().any(|source| {
                    &source.id == source_id
                        && source.environment_id == conversation.environment_id
                        && source.mode == "chat"
                })
            {
                return Err("A origem da tarefa deve ser um Chat do mesmo ambiente.".into());
            }
        }
    }
    Ok(())
}

struct Database(Mutex<Connection>);

fn initialize_database(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);")?;
    Ok(())
}

#[tauri::command]
fn load_workspace(database: State<'_, Database>) -> Result<Workspace, String> {
    let connection = database
        .0
        .lock()
        .map_err(|_| "Não foi possível aceder aos dados locais.")?;
    read_workspace(&connection)
}

fn read_workspace(connection: &Connection) -> Result<Workspace, String> {
    let data = connection.query_row("SELECT data FROM workspace WHERE id = 1", [], |row| {
        row.get::<_, String>(0)
    });
    match data {
        Ok(data) => {
            let workspace = serde_json::from_str(&data).map_err(|_| {
                "Os dados locais não puderam ser lidos. Os ficheiros foram preservados.".to_string()
            })?;
            validate_workspace(&workspace)?;
            Ok(workspace)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(initial_workspace()),
        Err(_) => Err("Não foi possível ler a base de dados local.".into()),
    }
}

#[tauri::command]
fn save_workspace(workspace: Workspace, database: State<'_, Database>) -> Result<(), String> {
    validate_workspace(&workspace)?;
    let data =
        serde_json::to_string(&workspace).map_err(|_| "Não foi possível preparar os dados.")?;
    if data.len() > 20_000_000 {
        return Err("O espaço local excedeu o limite de 20 MB desta versão.".into());
    }
    let connection = database
        .0
        .lock()
        .map_err(|_| "Não foi possível aceder aos dados locais.")?;
    connection.execute("INSERT INTO workspace (id, data) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET data = excluded.data", params![data])
        .map_err(|_| "Não foi possível guardar. Verifica o espaço disponível no disco.")?;
    Ok(())
}

fn main() {
    desktop::prepare_application_identity();
    let desktop_integration = desktop::initialize();
    tauri::Builder::default()
        .manage(desktop_integration)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("icons/128x128@2x.png"))?;
            }
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            let connection = Connection::open(directory.join("workbench.sqlite3"))?;
            initialize_database(&connection)?;
            app.manage(worker::initialize(&directory, &connection)?);
            app.manage(openai::initialize(&directory)?);
            app.manage(Database(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            desktop::desktop_integration_status,
            desktop::desktop_integration_repair,
            openai::openai_accounts,
            openai::openai_login,
            openai::openai_cancel_login,
            openai::openai_models,
            openai::openai_chat,
            openai::openai_cancel_chat,
            openai::openai_logout,
            worker::worker_runtime,
            worker::worker_prepare,
            worker::worker_history,
            worker::worker_run,
            worker::worker_cancel,
            worker::worker_approve
        ])
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o Agent Workbench")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                worker::shutdown(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn conversation(environment_id: &str, mode: &str) -> Conversation {
        Conversation {
            id: "conversation".into(),
            environment_id: environment_id.into(),
            project_id: None,
            mode: mode.into(),
            title: "Test".into(),
            messages: vec![],
            created_at: "2026-11-18".into(),
            source_id: None,
        }
    }

    #[test]
    fn rejects_cross_environment_project_access() {
        let mut workspace = initial_workspace();
        workspace.projects.push(Project {
            id: "private".into(),
            environment_id: "personal".into(),
            name: "Private".into(),
            path: String::new(),
            memory: String::new(),
        });
        let mut task = conversation("work", "worker");
        task.project_id = Some("private".into());
        workspace.conversations.push(task);
        assert!(validate_workspace(&workspace).is_err());
    }

    #[test]
    fn rejects_cross_environment_handoff() {
        let mut workspace = initial_workspace();
        workspace
            .conversations
            .push(conversation("personal", "chat"));
        let mut task = conversation("work", "worker");
        task.id = "task".into();
        task.source_id = Some("conversation".into());
        workspace.conversations.push(task);
        assert!(validate_workspace(&workspace).is_err());
    }

    #[test]
    fn accepts_explicit_handoff_without_changing_original_chat() {
        let mut workspace = initial_workspace();
        workspace
            .conversations
            .push(conversation("personal", "chat"));
        let mut task = conversation("personal", "worker");
        task.id = "task".into();
        task.source_id = Some("conversation".into());
        workspace.conversations.push(task);
        assert!(validate_workspace(&workspace).is_ok());
        assert_eq!(workspace.conversations[0].mode, "chat");
    }

    #[test]
    fn sqlite_round_trip_preserves_modes_and_memory() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let mut workspace = initial_workspace();
        workspace.environments[0].instructions = "Private preferences".into();
        workspace
            .conversations
            .push(conversation("personal", "chat"));
        let data = serde_json::to_string(&workspace).unwrap();
        connection
            .execute(
                "INSERT INTO workspace (id, data) VALUES (1, ?1)",
                params![data],
            )
            .unwrap();
        let stored: String = connection
            .query_row("SELECT data FROM workspace WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        let restored: Workspace = serde_json::from_str(&stored).unwrap();
        assert_eq!(restored.environments[0].instructions, "Private preferences");
        assert_eq!(restored.conversations[0].mode, "chat");
    }

    #[test]
    fn accepts_unicode_names_and_titles_within_character_limits() {
        let mut workspace = initial_workspace();
        workspace.environments[0].name = "環".repeat(80);
        let mut chat = conversation("personal", "chat");
        chat.title = "🚀".repeat(80);
        workspace.conversations.push(chat);
        assert!(validate_workspace(&workspace).is_ok());
        workspace.environments[0].name.push('a');
        assert!(validate_workspace(&workspace).is_err());
    }

    #[test]
    fn loads_messages_saved_before_chat_roles_were_added() {
        let mut value = serde_json::to_value(initial_workspace()).unwrap();
        value["conversations"] = serde_json::json!([{
            "id": "legacy", "environmentId": "personal", "projectId": null,
            "mode": "chat", "title": "Existing note", "createdAt": "2026-11-18",
            "sourceId": null, "messages": [{ "id": "old-message", "content": "Keep my existing context", "createdAt": "2026-11-18" }]
        }]);
        let workspace: Workspace = serde_json::from_value(value).unwrap();
        assert!(validate_workspace(&workspace).is_ok());
        assert_eq!(workspace.conversations[0].messages[0].role, "user");
        assert_eq!(
            workspace.conversations[0].messages[0].content,
            "Keep my existing context"
        );
    }
}
