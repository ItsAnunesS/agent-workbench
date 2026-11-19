use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

pub const APP_ID: &str = "com.anuness.agentworkbench";
const TEMPLATE: &str = include_str!("../resources/com.anuness.agentworkbench.desktop");
const ICONS: &[(u32, &[u8])] = &[
    (32, include_bytes!("../icons/32x32.png")),
    (64, include_bytes!("../icons/64x64.png")),
    (128, include_bytes!("../icons/128x128.png")),
    (256, include_bytes!("../icons/128x128@2x.png")),
    (512, include_bytes!("../icons/icon.png")),
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    supported: bool,
    installed: bool,
    issue: Option<String>,
}
impl IntegrationStatus {
    fn localized(mut self, locale: crate::i18n::Locale) -> Self {
        self.issue = self.issue.map(|issue| crate::i18n::message(&issue, locale));
        self
    }
}
pub struct DesktopIntegration {
    status: Mutex<IntegrationStatus>,
    target: Option<(PathBuf, PathBuf)>,
}

pub fn prepare_application_identity() {
    #[cfg(target_os = "linux")]
    {
        // GTK 3 derives the Wayland app_id from g_get_prgname(), independently of
        // GtkApplication.application-id. Set it before GTK initializes any window.
        #[link(name = "glib-2.0")]
        extern "C" {
            fn g_set_prgname(name: *const std::ffi::c_char);
        }
        let name =
            std::ffi::CString::new(APP_ID).expect("The application ID must be a valid C string");
        // SAFETY: GLib copies this valid, NUL-terminated string. This runs once on
        // the main thread before GTK or the app runtime has been initialized.
        unsafe {
            g_set_prgname(name.as_ptr());
        }
    }
}

// Register the AppImage before GTK creates its application or first window.
// Only this application's own launcher and icon names are ever replaced.
pub fn initialize() -> DesktopIntegration {
    let target = if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .and_then(|image| {
                let data = std::env::var_os("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|home| PathBuf::from(home).join(".local/share"))
                    });
                data.map(|data| (image, data))
            })
    } else {
        None
    };
    let status = match &target {
        Some((image, data)) => match install(image, data) {
            Ok(()) => IntegrationStatus {
                supported: true,
                installed: true,
                issue: None,
            },
            Err(error) => IntegrationStatus {
                supported: true,
                installed: false,
                issue: Some(error),
            },
        },
        None => IntegrationStatus {
            supported: false,
            installed: false,
            issue: None,
        },
    };
    DesktopIntegration {
        status: Mutex::new(status),
        target,
    }
}

fn exec_argument(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or("The AppImage path uses an unsupported format.")?;
    if !path.is_absolute() || value.contains(['\n', '\r', '\0']) {
        return Err("The AppImage path is not valid for creating a launcher.".into());
    }
    // Exec quoting and desktop-entry string escaping are separate layers.
    let mut quoted = String::from("\"");
    for character in value.chars() {
        match character {
            '%' => quoted.push_str("%%"),
            '\\' | '"' | '$' | '`' => {
                quoted.push('\\');
                quoted.push(character);
            }
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    Ok(quoted.replace('\\', "\\\\"))
}
fn write_owned_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|existing| existing == bytes) {
        return Ok(());
    }
    let parent = path.parent().ok_or("Invalid launcher destination.")?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "Could not create application menu integration folders.")?;
    let temporary = parent.join(format!(".{APP_ID}-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Could not prepare application menu integration.")?;
        file.write_all(bytes)
            .map_err(|_| "Could not save the logo or launcher.")?;
        file.sync_all()
            .map_err(|_| "Could not finish writing the integration.")?;
        std::fs::rename(&temporary, path)
            .map_err(|_| "Could not update the logo or launcher in the menu.")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
fn install(image: &Path, data: &Path) -> Result<(), String> {
    if !image.is_file() || !data.is_absolute() {
        return Err("The AppImage or user data folder is unavailable.".into());
    }
    let command = exec_argument(image)?;
    for (size, bytes) in ICONS {
        let path = data.join(format!("icons/hicolor/{size}x{size}/apps/{APP_ID}.png"));
        write_owned_file(&path, bytes)?;
    }
    // The hicolor mtime notifies icon-theme watchers without spawning shell tools.
    let theme = data.join("icons/hicolor");
    std::fs::File::open(&theme)
        .and_then(|directory| directory.set_modified(std::time::SystemTime::now()))
        .map_err(|_| "Could not update the user's icon index.")?;
    let entry = TEMPLATE.replace("Exec=agent-workbench", &format!("Exec={command}"));
    write_owned_file(
        &data.join(format!("applications/{APP_ID}.desktop")),
        entry.as_bytes(),
    )
}
#[tauri::command]
pub fn desktop_integration_status(
    state: State<'_, DesktopIntegration>,

    locale: Option<String>,
) -> Result<IntegrationStatus, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<IntegrationStatus, String> = (|| {
        state
            .status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "Could not check system integration.".into())
    })();
    result
        .map_err(|error| crate::i18n::message(&error, language))
        .map(|value| value.localized(language))
}
#[tauri::command]
pub fn desktop_integration_repair(
    state: State<'_, DesktopIntegration>,

    locale: Option<String>,
) -> Result<IntegrationStatus, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<IntegrationStatus, String> = (|| {
        let (image, data) = state
            .target
            .as_ref()
            .ok_or("Repair is available in the Linux AppImage version.")?;
        let mut status = state
            .status
            .lock()
            .map_err(|_| "Integration unavailable.")?;
        match install(image, data) {
            Ok(()) => {
                status.installed = true;
                status.issue = None;
            }
            Err(error) => {
                status.installed = false;
                status.issue = Some(error);
            }
        }
        Ok(status.clone())
    })();
    result
        .map_err(|error| crate::i18n::message(&error, language))
        .map(|value| value.localized(language))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_exec_quotes_paths_without_shell_expansion_or_field_codes() {
        let value =
            exec_argument(Path::new("/tmp/Apps/Agent \"$HOME`test`\\50%.AppImage")).unwrap();
        assert_eq!(
            value,
            "\"/tmp/Apps/Agent \\\\\"\\\\$HOME\\\\`test\\\\`\\\\\\\\50%%.AppImage\""
        );
        assert!(exec_argument(Path::new("relative.AppImage")).is_err());
        assert!(exec_argument(Path::new("/tmp/bad\nExec=evil")).is_err());
    }
    #[test]
    fn icons_and_desktop_identity_match_native_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], APP_ID);
        assert_eq!(config["app"]["enableGTKAppId"], true);
        assert!(TEMPLATE.contains(&format!("Icon={APP_ID}\n")));
        assert!(TEMPLATE.contains("StartupWMClass=com.anuness.agentworkbench\n"));
        for (size, bytes) in ICONS {
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
            assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), *size);
            assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), *size);
        }
        assert!(include_bytes!("../icons/icon.ico").starts_with(b"\x00\x00\x01\x00"));
        assert!(include_bytes!("../icons/icon.icns").starts_with(b"icns"));
    }
    #[test]
    #[cfg(target_os = "linux")]
    fn registration_updates_only_owned_files_and_keeps_a_stable_launcher() {
        let root = std::env::temp_dir().join(format!("awb-desktop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let data = root.join("data");
        let image = root.join("Agent Workbench 1.AppImage");
        std::fs::write(&image, b"fixture").unwrap();
        install(&image, &data).unwrap();
        let unrelated = data.join("applications/other.desktop");
        std::fs::write(&unrelated, b"preserve").unwrap();
        let updated = root.join("Agent Workbench 2.AppImage");
        std::fs::write(&updated, b"fixture").unwrap();
        install(&updated, &data).unwrap();
        install(&updated, &data).unwrap();
        let entry =
            std::fs::read_to_string(data.join(format!("applications/{APP_ID}.desktop"))).unwrap();
        assert!(entry.contains("Agent Workbench 2.AppImage"));
        assert!(!entry.contains("Agent Workbench 1.AppImage"));
        assert_eq!(std::fs::read(unrelated).unwrap(), b"preserve");
        assert_eq!(
            std::fs::read_dir(data.join("applications"))
                .unwrap()
                .count(),
            2
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
