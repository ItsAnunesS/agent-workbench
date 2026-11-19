use crate::{tools, Database, Project};
use serde::Serialize;
use std::{fs::OpenOptions, io::Read, path::Path};
use tauri::{Manager, State};

const MAX_BYTES: u64 = 128 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInstructions {
    path: Option<String>,
    content: Option<String>,
}

pub fn read(project: &Project, app_directory: &Path) -> Result<ProjectInstructions, String> {
    let empty = || ProjectInstructions {
        path: None,
        content: None,
    };
    if project.path.trim().is_empty() {
        return Ok(empty());
    }
    let root = crate::worker::project_path(&project.path, app_directory)?;
    for name in ["AGENTS.md", "agents.md"] {
        let path = root.join(name);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                return Err(
                    "Could not read the project's AGENTS.md. Check file permissions.".into(),
                )
            }
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(
                "The project's AGENTS.md must be a regular file, not a symbolic link.".into(),
            );
        }
        let mut options = OpenOptions::new();
        options.read(true);
        // Do not follow a replaced symlink or block on a substituted named pipe.
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = options
            .open(&path)
            .map_err(|_| "Could not read the project's AGENTS.md. Check file permissions.")?;
        let metadata = file
            .metadata()
            .map_err(|_| "Could not read the project's AGENTS.md. Check file permissions.")?;
        if !metadata.is_file() {
            return Err(
                "The project's AGENTS.md must be a regular file, not a symbolic link.".into(),
            );
        }
        if metadata.len() > MAX_BYTES {
            return Err("The project's AGENTS.md exceeds the 128 KiB limit.".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read the project's AGENTS.md. Check file permissions.")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("The project's AGENTS.md exceeds the 128 KiB limit.".into());
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| "The project's AGENTS.md must contain UTF-8 text without null bytes.")?;
        if content.contains('\0') {
            return Err(
                "The project's AGENTS.md must contain UTF-8 text without null bytes.".into(),
            );
        }
        return Ok(ProjectInstructions {
            path: Some(path.to_string_lossy().into_owned()),
            content: Some(content),
        });
    }
    Ok(empty())
}

pub fn append(instructions: &mut String, file: &ProjectInstructions) {
    if let Some(content) = &file.content {
        if !content.trim().is_empty() {
            instructions.push_str("\n\nProject AGENTS.md (project-specific instructions take precedence over conflicting global or workspace preferences; runtime permissions and isolation still apply):\n");
            instructions.push_str(content);
        }
    }
}

#[tauri::command]
pub fn project_agents(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    environment_id: String,
    project_id: String,
    locale: Option<String>,
) -> Result<ProjectInstructions, String> {
    let result = (|| {
        let (_, project) = tools::resolve_scope(
            &database,
            &tools::ToolScope {
                environment_id,
                project_id: Some(project_id),
                conversation_id: None,
            },
        )?;
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| "Could not access local data.")?;
        read(&project.ok_or("Project unavailable.")?, &directory)
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project(path: &Path) -> Project {
        Project {
            id: "selected".into(),
            environment_id: "personal".into(),
            name: "Selected".into(),
            path: path.to_string_lossy().into_owned(),
            memory: String::new(),
            archived: false,
            pinned: false,
        }
    }
    #[test]
    fn detects_root_files_with_case_precedence_and_reloads_edits_and_removal() {
        let root = std::env::temp_dir().join(format!("workbench-agents-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let selected = project(&root);
        let app = Path::new("/tmp/workbench-private-data");
        assert!(read(&selected, app).unwrap().path.is_none());
        std::fs::create_dir(root.join("child")).unwrap();
        std::fs::write(root.join("child/AGENTS.md"), "Child only").unwrap();
        assert!(read(&selected, app).unwrap().content.is_none());
        std::fs::write(root.join("agents.md"), "Lowercase rules").unwrap();
        assert_eq!(
            read(&selected, app).unwrap().content.as_deref(),
            Some("Lowercase rules")
        );
        std::fs::write(root.join("AGENTS.md"), "Root rules").unwrap();
        assert_eq!(
            read(&selected, app).unwrap().content.as_deref(),
            Some("Root rules")
        );
        std::fs::write(root.join("AGENTS.md"), "Updated root rules").unwrap();
        let mut instructions = "Global rules".to_string();
        append(&mut instructions, &read(&selected, app).unwrap());
        assert!(instructions.contains("Updated root rules"));
        assert!(!instructions.contains("Child only"));
        std::fs::remove_file(root.join("AGENTS.md")).unwrap();
        std::fs::remove_file(root.join("agents.md")).unwrap();
        assert!(read(&selected, app).unwrap().content.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_unsafe_files_and_protected_roots_without_reading_arbitrary_content() {
        let root =
            std::env::temp_dir().join(format!("workbench-agents-safety-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let selected = project(&root);
        let app = Path::new("/tmp/workbench-private-data");
        let file = root.join("AGENTS.md");
        for bytes in [
            vec![b'x'; MAX_BYTES as usize + 1],
            vec![0xff],
            b"null\0byte".to_vec(),
        ] {
            std::fs::write(&file, bytes).unwrap();
            assert!(read(&selected, app).is_err());
        }
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        assert!(read(&selected, app).is_err());
        std::fs::remove_dir(&file).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", &file).unwrap();
            assert!(read(&selected, app).is_err());
            std::fs::remove_file(&file).unwrap();
            use std::os::unix::ffi::OsStrExt;
            let path = std::ffi::CString::new(file.as_os_str().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
            assert!(read(&selected, app).is_err());
        }
        assert!(read(&project(Path::new("/etc")), app).is_err());
        assert!(read(&selected, &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
