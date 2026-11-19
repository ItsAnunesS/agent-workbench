use crate::{openai, Database};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[derive(Default)]
pub struct Tracker(Mutex<HashSet<String>>);
pub struct Context {
    pub environment: String,
    pub account_key: String,
    pub conversation: String,
    pub model: String,
    pub source: &'static str,
    pub fallback_id: String,
}
#[derive(Default, Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    input: Option<i64>,
    output: Option<i64>,
    total: Option<i64>,
    cached: Option<i64>,
    reasoning: Option<i64>,
}
impl Tokens {
    fn parse(value: &Value) -> Option<Self> {
        let count = |field: &Value| {
            field
                .as_i64()
                .filter(|value| (0..=9_007_199_254_740_991).contains(value))
        };
        let input = count(&value["input_tokens"]);
        let output = count(&value["output_tokens"]);
        let total = count(&value["total_tokens"]).or_else(|| {
            input.zip(output).and_then(|(a, b)| {
                a.checked_add(b)
                    .filter(|total| *total <= 9_007_199_254_740_991)
            })
        });
        let tokens = Self {
            input,
            output,
            total,
            cached: count(&value["input_tokens_details"]["cached_tokens"])
                .filter(|cached| input.is_none_or(|input| *cached <= input)),
            reasoning: count(&value["output_tokens_details"]["reasoning_tokens"])
                .filter(|reasoning| output.is_none_or(|output| *reasoning <= output)),
        };
        if tokens == Self::default() {
            None
        } else {
            Some(tokens)
        }
    }
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    responses: u64,
    tokens: Tokens,
    first_recorded_at: Option<i64>,
    incomplete_responses: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    date: String,
    total_tokens: Option<i64>,
    responses: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    source: String,
    model: String,
    created_at: i64,
    tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    connected: bool,
    recording_issue: bool,
    all_time: Totals,
    today: Totals,
    last_seven_days: Totals,
    daily: Vec<Day>,
    recent: Vec<Recent>,
}

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS token_usage (environment_id TEXT NOT NULL,account_key TEXT NOT NULL,response_id TEXT NOT NULL,conversation_id TEXT NOT NULL,source TEXT NOT NULL,model TEXT NOT NULL,created_at INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,total_tokens INTEGER,cached_tokens INTEGER,reasoning_tokens INTEGER,PRIMARY KEY(environment_id,account_key,response_id));CREATE INDEX IF NOT EXISTS token_usage_scope ON token_usage(environment_id,account_key,created_at);")
}
fn record(
    db: &Connection,
    context: &Context,
    response: &Value,
    timestamp: i64,
) -> Result<(), String> {
    let Some(tokens) = Tokens::parse(&response["usage"]) else {
        return Ok(());
    };
    let id = response["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 200)
        .unwrap_or(&context.fallback_id);
    db.execute("INSERT INTO token_usage(environment_id,account_key,response_id,conversation_id,source,model,created_at,input_tokens,output_tokens,total_tokens,cached_tokens,reasoning_tokens) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(environment_id,account_key,response_id) DO NOTHING",params![context.environment,context.account_key,id,context.conversation,context.source,context.model,timestamp,tokens.input,tokens.output,tokens.total,tokens.cached,tokens.reasoning])
        .map_err(|_|"Could not save token usage.")?;
    Ok(())
}
pub fn event(database: &Database, tracker: &Tracker, context: &Context, event: &Value) {
    if !matches!(
        event["type"].as_str(),
        Some("response.completed" | "response.failed" | "response.incomplete")
    ) {
        return;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let result = database
        .0
        .lock()
        .map_err(|_| "Could not access local data.".to_string())
        .and_then(|db| record(&db, context, &event["response"], timestamp));
    if result.is_err() {
        // Metering failure must not discard a successful model response.
        eprintln!("Could not save token usage.");
        if let Ok(mut issues) = tracker.0.lock() {
            issues.insert(format!("{}:{}", context.environment, context.account_key));
        }
    }
}
fn totals(db: &Connection, environment: &str, account: &str, since: i64) -> Result<Totals, String> {
    db.query_row("SELECT COUNT(*),SUM(input_tokens),SUM(output_tokens),SUM(total_tokens),SUM(cached_tokens),SUM(reasoning_tokens),MIN(created_at),COALESCE(SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END),0) FROM token_usage WHERE environment_id=?1 AND account_key=?2 AND created_at>=?3",params![environment,account,since],|row|Ok(Totals{responses:row.get(0)?,tokens:Tokens{input:row.get(1)?,output:row.get(2)?,total:row.get(3)?,cached:row.get(4)?,reasoning:row.get(5)?},first_recorded_at:row.get(6)?,incomplete_responses:row.get(7)?})).map_err(|_|"Could not read token usage.".into())
}
fn snapshot(
    db: &Connection,
    environment: &str,
    account: Option<&str>,
    recording_issue: bool,
    now: i64,
) -> Result<Snapshot, String> {
    let Some(account) = account else {
        return Ok(Snapshot {
            connected: false,
            recording_issue: false,
            all_time: Totals::default(),
            today: Totals::default(),
            last_seven_days: Totals::default(),
            daily: vec![],
            recent: vec![],
        });
    };
    let today = now - now.rem_euclid(86400);
    let week = today - 6 * 86400;
    let mut days=db.prepare("SELECT date(created_at,'unixepoch'),SUM(total_tokens),COUNT(*) FROM token_usage WHERE environment_id=?1 AND account_key=?2 AND created_at>=?3 GROUP BY date(created_at,'unixepoch') ORDER BY 1").map_err(|_|"Could not read token usage.")?;
    let daily = days
        .query_map(params![environment, account, week], |row| {
            Ok(Day {
                date: row.get(0)?,
                total_tokens: row.get(1)?,
                responses: row.get(2)?,
            })
        })
        .map_err(|_| "Could not read token usage.")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Could not read token usage.")?;
    let mut recent=db.prepare("SELECT source,model,created_at,input_tokens,output_tokens,total_tokens,cached_tokens,reasoning_tokens FROM token_usage WHERE environment_id=?1 AND account_key=?2 ORDER BY created_at DESC,rowid DESC LIMIT 12").map_err(|_|"Could not read token usage.")?;
    let recent = recent
        .query_map(params![environment, account], |row| {
            Ok(Recent {
                source: row.get(0)?,
                model: row.get(1)?,
                created_at: row.get(2)?,
                tokens: Tokens {
                    input: row.get(3)?,
                    output: row.get(4)?,
                    total: row.get(5)?,
                    cached: row.get(6)?,
                    reasoning: row.get(7)?,
                },
            })
        })
        .map_err(|_| "Could not read token usage.")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Could not read token usage.")?;
    Ok(Snapshot {
        connected: true,
        recording_issue,
        all_time: totals(db, environment, account, 0)?,
        today: totals(db, environment, account, today)?,
        last_seven_days: totals(db, environment, account, week)?,
        daily,
        recent,
    })
}
#[tauri::command]
pub async fn openai_usage(
    database: State<'_, Database>,
    state: State<'_, openai::OpenAi>,
    tracker: State<'_, Tracker>,
    environment_id: String,
    locale: Option<String>,
) -> Result<Snapshot, String> {
    let result = async {
        let account = openai::usage_account(&state, &environment_id).await;
        let issue = account.as_ref().is_some_and(|account| {
            tracker
                .0
                .lock()
                .map(|issues| issues.contains(&format!("{environment_id}:{account}")))
                .unwrap_or(true)
        });
        let db = database
            .0
            .lock()
            .map_err(|_| "Could not access local data.")?;
        if !crate::read_workspace(&db)?
            .environments
            .iter()
            .any(|item| item.id == environment_id)
        {
            return Err("Invalid environment.".into());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        snapshot(&db, &environment_id, account.as_deref(), issue, now)
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}
#[tauri::command]
pub fn openai_manage_usage(locale: Option<String>) -> Result<(), String> {
    let result = std::process::Command::new("/usr/bin/xdg-open")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .env_remove("GTK_PATH")
        .env_remove("GIO_MODULE_DIR")
        .env_remove("GIO_EXTRA_MODULES")
        .env_remove("GDK_PIXBUF_MODULE_FILE")
        .arg("https://chatgpt.com/settings/usage")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|mut child| {
            tauri::async_runtime::spawn_blocking(move || {
                let _ = child.wait();
            });
        })
        .map_err(|_| "Could not open the browser. Check that xdg-open is installed.".to_string());
    result.map_err(|error| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn context() -> Context {
        Context {
            environment: "personal".into(),
            account_key: "account-a".into(),
            conversation: "conversation".into(),
            model: "fixture-model".into(),
            source: "chat",
            fallback_id: "fallback".into(),
        }
    }
    #[test]
    fn preserves_unknown_fields_and_does_not_double_count_cached_or_reasoning_tokens() {
        assert_eq!(Tokens::parse(&Value::Null), None);
        let tokens=Tokens::parse(&json!({"input_tokens":100,"output_tokens":40,"input_tokens_details":{"cached_tokens":60},"output_tokens_details":{"reasoning_tokens":20}})).unwrap();
        assert_eq!(tokens.total, Some(140));
        assert_eq!(tokens.cached, Some(60));
        assert_eq!(tokens.reasoning, Some(20));
        let partial = Tokens::parse(&json!({"input_tokens":0,"output_tokens":-1})).unwrap();
        assert_eq!(partial.input, Some(0));
        assert_eq!(partial.output, None);
        assert_eq!(partial.total, None);
        assert_eq!(
            Tokens::parse(&json!({"input_tokens":5,"input_tokens_details":{"cached_tokens":6}}))
                .unwrap()
                .cached,
            None
        );
    }
    #[test]
    fn deduplicates_responses_and_isolates_accounts_environments_and_utc_days() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let mut ctx = context();
        let today = 20 * 86400;
        let response = json!({"id":"resp-1","usage":{"input_tokens":100,"output_tokens":40}});
        record(&db, &ctx, &response, today).unwrap();
        record(&db, &ctx, &response, today).unwrap();
        ctx.source = "worker";
        record(
            &db,
            &ctx,
            &json!({"id":"resp-2","usage":{"input_tokens":50,"output_tokens":10}}),
            today - 86400,
        )
        .unwrap();
        ctx.source = "review";
        record(
            &db,
            &ctx,
            &json!({"id":"resp-3","usage":{"input_tokens":5}}),
            today - 8 * 86400,
        )
        .unwrap();
        let summary = snapshot(&db, "personal", Some("account-a"), false, today + 100).unwrap();
        assert_eq!(summary.all_time.responses, 3);
        assert_eq!(summary.all_time.tokens.total, Some(200));
        assert_eq!(summary.all_time.incomplete_responses, 1);
        assert_eq!(summary.today.tokens.total, Some(140));
        assert_eq!(summary.last_seven_days.responses, 2);
        assert_eq!(summary.daily.len(), 2);
        assert_eq!(
            snapshot(&db, "work", Some("account-a"), false, today)
                .unwrap()
                .all_time
                .responses,
            0
        );
        assert_eq!(
            snapshot(&db, "personal", Some("account-b"), false, today)
                .unwrap()
                .all_time
                .tokens
                .total,
            None
        );
        assert!(
            !snapshot(&db, "personal", None, false, today)
                .unwrap()
                .connected
        );
    }
    #[test]
    fn persists_reported_usage_across_database_reopen_and_fragmented_streams() {
        let path =
            std::env::temp_dir().join(format!("workbench-usage-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            let database = Database(Mutex::new(db));
            let tracker = Tracker::default();
            let mut buffer = Vec::new();
            let stream = b"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-fragmented\",\"usage\":{\"input_tokens\":80,\"output_tokens\":20}}}\n\n";
            for chunk in stream.chunks(7) {
                buffer.extend_from_slice(chunk);
                for value in openai::extract_events(&mut buffer).unwrap() {
                    event(&database, &tracker, &context(), &value);
                }
            }
        }
        let db = Connection::open(&path).unwrap();
        initialize(&db).unwrap();
        let result = totals(&db, "personal", "account-a", 0).unwrap();
        assert_eq!(result.responses, 1);
        assert_eq!(result.tokens.total, Some(100));
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn records_only_terminal_provider_events_and_reports_storage_failure() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let database = Database(Mutex::new(db));
        let tracker = Tracker::default();
        let ctx = context();
        event(
            &database,
            &tracker,
            &ctx,
            &json!({"type":"response.output_text.delta","delta":"private content"}),
        );
        event(
            &database,
            &tracker,
            &ctx,
            &json!({"type":"response.incomplete","response":{"id":"partial","usage":{"input_tokens":10,"output_tokens":2}}}),
        );
        assert_eq!(
            totals(&database.0.lock().unwrap(), "personal", "account-a", 0)
                .unwrap()
                .tokens
                .total,
            Some(12)
        );
        database
            .0
            .lock()
            .unwrap()
            .execute("DROP TABLE token_usage", [])
            .unwrap();
        event(
            &database,
            &tracker,
            &ctx,
            &json!({"type":"response.completed","response":{"id":"failed-save","usage":{"input_tokens":1}}}),
        );
        assert!(tracker.0.lock().unwrap().contains("personal:account-a"));
    }
}
