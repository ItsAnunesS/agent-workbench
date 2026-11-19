use std::path::{Path, PathBuf};
use tauri::Manager;

const PICKER_ERROR: &str = "Could not open the folder chooser. Try again.";
const PATH_ERROR: &str = "Could not use the selected folder. Choose a valid local project folder.";
static PICKER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn validate_path(value: &str, app_directory: &Path) -> Result<(), String> {
    if value.len() > 4096 || value.contains('\0') || !Path::new(value).is_absolute() {
        return Err(PATH_ERROR.into());
    }
    crate::worker::project_path(value, app_directory).map_err(|_| PATH_ERROR.to_string())?;
    Ok(())
}

// Use GTK already linked by Tauri; no shell commands or additional dependencies.
#[cfg(target_os = "linux")]
mod native {
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    #[link(name = "gtk-3")]
    extern "C" {
        fn gtk_file_chooser_native_new(
            title: *const c_char,
            parent: *mut c_void,
            action: c_int,
            accept: *const c_char,
            cancel: *const c_char,
        ) -> *mut c_void;
        fn gtk_file_chooser_set_current_folder(
            chooser: *mut c_void,
            folder: *const c_char,
        ) -> c_int;
        fn gtk_file_chooser_set_local_only(chooser: *mut c_void, local: c_int);
        fn gtk_file_chooser_get_filename(chooser: *mut c_void) -> *mut c_char;
        fn gtk_native_dialog_set_modal(dialog: *mut c_void, modal: c_int);
        fn gtk_native_dialog_run(dialog: *mut c_void) -> c_int;
    }
    #[link(name = "gobject-2.0")]
    extern "C" {
        fn g_object_unref(object: *mut c_void);
    }
    #[link(name = "glib-2.0")]
    extern "C" {
        fn g_free(memory: *mut c_void);
    }

    pub fn choose(
        initial: Option<&str>,
        locale: crate::i18n::Locale,
    ) -> Result<Option<String>, String> {
        let label = |key| {
            CString::new(crate::i18n::message(key, locale))
                .map_err(|_| super::PICKER_ERROR.to_string())
        };
        let title = label("Select a project folder")?;
        let accept = label("Choose folder")?;
        let cancel = label("Cancel")?;
        let initial = initial.and_then(|value| CString::new(value).ok());
        // SAFETY: Called only on Tauri's GTK main thread. The dialog owns its GTK
        // state; GTK copies the NUL-terminated labels. Returned filenames are
        // copied before g_free, and the owned dialog is unreferenced exactly once.
        unsafe {
            let dialog = gtk_file_chooser_native_new(
                title.as_ptr(),
                std::ptr::null_mut(),
                2,
                accept.as_ptr(),
                cancel.as_ptr(),
            );
            if dialog.is_null() {
                return Err(super::PICKER_ERROR.into());
            }
            gtk_file_chooser_set_local_only(dialog, 1);
            gtk_native_dialog_set_modal(dialog, 1);
            if let Some(initial) = initial.as_ref() {
                gtk_file_chooser_set_current_folder(dialog, initial.as_ptr());
            }
            let response = gtk_native_dialog_run(dialog);
            let result = if response == -3 {
                let filename = gtk_file_chooser_get_filename(dialog);
                if filename.is_null() {
                    Err(super::PATH_ERROR.into())
                } else {
                    let result = CStr::from_ptr(filename)
                        .to_str()
                        .map(str::to_owned)
                        .map(Some)
                        .map_err(|_| super::PATH_ERROR.to_string());
                    g_free(filename.cast());
                    result
                }
            } else {
                Ok(None)
            };
            g_object_unref(dialog);
            result
        }
    }
}

#[tauri::command]
pub async fn select_project_folder(
    app: tauri::AppHandle,
    initial_path: Option<String>,
    locale: Option<String>,
) -> Result<Option<String>, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result = async {
        let _guard = PICKER.try_lock().map_err(|_| PICKER_ERROR.to_string())?;
        let directory: PathBuf = app
            .path()
            .app_data_dir()
            .map_err(|_| PATH_ERROR.to_string())?;
        let initial = initial_path.filter(|value| validate_path(value, &directory).is_ok());
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            #[cfg(target_os = "linux")]
            let result = native::choose(initial.as_deref(), language);
            #[cfg(not(target_os = "linux"))]
            let result = {
                let _ = initial;
                Err::<Option<String>, String>(PICKER_ERROR.into())
            };
            let _ = sender.send(result);
        })
        .map_err(|_| PICKER_ERROR.to_string())?;
        let selected = receiver.await.map_err(|_| PICKER_ERROR.to_string())??;
        if let Some(value) = &selected {
            validate_path(value, &directory)?;
        }
        Ok(selected)
    }
    .await;
    result.map_err(|error: String| crate::i18n::message(&error, language))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_local_project_folders_without_trimming_the_selected_path() {
        let root = std::env::temp_dir().join(format!("awb-folder-test-{}", uuid::Uuid::new_v4()));
        let selected = root.join("project with trailing space ");
        std::fs::create_dir_all(&selected).unwrap();
        let app_directory = root.join("app-data");
        let value = selected.to_str().unwrap();
        assert!(validate_path(value, &app_directory).is_ok());
        for invalid in [
            "relative",
            "/",
            "/etc",
            "/tmp/missing-awb-folder",
            "bad\0path",
        ] {
            assert!(
                validate_path(invalid, &app_directory).is_err(),
                "{invalid:?}"
            );
        }
        std::fs::create_dir(&app_directory).unwrap();
        assert!(validate_path(app_directory.to_str().unwrap(), &app_directory).is_err());
        let file = root.join("file");
        std::fs::write(&file, b"fixture").unwrap();
        assert!(validate_path(file.to_str().unwrap(), &app_directory).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Requires GTK and Xvfb; run the native folder picker smoke test separately"]
    #[cfg(target_os = "linux")]
    fn native_folder_picker_accepts_exact_paths_and_cancels() {
        use std::ffi::{c_char, c_int, c_void, CStr, CString};
        #[repr(C)]
        struct List {
            data: *mut c_void,
            next: *mut List,
            previous: *mut List,
        }
        #[link(name = "gtk-3")]
        extern "C" {
            fn gtk_init_check(argc: *mut c_int, argv: *mut *mut *mut c_char) -> c_int;
            fn gtk_window_list_toplevels() -> *mut List;
            fn gtk_window_get_title(window: *mut c_void) -> *const c_char;
            fn gtk_file_chooser_set_filename(chooser: *mut c_void, name: *const c_char) -> c_int;
            fn gtk_dialog_response(dialog: *mut c_void, response: c_int);
        }
        #[link(name = "glib-2.0")]
        extern "C" {
            fn g_list_free(list: *mut List);
            fn g_timeout_add(
                interval: u32,
                callback: unsafe extern "C" fn(*mut c_void) -> c_int,
                data: *mut c_void,
            ) -> u32;
        }
        struct Response {
            path: CString,
            accept: bool,
            selected: bool,
        }
        // SAFETY: GLib invokes this on the same GTK test thread. The boxed state
        // lives until the callback responds, and only this test's dialog matches.
        unsafe extern "C" fn respond(data: *mut c_void) -> c_int {
            let state = &mut *data.cast::<Response>();
            let list = gtk_window_list_toplevels();
            let mut entry = list;
            let mut finished = false;
            while !entry.is_null() {
                let window = (*entry).data;
                let title = gtk_window_get_title(window);
                if !title.is_null()
                    && CStr::from_ptr(title).to_bytes() == b"Select a project folder"
                {
                    if state.accept && !state.selected {
                        gtk_file_chooser_set_filename(window, state.path.as_ptr());
                        state.selected = true;
                    } else {
                        gtk_dialog_response(window, if state.accept { -3 } else { -6 });
                        finished = true;
                    }
                    break;
                }
                entry = (*entry).next;
            }
            g_list_free(list);
            if finished {
                drop(Box::from_raw(data.cast::<Response>()));
                0
            } else {
                1
            }
        }
        // SAFETY: This ignored test runs alone on one thread in a disposable Xvfb.
        unsafe {
            assert_ne!(
                gtk_init_check(std::ptr::null_mut(), std::ptr::null_mut()),
                0
            );
        }
        let root = std::env::temp_dir().join(format!("awb-native-folder-{}", uuid::Uuid::new_v4()));
        let selected = root.join("project with trailing space ");
        std::fs::create_dir_all(&selected).unwrap();
        let value = selected.to_str().unwrap();
        for accept in [false, true] {
            let state = Box::new(Response {
                path: CString::new(value).unwrap(),
                accept,
                selected: false,
            });
            // SAFETY: Ownership passes to the callback until it returns false.
            unsafe {
                g_timeout_add(500, respond, Box::into_raw(state).cast());
            }
            let result =
                super::native::choose(Some(root.to_str().unwrap()), crate::i18n::Locale::English)
                    .unwrap();
            assert_eq!(result, if accept { Some(value.into()) } else { None });
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
