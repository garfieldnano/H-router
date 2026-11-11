//! h-router-relay library: proxy core, header profiles, ban counters.
//!
//! Two relay contracts (user decision 2026-11-11: BOTH):
//! - **Mode A** — standard HTTP proxy: absolute-form requests
//!   (`POST http://upstream/path`) and `CONNECT host:port` tunnels.
//! - **Mode B** — `x-relay-target` / `x-relay-path` headers, mirroring the JS
//!   reference in `src/app/api/proxy-pools/vercel-deploy/route.js`
//!   (`RELAY_FUNCTION_CODE`).
//!
//! Header profiles mirror `open-sse/executors/default.js` `HEADER_HOOKS`,
//! `open-sse/config/appConstants.js` `buildKimiHeaders` and
//! `open-sse/shared/clineAuth.js` `buildClineHeaders`.
//!
//! Ban detection limitation (by design): code 11128 is only detectable in
//! non-streaming JSON error responses (HTTP 400 + `application/json` body
//! containing `"code": 11128`). Streamed responses (SSE / chunked) are never
//! buffered, so only status-based 403/429 detection applies to them.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use chrono::Local;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderName, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// Secrets / ids for header profiles. Never hardcoded: config file or env.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    /// Profile name: codebuddy | kimi | minimax | muse | cline | kilocode | none
    #[serde(default = "default_profile")]
    pub profile: String,
    /// Listen address, e.g. 127.0.0.1:20129
    #[serde(default = "default_listen")]
    pub listen: String,
    /// Kimi device id (stable per connection). Falls back to `kimi-<millis>`.
    #[serde(default)]
    pub kimi_device_id: Option<String>,
    /// Cline API key (`clp_...`) or OAuth access token (JWT).
    #[serde(default)]
    pub cline_api_key: Option<String>,
    #[serde(default)]
    pub cline_access_token: Option<String>,
    /// KiloCode organization id.
    #[serde(default)]
    pub kilocode_org_id: Option<String>,
    /// Muse: true = subscription (minted key) mode -> send x-api-version.
    #[serde(default)]
    pub muse_subscription: bool,
    /// App version stamped into Kimi / Cline headers. JS uses the 9router
    /// package.json version; default mirrors that (0.5.116 at time of writing).
    #[serde(default = "default_app_version")]
    pub app_version: String,
}

fn default_profile() -> String {
    "none".to_string()
}
fn default_listen() -> String {
    "127.0.0.1:20129".to_string()
}
fn default_app_version() -> String {
    "0.5.116".to_string()
}

/// Manual Default so `RelayConfig::default()` (used when no config file /
/// env is given) carries the same defaults as deserialization — a derived
/// Default would leave `app_version` empty and Kimi/Cline headers blank.
impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            profile: default_profile(),
            listen: default_listen(),
            kimi_device_id: None,
            cline_api_key: None,
            cline_access_token: None,
            kilocode_org_id: None,
            muse_subscription: false,
            app_version: default_app_version(),
        }
    }
}

impl RelayConfig {
    /// Precedence: CLI flag > env > config file > built-in default.
    pub fn from_env_and_file(
        file: Option<&str>,
        cli_listen: Option<String>,
        cli_profile: Option<String>,
    ) -> Result<Self, String> {
        let mut cfg = RelayConfig::default();
        let env_path = std::env::var("HROUTER_RELAY_CONFIG").ok();
        let path_opt = file.map(|s| s.to_string()).or(env_path);
        if let Some(path) = path_opt.as_deref() {
            let text = std::fs::read_to_string(path)
                .map_err(|e| format!("cannot read config {path}: {e}"))?;
            cfg = parse_config_text(&text, path)?;
        }
        // Env overrides (secrets live here or in the file, never hardcoded).
        if let Ok(v) = std::env::var("HROUTER_RELAY_LISTEN") {
            cfg.listen = v;
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_PROFILE") {
            cfg.profile = v;
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_KIMI_DEVICE_ID") {
            cfg.kimi_device_id = Some(v);
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_CLINE_API_KEY") {
            cfg.cline_api_key = Some(v);
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_CLINE_ACCESS_TOKEN") {
            cfg.cline_access_token = Some(v);
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_KILOCODE_ORG_ID") {
            cfg.kilocode_org_id = Some(v);
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_MUSE_SUBSCRIPTION") {
            cfg.muse_subscription = v.eq_ignore_ascii_case("true") || v == "1";
        }
        if let Ok(v) = std::env::var("HROUTER_RELAY_APP_VERSION") {
            cfg.app_version = v;
        }
        if let Some(v) = cli_listen {
            cfg.listen = v;
        }
        if let Some(v) = cli_profile {
            cfg.profile = v;
        }
        Ok(cfg)
    }
}

/// Parse TOML, falling back to JSON (`.json` extension forces JSON).
pub fn parse_config_text(text: &str, path: &str) -> Result<RelayConfig, String> {
    if path.ends_with(".json") {
        return serde_json::from_str(text).map_err(|e| format!("invalid JSON config: {e}"));
    }
    match toml::from_str::<RelayConfig>(text) {
        Ok(c) => Ok(c),
        Err(toml_err) => match serde_json::from_str::<RelayConfig>(text) {
            Ok(c) => Ok(c),
            Err(_) => Err(format!("invalid TOML config: {toml_err}")),
        },
    }
}

// ---------------------------------------------------------------------------
// Ban counters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
pub struct Counters {
    pub requests: u64,
    pub ok: u64,
    pub ban_403: u64,
    pub ban_429: u64,
    pub ban_11128: u64,
    pub last_ban_at: Option<String>,
    pub last_ban_status: Option<u16>,
    pub last_ban_code: Option<u64>,
}

#[derive(Debug, Default)]
struct StatsData {
    global: Counters,
    per_profile: HashMap<String, Counters>,
}

impl StatsData {
    fn record(&mut self, profile: &str, status: StatusCode, code_11128: bool) {
        let now = chrono::Utc::now().to_rfc3339();
        for c in [&mut self.global, self.per_profile.entry(profile.to_string()).or_default()] {
            c.requests += 1;
            if status.is_success() {
                c.ok += 1;
            }
            let banned = status == StatusCode::FORBIDDEN
                || status == StatusCode::TOO_MANY_REQUESTS
                || code_11128;
            if status == StatusCode::FORBIDDEN {
                c.ban_403 += 1;
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                c.ban_429 += 1;
            }
            if code_11128 {
                c.ban_11128 += 1;
            }
            if banned {
                c.last_ban_at = Some(now.clone());
                c.last_ban_status = Some(status.as_u16());
                c.last_ban_code = if code_11128 { Some(11128) } else { None };
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsSnapshot {
    pub global: Counters,
    pub per_profile: HashMap<String, Counters>,
    pub profile: String,
    pub uptime_secs: u64,
    pub banned: bool,
}

// ---------------------------------------------------------------------------
// Header profiles
// ---------------------------------------------------------------------------

/// Rustc version embedded by build.rs (used as Cline X-PLATFORM-VERSION,
/// mirroring JS `process.version` which is the Node version).
fn rustc_version() -> &'static str {
    env!("RUSTC_VERSION")
}

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other, // "linux" matches JS process.platform already
    }
}

fn device_model() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match os {
        "macos" => format!("macOS {arch}"),
        "windows" => format!("Windows {arch}"),
        "linux" => format!("Linux {arch}"),
        _ => format!("{os} {arch}"),
    }
}

/// Cline token handling (open-sse/shared/clineAuth.js getClineAccessToken):
/// `workos:` prefix kept; WorkOS JWTs (`eyJ... . ...`) get `workos:` prepended;
/// ClinePass API keys (`clp_...`, not JWTs) are sent verbatim.
pub fn cline_access_token(token: &str) -> String {
    let t = token.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.to_lowercase().starts_with("workos:") {
        return t.to_string();
    }
    let is_jwt = {
        let mut parts = t.split('.');
        matches!(parts.next(), Some(h) if h.starts_with("eyJ"))
            && parts.next().is_some_and(|p| !p.is_empty())
    };
    if is_jwt {
        format!("workos:{t}")
    } else {
        t.to_string()
    }
}

fn build_kimi_headers(cfg: &RelayConfig) -> Vec<(String, String)> {
    let device_id = cfg
        .kimi_device_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            let ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            format!("kimi-{ms}")
        });
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());
    vec![
        ("X-Msh-Platform".into(), "9router".into()),
        ("X-Msh-Version".into(), cfg.app_version.clone()),
        ("X-Msh-Device-Name".into(), device_name),
        ("X-Msh-Device-Model".into(), device_model()),
        ("X-Msh-Device-Id".into(), device_id),
    ]
}

fn build_cline_headers(cfg: &RelayConfig) -> Vec<(String, String)> {
    let mut h = vec![
        ("HTTP-Referer".into(), "https://cline.bot".into()),
        ("X-Title".into(), "Cline".into()),
        (
            "User-Agent".into(),
            format!("9Router/{}", cfg.app_version),
        ),
        ("X-PLATFORM".into(), platform_name().into()),
        ("X-PLATFORM-VERSION".into(), rustc_version().into()),
        ("X-CLIENT-TYPE".into(), "9router".into()),
        ("X-CLIENT-VERSION".into(), cfg.app_version.clone()),
        ("X-CORE-VERSION".into(), cfg.app_version.clone()),
        ("X-IS-MULTIROOT".into(), "false".into()),
    ];
    let token = cfg
        .cline_api_key
        .clone()
        .or_else(|| cfg.cline_access_token.clone())
        .unwrap_or_default();
    let access = cline_access_token(&token);
    if !access.is_empty() {
        h.push(("Authorization".into(), format!("Bearer {access}")));
    }
    h
}

/// Inject profile headers into the upstream request headers.
/// `incoming` is the client's original headers (used for the minimax
/// "only if not already present" session-id rule). Injected headers
/// overwrite same-name client headers, except where noted.
pub fn apply_profile(headers: &mut HeaderMap, incoming: &HeaderMap, cfg: &RelayConfig) {
    let pairs: Vec<(String, String)> = match cfg.profile.as_str() {
        "codebuddy" => {
            let request_id = uuid::Uuid::new_v4().to_string();
            let conv_id = uuid::Uuid::new_v4().to_string();
            vec![
                ("X-Request-ID".into(), request_id.clone()),
                ("X-Conversation-ID".into(), conv_id),
                ("X-Conversation-Request-ID".into(), request_id.clone()),
                ("X-Conversation-Message-ID".into(), request_id),
            ]
        }
        "kimi" => build_kimi_headers(cfg),
        "minimax" => {
            // System tz offset in seconds; JS: getTimezoneOffset() * -60.
            let offset_secs = Local::now().offset().local_minus_utc();
            let mut v = vec![
                ("x-api-key".into(), "sk-xxx".into()),
                (
                    "X-Mavis-Timezone-Offset".into(),
                    offset_secs.to_string(),
                ),
            ];
            if !incoming.contains_key("X-Mavis-Session-Id") {
                v.push((
                    "X-Mavis-Session-Id".into(),
                    uuid::Uuid::new_v4().to_string(),
                ));
            }
            v
        }
        "muse" => {
            if cfg.muse_subscription {
                vec![("x-api-version".into(), "1.0.0".into())]
            } else {
                vec![]
            }
        }
        "cline" => build_cline_headers(cfg),
        "kilocode" => match &cfg.kilocode_org_id {
            Some(org) if !org.trim().is_empty() => {
                vec![("X-Kilocode-OrganizationID".into(), org.clone())]
            }
            _ => vec![],
        },
        _ => vec![], // "none" and unknown profiles inject nothing
    };
    for (k, v) in pairs {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(&v),
        ) {
            headers.insert(name, val);
        }
    }
}

// ---------------------------------------------------------------------------
// 11128 detection
// ---------------------------------------------------------------------------

/// True when a JSON body is an error object with code 11128
/// (number or string form). Only used for buffered non-streaming JSON
/// error responses; streamed bodies are never inspected.
pub fn body_has_code_11128(body: &[u8]) -> bool {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    match v.get("code") {
        Some(serde_json::Value::Number(n)) => n.as_u64() == Some(11128),
        Some(serde_json::Value::String(s)) => s == "11128",
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Relay state / server
// ---------------------------------------------------------------------------

type BoxBody = http_body_util::combinators::BoxBody<
    Bytes,
    Box<dyn std::error::Error + Send + Sync>,
>;
type BoxResponse = Response<BoxBody>;

fn full_body(bytes: Bytes) -> BoxBody {
    BoxBody::new(Full::new(bytes).map_err(|e| match e {}))
}

fn text_response(status: StatusCode, body: &str) -> BoxResponse {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(full_body(Bytes::from(body.to_string())))
        .unwrap()
}

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub struct Relay {
    cfg: RelayConfig,
    client: reqwest::Client,
    stats: Arc<Mutex<StatsData>>,
    started: Instant,
}

impl Relay {
    pub fn new(cfg: RelayConfig) -> Self {
        Self {
            cfg,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("reqwest client"),
            stats: Arc::new(Mutex::new(StatsData::default())),
            started: Instant::now(),
        }
    }

    pub fn snapshot(&self) -> StatsSnapshot {
        let data = self.stats.lock().unwrap();
        StatsSnapshot {
            banned: data.global.last_ban_at.is_some(),
            global: data.global.clone(),
            per_profile: data.per_profile.clone(),
            profile: self.cfg.profile.clone(),
            uptime_secs: self.started.elapsed().as_secs(),
        }
    }

    fn health_body(&self) -> String {
        let snap = self.snapshot();
        serde_json::json!({
            "status": if snap.banned { "degraded" } else { "ok" },
            "uptime_secs": snap.uptime_secs,
            "banned": snap.banned,
            "profile": snap.profile,
            "requests": snap.global.requests,
            "ok": snap.global.ok,
            "ban_403": snap.global.ban_403,
            "ban_429": snap.global.ban_429,
            "ban_11128": snap.global.ban_11128,
            "last_ban_at": snap.global.last_ban_at,
            "last_ban_status": snap.global.last_ban_status,
            "last_ban_code": snap.global.last_ban_code,
        })
        .to_string()
    }

    fn stats_body(&self) -> String {
        serde_json::to_string(&self.snapshot()).unwrap()
    }

    /// Main entry point for one inbound request.
    pub async fn handle(&self, req: Request<Incoming>) -> Result<BoxResponse, hyper::Error> {
        let started = Instant::now();
        let method = req.method().clone();
        let uri = req.uri().clone();

        // Local endpoints: origin-form GET /health and /stats only.
        // (Absolute-form http://.../health is a proxy request, not local.)
        if method == Method::GET && uri.scheme().is_none() {
            match uri.path() {
                "/health" => {
                    let body = self.health_body();
                    let mut r = text_response(StatusCode::OK, &body);
                    r.headers_mut()
                        .insert("x-hrouter-relay", HeaderValue::from_static("1"));
                    log_line(&method, "-", StatusCode::OK, started);
                    return Ok(r);
                }
                "/stats" => {
                    let body = self.stats_body();
                    let mut r = text_response(StatusCode::OK, &body);
                    r.headers_mut()
                        .insert("x-hrouter-relay", HeaderValue::from_static("1"));
                    log_line(&method, "-", StatusCode::OK, started);
                    return Ok(r);
                }
                _ => {}
            }
        }

        if method == Method::CONNECT {
            return self.handle_connect(req, started).await;
        }

        // Mode B: x-relay-target wins over absolute-form.
        let target_header = req
            .headers()
            .get("x-relay-target")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let is_mode_b = target_header.is_some();
        let (target_url, host_for_log) = if let Some(target) = target_header {
            let path = req
                .headers()
                .get("x-relay-path")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("/");
            // Mirror JS exactly: target minus trailing "/" + relayPath.
            let base = target.trim_end_matches('/');
            let url = format!("{base}{path}");
            (url, target)
        } else if uri.scheme().is_some() {
            // Mode A absolute-form.
            (uri.to_string(), uri.authority().map(|a| a.to_string()).unwrap_or_default())
        } else {
            let r = text_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"proxy request must be absolute-form or carry x-relay-target"}"#,
            );
            log_line(&method, "-", StatusCode::BAD_REQUEST, started);
            return Ok(r);
        };

        // Missing/empty target in mode B -> 400 like the JS reference.
        // (target_header present but empty string reaches here via format!.)
        if is_mode_b && target_url.trim_end_matches('/').is_empty() {
            let r = text_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Missing x-relay-target header"}"#,
            );
            log_line(&method, "-", StatusCode::BAD_REQUEST, started);
            return Ok(r);
        }

        let url: reqwest::Url = match target_url.parse() {
            Ok(u) => u,
            Err(_) => {
                let r = text_response(
                    StatusCode::BAD_REQUEST,
                    r#"{"error":"invalid target URL"}"#,
                );
                log_line(&method, &host_for_log, StatusCode::BAD_REQUEST, started);
                return Ok(r);
            }
        };

        // Forward headers: all except hop-by-hop, host, and (mode B)
        // x-relay-target / x-relay-path. Content-length is dropped: the
        // body is re-streamed and reqwest sets framing itself.
        let mut fwd = HeaderMap::new();
        for (k, v) in req.headers().iter() {
            let kl = k.as_str().to_lowercase();
            if kl == "host"
                || kl == "content-length"
                || HOP_BY_HOP.contains(&kl.as_str())
                || (is_mode_b && (kl == "x-relay-target" || kl == "x-relay-path"))
            {
                continue;
            }
            fwd.append(k.clone(), v.clone());
        }
        let incoming = req.headers().clone();
        apply_profile(&mut fwd, &incoming, &self.cfg);

        // Streaming duplex body (none for GET/HEAD, mirroring the JS
        // `body: method !== GET && method !== HEAD ? req.body : undefined`).
        let mut builder = self.client.request(
            reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
            url,
        );
        builder = builder.headers(fwd);
        if method != Method::GET && method != Method::HEAD {
            let stream = req
                .into_body()
                .into_data_stream()
                .map(|r| r.map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>));
            builder = builder.body(reqwest::Body::wrap_stream(stream));
        }

        let upstream = match builder.send().await {
            Ok(r) => r,
            Err(e) => {
                let r = text_response(
                    StatusCode::BAD_GATEWAY,
                    &serde_json::json!({"error": format!("upstream error: {e}")}).to_string(),
                );
                log_line(&method, &host_for_log, StatusCode::BAD_GATEWAY, started);
                return Ok(r);
            }
        };

        let status = StatusCode::from_u16(upstream.status().as_u16())
            .unwrap_or(StatusCode::BAD_GATEWAY);
        let is_json_400 = status == StatusCode::BAD_REQUEST
            && upstream
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|ct| ct.contains("application/json"))
                .unwrap_or(false);

        // Copy upstream headers (minus hop-by-hop).
        let mut resp_headers = HeaderMap::new();
        for (k, v) in upstream.headers().iter() {
            let kl = k.as_str().to_lowercase();
            if HOP_BY_HOP.contains(&kl.as_str()) {
                continue;
            }
            resp_headers.append(k.clone(), v.clone());
        }
        resp_headers.insert("x-hrouter-relay", HeaderValue::from_static("1"));

        if is_json_400 {
            // Only non-streaming JSON error bodies are buffered, so code
            // 11128 can be detected. SSE / chunked bodies never take
            // this path (different content-type) and stay streamed.
            let bytes = upstream.bytes().await.unwrap_or_default();
            let code_11128 = body_has_code_11128(&bytes);
            self.record(status, code_11128);
            if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
                resp_headers.insert(
                    "x-hrouter-ban",
                    HeaderValue::from_str(&status.as_u16().to_string()).unwrap(),
                );
            }
            if code_11128 {
                resp_headers.insert("x-hrouter-ban", HeaderValue::from_static("400"));
                resp_headers.insert("x-hrouter-ban-code", HeaderValue::from_static("11128"));
            }
            let mut r = Response::builder()
                .status(status)
                .body(full_body(bytes))
                .unwrap();
            *r.headers_mut() = resp_headers;
            log_line(&method, &host_for_log, status, started);
            return Ok(r);
        }

        let is_ban_status =
            status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS;
        self.record(status, false);
        if is_ban_status {
            resp_headers.insert(
                "x-hrouter-ban",
                HeaderValue::from_str(&status.as_u16().to_string()).unwrap(),
            );
        }
        // Stream the response body without buffering (SSE passthrough).
        let stream = upstream.bytes_stream().map(|r| {
            r.map(hyper::body::Frame::data)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        });
        let mut r = Response::builder()
            .status(status)
            .body(BoxBody::new(StreamBody::new(stream)))
            .unwrap();
        *r.headers_mut() = resp_headers;
        log_line(&method, &host_for_log, status, started);
        Ok(r)
    }

    fn record(&self, status: StatusCode, code_11128: bool) {
        let mut data = self.stats.lock().unwrap();
        data.record(&self.cfg.profile, status, code_11128);
    }

    async fn handle_connect(
        &self,
        req: Request<Incoming>,
        started: Instant,
    ) -> Result<BoxResponse, hyper::Error> {
        let authority = req
            .uri()
            .authority()
            .map(|a| a.to_string())
            .unwrap_or_default();
        if authority.is_empty() {
            let r = text_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"CONNECT requires host:port authority"}"#,
            );
            log_line(&Method::CONNECT, "-", StatusCode::BAD_REQUEST, started);
            return Ok(r);
        }
        let target = match TcpStream::connect(&authority).await {
            Ok(s) => s,
            Err(e) => {
                let r = text_response(
                    StatusCode::BAD_GATEWAY,
                    &serde_json::json!({"error": format!("connect failed: {e}")}).to_string(),
                );
                log_line(&Method::CONNECT, &authority, StatusCode::BAD_GATEWAY, started);
                return Ok(r);
            }
        };
        // hyper upgrade: take the future now, answer 200, then splice.
        let upgraded = hyper::upgrade::on(req);
        let mut target = target;
        tokio::spawn(async move {
            match upgraded.await {
                Ok(up) => {
                    let mut up = TokioIo::new(up);
                    let _ = tokio::io::copy_bidirectional(&mut up, &mut target).await;
                }
                Err(e) => eprintln!("relay: upgrade failed: {e}"),
            }
        });
        let r = Response::builder()
            .status(StatusCode::OK)
            .header("x-hrouter-relay", "1")
            .body(full_body(Bytes::new()))
            .unwrap();
        log_line(&Method::CONNECT, &authority, StatusCode::OK, started);
        Ok(r)
    }
}

fn log_line(method: &Method, host: &str, status: StatusCode, started: Instant) {
    // Structured, minimal: never bodies or auth headers.
    println!(
        "{{\"ts\":\"{}\",\"method\":\"{}\",\"host\":\"{}\",\"status\":{},\"duration_ms\":{}}}",
        chrono::Utc::now().to_rfc3339(),
        method.as_str(),
        host.replace('\\', "\\\\").replace('"', "\\\""),
        status.as_u16(),
        started.elapsed().as_millis()
    );
}

/// Serve on an already-bound listener (used by main and by tests).
pub async fn serve(listener: TcpListener, cfg: RelayConfig) -> std::io::Result<()> {
    let relay = Arc::new(Relay::new(cfg));
    loop {
        let (stream, _peer) = listener.accept().await?;
        let relay = relay.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let svc = hyper::service::service_fn(move |req| {
                let relay = relay.clone();
                async move { relay.handle(req).await }
            });
            // serve_connection_with_upgrades: CONNECT tunnels need the
            // upgrade path enabled (plain serve_connection rejects it with
            // "upgrade expected but low level API in use").
            if let Err(e) = hyper_util::server::conn::auto::Builder::new(
                hyper_util::rt::TokioExecutor::new(),
            )
            .serve_connection_with_upgrades(io, svc)
            .await
            {
                // Client disconnects mid-stream are normal for a proxy.
                eprintln!("relay: connection error: {e}");
            }
        });
    }
}

pub async fn run(addr: SocketAddr, cfg: RelayConfig) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    serve(listener, cfg).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cline_jwt_gets_workos_prefix_but_api_key_does_not() {
        assert_eq!(
            cline_access_token("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"),
            "workos:eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"
        );
        assert_eq!(cline_access_token("clp_abc123"), "clp_abc123");
        assert_eq!(cline_access_token("workos:eyJx.eyJz"), "workos:eyJx.eyJz");
        assert_eq!(cline_access_token(""), "");
    }

    #[test]
    fn code_11128_detection() {
        assert!(body_has_code_11128(
            br#"{"code":11128,"msg":"request illegal"}"#
        ));
        assert!(body_has_code_11128(br#"{"code":"11128"}"#));
        assert!(!body_has_code_11128(br#"{"code":6004}"#));
        assert!(!body_has_code_11128(b"not json"));
        assert!(!body_has_code_11128(br#"{"error":"x"}"#));
    }

    #[test]
    fn codebuddy_profile_links_request_and_message_ids() {
        let cfg = RelayConfig {
            profile: "codebuddy".into(),
            ..Default::default()
        };
        let mut h = HeaderMap::new();
        apply_profile(&mut h, &HeaderMap::new(), &cfg);
        let req_id = h["X-Request-ID"].to_str().unwrap().to_string();
        assert_eq!(h["X-Conversation-Request-ID"].to_str().unwrap(), req_id);
        assert_eq!(h["X-Conversation-Message-ID"].to_str().unwrap(), req_id);
        assert!(!h["X-Conversation-ID"].to_str().unwrap().is_empty());
        assert_ne!(h["X-Conversation-ID"].to_str().unwrap(), req_id);
        uuid::Uuid::parse_str(&req_id).unwrap();
    }

    #[test]
    fn minimax_keeps_existing_session_id() {
        let cfg = RelayConfig {
            profile: "minimax".into(),
            ..Default::default()
        };
        let mut incoming = HeaderMap::new();
        incoming.insert("X-Mavis-Session-Id", HeaderValue::from_static("keep-me"));
        let mut h = HeaderMap::new();
        apply_profile(&mut h, &incoming, &cfg);
        assert_eq!(h["x-api-key"].to_str().unwrap(), "sk-xxx");
        // Injection must NOT add/overwrite a session id the client already
        // carries (in the real flow the forwarded headers already hold it).
        assert!(!h.contains_key("X-Mavis-Session-Id"));
        // ...but a request without one gets a fresh uuid.
        let mut h2 = HeaderMap::new();
        apply_profile(&mut h2, &HeaderMap::new(), &cfg);
        let sid = h2["X-Mavis-Session-Id"].to_str().unwrap().to_string();
        assert_ne!(sid, "keep-me");
        uuid::Uuid::parse_str(&sid).unwrap();
        // Offset must be a plausible whole-seconds tz offset.
        let off: i64 = h["X-Mavis-Timezone-Offset"]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(off % 60, 0);
        assert!((-14 * 3600..=14 * 3600).contains(&off));
    }

    #[test]
    fn muse_only_in_subscription_mode() {
        let mut cfg = RelayConfig {
            profile: "muse".into(),
            ..Default::default()
        };
        let mut h = HeaderMap::new();
        apply_profile(&mut h, &HeaderMap::new(), &cfg);
        assert!(!h.contains_key("x-api-version"));
        cfg.muse_subscription = true;
        apply_profile(&mut h, &HeaderMap::new(), &cfg);
        assert_eq!(h["x-api-version"].to_str().unwrap(), "1.0.0");
    }

    #[test]
    fn kimi_headers_shape() {
        let cfg = RelayConfig {
            profile: "kimi".into(),
            kimi_device_id: Some("dev-123".into()),
            app_version: "0.5.116".into(),
            ..Default::default()
        };
        let mut h = HeaderMap::new();
        apply_profile(&mut h, &HeaderMap::new(), &cfg);
        assert_eq!(h["X-Msh-Platform"].to_str().unwrap(), "9router");
        assert_eq!(h["X-Msh-Version"].to_str().unwrap(), "0.5.116");
        assert_eq!(h["X-Msh-Device-Id"].to_str().unwrap(), "dev-123");
        assert!(!h["X-Msh-Device-Name"].to_str().unwrap().is_empty());
        assert!(!h["X-Msh-Device-Model"].to_str().unwrap().is_empty());
    }

    #[test]
    fn config_parses_toml_and_json() {
        let c = parse_config_text(
            "profile = \"kimi\"\nkimi_device_id = \"d1\"\n",
            "config.toml",
        )
        .unwrap();
        assert_eq!(c.profile, "kimi");
        assert_eq!(c.kimi_device_id.as_deref(), Some("d1"));
        let c2 = parse_config_text(
            r#"{"profile":"cline","cline_api_key":"clp_x"}"#,
            "config.json",
        )
        .unwrap();
        assert_eq!(c2.cline_api_key.as_deref(), Some("clp_x"));
    }
}
