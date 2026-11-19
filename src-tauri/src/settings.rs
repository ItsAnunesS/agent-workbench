use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AppSettings {
    pub agents_markdown: String,
    pub commit_convention: String,
    pub pull_request_convention: String,
    pub branch_convention: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        // Explicit fields avoid recursive serde defaults while loading the bundled defaults.
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../../src/global-settings-defaults.json"))
                .expect("Bundled global settings must be valid JSON");
        Self {
            agents_markdown: value["agentsMarkdown"].as_str().unwrap_or_default().into(),
            commit_convention: value["commitConvention"]
                .as_str()
                .unwrap_or_default()
                .into(),
            pull_request_convention: value["pullRequestConvention"]
                .as_str()
                .unwrap_or_default()
                .into(),
            branch_convention: value["branchConvention"]
                .as_str()
                .unwrap_or_default()
                .into(),
        }
    }
}

impl AppSettings {
    fn validate(&self) -> Result<(), String> {
        if self.agents_markdown.chars().count() > 100_000
            || [
                &self.commit_convention,
                &self.pull_request_convention,
                &self.branch_convention,
            ]
            .iter()
            .any(|value| value.chars().count() > 4_000)
            || [
                &self.agents_markdown,
                &self.commit_convention,
                &self.pull_request_convention,
                &self.branch_convention,
            ]
            .iter()
            .any(|value| value.contains('\0'))
        {
            return Err("Invalid global instructions or conventions.".into());
        }
        Ok(())
    }

    pub fn instructions(&self, workspace_instructions: &str) -> String {
        let mut sections = Vec::new();
        for (heading, content) in [
            ("Global AGENTS.md", self.agents_markdown.as_str()),
            ("Commit convention", self.commit_convention.as_str()),
            (
                "Pull request convention",
                self.pull_request_convention.as_str(),
            ),
            ("Branch convention", self.branch_convention.as_str()),
            ("Workspace instructions", workspace_instructions),
        ] {
            if !content.trim().is_empty() {
                sections.push(format!("{heading}:\n{content}"));
            }
        }
        if sections.is_empty() {
            return String::new();
        }
        format!("Apply the following instructions when relevant. Git conventions specify formatting, not permission to commit, publish or perform other actions.\n\n{}", sections.join("\n\n"))
    }
}

pub fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);")
}

pub fn read(connection: &Connection) -> Result<AppSettings, String> {
    let data = connection.query_row("SELECT data FROM app_settings WHERE id=1", [], |row| {
        row.get::<_, String>(0)
    });
    match data {
        Ok(data) => {
            let settings: AppSettings =
                serde_json::from_str(&data).map_err(|_| "Could not read global settings.")?;
            settings.validate()?;
            Ok(settings)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(AppSettings::default()),
        Err(_) => Err("Could not read global settings.".into()),
    }
}

fn save(connection: &Connection, settings: &AppSettings) -> Result<(), String> {
    settings.validate()?;
    let data = serde_json::to_string(settings).map_err(|_| "Could not prepare global settings.")?;
    connection.execute("INSERT INTO app_settings(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![data])
        .map_err(|_| "Could not save global settings.")?;
    Ok(())
}

#[tauri::command]
pub fn load_app_settings(
    database: State<'_, crate::Database>,
    locale: Option<String>,
) -> Result<AppSettings, String> {
    let result = (|| {
        let connection = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        read(&connection)
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[tauri::command]
pub fn save_app_settings(
    settings: AppSettings,
    database: State<'_, crate::Database>,
    locale: Option<String>,
) -> Result<(), String> {
    let result = (|| {
        let connection = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        save(&connection, &settings)
    })();
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn global_settings_round_trip_without_rewriting_workspace_data() {
        let connection = Connection::open_in_memory().unwrap();
        crate::initialize_database(&connection).unwrap();
        let workspace = serde_json::to_string(&crate::initial_workspace()).unwrap();
        connection
            .execute(
                "INSERT INTO workspace(id,data) VALUES(1,?1)",
                params![workspace],
            )
            .unwrap();
        let mut settings = read(&connection).unwrap();
        settings.agents_markdown = "# Global instructions\nAlways include validation.".into();
        settings.commit_convention = "fix: short description".into();
        save(&connection, &settings).unwrap();
        assert_eq!(read(&connection).unwrap(), settings);
        let retained: String = connection
            .query_row("SELECT data FROM workspace", [], |row| row.get(0))
            .unwrap();
        assert_eq!(retained, workspace);
    }
    #[test]
    fn rejects_invalid_values_and_preserves_the_previous_settings() {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        let previous = AppSettings::default();
        save(&connection, &previous).unwrap();
        let mut invalid = previous.clone();
        invalid.branch_convention = "a".repeat(4_001);
        assert!(save(&connection, &invalid).is_err());
        invalid = previous.clone();
        invalid.agents_markdown.push('\0');
        assert!(save(&connection, &invalid).is_err());
        assert_eq!(read(&connection).unwrap(), previous);
        connection
            .execute("UPDATE app_settings SET data='invalid'", [])
            .unwrap();
        assert!(read(&connection).is_err());
    }
    #[test]
    fn combines_global_and_local_instructions_as_text_without_executing_templates() {
        let settings = AppSettings {
            agents_markdown: "Keep changes focused.".into(),
            branch_convention: "feature/{name} $(never-run)".into(),
            ..AppSettings::default()
        };
        let text = settings.instructions("Workspace-specific rules");
        assert!(text.contains("Keep changes focused."));
        assert!(text.contains("Workspace-specific rules"));
        assert!(text.contains("feature/{name} $(never-run)"));
        assert!(text.contains(&settings.commit_convention));
        assert!(text.contains(&settings.pull_request_convention));
    }
}
