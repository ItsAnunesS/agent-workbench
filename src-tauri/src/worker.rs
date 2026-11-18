use crate::{openai, read_workspace, Database};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex as AsyncMutex},
};
use tokio_util::sync::CancellationToken;

const IMAGE: &str = "agent-workbench-codex:0.4.0";
const MAX_EVENTS: usize = 1500;
const MAX_OUTPUT: usize = 2_000_000;
type Input = Arc<AsyncMutex<ChildStdin>>;
type Approvals = Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

pub struct Worker {
    directory: PathBuf,
    active: Mutex<HashMap<String, Active>>,
    preparing: AsyncMutex<()>,
}
struct Active {
    environment: String,
    conversation: String,
    project: String,
    path: PathBuf,
    cancel: CancellationToken,
    approvals: Approvals,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerEvent {
    kind: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item: Option<Value>,
}
impl WorkerEvent {
    fn text(kind: &str, text: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            text: text.into(),
            approval_id: None,
            item: None,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    id: String,
    environment_id: String,
    project_id: String,
    conversation_id: String,
    model: String,
    status: String,
    created_at: u64,
    events: Vec<WorkerEvent>,
    output: String,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    available: bool,
    ready: bool,
    message: String,
}

pub fn initialize(
    directory: &Path,
    connection: &rusqlite::Connection,
) -> Result<Worker, Box<dyn std::error::Error>> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS worker_runs (id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, conversation_id TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS worker_history ON worker_runs(environment_id, conversation_id);")?;
    // A stopped app cannot keep an approval pending. Preserve its audit trail.
    let records: Vec<(String, String)> = {
        let mut statement = connection.prepare("SELECT id, data FROM worker_runs WHERE json_extract(data, '$.status') IN ('running', 'awaitingApproval')")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    for (id, data) in records {
        let mut run: Run = serde_json::from_str(&data)?;
        if ["running", "awaitingApproval"].contains(&run.status.as_str()) {
            if uuid::Uuid::parse_str(&id).is_ok() {
                let name = format!("awb-worker-{id}");
                tauri::async_runtime::spawn(async move {
                    let _ = docker_output(&["rm", "--force", &name], 15).await;
                });
            }
            run.status = "interrupted".into();
            run.error = Some("A aplicação foi encerrada durante a tarefa. Verifica os ficheiros antes de continuar.".into());
            connection.execute(
                "UPDATE worker_runs SET data=?1 WHERE id=?2",
                rusqlite::params![serde_json::to_string(&run)?, id],
            )?;
        }
    }
    Ok(Worker {
        directory: directory.to_owned(),
        active: Mutex::new(HashMap::new()),
        preparing: AsyncMutex::new(()),
    })
}
fn persist(app: &AppHandle, run: &Run) -> Result<(), String> {
    let state = app.state::<Database>();
    let db = state.0.lock().map_err(|_| "Dados locais indisponíveis.")?;
    db.execute("INSERT INTO worker_runs(id, environment_id, conversation_id, data) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data", rusqlite::params![run.id, run.environment_id, run.conversation_id, serde_json::to_string(run).map_err(|_| "Registo da tarefa inválido.")?]).map_err(|_| "Não foi possível guardar o registo da tarefa.")?;
    Ok(())
}
fn publish(
    app: &AppHandle,
    channel: &Channel<WorkerEvent>,
    run: &mut Run,
    event: WorkerEvent,
) -> Result<(), String> {
    if run.events.len() >= MAX_EVENTS
        || serde_json::to_vec(&run.events).map_or(true, |bytes| bytes.len() > 5_000_000)
    {
        return Err(
            "A tarefa atingiu o limite de atividade. Divide o trabalho em tarefas menores.".into(),
        );
    }
    run.events.push(event.clone());
    persist(app, run)?;
    channel
        .send(event)
        .map_err(|_| "A janela da tarefa foi fechada.".into())
}
fn scope(
    database: &Database,
    environment: &str,
    conversation: &str,
) -> Result<(crate::Project, String, String), String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "Dados locais indisponíveis.")?;
    let workspace = read_workspace(&db)?;
    let task = workspace
        .conversations
        .iter()
        .find(|item| {
            item.id == conversation && item.environment_id == environment && item.mode == "worker"
        })
        .ok_or("Seleciona uma conversa Worker deste ambiente.")?;
    let project = workspace
        .projects
        .iter()
        .find(|item| {
            Some(&item.id) == task.project_id.as_ref() && item.environment_id == environment
        })
        .ok_or("Associa a tarefa a um projeto com pasta local.")?;
    let environment = workspace
        .environments
        .iter()
        .find(|item| item.id == environment)
        .ok_or("Ambiente indisponível.")?;
    let instructions = format!("{}\n\nProject memory:\n{}\n\nWork only in /workspace. Commands have no network access. Never request host access, Docker, credentials, or additional mounts. Ask the user when a task cannot be completed inside this boundary.", environment.instructions, project.memory);
    // Rebuild context solely from this Worker's local history. Chat is included only by explicit handoff.
    let history = task
        .messages
        .iter()
        .map(|item| format!("{}:\n{}", item.role, item.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok((project.clone(), instructions, history))
}
fn project_path(raw: &str, app_directory: &Path) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(raw)
        .map_err(|_| "A pasta do projeto não existe ou não está acessível.")?;
    if !path.is_dir()
        || !Path::new(raw).is_absolute()
        || raw.contains([',', '\n', '\r'])
        || path
            .to_str()
            .is_none_or(|value| value.contains([',', '\n', '\r']))
    {
        return Err("Escolhe uma pasta local com caminho absoluto válido.".into());
    }
    let app_directory =
        std::fs::canonicalize(app_directory).unwrap_or_else(|_| app_directory.to_owned());
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let protected = [
        "/etc", "/usr", "/proc", "/sys", "/dev", "/run", "/var", "/boot", "/root", "/bin", "/sbin",
        "/lib", "/lib64",
    ];
    if path.parent().is_none()
        || home.as_ref().is_some_and(|home| home.starts_with(&path))
        || protected.iter().any(|root| path.starts_with(root))
        || app_directory.starts_with(&path)
        || path.starts_with(&app_directory)
        || path.components().any(|part| {
            [".ssh", ".aws", ".codex", ".config", ".local", ".gnupg"]
                .iter()
                .any(|name| part.as_os_str() == *name)
        })
    {
        return Err("Escolhe apenas a pasta do projeto. Pastas pessoais, de credenciais e do sistema não podem ser montadas.".into());
    }
    Ok(path)
}
fn overlaps(left: &Path, right: &Path) -> bool {
    left.starts_with(right) || right.starts_with(left)
}
async fn docker_output(args: &[&str], timeout: u64) -> Result<std::process::Output, String> {
    tokio::time::timeout(
        Duration::from_secs(timeout),
        Command::new("docker")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "O Docker não respondeu a tempo.")?
    .map_err(|_| "Instala e inicia o Docker para usar o Worker.".into())
}
async fn cleanup_container(name: &str) -> Result<(), String> {
    let output = docker_output(&["rm", "--force", name], 15).await?;
    if output.status.success() {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&output.stderr);
    if error.contains("No such container") || error.contains("No such object") {
        Ok(())
    } else {
        Err("Não foi possível remover o container da tarefa.".into())
    }
}
#[tauri::command]
pub async fn worker_runtime() -> RuntimeStatus {
    if !docker_output(&["info", "--format", "{{.ServerVersion}}"], 8)
        .await
        .is_ok_and(|result| result.status.success())
    {
        return RuntimeStatus {
            available: false,
            ready: false,
            message: "Inicia o Docker e volta a verificar.".into(),
        };
    }
    let ready = docker_output(
        &[
            "image",
            "inspect",
            "--format",
            "{{index .Config.Labels \"com.agentworkbench.runtime\"}}",
            IMAGE,
        ],
        8,
    )
    .await
    .is_ok_and(|result| {
        result.status.success() && String::from_utf8_lossy(&result.stdout).trim() == "4"
    });
    RuntimeStatus {
        available: true,
        ready,
        message: if ready {
            "Codex pronto. Execução isolada por projeto."
        } else {
            "Prepara o runtime do Codex. A primeira instalação pode demorar alguns minutos."
        }
        .into(),
    }
}
#[tauri::command]
pub async fn worker_prepare(state: State<'_, Worker>) -> Result<RuntimeStatus, String> {
    let _guard = state
        .preparing
        .try_lock()
        .map_err(|_| "A preparação já está em curso.")?;
    let directory = state.directory.join("worker-runtime");
    std::fs::create_dir_all(&directory).map_err(|_| "Não foi possível preparar o runtime.")?;
    std::fs::write(
        directory.join("Dockerfile"),
        include_str!("../../worker/Dockerfile"),
    )
    .map_err(|_| "Não foi possível gravar o runtime.")?;
    std::fs::write(
        directory.join("bridge.mjs"),
        include_str!("../../worker/bridge.mjs"),
    )
    .map_err(|_| "Não foi possível gravar o runtime.")?;
    let status = tokio::time::timeout(
        Duration::from_secs(900),
        Command::new("docker")
            .args(["build", "--tag", IMAGE])
            .arg(&directory)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await
    .map_err(|_| {
        "A preparação demorou demasiado. Verifica a ligação à Internet e tenta novamente."
    })?
    .map_err(|_| "Instala e inicia o Docker.")?;
    if !status.success() {
        return Err("Não foi possível preparar o Codex. Verifica o Docker, a ligação à Internet e o espaço em disco.".into());
    }
    Ok(worker_runtime().await)
}
#[tauri::command]
pub fn worker_history(
    database: State<'_, Database>,
    environment_id: String,
    conversation_id: String,
) -> Result<Vec<Run>, String> {
    scope(&database, &environment_id, &conversation_id)?;
    let db = database
        .0
        .lock()
        .map_err(|_| "Dados locais indisponíveis.")?;
    let mut statement = db.prepare("SELECT data FROM worker_runs WHERE environment_id=?1 AND conversation_id=?2 ORDER BY rowid DESC LIMIT 10").map_err(|_| "Histórico indisponível.")?;
    let rows = statement
        .query_map(rusqlite::params![environment_id, conversation_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|_| "Histórico indisponível.")?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|_| "Histórico indisponível.")?)
            .map_err(|_| "Registo de tarefa inválido.".into())
    })
    .collect()
}
pub fn cancel_environment(app: &AppHandle, environment: &str) {
    if let Ok(active) = app.state::<Worker>().active.lock() {
        for run in active.values().filter(|run| run.environment == environment) {
            run.cancel.cancel();
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Ok(active) = app.state::<Worker>().active.lock() {
        for (id, run) in active.iter() {
            run.cancel.cancel();
            // Only names created and tracked by this app may be removed.
            let _ = std::process::Command::new("docker")
                .args(["rm", "--force", &format!("awb-worker-{id}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }
}
#[tauri::command]
pub fn worker_cancel(
    state: State<'_, Worker>,
    environment_id: String,
    conversation_id: String,
    run_id: String,
) -> Result<(), String> {
    let active = state.active.lock().map_err(|_| "Worker indisponível.")?;
    let run = active
        .get(&run_id)
        .filter(|run| run.environment == environment_id && run.conversation == conversation_id)
        .ok_or("A tarefa já terminou ou pertence a outro espaço.")?;
    run.cancel.cancel();
    Ok(())
}
#[tauri::command]
pub fn worker_approve(
    state: State<'_, Worker>,
    environment_id: String,
    conversation_id: String,
    run_id: String,
    approval_id: String,
    accept: bool,
) -> Result<(), String> {
    resolve_approval(
        &state,
        &environment_id,
        &conversation_id,
        &run_id,
        &approval_id,
        accept,
    )
}
fn resolve_approval(
    state: &Worker,
    environment_id: &str,
    conversation_id: &str,
    run_id: &str,
    approval_id: &str,
    accept: bool,
) -> Result<(), String> {
    let active = state.active.lock().map_err(|_| "Worker indisponível.")?;
    let run = active
        .get(run_id)
        .filter(|run| {
            run.environment == environment_id
                && run.conversation == conversation_id
                && !run.cancel.is_cancelled()
        })
        .ok_or("A aprovação pertence a outra tarefa ou já expirou.")?;
    let sender = run
        .approvals
        .lock()
        .map_err(|_| "Aprovação indisponível.")?
        .remove(approval_id)
        .ok_or("Esta aprovação já foi respondida ou expirou.")?;
    sender
        .send(accept)
        .map_err(|_| "Esta aprovação já expirou.".into())
}
async fn write(input: &Input, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|_| "Pedido Codex inválido.")?;
    bytes.push(b'\n');
    input
        .lock()
        .await
        .write_all(&bytes)
        .await
        .map_err(|_| "A ligação ao Codex foi interrompida.".into())
}
fn inference_body(raw: &str, model: &str) -> Result<Value, String> {
    if raw.len() > 8 * 1024 * 1024 {
        return Err("O pedido ao modelo excedeu o limite.".into());
    }
    let mut body: Value = serde_json::from_str(raw).map_err(|_| "Pedido ao modelo inválido.")?;
    if !body.is_object() || body["model"].as_str() != Some(model) {
        return Err("O Codex pediu um modelo diferente do selecionado.".into());
    }
    body["store"] = json!(false);
    body["stream"] = json!(true);
    // No remote tools or provider-side background jobs may bypass the container boundary.
    if body.get("background").is_some_and(|value| value == true)
        || ["conversation", "previous_response_id"]
            .iter()
            .any(|key| body.get(key).is_some_and(|value| !value.is_null()))
        || body["tools"]
            .as_array()
            .is_some_and(|tools| tools.iter().any(|tool| !local_tool(tool)))
    {
        return Err("A tarefa tentou usar uma ferramenta externa ao projeto.".into());
    }
    Ok(body)
}
fn local_tool(tool: &Value) -> bool {
    match tool["type"].as_str() {
        Some("function" | "custom") => true,
        Some("namespace") => tool["tools"].as_array().is_some_and(|tools| {
            tools
                .iter()
                .all(|tool| matches!(tool["type"].as_str(), Some("function" | "custom")))
        }),
        _ => false,
    }
}
async fn bridge(
    app: AppHandle,
    environment: String,
    model: String,
    message: Value,
    input: Input,
    cancel: CancellationToken,
) -> Result<(), String> {
    let id = message["id"]
        .as_str()
        .filter(|id| id.len() < 80)
        .ok_or("Transporte Codex inválido.")?;
    let state = app.state::<openai::OpenAi>();
    let token = openai::access_token(&state, &environment).await?;
    let request = match (message["method"].as_str(), message["path"].as_str()) {
        (Some("GET"), Some("/v1/models")) => state.client.get("https://api.openai.com/v1/models"),
        (Some("POST"), Some("/v1/responses")) => state
            .client
            .post("https://api.openai.com/v1/responses")
            .json(&inference_body(
                message["body"].as_str().ok_or("Pedido inválido.")?,
                &model,
            )?),
        _ => return Err("O transporte recusou um endpoint não autorizado.".into()),
    };
    let response = request
        .bearer_auth(token)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|_| "Não foi possível contactar a OpenAI.")?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error = response.json::<Value>().await.unwrap_or_default();
        return Err(openai::api_error(
            status,
            error["error"]["code"].as_str().unwrap_or(""),
        ));
    }
    let status = response.status().as_u16();
    let content_type = if message["method"] == "POST" {
        "text/event-stream"
    } else {
        "application/json"
    };
    let mut stream = response.bytes_stream();
    let mut total = 0usize;
    loop {
        let chunk = tokio::select! { _ = cancel.cancelled() => return Ok(()), value = stream.next() => value };
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|_| "A ligação à OpenAI foi interrompida.")?;
        total += chunk.len();
        if total > 32 * 1024 * 1024 {
            return Err("A resposta atingiu o limite desta tarefa.".into());
        }
        write(&input, json!({"workbenchBridgeResponse":{"id":id,"status":status,"contentType":content_type,"data":STANDARD.encode(chunk)}})).await?;
    }
    write(
        &input,
        json!({"workbenchBridgeResponse":{"id":id,"end":true}}),
    )
    .await
}
fn approval_allowed(method: &str, params: &Value) -> bool {
    if params["command"]
        .as_str()
        .is_some_and(|command| command.len() > 24_000)
    {
        return false;
    }
    if ![
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
    ]
    .contains(&method)
    {
        return false;
    }
    if [
        "additionalPermissions",
        "networkApprovalContext",
        "proposedNetworkPolicyAmendments",
        "proposedExecpolicyAmendment",
        "grantRoot",
    ]
    .iter()
    .any(|key| params.get(key).is_some_and(|value| !value.is_null()))
    {
        return false;
    }
    params["cwd"].as_str().is_none_or(|cwd| {
        Path::new(cwd).starts_with("/workspace")
            && !Path::new(cwd)
                .components()
                .any(|part| part == std::path::Component::ParentDir)
    })
}
fn safe_item(item: &Value) -> Option<Value> {
    match item["type"].as_str()? {
        "commandExecution" => Some(json!({"type":"commandExecution","id":item["id"],"command":item["command"],"cwd":item["cwd"],"status":item["status"],"exitCode":item["exitCode"],"output":truncate(item["aggregatedOutput"].as_str().unwrap_or(""), 24_000)})),
        "fileChange" => Some(json!({"type":"fileChange","id":item["id"],"status":item["status"],"changes":item["changes"].as_array().map(|changes| changes.iter().take(20).map(|change| json!({"path":truncate(change["path"].as_str().unwrap_or(""),4096),"kind":change["kind"],"diff":truncate(change["diff"].as_str().unwrap_or(""), 4000)})).collect::<Vec<_>>())})),
        _ => None,
    }.filter(|value| value.to_string().len() <= 200_000)
}
fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}
#[tauri::command]
pub async fn worker_run(
    app: AppHandle,
    state: State<'_, Worker>,
    database: State<'_, Database>,
    environment_id: String,
    conversation_id: String,
    model: String,
    run_id: String,
    on_event: Channel<WorkerEvent>,
) -> Result<Run, String> {
    if uuid::Uuid::parse_str(&run_id).is_err()
        || model.is_empty()
        || model.len() > 160
        || !model
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || "-_.".contains(value))
    {
        return Err("Identificador da tarefa ou modelo inválido.".into());
    }
    {
        let db = database
            .0
            .lock()
            .map_err(|_| "Dados locais indisponíveis.")?;
        if db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM worker_runs WHERE id=?1)",
                [&run_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| "Histórico indisponível.")?
        {
            return Err("Este identificador de tarefa já foi utilizado.".into());
        }
    }
    let (project, instructions, history) = scope(&database, &environment_id, &conversation_id)?;
    if history.trim().is_empty() || history.len() > MAX_OUTPUT {
        return Err("A tarefa está vazia ou tem demasiado contexto. Cria uma tarefa menor.".into());
    }
    let path = project_path(&project.path, &state.directory)?;
    let cancel = CancellationToken::new();
    let approvals: Approvals = Default::default();
    {
        let mut active = state.active.lock().map_err(|_| "Worker indisponível.")?;
        if active.len() >= 4
            || active.contains_key(&run_id)
            || active
                .values()
                .any(|run| run.project == project.id || overlaps(&run.path, &path))
        {
            return Err("Já existe uma tarefa nesta pasta ou numa pasta sobreposta. Aguarda a conclusão antes de iniciar outra.".into());
        }
        active.insert(
            run_id.clone(),
            Active {
                environment: environment_id.clone(),
                conversation: conversation_id.clone(),
                project: project.id.clone(),
                path: path.clone(),
                cancel: cancel.clone(),
                approvals: approvals.clone(),
            },
        );
    }
    let mut run = Run {
        id: run_id.clone(),
        environment_id,
        project_id: project.id,
        conversation_id,
        model,
        status: "running".into(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        events: vec![],
        output: String::new(),
        error: None,
    };
    let result = execute(
        &app,
        &state.directory,
        &path,
        &mut run,
        &on_event,
        cancel.clone(),
        approvals,
        instructions,
        history,
    )
    .await;
    cancel.cancel();
    let cleanup = cleanup_container(&format!("awb-worker-{run_id}")).await;
    if let Ok(mut active) = state.active.lock() {
        active.remove(&run_id);
    }
    if let Err(error) = result {
        run.status = "failed".into();
        run.error = Some(error);
    }
    if cleanup.is_err() {
        let message =
            "O Docker não confirmou a limpeza do container. Verifica o Docker antes de continuar."
                .to_string();
        run.error = Some(match run.error.take() {
            Some(error) => format!("{error} {message}"),
            None => message,
        });
        if run.status == "completed" {
            run.status = "failed".into();
        }
    }
    persist(&app, &run)?;
    let _ = on_event.send(WorkerEvent::text("finished", &run.status));
    Ok(run)
}
async fn execute(
    app: &AppHandle,
    directory: &Path,
    path: &Path,
    run: &mut Run,
    channel: &Channel<WorkerEvent>,
    cancel: CancellationToken,
    approvals: Approvals,
    instructions: String,
    history: String,
) -> Result<(), String> {
    if !worker_runtime().await.ready {
        return Err("Prepara o runtime do Worker nas definições antes de executar.".into());
    }
    openai::access_token(&app.state::<openai::OpenAi>(), &run.environment_id).await?;
    #[cfg(unix)]
    let user = {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(directory).map_err(|_| "Pasta local indisponível.")?;
        format!("{}:{}", metadata.uid(), metadata.gid())
    };
    #[cfg(not(unix))]
    let user = "1000:1000".to_string();
    let mut child = Command::new("docker")
        .args([
            "run",
            "--rm",
            "--interactive",
            "--name",
            &format!("awb-worker-{}", run.id),
            "--label",
            "com.agentworkbench.worker=true",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "256",
            "--memory",
            "4g",
            "--cpus",
            "2",
            "--user",
            &user,
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
            "--tmpfs",
            "/home/worker:rw,nosuid,nodev,size=128m,mode=1777",
            "--mount",
            &format!("type=bind,src={},dst=/workspace", path.display()),
            IMAGE,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Não foi possível iniciar o Docker.")?;
    let input = Arc::new(AsyncMutex::new(
        child.stdin.take().ok_or("Transporte indisponível.")?,
    ));
    let mut stdout = BufReader::new(child.stdout.take().ok_or("Transporte indisponível.")?);
    publish(app, channel, run, WorkerEvent::text("status", "Codex iniciado num container. Apenas a pasta deste projeto está montada; comandos sem rede."))?;
    let mut thread = String::new();
    let mut turn = String::new();
    let mut output_item = String::new();
    let mut last_checkpoint = tokio::time::Instant::now();
    let startup_deadline = tokio::time::sleep(Duration::from_secs(90));
    tokio::pin!(startup_deadline);
    let (fail_tx, mut fail_rx) = tokio::sync::mpsc::channel::<String>(4);
    let (decision_tx, mut decision_rx) =
        tokio::sync::mpsc::channel::<(String, bool, oneshot::Sender<()>)>(16);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
    let mut tasks = tokio::task::JoinSet::new();
    let deadline = tokio::time::sleep(Duration::from_secs(3600));
    tokio::pin!(deadline);
    let result = async {
        let mut line = Vec::new();
        loop {
            let mut limited = tokio::io::AsyncReadExt::take(&mut stdout, (16 * 1024 * 1024 - line.len()) as u64);
            let count = tokio::select! {
                _ = cancel.cancelled() => {
                    if !thread.is_empty() && !turn.is_empty() { let _ = tokio::time::timeout(Duration::from_secs(1), write(&input, json!({"id":"interrupt","method":"turn/interrupt","params":{"threadId":thread,"turnId":turn}}))).await; }
                    run.status = "interrupted".into(); return Ok(());
                },
                _ = &mut deadline => return Err("A tarefa atingiu o limite de uma hora. Divide o trabalho em tarefas menores.".into()),
                Some(error) = fail_rx.recv() => return Err(error),
                Some((approval_id, accepted, acknowledged)) = decision_rx.recv() => {
                    run.status = if approvals.lock().map_err(|_| "Aprovação indisponível.")?.is_empty() { "running" } else { "awaitingApproval" }.into();
                    publish(app, channel, run, WorkerEvent { kind: "decision".into(), text: if accepted { "Ação autorizada uma vez." } else { "Ação recusada ou aprovação expirada." }.into(), approval_id: Some(approval_id), item: None })?;
                    let _ = acknowledged.send(());
                    continue;
                },
                _ = &mut startup_deadline, if turn.is_empty() => return Err("O Codex não concluiu a inicialização. Verifica o Docker e tenta novamente.".into()),
                count = limited.read_until(b'\n', &mut line) => count.map_err(|_| "A ligação ao container falhou.")?,
            };
            if count == 0 { return Err("O container terminou antes de concluir a tarefa.".into()); }
            if line.len() >= 16 * 1024 * 1024 { return Err("O Codex excedeu o limite de transporte.".into()); }
            let value: Value = serde_json::from_slice(&line).map_err(|_| "O Codex devolveu uma mensagem de protocolo inválida.")?;
            line.clear();
            if value["workbenchReady"] == true {
                write(&input, json!({"id":"init","method":"initialize","params":{"clientInfo":{"name":"agent_workbench","title":"Agent Workbench","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}})).await?;
            } else if let Some(message) = value.get("workbenchBridge") {
                let permit = semaphore.clone().try_acquire_owned().map_err(|_| "Demasiados pedidos simultâneos ao modelo.")?;
                let app = app.clone(); let environment = run.environment_id.clone(); let model = run.model.clone(); let message = message.clone(); let input = input.clone(); let cancel = cancel.clone(); let fail = fail_tx.clone();
                tasks.spawn(async move { let _permit = permit; if let Err(error) = bridge(app, environment, model, message, input, cancel).await { let _ = fail.send(error).await; } });
            } else if value.get("method").is_none() {
                if value.get("error").is_some() { return Err(format!("O Codex recusou o pedido: {}", truncate(value["error"]["message"].as_str().unwrap_or("protocolo incompatível"), 500))); }
                match value["id"].as_str() {
                    Some("init") => {
                        write(&input, json!({"method":"initialized"})).await?;
                        write(&input, json!({"id":"thread","method":"thread/start","params":{"model":run.model,"modelProvider":"workbench","cwd":"/workspace","ephemeral":true,"approvalPolicy":"untrusted","approvalsReviewer":"user","developerInstructions":instructions,"config":{"sandbox_mode":"danger-full-access","web_search":"disabled","features.multi_agent":false}}})).await?;
                    },
                    Some("thread") => {
                        thread = value["result"]["thread"]["id"].as_str().ok_or("O Codex não criou a tarefa.")?.into();
                        write(&input, json!({"id":"turn","method":"turn/start","params":{"threadId":thread,"model":run.model,"cwd":"/workspace","approvalPolicy":"untrusted","approvalsReviewer":"user","sandboxPolicy":{"type":"externalSandbox","networkAccess":"restricted"},"input":[{"type":"text","text":history,"text_elements":[]}]}})).await?;
                    },
                    Some("turn") => { turn = value["result"]["turn"]["id"].as_str().ok_or("O Codex não iniciou a execução.")?.into(); },
                    _ => {},
                }
            } else {
                let method = value["method"].as_str().unwrap_or("");
                let params = &value["params"];
                if params.get("threadId").is_some() && params["threadId"].as_str() != Some(&thread) { return Err("O Codex enviou atividade de outra tarefa.".into()); }
                if method == "turn/started" { turn = params["turn"]["id"].as_str().ok_or("Execução Codex inválida.")?.into(); }
                if value.get("id").is_some() {
                    if params["threadId"].as_str() != Some(&thread) || turn.is_empty() || params["turnId"].as_str() != Some(&turn) { return Err("O Codex pediu uma aprovação fora desta tarefa.".into()); }
                    if method == "item/permissions/requestApproval" {
                        write(&input, json!({"id":value["id"],"result":{"permissions":{},"scope":"turn"}})).await?;
                        publish(app, channel, run, WorkerEvent::text("denied", "O Worker recusou alargar permissões para fora do isolamento."))?;
                    } else if ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].contains(&method) {
                        if !approval_allowed(method, params) {
                            write(&input, json!({"id":value["id"],"result":{"decision":"decline"}})).await?;
                            publish(app, channel, run, WorkerEvent::text("denied", "Pedido recusado por exceder os limites do projeto."))?;
                        } else {
                            let approval_id = uuid::Uuid::new_v4().to_string();
                            let (sender, receiver) = oneshot::channel();
                            approvals.lock().map_err(|_| "Aprovação indisponível.")?.insert(approval_id.clone(), sender);
                            run.status = "awaitingApproval".into();
                            publish(app, channel, run, WorkerEvent { kind: "approval".into(), text: params["reason"].as_str().unwrap_or("O Codex pede autorização para esta ação.").into(), approval_id: Some(approval_id.clone()), item: Some(json!({"type":if method.contains("commandExecution") {"commandExecution"} else {"fileChange"},"command":params["command"],"cwd":params["cwd"],"itemId":params["itemId"]})) })?;
                            let input = input.clone(); let cancel = cancel.clone(); let fail = fail_tx.clone(); let rpc_id = value["id"].clone(); let decisions = decision_tx.clone(); let pending = approvals.clone();
                            tasks.spawn(async move {
                                let accept = tokio::select! { _ = cancel.cancelled() => false, result = tokio::time::timeout(Duration::from_secs(900), receiver) => result.is_ok_and(|value| value.unwrap_or(false)) };
                                if let Ok(mut pending) = pending.lock() { pending.remove(&approval_id); }
                                let (acknowledge, acknowledged) = oneshot::channel();
                                if decisions.send((approval_id, accept, acknowledge)).await.is_err() || acknowledged.await.is_err() { return; }
                                if let Err(error) = write(&input, json!({"id":rpc_id,"result":{"decision":if accept {"accept"} else {"decline"}}})).await { let _ = fail.send(error).await; }
                            });
                        }
                    } else {
                        write(&input, json!({"id":value["id"],"error":{"code":-32601,"message":"This client does not support this request"}})).await?;
                        publish(app, channel, run, WorkerEvent::text("denied", "O Codex pediu uma interação ainda não suportada. Reformula a tarefa se necessário."))?;
                    }
                } else if method == "item/agentMessage/delta" {
                    let item_id = params["itemId"].as_str().unwrap_or("");
                    if output_item != item_id {
                        if !run.output.is_empty() { run.output.push_str("\n\n"); channel.send(WorkerEvent::text("delta", "\n\n")).map_err(|_| "A janela da tarefa foi fechada.")?; }
                        output_item = item_id.into();
                    }
                    let delta = params["delta"].as_str().unwrap_or("");
                    if run.output.len() + delta.len() > MAX_OUTPUT { return Err("A resposta atingiu o limite desta tarefa.".into()); }
                    run.output.push_str(delta);
                    if last_checkpoint.elapsed() >= Duration::from_secs(1) { persist(app, run)?; last_checkpoint = tokio::time::Instant::now(); }
                    channel.send(WorkerEvent::text("delta", delta)).map_err(|_| "A janela da tarefa foi fechada.")?;
                } else if ["item/started", "item/completed"].contains(&method) {
                    if let Some(item) = safe_item(&params["item"]) { publish(app, channel, run, WorkerEvent { kind: "activity".into(), text: String::new(), approval_id: None, item: Some(item) })?; }
                } else if method == "turn/completed" {
                    if params["turn"]["id"].as_str() != Some(&turn) { return Err("O Codex concluiu outra execução.".into()); }
                    run.status = match params["turn"]["status"].as_str() { Some("completed") => "completed", Some("interrupted") => "interrupted", _ => "failed" }.into();
                    if run.status == "failed" { run.error = Some("O Codex não conseguiu concluir a tarefa. Consulta a atividade e verifica os ficheiros antes de tentar novamente.".into()); }
                    return Ok(());
                } else if method == "error" && params["willRetry"] != true {
                    return Err("O Codex encontrou um erro durante a execução. Verifica a conta, o modelo e os limites de utilização.".into());
                }
            }
            while tasks.try_join_next().is_some() {}
        }
    }.await;
    cancel.cancel();
    tasks.abort_all();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.kill()).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_boundaries_reject_home_system_and_credentials() {
        let root = std::env::temp_dir().join(format!("awb-path-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("project")).unwrap();
        std::fs::create_dir_all(root.join(".ssh")).unwrap();
        assert!(project_path(root.join("project").to_str().unwrap(), &root.join("data")).is_ok());
        assert!(project_path("/", &root).is_err());
        assert!(project_path("/etc", &root).is_err());
        assert!(project_path(root.join(".ssh").to_str().unwrap(), &root.join("data")).is_err());
        assert!(project_path(root.to_str().unwrap(), &root.join("data")).is_err());
        assert!(project_path("relative", &root).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", root.join("escape")).unwrap();
            assert!(
                project_path(root.join("escape").to_str().unwrap(), &root.join("data")).is_err()
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn approvals_are_bound_to_environment_task_and_single_use() {
        let worker = Worker {
            directory: PathBuf::new(),
            active: Mutex::new(HashMap::new()),
            preparing: AsyncMutex::new(()),
        };
        let approvals: Approvals = Default::default();
        let (sender, mut receiver) = oneshot::channel();
        approvals.lock().unwrap().insert("approval".into(), sender);
        worker.active.lock().unwrap().insert(
            "run".into(),
            Active {
                environment: "personal".into(),
                conversation: "task".into(),
                project: "project".into(),
                path: "/project".into(),
                cancel: CancellationToken::new(),
                approvals,
            },
        );
        assert!(resolve_approval(&worker, "work", "task", "run", "approval", true).is_err());
        assert!(resolve_approval(&worker, "personal", "other", "run", "approval", true).is_err());
        assert!(resolve_approval(&worker, "personal", "task", "other", "approval", true).is_err());
        assert!(resolve_approval(&worker, "personal", "task", "run", "approval", false).is_ok());
        assert_eq!(receiver.try_recv().unwrap(), false);
        assert!(resolve_approval(&worker, "personal", "task", "run", "approval", true).is_err());
    }
    #[test]
    fn recovers_interrupted_tasks_without_losing_audit_or_output() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        initialize(Path::new("/tmp/worker-test"), &connection).unwrap();
        let run = Run {
            id: "fixture".into(),
            environment_id: "personal".into(),
            project_id: "project".into(),
            conversation_id: "task".into(),
            model: "model".into(),
            status: "awaitingApproval".into(),
            created_at: 1,
            events: vec![WorkerEvent::text("status", "Fixture activity")],
            output: "Partial output".into(),
            error: None,
        };
        connection.execute("INSERT INTO worker_runs(id, environment_id, conversation_id, data) VALUES (?1,?2,?3,?4)", rusqlite::params![run.id,run.environment_id,run.conversation_id,serde_json::to_string(&run).unwrap()]).unwrap();
        initialize(Path::new("/tmp/worker-test"), &connection).unwrap();
        let data: String = connection
            .query_row(
                "SELECT data FROM worker_runs WHERE id='fixture'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let recovered: Run = serde_json::from_str(&data).unwrap();
        assert_eq!(recovered.status, "interrupted");
        assert_eq!(recovered.output, run.output);
        assert_eq!(recovered.events[0].text, "Fixture activity");
        assert!(recovered.error.is_some());
    }
    #[test]
    fn rejects_overlapping_project_runs() {
        assert!(overlaps(
            Path::new("/projects/app"),
            Path::new("/projects/app/src")
        ));
        assert!(overlaps(
            Path::new("/projects/app"),
            Path::new("/projects/app")
        ));
        assert!(!overlaps(
            Path::new("/projects/app"),
            Path::new("/projects/app2")
        ));
    }
    #[test]
    fn approval_cannot_expand_container_boundary() {
        assert!(approval_allowed(
            "item/commandExecution/requestApproval",
            &json!({"cwd":"/workspace"})
        ));
        for params in [
            json!({"cwd":"/workspace/../etc"}),
            json!({"cwd":"/home/worker"}),
            json!({"additionalPermissions":{}}),
            json!({"grantRoot":"/"}),
            json!({"networkApprovalContext":{}}),
        ] {
            assert!(!approval_allowed(
                "item/commandExecution/requestApproval",
                &params
            ));
        }
        assert!(!approval_allowed(
            "item/permissions/requestApproval",
            &json!({})
        ));
    }
    #[test]
    fn bridge_fixes_model_privacy_and_rejects_remote_tools() {
        let value = inference_body(
            r#"{"model":"test","store":true,"tools":[{"type":"function"}]}"#,
            "test",
        )
        .unwrap();
        assert_eq!(value["store"], false);
        assert_eq!(value["stream"], true);
        assert!(inference_body(r#"{"model":"other"}"#, "test").is_err());
        assert!(inference_body(
            r#"{"model":"test","tools":[{"type":"web_search"}]}"#,
            "test"
        )
        .is_err());
        assert!(inference_body(r#"{"model":"test","background":true}"#, "test").is_err());
        assert!(inference_body(r#"{"model":"test","conversation":"foreign"}"#, "test").is_err());
        assert!(inference_body(
            r#"{"model":"test","previous_response_id":"foreign"}"#,
            "test"
        )
        .is_err());
        assert!(inference_body(
            r#"{"model":"test","tools":[{"type":"namespace","tools":[{"type":"function"}]}]}"#,
            "test"
        )
        .is_ok());
    }
    #[test]
    fn worker_scope_rejects_chat_and_other_environments() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        crate::initialize_database(&connection).unwrap();
        let mut workspace = crate::initial_workspace();
        workspace
            .conversations
            .push(crate::tests::conversation("personal", "chat"));
        connection
            .execute(
                "INSERT INTO workspace(id,data) VALUES(1,?1)",
                [serde_json::to_string(&workspace).unwrap()],
            )
            .unwrap();
        let db = Database(Mutex::new(connection));
        assert!(scope(&db, "personal", "conversation").is_err());
        assert!(scope(&db, "work", "conversation").is_err());
    }
}
