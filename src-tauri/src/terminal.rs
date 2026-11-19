use crate::{
    tools::{resolve_scope, ToolScope},
    Database,
};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
};
use tauri::{ipc::Channel, Manager, State};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalConfig {
    pub executable: String,
    pub args: Vec<String>,
}
impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            executable: if cfg!(windows) {
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
            } else {
                "/bin/bash"
            }
            .into(),
            args: vec![],
        }
    }
}
impl TerminalConfig {
    fn validate(&self) -> Result<(), String> {
        if !std::path::Path::new(&self.executable).is_absolute()
            || self.executable.len() > 4096
            || self.executable.contains('\0')
            || self.args.len() > 20
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 2000 || arg.contains('\0'))
        {
            return Err("Invalid terminal configuration.".into());
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    global: TerminalConfig,
    environment_override: Option<TerminalConfig>,
    effective: TerminalConfig,
}
type ShellChild = std::sync::Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>;
fn stop_child(child: &ShellChild) -> Result<(), String> {
    let mut child = child.lock().map_err(|_| "Could not close terminal.")?;
    if child
        .try_wait()
        .map_err(|_| "Could not close terminal.")?
        .is_none()
    {
        child.kill().map_err(|_| "Could not close terminal.")?;
    }
    Ok(())
}
struct Session {
    scope: String,
    master: std::sync::Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: std::sync::Arc<Mutex<Box<dyn Write + Send>>>,
    child: ShellChild,
    credits: std::sync::Arc<tokio::sync::Semaphore>,
}
#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Session>>);
#[derive(Clone, Serialize)]
pub struct Output {
    data: Vec<u8>,
    exited: bool,
}

pub fn initialize(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS terminal_preferences (scope TEXT PRIMARY KEY,data TEXT NOT NULL);")
}
fn environment_key(db: &rusqlite::Connection, environment: Option<&str>) -> Result<String, String> {
    match environment {
        Some(id) => {
            if !crate::read_workspace(db)?
                .environments
                .iter()
                .any(|item| item.id == id)
            {
                return Err("Invalid environment.".into());
            }
            Ok(format!("environment:{id}"))
        }
        None => Ok("global".into()),
    }
}
fn read_config(db: &rusqlite::Connection, key: &str) -> Result<Option<TerminalConfig>, String> {
    use rusqlite::OptionalExtension;
    let value: Option<String> = db
        .query_row(
            "SELECT data FROM terminal_preferences WHERE scope=?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Could not read terminal settings.")?;
    value
        .map(|text| {
            let config: TerminalConfig =
                serde_json::from_str(&text).map_err(|_| "Could not read terminal settings.")?;
            config.validate()?;
            Ok(config)
        })
        .transpose()
}
fn preferences(
    db: &rusqlite::Connection,
    environment: Option<&str>,
) -> Result<Preferences, String> {
    let key = environment_key(db, environment)?;
    let global = read_config(db, "global")?.unwrap_or_default();
    let environment_override = if environment.is_some() {
        read_config(db, &key)?
    } else {
        None
    };
    Ok(Preferences {
        effective: environment_override
            .clone()
            .unwrap_or_else(|| global.clone()),
        global,
        environment_override,
    })
}
#[tauri::command]
pub fn terminal_preferences(
    database: State<'_, Database>,
    environment_id: Option<String>,
    locale: Option<String>,
) -> Result<Preferences, String> {
    let result = (|| {
        let db = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        preferences(&db, environment_id.as_deref())
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
#[tauri::command]
pub fn save_terminal_preferences(
    database: State<'_, Database>,
    environment_id: Option<String>,
    config: Option<TerminalConfig>,
    locale: Option<String>,
) -> Result<(), String> {
    let result = (|| {
        let db = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        let key = environment_key(&db, environment_id.as_deref())?;
        if let Some(config) = config {
            config.validate()?;
            let data =
                serde_json::to_string(&config).map_err(|_| "Invalid terminal configuration.")?;
            db.execute("INSERT INTO terminal_preferences(scope,data) VALUES(?1,?2) ON CONFLICT(scope) DO UPDATE SET data=excluded.data",params![key,data]).map_err(|_| "Could not save terminal settings.")?;
        } else {
            db.execute(
                "DELETE FROM terminal_preferences WHERE scope=?1",
                params![key],
            )
            .map_err(|_| "Could not save terminal settings.")?;
        }
        Ok(())
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
        return Err("Invalid terminal size.".into());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}
#[tauri::command]
pub async fn terminal_open(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    terminals: State<'_, Terminals>,
    scope: ToolScope,
    cols: u16,
    rows: u16,
    output: Channel<Output>,
    locale: Option<String>,
) -> Result<String, String> {
    let result = async {
        let (key, project) = resolve_scope(&database, &scope)?;
        let cwd = if project.is_some() {
            crate::tools::project_root(&app, &database, &scope)?
        } else {
            app.path()
                .home_dir()
                .map_err(|_| "Could not open terminal.")?
        };
        let config = {
            let db = database
                .0
                .lock()
                .map_err(|_| "Could not access local data.")?;
            preferences(&db, Some(&scope.environment_id))?.effective
        };
        if !std::path::Path::new(&config.executable).is_file() {
            return Err("The configured shell executable does not exist.".into());
        }
        let mut sessions = terminals.0.lock().map_err(|_| "Terminal unavailable.")?;
        if sessions.len() >= 8 {
            return Err("Close an existing terminal before opening another.").map_err(String::from);
        }
        let pair = native_pty_system()
            .openpty(size(cols, rows)?)
            .map_err(|_| "Could not open terminal.")?;
        let mut command = CommandBuilder::new(&config.executable);
        command.args(&config.args);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        // The manually controlled terminal inherits the user's shell environment, never the model transport.
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| "Could not start the configured shell.")?;
        drop(pair.slave);
        #[cfg(unix)]
        if let Some(fd) = pair.master.as_raw_fd() {
            // Nonblocking PTY I/O lets session cancellation interrupt a full input buffer.
            let result = unsafe {
                let flags = libc::fcntl(fd, libc::F_GETFL);
                if flags < 0 {
                    -1
                } else {
                    libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK)
                }
            };
            if result < 0 {
                let _ = child.kill();
                return Err("Could not open terminal.".into());
            }
        }
        let mut reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(_) => {
                let _ = child.kill();
                return Err("Could not open terminal.".into());
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(_) => {
                let _ = child.kill();
                return Err("Could not open terminal.".into());
            }
        };
        let credits = std::sync::Arc::new(tokio::sync::Semaphore::new(65_536));
        let child: ShellChild = std::sync::Arc::new(Mutex::new(child));
        let master = std::sync::Arc::new(Mutex::new(pair.master));
        let reader_master = master.clone();
        let reader_credits = credits.clone();
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Session {
                scope: key,
                master,
                writer: std::sync::Arc::new(Mutex::new(writer)),
                child: child.clone(),
                credits,
            },
        );
        let session_id = id.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                if reader_credits.is_closed() {
                    let _ = stop_child(&child);
                    break;
                }
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        // Bound in-flight output until xterm has parsed it, including in hidden tabs.
                        match tauri::async_runtime::block_on(
                            reader_credits.acquire_many(count as u32),
                        ) {
                            Ok(permit) => permit.forget(),
                            Err(_) => {
                                let _ = stop_child(&child);
                                break;
                            }
                        }
                        if output
                            .send(Output {
                                data: buffer[..count].to_vec(),
                                exited: false,
                            })
                            .is_err()
                        {
                            let _ = stop_child(&child);
                            break;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        #[cfg(unix)]
                        {
                            let fd = reader_master
                                .lock()
                                .ok()
                                .and_then(|master| master.as_raw_fd());
                            if let Some(fd) = fd {
                                let mut descriptor = libc::pollfd {
                                    fd,
                                    events: libc::POLLIN,
                                    revents: 0,
                                };
                                // reader_master keeps this descriptor alive throughout the poll.
                                unsafe {
                                    libc::poll(&mut descriptor, 1, 100);
                                }
                            } else {
                                break;
                            }
                        }
                        #[cfg(not(unix))]
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
            loop {
                let running = child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok())
                    .is_some_and(|status| status.is_none());
                if !running {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if let Ok(mut sessions) = app.state::<Terminals>().0.lock() {
                sessions.remove(&session_id);
            }
            let _ = output.send(Output {
                data: vec![],
                exited: true,
            });
        });
        Ok(id)
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
#[tauri::command]
pub async fn terminal_control(
    database: State<'_, Database>,
    terminals: State<'_, Terminals>,
    scope: ToolScope,
    id: String,
    action: String,
    data: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    locale: Option<String>,
) -> Result<(), String> {
    let result = async {
        let key = if action == "close" {
            crate::tools::scope_key(&scope)?
        } else {
            resolve_scope(&database, &scope)?.0
        };
        if action == "write" {
            let data = data.ok_or("Invalid terminal input.")?;
            if data.len() > 65_536 {
                return Err("Invalid terminal input.".into());
            }
            let (writer, credits, master) = {
                let sessions = terminals.0.lock().map_err(|_| "Terminal unavailable.")?;
                let session = sessions.get(&id).ok_or("Terminal unavailable.")?;
                if session.scope != key {
                    return Err("Terminal belongs to another project or conversation.".into());
                }
                (
                    session.writer.clone(),
                    session.credits.clone(),
                    session.master.clone(),
                )
            };
            // A busy shell must not block the UI, output acknowledgements or session closure.
            return tauri::async_runtime::spawn_blocking(move || {
                let mut writer = writer.lock().map_err(|_| "Could not write to terminal.")?;
                let _master = master;
                let mut remaining = data.as_bytes();
                while !remaining.is_empty() {
                    if credits.is_closed() {
                        return Err("Could not write to terminal.".into());
                    }
                    match writer.write(remaining) {
                        Ok(0) => return Err("Could not write to terminal.".into()),
                        Ok(count) => remaining = &remaining[count..],
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(5))
                        }
                        Err(_) => return Err("Could not write to terminal.".into()),
                    }
                }
                Ok(())
            })
            .await
            .map_err(|_| "Could not write to terminal.")?;
        }
        if action == "close" {
            let session = {
                let mut sessions = terminals.0.lock().map_err(|_| "Terminal unavailable.")?;
                let session = sessions.get(&id).ok_or("Terminal unavailable.")?;
                if session.scope != key {
                    return Err("Terminal belongs to another project or conversation.".into());
                }
                session.credits.close();
                sessions.remove(&id).ok_or("Terminal unavailable.")?
            };
            return tauri::async_runtime::spawn_blocking(move || stop_child(&session.child))
                .await
                .map_err(|_| "Could not close terminal.")?;
        }
        let mut sessions = terminals.0.lock().map_err(|_| "Terminal unavailable.")?;
        let session = sessions.get_mut(&id).ok_or("Terminal unavailable.")?;
        if session.scope != key {
            return Err("Terminal belongs to another project or conversation.".into());
        }
        match action.as_str() {
            "ack" => {
                let count = data
                    .and_then(|value| value.parse::<usize>().ok())
                    .filter(|count| *count <= 65_536)
                    .ok_or("Invalid terminal input.")?;
                if session.credits.available_permits() + count > 65_536 {
                    return Err("Invalid terminal input.".into());
                }
                session.credits.add_permits(count);
            }
            "resize" => session
                .master
                .lock()
                .map_err(|_| "Could not resize terminal.")?
                .resize(size(cols.unwrap_or(80), rows.unwrap_or(24))?)
                .map_err(|_| "Could not resize terminal.")?,
            _ => return Err("Invalid terminal action.".into()),
        }
        Ok(())
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut sessions) = app.state::<Terminals>().0.lock() {
        for session in sessions.values_mut() {
            session.credits.close();
            let _ = stop_child(&session.child);
        }
        sessions.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(unix)]
    fn local_shell_has_a_real_pty_and_respects_its_working_directory() {
        let pair = native_pty_system().openpty(size(80, 24).unwrap()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "test -t 0 && printf 'PTY_READY:' && pwd"]);
        command.cwd("/tmp");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        assert!(child.wait().unwrap().success());
        assert!(output.contains("PTY_READY:/tmp"));
    }
    #[test]
    fn environment_terminal_overrides_global_and_can_inherit_again() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::initialize_database(&db).unwrap();
        db.execute(
            "INSERT INTO workspace VALUES(1,?1)",
            params![serde_json::to_string(&crate::initial_workspace()).unwrap()],
        )
        .unwrap();
        let global = TerminalConfig {
            executable: "/bin/sh".into(),
            args: vec!["-l".into()],
        };
        db.execute(
            "INSERT INTO terminal_preferences VALUES('global',?1)",
            params![serde_json::to_string(&global).unwrap()],
        )
        .unwrap();
        assert_eq!(
            preferences(&db, Some("personal")).unwrap().effective,
            global
        );
        let custom = TerminalConfig {
            executable: "/bin/bash".into(),
            args: vec![],
        };
        db.execute(
            "INSERT INTO terminal_preferences VALUES('environment:personal',?1)",
            params![serde_json::to_string(&custom).unwrap()],
        )
        .unwrap();
        assert_eq!(
            preferences(&db, Some("personal")).unwrap().effective,
            custom
        );
        assert_eq!(preferences(&db, Some("work")).unwrap().effective, global);
        db.execute(
            "DELETE FROM terminal_preferences WHERE scope='environment:personal'",
            [],
        )
        .unwrap();
        assert_eq!(
            preferences(&db, Some("personal")).unwrap().effective,
            global
        );
        assert!(preferences(&db, Some("missing")).is_err());
        assert!(TerminalConfig {
            executable: "bash".into(),
            args: vec![]
        }
        .validate()
        .is_err());
        assert!(size(0, 24).is_err());
    }
}
