use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tauri::{ipc::Channel, Emitter, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

const AUTH: &str = "https://auth.openai.com";
const API: &str = "https://api.openai.com/v1";
const PERMISSION: &str = "chatgpt.tokens.use.direct";

#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    id_token: String,
    expires_at: u64,
    scopes: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Registration {
    client_id: String,
    subject: String,
    email: String,
    tokens: Option<Tokens>,
}

#[derive(Default, Serialize, Deserialize)]
struct Credentials {
    host_id: String,
    accounts: HashMap<String, Registration>,
}

struct Request {
    environment_id: String,
    cancel: CancellationToken,
}

pub struct OpenAi {
    path: PathBuf,
    pub(crate) client: Client,
    credentials: Mutex<Credentials>,
    login: Mutex<Option<(String, CancellationToken)>>,
    requests: Mutex<HashMap<String, Request>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    environment_id: String,
    email: String,
    connected: bool,
    eligible: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginEvent {
    environment_id: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
}

#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    nonce: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    jwks_uri: String,
    revocation_endpoint: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct Model {
    slug: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Delta {
        text: String,
    },
    Completed {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    Summary {
        text: String,
    },
    Interrupted,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn random_secret() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not prepare a secure session.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn trusted_auth_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid authentication configuration.")?;
    if url.scheme() != "https"
        || url.host_str() != Some("auth.openai.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid authentication destination.".into());
    }
    Ok(url)
}

fn persist(path: &Path, credentials: &Credentials) -> Result<(), String> {
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not protect local credentials.")?;
        let bytes = serde_json::to_vec(credentials).map_err(|_| "Could not save credentials.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save credentials.")?;
        std::fs::rename(&temporary, path).map_err(|_| "Could not update credentials.")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub fn initialize(directory: &Path) -> Result<OpenAi, Box<dyn std::error::Error>> {
    let path = directory.join("openai-credentials.json");
    let mut credentials: Credentials = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Credentials::default(),
        Err(error) => return Err(error.into()),
    };
    if credentials.host_id.is_empty() {
        credentials.host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        persist(&path, &credentials)?;
    }
    Ok(OpenAi {
        path,
        client: Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300))
            .build()?,
        credentials: Mutex::new(credentials),
        login: Mutex::new(None),
        requests: Mutex::new(HashMap::new()),
    })
}

fn ensure_environment(database: &super::Database, environment_id: &str) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Local data unavailable.")?;
    let workspace = super::read_workspace(&connection)?;
    if !workspace
        .environments
        .iter()
        .any(|environment| environment.id == environment_id)
    {
        return Err("Environment not found.".into());
    }
    Ok(())
}

async fn discovery(client: &Client) -> Result<Discovery, String> {
    let metadata: Discovery = client
        .get(format!("{AUTH}/.well-known/openid-configuration"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Could not contact OpenAI.")?
        .error_for_status()
        .map_err(|_| "OpenAI did not provide the login configuration.")?
        .json()
        .await
        .map_err(|_| "Invalid login configuration.")?;
    if metadata.issuer != AUTH {
        return Err("Invalid authentication issuer.".into());
    }
    trusted_auth_url(&metadata.jwks_uri)?;
    Ok(metadata)
}

async fn validate_identity(
    client: &Client,
    token: &str,
    client_id: &str,
    nonce: &str,
) -> Result<Claims, String> {
    let metadata = discovery(client).await?;
    let keys: JwkSet = client
        .get(trusted_auth_url(&metadata.jwks_uri)?)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Could not verify the OpenAI identity.")?
        .error_for_status()
        .map_err(|_| "Could not retrieve OpenAI keys.")?
        .json()
        .await
        .map_err(|_| "Invalid identity keys.")?;
    verify_identity(token, &keys, client_id, nonce)
}

fn verify_identity(
    token: &str,
    keys: &JwkSet,
    client_id: &str,
    nonce: &str,
) -> Result<Claims, String> {
    let header = decode_header(token).map_err(|_| "Invalid identity token.")?;
    if !matches!(header.alg, Algorithm::RS256 | Algorithm::ES256) {
        return Err("Unsupported identity signature.".into());
    }
    let key = keys
        .find(
            header
                .kid
                .as_deref()
                .ok_or("Missing signature identifier.")?,
        )
        .ok_or("Unknown identity key.")?;
    let mut validation = Validation::new(header.alg);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&[AUTH]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.validate_nbf = true;
    validation.leeway = 30;
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_jwk(key).map_err(|_| "Invalid identity key.")?,
        &validation,
    )
    .map_err(|_| "The OpenAI identity could not be validated.")?
    .claims;
    if claims.sub.is_empty()
        || !bool::from(
            claims
                .nonce
                .as_deref()
                .unwrap_or("")
                .as_bytes()
                .ct_eq(nonce.as_bytes()),
        )
    {
        return Err("The returned session does not match the login request.".into());
    }
    Ok(claims)
}

#[tauri::command]
pub async fn openai_accounts(
    state: State<'_, OpenAi>,
    locale: Option<String>,
) -> Result<Vec<Account>, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<Vec<Account>, String> = async {
        Ok(state
            .credentials
            .lock()
            .await
            .accounts
            .iter()
            .map(|(id, account)| Account {
                environment_id: id.clone(),
                email: account.email.clone(),
                connected: account.tokens.is_some(),
                eligible: account
                    .tokens
                    .as_ref()
                    .is_some_and(|tokens| tokens.scopes.iter().any(|scope| scope == PERMISSION)),
            })
            .collect())
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

fn callback_parameters(
    target: &str,
    expected_state: &str,
    previous_client: Option<&str>,
) -> Result<Option<(String, String)>, String> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "Invalid callback.")?;
    if url.path() != "/auth/callback" {
        return Ok(None);
    }
    let mut values = HashMap::new();
    for (key, value) in url.query_pairs() {
        if values
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("Duplicate callback.".into());
        }
    }
    if !bool::from(
        values
            .get("state")
            .map(String::as_bytes)
            .unwrap_or_default()
            .ct_eq(expected_state.as_bytes()),
    ) {
        return Ok(None);
    }
    if values.contains_key("error") {
        return Err("Login canceled or not authorized by OpenAI.".into());
    }
    let client_id = match (previous_client, values.get("client_id")) {
        (Some(previous), Some(returned)) if previous != returned => {
            return Err("The returned account does not match the selected account.".into())
        }
        (Some(previous), _) => previous.to_string(),
        (None, Some(returned)) if !returned.is_empty() && returned != "dynamic_agent_client" => {
            returned.clone()
        }
        _ => return Err("OpenAI did not complete this app's registration.".into()),
    };
    let code = values
        .remove("code")
        .filter(|code| !code.is_empty())
        .ok_or("Missing authorization code.")?;
    Ok(Some((code, client_id)))
}

async fn receive_callback(
    listener: TcpListener,
    state: &str,
    previous: Option<&str>,
    locale: crate::i18n::Locale,
) -> Result<(String, String), String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "Could not receive the login callback.")?;
        let mut data = Vec::new();
        let read = tokio::time::timeout(Duration::from_secs(3), async {
            let mut buffer = [0; 1024];
            while data.len() < 8192 {
                let size = socket.read(&mut buffer).await?;
                if size == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..size]);
                if data.windows(4).any(|value| value == b"\r\n\r\n") {
                    break;
                }
            }
            Ok::<(), std::io::Error>(())
        })
        .await;
        if !matches!(read, Ok(Ok(()))) {
            continue;
        }
        let request = String::from_utf8_lossy(&data);
        let mut parts = request.lines().next().unwrap_or("").split_whitespace();
        if parts.next() != Some("GET") {
            continue;
        }
        let target = parts.next().unwrap_or("");
        let result = callback_parameters(target, state, previous);
        let page_state = match &result {
            Ok(Some(_)) => super::auth_page::CallbackState::Received,
            Ok(None) => super::auth_page::CallbackState::Invalid,
            Err(_) => super::auth_page::CallbackState::Denied,
        };
        let response = super::auth_page::callback_response(page_state, locale);
        let _ = socket.write_all(response.as_bytes()).await;
        if let Some(value) = result? {
            return Ok(value);
        }
    }
}

#[tauri::command]
pub async fn openai_login(
    app: tauri::AppHandle,
    database: State<'_, super::Database>,
    state: State<'_, OpenAi>,
    environment_id: String,

    locale: Option<String>,
) -> Result<(), String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<(), String> = async {
        ensure_environment(&database, &environment_id)?;
        let cancel = CancellationToken::new();
        {
            let mut pending = state.login.lock().await;
            if pending.is_some() {
                return Err("A login is already in progress. Complete or cancel it first.".into());
            }
            *pending = Some((environment_id.clone(), cancel.clone()));
        }
        let result = tokio::select! {
            _ = cancel.cancelled() => Err("Login canceled.".into()),
            result = login_inner(&state, &environment_id, cancel.clone(), language) => result,
        };
        *state.login.lock().await = None;
        let _ = app.emit(
            "openai-account-changed",
            LoginEvent {
                environment_id,
                error: result
                    .as_ref()
                    .err()
                    .map(|error| crate::i18n::message(error, language)),
            },
        );
        result
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

async fn login_inner(
    state: &OpenAi,
    environment_id: &str,
    cancel: CancellationToken,
    locale: crate::i18n::Locale,
) -> Result<(), String> {
    let (host_id, previous) = {
        let credentials = state.credentials.lock().await;
        (
            credentials.host_id.clone(),
            credentials.accounts.get(environment_id).cloned(),
        )
    };
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not open the local callback.")?;
    let redirect = format!(
        "http://127.0.0.1:{}/auth/callback",
        listener
            .local_addr()
            .map_err(|_| "Callback unavailable.")?
            .port()
    );
    let csrf = random_secret()?;
    let nonce = random_secret()?;
    let verifier = random_secret()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = trusted_auth_url(&format!("{AUTH}/api/accounts/authorize"))?;
    {
        let mut query = url.query_pairs_mut();
        query.extend_pairs([
            (
                "client_id",
                previous
                    .as_ref()
                    .map(|account| account.client_id.as_str())
                    .unwrap_or("dynamic_agent_client"),
            ),
            ("ext_agent_host_id", &host_id),
            ("response_type", "code"),
            ("redirect_uri", &redirect),
            (
                "scope",
                "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            ),
            ("resource", API),
            ("state", &csrf),
            ("nonce", &nonce),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
        ]);
        if previous.is_none() {
            query.append_pair("agent_name_hint", "Agent Workbench");
        }
    }
    // Only the authorization URL generated above is passed to the system browser.
    let browser = std::process::Command::new("/usr/bin/xdg-open")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .env_remove("GTK_PATH")
        .env_remove("GIO_MODULE_DIR")
        .env_remove("GIO_EXTRA_MODULES")
        .env_remove("GDK_PIXBUF_MODULE_FILE")
        .arg(url.as_str())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "Could not open the browser. Check that xdg-open is installed.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut browser = browser;
        let _ = browser.wait();
    });
    let (code, client_id) = tokio::select! {
        _ = cancel.cancelled() => return Err("Login canceled.".into()),
        result = tokio::time::timeout(Duration::from_secs(240), receive_callback(listener, &csrf, previous.as_ref().map(|account| account.client_id.as_str()), locale)) =>
            result.map_err(|_| "Login timed out. Try again.")??,
    };
    let response = state
        .client
        .post(format!("{AUTH}/api/accounts/oauth/token"))
        .timeout(Duration::from_secs(20))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("resource", API),
        ])
        .send()
        .await
        .map_err(|_| "Could not complete login with OpenAI.")?;
    let tokens = read_tokens(response).await?;
    let identity_token = tokens
        .id_token
        .as_deref()
        .ok_or("OpenAI did not return an identity token.")?;
    let claims = validate_identity(&state.client, identity_token, &client_id, &nonce).await?;
    if previous
        .as_ref()
        .is_some_and(|previous| previous.subject != claims.sub)
    {
        return Err("This identity differs from the account linked to the environment.".into());
    }
    let account = Registration {
        client_id,
        subject: claims.sub,
        email: claims.email.unwrap_or_else(|| "OpenAI account".into()),
        tokens: Some(convert_tokens(tokens, None)?),
    };
    if cancel.is_cancelled() {
        return Err("Login canceled.".into());
    }
    let mut credentials = state.credentials.lock().await;
    if cancel.is_cancelled() {
        return Err("Login canceled.".into());
    }
    let mut updated = Credentials {
        host_id: credentials.host_id.clone(),
        accounts: credentials.accounts.clone(),
    };
    updated.accounts.insert(environment_id.into(), account);
    persist(&state.path, &updated)?;
    *credentials = updated;
    Ok(())
}

#[tauri::command]
pub async fn openai_cancel_login(
    state: State<'_, OpenAi>,
    locale: Option<String>,
) -> Result<(), String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<(), String> = async {
        if let Some((_, cancel)) = state.login.lock().await.as_ref() {
            cancel.cancel();
        }
        Ok(())
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

async fn read_tokens(response: reqwest::Response) -> Result<TokenResponse, String> {
    if !response.status().is_success() {
        return Err(
            "OpenAI denied authorization. Reconnect the account or check subscription eligibility."
                .into(),
        );
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid authentication response.".into())
}

fn convert_tokens(response: TokenResponse, previous: Option<&Tokens>) -> Result<Tokens, String> {
    if !response.token_type.eq_ignore_ascii_case("bearer")
        || response.access_token.is_empty()
        || response.expires_in == 0
    {
        return Err("Invalid OpenAI credentials.".into());
    }
    let scopes = match response.scope {
        Some(scopes) => scopes.split_whitespace().map(str::to_string).collect(),
        None if previous.is_some() => previous.unwrap().scopes.clone(),
        None => vec![],
    };
    Ok(Tokens {
        access_token: response.access_token,
        refresh_token: response
            .refresh_token
            .or_else(|| previous.and_then(|tokens| tokens.refresh_token.clone())),
        id_token: response
            .id_token
            .or_else(|| previous.map(|tokens| tokens.id_token.clone()))
            .ok_or("Missing OpenAI identity.")?,
        expires_at: now().saturating_add(response.expires_in),
        scopes,
    })
}

pub(crate) async fn access_token(state: &OpenAi, environment_id: &str) -> Result<String, String> {
    // Serializing refresh and persistence prevents rotating-token races in this process.
    let mut credentials = state.credentials.lock().await;
    let account = credentials
        .accounts
        .get(environment_id)
        .cloned()
        .ok_or("Connect an OpenAI account to this environment.")?;
    let mut tokens = account
        .tokens
        .clone()
        .ok_or("Reconnect this environment's account.")?;
    if !tokens.scopes.iter().any(|scope| scope == PERMISSION) {
        return Err("The account did not authorize subscription use in this app. Reconnect the account and check permissions.".into());
    }
    if tokens.expires_at <= now().saturating_add(60) {
        let refresh = tokens
            .refresh_token
            .as_deref()
            .ok_or("The session expired. Reconnect the account.")?;
        let response = state
            .client
            .post(format!("{AUTH}/api/accounts/oauth/token"))
            .timeout(Duration::from_secs(20))
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", &account.client_id),
                ("refresh_token", refresh),
                ("resource", API),
            ])
            .send()
            .await
            .map_err(|_| "Could not refresh the OpenAI session.")?;
        tokens = convert_tokens(read_tokens(response).await?, Some(&tokens))?;
        if !tokens.scopes.iter().any(|scope| scope == PERMISSION) {
            return Err("Subscription permission is no longer available.".into());
        }
        let mut updated = Credentials {
            host_id: credentials.host_id.clone(),
            accounts: credentials.accounts.clone(),
        };
        updated
            .accounts
            .get_mut(environment_id)
            .ok_or("Account unavailable.")?
            .tokens = Some(tokens.clone());
        persist(&state.path, &updated)?;
        *credentials = updated;
    }
    Ok(tokens.access_token)
}

#[tauri::command]
pub async fn openai_models(
    database: State<'_, super::Database>,
    state: State<'_, OpenAi>,
    environment_id: String,

    locale: Option<String>,
) -> Result<Vec<Model>, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<Vec<Model>, String> = async {
        ensure_environment(&database, &environment_id)?;
        let token = access_token(&state, &environment_id).await?;
        let response = state
            .client
            .get(format!("{API}/models"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Could not retrieve models.")?;
        if !response.status().is_success() {
            return Err(api_error(response.status().as_u16(), ""));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid model catalog.")?;
        Ok(value
            .get("models")
            .and_then(Value::as_array)
            .ok_or("Unsupported model catalog.")?
            .iter()
            .filter(|item| item["visibility"] == "list")
            .filter_map(|item| {
                Some(Model {
                    slug: item["slug"].as_str()?.into(),
                    name: item["display_name"].as_str()?.into(),
                })
            })
            .collect())
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

pub(crate) fn api_error(status: u16, code: &str) -> String {
    match (status, code) {
        (_, "subscription_sharing_user_not_eligible") => {
            "The subscription or workspace does not allow this app."
        }
        (_, "subscription_sharing_usage_limit_exceeded") | (429, _) => {
            "The usage limit has been reached. Check your limits in ChatGPT > Settings > Usage."
        }
        (_, "subscription_sharing_usage_unavailable") | (503, _) => {
            "Subscription usage is temporarily unavailable. Try again later."
        }
        (401, _) => "The OpenAI session is no longer valid. Reconnect the account.",
        (403, _) => "The account or workspace did not authorize this request.",
        (400, _) | (404, _) => {
            "The model or request is unavailable for this account. Refresh the model list."
        }
        _ => "The OpenAI request failed. Try again later.",
    }
    .into()
}

fn chat_input(
    workspace: &super::Workspace,
    settings: &crate::settings::AppSettings,
    environment_id: &str,
    conversation_id: &str,
    model: &str,
) -> Result<Value, String> {
    if model.is_empty() || model.len() > 160 {
        return Err("Select a valid model.".into());
    }
    let environment = workspace
        .environments
        .iter()
        .find(|environment| environment.id == environment_id)
        .ok_or("Environment not found.")?;
    let conversation = workspace
        .conversations
        .iter()
        .find(|conversation| {
            conversation.id == conversation_id
                && conversation.environment_id == environment_id
                && conversation.mode == "chat"
                && !conversation.archived
        })
        .ok_or("This conversation is not a Chat in this environment.")?;
    let mut instructions = settings.instructions(&environment.instructions);
    if let Some(project_id) = &conversation.project_id {
        let project = workspace
            .projects
            .iter()
            .find(|project| {
                &project.id == project_id
                    && project.environment_id == environment_id
                    && !project.archived
            })
            .ok_or("Project unavailable in this environment.")?;
        instructions.push_str("\n\nProject context:\n");
        instructions.push_str(&project.memory);
    }
    let input: Vec<Value> = conversation
        .messages
        .iter()
        .filter(|message| message.status.as_deref().unwrap_or("completed") == "completed")
        .map(|message| json!({"role": message.role, "content": message.content}))
        .collect();
    if input.is_empty() {
        return Err("The conversation has no messages to send.".into());
    }
    Ok(
        json!({"model": model, "input": input, "instructions": instructions, "store": false, "stream": true}),
    )
}

pub(crate) fn extract_events(buffer: &mut Vec<u8>) -> Result<Vec<Value>, String> {
    if buffer.len() > 2_000_000 {
        return Err("The response exceeded the supported size.".into());
    }
    let mut result = vec![];
    loop {
        let separator = buffer
            .windows(2)
            .position(|slice| slice == b"\n\n")
            .map(|index| (index, 2))
            .or_else(|| {
                buffer
                    .windows(4)
                    .position(|slice| slice == b"\r\n\r\n")
                    .map(|index| (index, 4))
            });
        let Some((index, length)) = separator else {
            break;
        };
        let bytes: Vec<u8> = buffer.drain(..index + length).collect();
        let text =
            std::str::from_utf8(&bytes).map_err(|_| "The response contains invalid text.")?;
        let data = text
            .lines()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        result.push(
            serde_json::from_str(&data).map_err(|_| "The OpenAI response could not be read.")?,
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn openai_chat(
    database: State<'_, super::Database>,
    state: State<'_, OpenAi>,
    environment_id: String,
    conversation_id: String,
    model: String,
    request_id: String,
    on_event: Channel<ChatEvent>,

    locale: Option<String>,
) -> Result<(), String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<(), String> = async {
        let input = {
            let connection = database.0.lock().map_err(|_| "Local data unavailable.")?;
            chat_input(
                &super::read_workspace(&connection)?,
                &crate::settings::read(&connection)?,
                &environment_id,
                &conversation_id,
                &model,
            )?
        };
        let cancel = CancellationToken::new();
        {
            let mut requests = state.requests.lock().await;
            if requests.contains_key(&request_id)
                || requests
                    .values()
                    .any(|request| request.environment_id == environment_id)
            {
                return Err("A response is already in progress in this environment.".into());
            }
            requests.insert(
                request_id.clone(),
                Request {
                    environment_id: environment_id.clone(),
                    cancel: cancel.clone(),
                },
            );
        }
        let token = access_token(&state, &environment_id).await;
        let result = match token {
            Err(error) => Err(error),
            Ok(token) => tokio::select! {
              _ = cancel.cancelled() => { let _ = on_event.send(ChatEvent::Interrupted); Ok(()) },
              result = stream_chat(&state, token, input, &on_event) => result,
            },
        };
        state.requests.lock().await.remove(&request_id);
        result
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

async fn stream_chat(
    state: &OpenAi,
    token: String,
    input: Value,
    channel: &Channel<ChatEvent>,
) -> Result<(), String> {
    let response = state
        .client
        .post(format!("{API}/responses"))
        .bearer_auth(token)
        .json(&input)
        .send()
        .await
        .map_err(|_| "Could not contact OpenAI. The message was saved.")?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error = response.json::<Value>().await.unwrap_or_default();
        return Err(api_error(
            status,
            error["error"]["code"].as_str().unwrap_or(""),
        ));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = vec![];
    let mut output_size = 0;
    let mut summary_size = 0;
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(90), stream.next())
        .await
        .map_err(|_| "The response timed out. You can try again.")?
    {
        buffer.extend_from_slice(
            &chunk.map_err(|_| {
                "The connection was interrupted. The partial response was preserved."
            })?,
        );
        for event in extract_events(&mut buffer)? {
            match event["type"].as_str().unwrap_or("") {
                "response.output_text.delta" | "response.refusal.delta" => {
                    let text = event["delta"].as_str().ok_or("Invalid response text.")?;
                    output_size += text.len();
                    if output_size > 2_000_000 {
                        return Err("The response exceeded the supported size.".into());
                    }
                    channel
                        .send(ChatEvent::Delta { text: text.into() })
                        .map_err(|_| "The conversation was closed.")?;
                }
                "response.reasoning_summary_text.delta" => {
                    let text = event["delta"].as_str().ok_or("Invalid response text.")?;
                    summary_size += text.len();
                    if summary_size <= 20_000 {
                        channel
                            .send(ChatEvent::Summary { text: text.into() })
                            .map_err(|_| "The conversation was closed.")?;
                    }
                }
                "response.completed" => {
                    if event["response"]["status"] != "completed" {
                        return Err("OpenAI did not complete the response.".into());
                    }
                    channel
                        .send(ChatEvent::Completed {
                            input_tokens: event["response"]["usage"]["input_tokens"].as_u64(),
                            output_tokens: event["response"]["usage"]["output_tokens"].as_u64(),
                        })
                        .map_err(|_| "The conversation was closed.")?;
                    return Ok(());
                }
                "response.failed" | "error" => {
                    return Err(api_error(
                        0,
                        event["response"]["error"]["code"]
                            .as_str()
                            .or_else(|| event["code"].as_str())
                            .unwrap_or(""),
                    ))
                }
                "response.incomplete" => {
                    return Err(
                        "OpenAI returned an incomplete response. The partial text was preserved."
                            .into(),
                    )
                }
                _ => {}
            }
        }
    }
    Err("The connection ended before OpenAI completed the response.".into())
}

#[tauri::command]
pub async fn openai_cancel_chat(
    state: State<'_, OpenAi>,
    environment_id: String,
    request_id: String,

    locale: Option<String>,
) -> Result<(), String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<(), String> = async {
        if let Some(request) = state.requests.lock().await.get(&request_id) {
            if request.environment_id != environment_id {
                return Err("The request belongs to another environment.".into());
            }
            request.cancel.cancel();
        }
        Ok(())
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

#[tauri::command]
pub async fn openai_logout(
    app: tauri::AppHandle,
    state: State<'_, OpenAi>,
    environment_id: String,

    locale: Option<String>,
) -> Result<bool, String> {
    let language = crate::i18n::Locale::from_option(locale.as_deref());
    let result: Result<bool, String> = async {
        super::worker::cancel_environment(&app, &environment_id);
        if let Some((pending_environment, cancel)) = state.login.lock().await.as_ref() {
            if pending_environment == &environment_id {
                cancel.cancel();
            }
        }
        for request in state.requests.lock().await.values() {
            if request.environment_id == environment_id {
                request.cancel.cancel();
            }
        }
        let mut credentials = state.credentials.lock().await;
        let account = credentials
            .accounts
            .get(&environment_id)
            .cloned()
            .ok_or("This environment has no connected account.")?;
        let mut revoked = false;
        if let Some(refresh) = account
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.refresh_token.as_ref())
        {
            if let Ok(metadata) = discovery(&state.client).await {
                if let Some(endpoint) = metadata
                    .revocation_endpoint
                    .and_then(|endpoint| trusted_auth_url(&endpoint).ok())
                {
                    for attempt in 0..2 {
                        let response = state
                            .client
                            .post(endpoint.clone())
                            .timeout(Duration::from_secs(20))
                            .form(&[
                                ("token", refresh.as_str()),
                                ("token_type_hint", "refresh_token"),
                                ("client_id", account.client_id.as_str()),
                            ])
                            .send()
                            .await;
                        if response.is_ok_and(|response| response.status().is_success()) {
                            revoked = true;
                            break;
                        }
                        if attempt == 0 {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
        let mut updated = Credentials {
            host_id: credentials.host_id.clone(),
            accounts: credentials.accounts.clone(),
        };
        updated
            .accounts
            .get_mut(&environment_id)
            .ok_or("Account unavailable.")?
            .tokens = None;
        persist(&state.path, &updated)?;
        *credentials = updated;
        Ok(revoked)
    }
    .await;
    result.map_err(|error| crate::i18n::message(&error, language))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn callback_listener_ignores_foreign_state_then_accepts_own_attempt() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let pending = tokio::spawn(async move {
            receive_callback(listener, "own-state", None, crate::i18n::Locale::English).await
        });
        for (state, expected_status) in [
            ("foreign-state", "400 Bad Request"),
            ("own-state", "200 OK"),
        ] {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream.write_all(format!("GET /auth/callback?state={state}&code=test-code&client_id=issued HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
            let mut response = vec![];
            tokio::time::timeout(Duration::from_secs(3), stream.read_to_end(&mut response))
                .await
                .unwrap()
                .unwrap();
            assert!(String::from_utf8(response)
                .unwrap()
                .contains(expected_status));
        }
        assert_eq!(
            pending.await.unwrap().unwrap(),
            ("test-code".into(), "issued".into())
        );
    }

    #[test]
    fn refresh_replaces_rotation_and_preserves_only_omitted_scopes() {
        let previous = Tokens {
            access_token: "fixture-access".into(),
            refresh_token: Some("fixture-refresh".into()),
            id_token: "fixture-identity".into(),
            expires_at: 1,
            scopes: vec![PERMISSION.into()],
        };
        let response = || TokenResponse {
            access_token: "fixture-new-access".into(),
            refresh_token: Some("fixture-new-refresh".into()),
            id_token: None,
            token_type: "Bearer".into(),
            expires_in: 3600,
            scope: None,
        };
        let updated = convert_tokens(response(), Some(&previous)).unwrap();
        assert_eq!(
            updated.refresh_token.as_deref(),
            Some("fixture-new-refresh")
        );
        assert_eq!(updated.scopes, previous.scopes);
        let mut explicit_scopes = response();
        explicit_scopes.scope = Some("openid".into());
        assert!(!convert_tokens(explicit_scopes, Some(&previous))
            .unwrap()
            .scopes
            .contains(&PERMISSION.to_string()));
    }

    #[test]
    fn verifies_signature_audience_issuer_expiry_and_nonce() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let private = Command::new("openssl")
            .args([
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
            ])
            .output()
            .expect("OpenSSL must be available in the build image");
        assert!(private.status.success());
        let mut modulus = Command::new("openssl")
            .args(["rsa", "-modulus", "-noout"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        modulus
            .stdin
            .take()
            .unwrap()
            .write_all(&private.stdout)
            .unwrap();
        let modulus = modulus.wait_with_output().unwrap();
        assert!(modulus.status.success());
        let modulus_text = String::from_utf8(modulus.stdout).unwrap();
        let hex = modulus_text.trim().strip_prefix("Modulus=").unwrap();
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
            .collect();
        let keys: JwkSet = serde_json::from_value(json!({"keys": [{"kty": "RSA", "kid": "test", "alg": "RS256", "n": URL_SAFE_NO_PAD.encode(bytes), "e": "AQAB"}]})).unwrap();
        let key = jsonwebtoken::EncodingKey::from_rsa_pem(&private.stdout).unwrap();
        let mut header = jsonwebtoken::Header::new(Algorithm::RS256);
        header.kid = Some("test".into());
        let claims = json!({"iss": AUTH, "aud": "issued-client", "sub": "subject", "exp": now() + 300, "nonce": "expected-nonce"});
        let token = jsonwebtoken::encode(&header, &claims, &key).unwrap();
        assert_eq!(
            verify_identity(&token, &keys, "issued-client", "expected-nonce")
                .unwrap()
                .sub,
            "subject"
        );
        assert!(verify_identity(&token, &keys, "another-client", "expected-nonce").is_err());
        assert!(verify_identity(&token, &keys, "issued-client", "wrong-nonce").is_err());
        for (field, value) in [
            ("iss", json!("https://invalid.test")),
            ("exp", json!(now() - 120)),
        ] {
            let mut modified = claims.clone();
            modified[field] = value;
            let invalid = jsonwebtoken::encode(&header, &modified, &key).unwrap();
            assert!(verify_identity(&invalid, &keys, "issued-client", "expected-nonce").is_err());
        }
        let invalid_signature = format!("{}.invalid", token.rsplit_once('.').unwrap().0);
        assert!(
            verify_identity(&invalid_signature, &keys, "issued-client", "expected-nonce").is_err()
        );
    }

    #[test]
    fn credentials_are_atomic_private_and_separate_for_equal_emails() {
        let directory = std::env::temp_dir().join(format!(
            "workbench-credentials-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("credentials.json");
        let mut credentials = Credentials {
            host_id: "test-host".into(),
            accounts: HashMap::new(),
        };
        for (environment, client_id) in [("personal", "client-one"), ("work", "client-two")] {
            credentials.accounts.insert(
                environment.into(),
                Registration {
                    client_id: client_id.into(),
                    subject: "same-subject".into(),
                    email: "fixture@example.test".into(),
                    tokens: None,
                },
            );
        }
        persist(&path, &credentials).unwrap();
        let stored: Credentials = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_ne!(
            stored.accounts["personal"].client_id,
            stored.accounts["work"].client_id
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_wrong_state_and_replaced_client() {
        assert!(callback_parameters(
            "/auth/callback?state=wrong&code=secret&client_id=issued",
            "expected",
            None
        )
        .unwrap()
        .is_none());
        assert!(callback_parameters(
            "/auth/callback?state=ok&code=secret&client_id=other",
            "ok",
            Some("issued")
        )
        .is_err());
        assert!(callback_parameters(
            "/auth/callback?state=ok&state=ok&code=secret&client_id=issued",
            "ok",
            None
        )
        .is_err());
        assert!(callback_parameters(
            "/auth/callback?state=ok&code=secret&client_id=dynamic_agent_client",
            "ok",
            None
        )
        .is_err());
        assert_eq!(
            callback_parameters("/auth/callback?state=ok&code=secret", "ok", Some("issued"))
                .unwrap(),
            Some(("secret".into(), "issued".into()))
        );
    }

    #[test]
    fn stream_handles_fragmented_unicode_and_crlf() {
        let bytes =
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello 🚀\"}\r\n\r\n"
                .as_bytes();
        let split = bytes.iter().position(|byte| *byte == 0xf0).unwrap() + 1;
        let mut buffer = bytes[..split].to_vec();
        assert!(extract_events(&mut buffer).unwrap().is_empty());
        buffer.extend_from_slice(&bytes[split..]);
        assert_eq!(extract_events(&mut buffer).unwrap()[0]["delta"], "hello 🚀");
        assert!(buffer.is_empty());
    }

    #[test]
    fn rejects_untrusted_identity_endpoints() {
        for endpoint in [
            "http://auth.openai.com/keys",
            "https://auth.openai.com.evil.test/keys",
            "https://auth.openai.com:8443/keys",
        ] {
            assert!(trusted_auth_url(endpoint).is_err());
        }
    }

    #[test]
    fn chat_never_reads_another_environment_or_worker() {
        let mut workspace = super::super::initial_workspace();
        workspace.environments[0].instructions = "Private instructions".into();
        workspace.environments[1].instructions = "Work instructions".into();
        let mut conversation = super::super::tests::conversation("personal", "chat");
        conversation.messages.push(super::super::Message {
            id: "m".into(),
            content: "Hello".into(),
            created_at: String::new(),
            role: "user".into(),
            status: None,
            duration_ms: None,
            summary: None,
            worker_run_id: None,
        });
        workspace.conversations.push(conversation);
        assert!(chat_input(
            &workspace,
            &crate::settings::AppSettings::default(),
            "work",
            "conversation",
            "model"
        )
        .is_err());
        let settings = crate::settings::AppSettings {
            agents_markdown: "Global instruction".into(),
            ..Default::default()
        };
        let input = chat_input(&workspace, &settings, "personal", "conversation", "model").unwrap();
        let instructions = input["instructions"].as_str().unwrap();
        assert!(instructions.contains("Global instruction"));
        assert!(instructions.contains("Private instructions"));
        assert!(!instructions.contains("Work instructions"));
        workspace.conversations[0].archived = true;
        assert!(chat_input(
            &workspace,
            &crate::settings::AppSettings::default(),
            "personal",
            "conversation",
            "model"
        )
        .is_err());
        workspace.conversations[0].mode = "worker".into();
        assert!(chat_input(
            &workspace,
            &crate::settings::AppSettings::default(),
            "personal",
            "conversation",
            "model"
        )
        .is_err());
    }
}
