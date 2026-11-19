use crate::{
    tools::{resolve_scope, ToolScope},
    Database,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl};

const LABEL: &str = "tool-browser";
#[derive(Default)]
pub struct Browser(pub Mutex<Option<String>>);
#[derive(Clone, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Bounds {
    fn validate(&self) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0 || *v > 20_000.0)
            || self.width < 1.0
            || self.height < 1.0
        {
            return Err("Invalid browser bounds.".into());
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct RecentPage {
    url: String,
    title: String,
}
#[derive(Serialize)]
pub struct Snapshot {
    url: Option<String>,
    pages: Vec<RecentPage>,
}

pub fn initialize(db: &rusqlite::Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS browser_pages (scope TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,visited INTEGER NOT NULL,PRIMARY KEY(scope,url));")
}
fn allowed(url: &tauri::Url) -> bool {
    url.as_str().len() <= 8192
        && matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(
            url.host_str(),
            Some("ipc.localhost" | "tauri.localhost" | "asset.localhost")
        )
}
fn parse_url(raw: &str) -> Result<tauri::Url, String> {
    if raw.len() > 8192 {
        return Err("Enter a valid HTTP or HTTPS address.".into());
    }
    let url = tauri::Url::parse(raw).map_err(|_| "Enter a valid HTTP or HTTPS address.")?;
    if !allowed(&url) {
        return Err("Enter a valid HTTP or HTTPS address.".into());
    }
    Ok(url)
}
fn remember(app: &tauri::AppHandle, scope: &str, url: &tauri::Url, title: Option<&str>) {
    if !allowed(url) {
        return;
    }
    let database = app.state::<Database>();
    let Ok(db) = database.0.lock() else { return };
    // Failed history writes do not interrupt navigation, but remain visible in the process log.
    let result = (|| -> rusqlite::Result<()> {
        db.execute("INSERT INTO browser_pages(scope,url,title,visited) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,url) DO UPDATE SET title=CASE WHEN ?5 THEN excluded.title ELSE browser_pages.title END,visited=excluded.visited", params![scope,url.as_str(),title.unwrap_or(url.as_str()).chars().take(300).collect::<String>(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64,title.is_some()])?;
        db.execute("DELETE FROM browser_pages WHERE scope=?1 AND url NOT IN (SELECT url FROM browser_pages WHERE scope=?1 ORDER BY visited DESC LIMIT 50)",params![scope])?;
        Ok(())
    })();
    if result.is_err() {
        eprintln!("Could not save browser history.");
    }
}

#[tauri::command]
pub fn tool_browser_snapshot(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    browser: State<'_, Browser>,
    scope: ToolScope,
    locale: Option<String>,
) -> Result<Snapshot, String> {
    let result = (|| {
        let (key, _) = resolve_scope(&database, &scope)?;
        let db = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        let mut statement = db
            .prepare(
                "SELECT url,title FROM browser_pages WHERE scope=?1 ORDER BY visited DESC LIMIT 12",
            )
            .map_err(|_| "Could not read browser history.")?;
        let pages = statement
            .query_map(params![key], |row| {
                Ok(RecentPage {
                    url: row.get(0)?,
                    title: row.get(1)?,
                })
            })
            .map_err(|_| "Could not read browser history.")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Could not read browser history.")?;
        drop(statement);
        drop(db);
        let active = browser.0.lock().map_err(|_| "Browser unavailable.")?;
        let url = if active.as_ref() == Some(&key) {
            app.get_webview(LABEL)
                .and_then(|view| view.url().ok())
                .map(|url| url.to_string())
        } else {
            None
        };
        Ok(Snapshot { url, pages })
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[tauri::command]
pub async fn tool_browser(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    browser: State<'_, Browser>,
    scope: ToolScope,
    action: String,
    url: Option<String>,
    bounds: Option<Bounds>,
    locale: Option<String>,
) -> Result<(), String> {
    let result = async {
        if !cfg!(any(target_os = "linux", target_os = "windows")) && action == "open" {
            return Err(
                "Isolated integrated browsing is currently supported on Linux and Windows.".into(),
            );
        }
        // Closing or hiding must still work after a scope is archived or removed.
        let key = if matches!(action.as_str(), "close" | "hide") {
            crate::tools::scope_key(&scope)?
        } else {
            resolve_scope(&database, &scope)?.0
        };
        let mut active = browser.0.lock().map_err(|_| "Browser unavailable.")?;
        if matches!(action.as_str(), "close" | "hide") {
            if active.as_ref() == Some(&key) {
                if let Some(view) = app.get_webview(LABEL) {
                    if action == "close" {
                        view.close().map_err(|_| "Could not close browser.")?;
                        *active = None;
                    } else {
                        view.hide().map_err(|_| "Browser unavailable.")?;
                    }
                }
            }
            return Ok(());
        }
        if let Some(bounds) = &bounds {
            bounds.validate()?;
        }
        if action == "open" {
            let url = parse_url(url.as_deref().unwrap_or(""))?;
            let bounds = bounds.clone().ok_or("Invalid browser bounds.")?;
            if active.as_ref() != Some(&key) {
                if let Some(view) = app.get_webview(LABEL) {
                    view.close().map_err(|_| "Could not close browser.")?;
                }
                *active = None;
            }
            if let Some(view) = app.get_webview(LABEL) {
                view.navigate(url)
                    .map_err(|_| "Could not navigate browser.")?;
                view.show().map_err(|_| "Browser unavailable.")?;
            } else {
                let directory = app
                    .path()
                    .app_data_dir()
                    .map_err(|_| "Could not access local data.")?
                    .join("browser")
                    .join(&key);
                std::fs::create_dir_all(&directory)
                    .map_err(|_| "Could not prepare browser storage.")?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                        .map_err(|_| "Could not prepare browser storage.")?;
                }
                let navigation_app = app.clone();
                let navigation_key = key.clone();
                let title_app = app.clone();
                let title_key = key.clone();
                let builder = tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(url))
                    .data_directory(directory)
                    .devtools(false)
                    .on_navigation(move |url| {
                        if !allowed(url) {
                            return false;
                        }
                        remember(&navigation_app, &navigation_key, url, None);
                        true
                    })
                    .on_document_title_changed(move |view, title| {
                        if let Ok(url) = view.url() {
                            remember(&title_app, &title_key, &url, Some(&title));
                        }
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_download(|_, _| false);
                app.get_window("main")
                    .ok_or("Browser unavailable.")?
                    .add_child(
                        builder,
                        tauri::LogicalPosition::new(bounds.x, bounds.y),
                        tauri::LogicalSize::new(bounds.width, bounds.height),
                    )
                    .map_err(|_| "Could not open the integrated browser.")?;
                *active = Some(key.clone());
            }
        }
        if active.as_ref() != Some(&key) {
            return Err("Browser unavailable.".into());
        }
        let view = app.get_webview(LABEL).ok_or("Browser unavailable.")?;
        if let Some(bounds) = bounds {
            view.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|_| "Browser unavailable.")?;
            view.set_size(tauri::LogicalSize::new(bounds.width, bounds.height))
                .map_err(|_| "Browser unavailable.")?;
        }
        match action.as_str() {
            "open" | "bounds" => {}
            "show" => {
                view.show().map_err(|_| "Browser unavailable.")?;
            }
            "back" => {
                view.eval("history.back()")
                    .map_err(|_| "Could not navigate browser.")?;
            }
            "forward" => {
                view.eval("history.forward()")
                    .map_err(|_| "Could not navigate browser.")?;
            }
            "reload" => {
                view.reload().map_err(|_| "Could not navigate browser.")?;
            }
            _ => return Err("Invalid browser action.".into()),
        }
        Ok(())
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
    #[cfg(target_os = "linux")]
    #[ignore = "Requires native WebKit; run scripts/test-native-tools.sh in Docker"]
    fn native_browser_sessions_and_ipc_are_isolated() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            time::{Duration, Instant},
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let page =
                    "<!doctype html><title>Native session test</title><p>Browser fixture</p>";
                let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",page.len(),page);
            }
        });
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::initialize_database(&db).unwrap();
        let mut workspace = crate::initial_workspace();
        workspace.projects.push(crate::Project {
            id: "native-project".into(),
            environment_id: "personal".into(),
            name: "Native project".into(),
            path: "/tmp".into(),
            memory: String::new(),
            archived: false,
            pinned: false,
        });
        let mut task = crate::tests::conversation("personal", "chat");
        task.id = "standalone".into();
        workspace.conversations.push(task);
        db.execute(
            "INSERT INTO workspace VALUES(1,?1)",
            params![serde_json::to_string(&workspace).unwrap()],
        )
        .unwrap();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows[0].url =
            WebviewUrl::External("about:blank".parse().unwrap());
        context.config_mut().app.windows[0].visible = false;
        let app = tauri::Builder::default()
            .any_thread()
            .manage(Database(Mutex::new(db)))
            .manage(Browser::default())
            .manage(crate::terminal::Terminals::default())
            .invoke_handler(crate::app_commands)
            .build(context)
            .unwrap();
        let handle = app.handle().clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let ready_deadline = Instant::now() + Duration::from_secs(10);
                while handle.get_window("main").is_none() {
                    assert!(
                        Instant::now() < ready_deadline,
                        "Main window did not initialize"
                    );
                    std::thread::sleep(Duration::from_millis(20));
                }
                fn evaluate(app: &tauri::AppHandle, script: &str) -> serde_json::Value {
                    let (tx, rx) = std::sync::mpsc::channel();
                    app.get_webview(LABEL)
                        .unwrap()
                        .eval_with_callback(script.to_owned(), move |result| {
                            let _ = tx.send(result);
                        })
                        .unwrap();
                    match rx.recv_timeout(Duration::from_secs(15)) {
                        Ok(value) => serde_json::from_str(&value).unwrap(),
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            serde_json::Value::Null
                        }
                        Err(error) => panic!("Native JavaScript callback timed out: {error}"),
                    }
                }
                let project = ToolScope {
                    environment_id: "personal".into(),
                    project_id: Some("native-project".into()),
                    conversation_id: None,
                };
                let standalone = ToolScope {
                    environment_id: "personal".into(),
                    project_id: None,
                    conversation_id: Some("standalone".into()),
                };
                let url = format!("http://{address}/");
                let open = |scope: &ToolScope| {
                    tauri::async_runtime::block_on(tool_browser(
                        handle.clone(),
                        handle.state(),
                        handle.state(),
                        scope.clone(),
                        "open".into(),
                        Some(url.clone()),
                        Some(Bounds {
                            x: 0.,
                            y: 0.,
                            width: 400.,
                            height: 300.,
                        }),
                        None,
                    ))
                    .unwrap();
                    let deadline = Instant::now() + Duration::from_secs(20);
                    while evaluate(&handle, "document.title") != "Native session test" {
                        assert!(Instant::now() < deadline, "Native page did not load");
                        std::thread::sleep(Duration::from_millis(50));
                    }
                };
                let close = |scope: &ToolScope| {
                    tauri::async_runtime::block_on(tool_browser(
                        handle.clone(),
                        handle.state(),
                        handle.state(),
                        scope.clone(),
                        "close".into(),
                        None,
                        None,
                        None,
                    ))
                    .unwrap()
                };
                open(&project);
                evaluate(&handle,"localStorage.setItem('scope','project'); document.cookie='scope=project; Max-Age=3600; Path=/'; true");
                evaluate(&handle,"window.__ipcProbe='pending'; if (!window.__TAURI_INTERNALS__) window.__ipcProbe='blocked'; else window.__TAURI_INTERNALS__.invoke('load_workspace').then(()=>window.__ipcProbe='allowed').catch(()=>window.__ipcProbe='blocked'); true");
                let deadline = Instant::now() + Duration::from_secs(10);
                while evaluate(&handle, "window.__ipcProbe") == "pending" {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(50));
                }
                assert_eq!(evaluate(&handle, "window.__ipcProbe"), "blocked");
                close(&project);
                open(&standalone);
                assert!(evaluate(&handle, "localStorage.getItem('scope')").is_null());
                assert_eq!(evaluate(&handle, "document.cookie"), "");
                evaluate(&handle,"localStorage.setItem('scope','standalone'); document.cookie='scope=standalone; Max-Age=3600; Path=/'; true");
                close(&standalone);
                open(&project);
                assert_eq!(
                    evaluate(&handle, "localStorage.getItem('scope')"),
                    "project"
                );
                assert!(evaluate(&handle, "document.cookie")
                    .as_str()
                    .unwrap()
                    .contains("scope=project"));
                close(&project);
                open(&standalone);
                assert_eq!(
                    evaluate(&handle, "localStorage.getItem('scope')"),
                    "standalone"
                );
                close(&standalone);
                std::fs::create_dir_all(handle.path().home_dir().unwrap()).unwrap();
                let (output_tx, output_rx) = std::sync::mpsc::channel();
                let output = tauri::ipc::Channel::<crate::terminal::Output>::new(move |body| {
                    let _ = output_tx.send(body.deserialize::<serde_json::Value>().unwrap());
                    Ok(())
                });
                let terminal_id = tauri::async_runtime::block_on(crate::terminal::terminal_open(
                    handle.clone(),
                    handle.state(),
                    handle.state(),
                    standalone.clone(),
                    80,
                    24,
                    output,
                    None,
                ))
                .unwrap();
                assert!(
                    tauri::async_runtime::block_on(crate::terminal::terminal_control(
                        handle.state(),
                        handle.state(),
                        project.clone(),
                        terminal_id.clone(),
                        "write".into(),
                        Some("pwd\r".into()),
                        None,
                        None,
                        None
                    ))
                    .is_err()
                );
                tauri::async_runtime::block_on(crate::terminal::terminal_control(
                    handle.state(),
                    handle.state(),
                    standalone.clone(),
                    terminal_id.clone(),
                    "write".into(),
                    Some("printf 'NATIVE_PTY_OK\\n'\r".into()),
                    None,
                    None,
                    None,
                ))
                .unwrap();
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut received = String::new();
                while !received.contains("NATIVE_PTY_OK\r\n") {
                    assert!(Instant::now() < deadline, "PTY output did not arrive");
                    let message = output_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    let bytes: Vec<u8> = serde_json::from_value(message["data"].clone()).unwrap();
                    received.push_str(&String::from_utf8_lossy(&bytes));
                    tauri::async_runtime::block_on(crate::terminal::terminal_control(
                        handle.state(),
                        handle.state(),
                        standalone.clone(),
                        terminal_id.clone(),
                        "ack".into(),
                        Some(bytes.len().to_string()),
                        None,
                        None,
                        None,
                    ))
                    .unwrap();
                }
                tauri::async_runtime::block_on(crate::terminal::terminal_control(
                    handle.state(),
                    handle.state(),
                    standalone.clone(),
                    terminal_id.clone(),
                    "write".into(),
                    Some("stty -echo -icanon; sleep 2\r".into()),
                    None,
                    None,
                    None,
                ))
                .unwrap();
                std::thread::sleep(Duration::from_millis(100));
                let input_handle = handle.clone();
                let input_scope = standalone.clone();
                let input_id = terminal_id.clone();
                let pending_input = tauri::async_runtime::spawn(async move {
                    crate::terminal::terminal_control(
                        input_handle.state(),
                        input_handle.state(),
                        input_scope,
                        input_id,
                        "write".into(),
                        Some("x".repeat(65_000)),
                        None,
                        None,
                        None,
                    )
                    .await
                });
                std::thread::sleep(Duration::from_millis(100));
                let close_started = Instant::now();
                tauri::async_runtime::block_on(crate::terminal::terminal_control(
                    handle.state(),
                    handle.state(),
                    standalone.clone(),
                    terminal_id,
                    "close".into(),
                    None,
                    None,
                    None,
                    None,
                ))
                .unwrap();
                assert!(
                    close_started.elapsed() < Duration::from_secs(1),
                    "Closing a busy PTY must not wait for blocked input"
                );
                assert!(tauri::async_runtime::block_on(async {
                    tokio::time::timeout(Duration::from_secs(5), pending_input).await
                })
                .is_ok());
            }));
            let _ = tx.send(result.is_ok());
            handle.exit(0);
        });
        assert_eq!(app.run_return(|_, _| {}), 0);
        assert!(
            rx.recv_timeout(Duration::from_secs(60)).unwrap(),
            "Native browser smoke test failed"
        );
    }
    #[test]
    fn only_remote_web_schemes_without_credentials_are_allowed() {
        for raw in ["https://example.com", "http://localhost:3000"] {
            assert!(parse_url(raw).is_ok());
        }
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost",
            "http://ipc.localhost",
            "https://user:secret@example.com",
        ] {
            assert!(parse_url(raw).is_err());
        }
    }
    #[test]
    fn browser_history_is_partitioned_and_bounded_coordinates_are_required() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db.execute(
            "INSERT INTO browser_pages VALUES('project-a','https://a.test','A',1)",
            [],
        )
        .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM browser_pages WHERE scope='project-b'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(Bounds {
            x: 0.,
            y: 0.,
            width: 300.,
            height: 200.
        }
        .validate()
        .is_ok());
        assert!(Bounds {
            x: f64::NAN,
            y: 0.,
            width: 300.,
            height: 200.
        }
        .validate()
        .is_err());
    }
}
