use crate::{Database, Project};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tauri::{Manager, State};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolScope {
    pub environment_id: String,
    pub project_id: Option<String>,
    pub conversation_id: Option<String>,
}

pub fn scope_key(scope: &ToolScope) -> Result<String, String> {
    let (kind, id) = if let Some(id) = &scope.project_id {
        ("project", id)
    } else {
        (
            "conversation",
            scope
                .conversation_id
                .as_ref()
                .ok_or("Select a project or conversation to use this tool.")?,
        )
    };
    let encoded = serde_json::to_vec(&(&scope.environment_id, kind, id))
        .map_err(|_| "Invalid tool scope.")?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

pub fn resolve_scope(
    database: &Database,
    scope: &ToolScope,
) -> Result<(String, Option<Project>), String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "Could not access local data.")?;
    let workspace = crate::read_workspace(&db)?;
    if !workspace
        .environments
        .iter()
        .any(|item| item.id == scope.environment_id)
    {
        return Err("Invalid environment.".into());
    }
    let project_id = if let Some(id) = &scope.conversation_id {
        let conversation = workspace
            .conversations
            .iter()
            .find(|item| {
                item.id == *id && item.environment_id == scope.environment_id && !item.archived
            })
            .ok_or("Conversation unavailable.")?;
        if conversation.project_id != scope.project_id {
            return Err("Invalid project.".into());
        }
        conversation.project_id.as_ref()
    } else {
        scope.project_id.as_ref()
    };
    let project = if let Some(id) = project_id {
        let project = workspace
            .projects
            .iter()
            .find(|item| {
                item.id == *id && item.environment_id == scope.environment_id && !item.archived
            })
            .ok_or("Project unavailable.")?;
        Some(project.clone())
    } else {
        None
    };
    Ok((scope_key(scope)?, project))
}

pub fn project_root(
    app: &tauri::AppHandle,
    database: &Database,
    scope: &ToolScope,
) -> Result<PathBuf, String> {
    let (_, project) = resolve_scope(database, scope)?;
    let project = project.ok_or("Select a project folder to use this tool.")?;
    crate::worker::project_path(
        &project.path,
        &app.path()
            .app_data_dir()
            .map_err(|_| "Could not access local data.")?,
    )
}

fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.len() > 4096
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("The file is outside the selected project.".into());
    }
    let canonical = root
        .join(path)
        .canonicalize()
        .map_err(|_| "Could not open this project path.")?;
    if !canonical.starts_with(root) {
        return Err("The file is outside the selected project.".into());
    }
    Ok(canonical)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    directory: bool,
    symlink: bool,
}
#[derive(Serialize)]
pub struct FileListing {
    entries: Vec<FileEntry>,
    truncated: bool,
}

fn list(root: &Path, relative: &str) -> Result<FileListing, String> {
    let path = safe_path(root, relative)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in std::fs::read_dir(path).map_err(|_| "Could not read this folder.")? {
        if entries.len() >= 2000 {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|_| "Could not read this folder.")?;
        let metadata = entry
            .file_type()
            .map_err(|_| "Could not read this folder.")?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        entries.push(FileEntry {
            path: Path::new(relative).join(&name).to_string_lossy().into(),
            name,
            directory: metadata.is_dir(),
            symlink: metadata.is_symlink(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FileListing { entries, truncated })
}

fn read(root: &Path, relative: &str) -> Result<String, String> {
    use std::io::Read;
    let path = safe_path(root, relative)?;
    let file = std::fs::File::open(path).map_err(|_| "Could not read this file.")?;
    if !file
        .metadata()
        .map_err(|_| "Could not read this file.")?
        .is_file()
    {
        return Err("Choose a text file.".into());
    }
    let mut bytes = Vec::new();
    file.take(512_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read this file.")?;
    if bytes.len() > 512_000 {
        return Err("This file is too large to preview (500 KB maximum).".into());
    }
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed.".into());
    }
    String::from_utf8(bytes).map_err(|_| "Choose a UTF-8 text file.".into())
}

#[tauri::command]
pub async fn tool_files(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    scope: ToolScope,
    path: String,
    locale: Option<String>,
) -> Result<FileListing, String> {
    let result = async {
        let root = project_root(&app, &database, &scope)?;
        tauri::async_runtime::spawn_blocking(move || list(&root, &path))
            .await
            .map_err(|_| "Could not read this folder.")?
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
#[tauri::command]
pub async fn tool_read_file(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    scope: ToolScope,
    path: String,
    locale: Option<String>,
) -> Result<String, String> {
    let result = async {
        let root = project_root(&app, &database, &scope)?;
        tauri::async_runtime::spawn_blocking(move || read(&root, &path))
            .await
            .map_err(|_| "Could not read this file.")?
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_tabs_share_a_partition_and_standalone_tasks_are_isolated() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::initialize_database(&db).unwrap();
        let mut workspace = crate::initial_workspace();
        workspace.projects.push(Project {
            id: "project".into(),
            environment_id: "personal".into(),
            name: "Project".into(),
            path: "/tmp/project".into(),
            memory: String::new(),
            archived: false,
            pinned: false,
        });
        for id in ["one", "two"] {
            let mut task = crate::tests::conversation("personal", "chat");
            task.id = id.into();
            task.project_id = Some("project".into());
            workspace.conversations.push(task);
        }
        for id in ["three", "four"] {
            let mut task = crate::tests::conversation("personal", "chat");
            task.id = id.into();
            workspace.conversations.push(task);
        }
        db.execute(
            "INSERT INTO workspace VALUES(1,?1)",
            rusqlite::params![serde_json::to_string(&workspace).unwrap()],
        )
        .unwrap();
        let database = Database(std::sync::Mutex::new(db));
        let mut scope = ToolScope {
            environment_id: "personal".into(),
            project_id: Some("project".into()),
            conversation_id: Some("one".into()),
        };
        let first = resolve_scope(&database, &scope).unwrap().0;
        scope.conversation_id = Some("two".into());
        assert_eq!(resolve_scope(&database, &scope).unwrap().0, first);
        scope.project_id = None;
        assert!(resolve_scope(&database, &scope).is_err());
        scope.conversation_id = Some("three".into());
        let third = resolve_scope(&database, &scope).unwrap().0;
        assert_ne!(first, third);
        scope.conversation_id = Some("four".into());
        assert_ne!(third, resolve_scope(&database, &scope).unwrap().0);
        scope.environment_id = "work".into();
        assert!(resolve_scope(&database, &scope).is_err());
    }
    #[test]
    fn previews_text_and_rejects_traversal_binary_and_oversized_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(root.join("child")).unwrap();
        std::fs::write(root.join("child/code.ts"), "const value = 1;").unwrap();
        assert!(list(&root, "").unwrap().entries[0].directory);
        assert_eq!(read(&root, "child/code.ts").unwrap(), "const value = 1;");
        for path in ["../outside", "/etc/passwd", "child/../../outside"] {
            assert!(read(&root, path).is_err());
        }
        std::fs::write(root.join("binary"), [0, 1, 2]).unwrap();
        assert!(read(&root, "binary").is_err());
        std::fs::write(root.join("large"), vec![b'a'; 512_001]).unwrap();
        assert!(read(&root, "large").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", root.join("escape")).unwrap();
            assert!(read(&root, "escape").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
