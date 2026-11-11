//! Integration tests for h-router-relay.
//! Mock upstream is an axum server on an ephemeral port; the relay under
//! test is spawned in-process on an ephemeral port.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::Request as AxumRequest;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response as AxumResponse};
use axum::routing::{any, get};
use axum::{Json, Router};
use futures_util::stream;
use h_router_relay::{RelayConfig, serve};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn echo_handler(req: AxumRequest) -> AxumResponse {
    let method = req.method().to_string();
    let headers: HashMap<String, String> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap_or_default();
    Json(json!({
        "method": method,
        "headers": headers,
        "body": String::from_utf8_lossy(&body).to_string(),
    }))
    .into_response()
}

async fn sse_handler() -> AxumResponse {
    // 3 chunks, 400 ms apart. If the relay buffered, the first chunk
    // would only arrive after the upstream finished (~1200 ms).
    let s = stream::unfold(0, |i| async move {
        if i >= 3 {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
        Some((
            Ok::<_, std::convert::Infallible>(bytes::Bytes::from(format!("data: chunk{i}\n\n"))),
            i + 1,
        ))
    });
    AxumResponse::builder()
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(s))
        .unwrap()
}

async fn start_upstream() -> SocketAddr {
    let app = Router::new()
        .route("/echo", any(echo_handler))
        .route("/sse", get(sse_handler))
        .route(
            "/ban400",
            get(|| async {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"code": 11128, "msg": "request illegal"})),
                )
            }),
        )
        .route("/ban403", get(|| async { (StatusCode::FORBIDDEN, "no") }))
        .route(
            "/ban429",
            get(|| async { (StatusCode::TOO_MANY_REQUESTS, "slow down") }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

async fn start_relay(cfg: RelayConfig) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        serve(listener, cfg).await.unwrap();
    });
    // Give the listener a moment to start accepting.
    tokio::time::sleep(Duration::from_millis(50)).await;
    addr
}

fn relay_url(relay: SocketAddr) -> String {
    format!("http://{relay}")
}

fn cfg(profile: &str) -> RelayConfig {
    RelayConfig {
        profile: profile.to_string(),
        ..Default::default()
    }
}

/// Raw HTTP request over one TCP connection; returns (status, headers, body).
/// Handles chunked transfer-encoding from the relay's streaming responses.
async fn raw_request(relay: SocketAddr, raw: &str) -> (u16, HeaderMap, Vec<u8>) {
    let mut stream = TcpStream::connect(relay).await.unwrap();
    stream.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    parse_raw_response(&buf)
}

fn parse_raw_response(buf: &[u8]) -> (u16, HeaderMap, Vec<u8>) {
    let text = String::from_utf8_lossy(buf);
    let (head, rest) = text.split_once("\r\n\r\n").unwrap();
    let mut lines = head.lines();
    let status_line = lines.next().unwrap();
    let status: u16 = status_line.split_whitespace().nth(1).unwrap().parse().unwrap();
    let mut headers = HeaderMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(
                k.trim().parse::<axum::http::HeaderName>().unwrap(),
                v.trim().parse().unwrap(),
            );
        }
    }
    let chunked = headers
        .get("transfer-encoding")
        .map(|v| v.to_str().unwrap_or("").contains("chunked"))
        .unwrap_or(false);
    let body = if chunked {
        dechunk(rest.as_bytes())
    } else {
        rest.as_bytes().to_vec()
    };
    (status, headers, body)
}

fn dechunk(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut rest = data;
    loop {
        let Some(pos) = rest.windows(2).position(|w| w == b"\r\n") else {
            break;
        };
        let size_str = String::from_utf8_lossy(&rest[..pos]).trim().to_string();
        let size = usize::from_str_radix(&size_str, 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        let start = pos + 2;
        out.extend_from_slice(&rest[start..start + size]);
        rest = &rest[start + size + 2..];
    }
    out
}

fn upstream(up: SocketAddr) -> String {
    format!("http://{up}")
}

// --- Mode A: absolute-form via reqwest proxy client -------------------------

#[tokio::test]
async fn mode_a_absolute_form_forwards_method_headers_body() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::http(relay_url(relay)).unwrap())
        .build()
        .unwrap();
    let resp = client
        .post(format!("{}/echo", upstream(up)))
        .header("x-custom-test", "hello123")
        .body("payload-body")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.headers().get("x-hrouter-relay").unwrap(), "1");
    let v: Value = resp.json().await.unwrap();
    assert_eq!(v["method"], "POST");
    assert_eq!(v["body"], "payload-body");
    assert_eq!(v["headers"]["x-custom-test"], "hello123");
    // Proxy headers must not leak to upstream.
    assert!(v["headers"].get("proxy-authorization").is_none());
}

#[tokio::test]
async fn mode_a_connect_tunnel_reaches_upstream() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let mut stream = TcpStream::connect(relay).await.unwrap();
    stream
        .write_all(
            format!("CONNECT {up} HTTP/1.1\r\nHost: {up}\r\n\r\n").as_bytes(),
        )
        .await
        .unwrap();
    // Read the 200 response headers.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        stream.read_exact(&mut byte).await.unwrap();
        head.push(byte[0]);
        if head.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head_str = String::from_utf8_lossy(&head);
    assert!(head_str.starts_with("HTTP/1.1 200"), "got: {head_str}");
    assert!(head_str.contains("x-hrouter-relay: 1"));
    // Now speak plain HTTP through the tunnel.
    stream
        .write_all(b"GET /echo HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let body = String::from_utf8_lossy(&buf);
    assert!(body.contains("\"method\":\"GET\""), "got: {body}");
}

// --- Mode B -----------------------------------------------------------------

#[tokio::test]
async fn mode_b_x_relay_target_forwards_and_strips_relay_headers() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(relay_url(relay))
        .header("x-relay-target", upstream(up))
        .header("x-relay-path", "/echo")
        .header("x-custom-test", "modeb")
        .body("b-body")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.headers().get("x-hrouter-relay").unwrap(), "1");
    let v: Value = resp.json().await.unwrap();
    assert_eq!(v["method"], "POST");
    assert_eq!(v["body"], "b-body");
    assert_eq!(v["headers"]["x-custom-test"], "modeb");
    assert!(v["headers"].get("x-relay-target").is_none());
    assert!(v["headers"].get("x-relay-path").is_none());
}

#[tokio::test]
async fn mode_b_missing_target_is_400() {
    let relay = start_relay(cfg("none")).await;
    // Empty x-relay-target header value.
    let (status, _, body) = raw_request(
        relay,
        "GET / HTTP/1.1\r\nHost: relay\r\nx-relay-target:\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 400);
    assert!(String::from_utf8_lossy(&body).contains("Missing x-relay-target"));
    // Origin-form with no target at all is also 400.
    let (status, _, _) = raw_request(
        relay,
        "GET /echo HTTP/1.1\r\nHost: relay\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn mode_b_default_path_is_slash() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    // No x-relay-path: target + "/" -> upstream root, which axum 404s.
    // Assert the relay forwarded to the root (404 from upstream, not 400).
    let client = reqwest::Client::new();
    let resp = client
        .get(relay_url(relay))
        .header("x-relay-target", upstream(up))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

// --- SSE passthrough ---------------------------------------------------------

#[tokio::test]
async fn sse_first_chunk_arrives_before_upstream_finishes() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let client = reqwest::Client::new();
    let t0 = Instant::now();
    let resp = client
        .get(relay_url(relay))
        .header("x-relay-target", upstream(up))
        .header("x-relay-path", "/sse")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut first_chunk_at: Option<Duration> = None;
    let mut all = Vec::new();
    while let Some(chunk) = stream.next().await {
        let c = chunk.unwrap();
        if first_chunk_at.is_none() {
            first_chunk_at = Some(t0.elapsed());
        }
        all.extend_from_slice(&c);
    }
    let total = t0.elapsed();
    let first = first_chunk_at.expect("no chunks received");
    // Upstream emits chunk 0 at ~400 ms and finishes at ~1200 ms.
    // A buffering relay would deliver the first chunk only at ~1200 ms.
    assert!(
        first < Duration::from_millis(900),
        "first chunk took {first:?} (total {total:?}) — response was buffered"
    );
    assert!(total > Duration::from_millis(1000), "total {total:?}");
    let text = String::from_utf8_lossy(&all);
    assert!(text.contains("data: chunk0"));
    assert!(text.contains("data: chunk2"));
}

// --- Header profiles ---------------------------------------------------------

async fn echo_via_mode_b(relay: SocketAddr, up: SocketAddr) -> Value {
    let client = reqwest::Client::new();
    let resp = client
        .post(relay_url(relay))
        .header("x-relay-target", upstream(up))
        .header("x-relay-path", "/echo")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

#[tokio::test]
async fn profile_codebuddy_injects_linked_uuids() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("codebuddy")).await;
    let v = echo_via_mode_b(relay, up).await;
    let h = &v["headers"];
    let req_id = h["x-request-id"].as_str().unwrap();
    assert_eq!(h["x-conversation-request-id"].as_str().unwrap(), req_id);
    assert_eq!(h["x-conversation-message-id"].as_str().unwrap(), req_id);
    assert!(!h["x-conversation-id"].as_str().unwrap().is_empty());
    uuid::Uuid::parse_str(req_id).unwrap();
}

#[tokio::test]
async fn profile_kimi_injects_device_headers() {
    let up = start_upstream().await;
    let mut c = cfg("kimi");
    c.kimi_device_id = Some("kimi-device-42".into());
    let relay = start_relay(c).await;
    let v = echo_via_mode_b(relay, up).await;
    let h = &v["headers"];
    assert_eq!(h["x-msh-platform"], "9router");
    assert_eq!(h["x-msh-version"], "0.5.116");
    assert_eq!(h["x-msh-device-id"], "kimi-device-42");
    assert!(!h["x-msh-device-model"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn profile_minimax_and_kilocode_and_cline() {
    let up = start_upstream().await;

    let relay = start_relay(cfg("minimax")).await;
    let v = echo_via_mode_b(relay, up).await;
    assert_eq!(v["headers"]["x-api-key"], "sk-xxx");
    assert!(!v["headers"]["x-mavis-session-id"].as_str().unwrap().is_empty());
    let off: i64 = v["headers"]["x-mavis-timezone-offset"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(off % 60, 0);

    let mut c = cfg("kilocode");
    c.kilocode_org_id = Some("org-99".into());
    let relay = start_relay(c).await;
    let v = echo_via_mode_b(relay, up).await;
    assert_eq!(v["headers"]["x-kilocode-organizationid"], "org-99");

    let mut c = cfg("cline");
    c.cline_api_key = Some("clp_testkey".into());
    let relay = start_relay(c).await;
    let v = echo_via_mode_b(relay, up).await;
    let h = &v["headers"];
    assert_eq!(h["authorization"], "Bearer clp_testkey"); // API key: verbatim, no workos: prefix
    assert_eq!(h["http-referer"], "https://cline.bot");
    assert_eq!(h["x-title"], "Cline");
    assert_eq!(h["x-client-type"], "9router");
}

#[tokio::test]
async fn profile_muse_subscription_flag() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("muse")).await;
    let v = echo_via_mode_b(relay, up).await;
    assert!(v["headers"].get("x-api-version").is_none());

    let mut c = cfg("muse");
    c.muse_subscription = true;
    let relay = start_relay(c).await;
    let v = echo_via_mode_b(relay, up).await;
    assert_eq!(v["headers"]["x-api-version"], "1.0.0");
}

#[tokio::test]
async fn profile_none_injects_nothing() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let v = echo_via_mode_b(relay, up).await;
    let h = v["headers"].as_object().unwrap();
    for k in h.keys() {
        assert!(!k.starts_with("x-request-id"), "unexpected {k}");
        assert!(!k.starts_with("x-msh-"), "unexpected {k}");
    }
}

// --- Ban counters, /health, /stats ------------------------------------------

#[tokio::test]
async fn ban_counters_health_stats_and_ban_headers() {
    let up = start_upstream().await;
    let relay = start_relay(cfg("none")).await;
    let client = reqwest::Client::new();
    let base = relay_url(relay);

    // 11128 via JSON 400.
    let resp = client
        .get(&base)
        .header("x-relay-target", upstream(up))
        .header("x-relay-path", "/ban400")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    assert_eq!(resp.headers().get("x-hrouter-ban").unwrap(), "400");
    assert_eq!(resp.headers().get("x-hrouter-ban-code").unwrap(), "11128");
    let v: Value = resp.json().await.unwrap();
    assert_eq!(v["code"], 11128);

    // 403 / 429 status bans.
    for (path, want) in [("/ban403", "403"), ("/ban429", "429")] {
        let resp = client
            .get(&base)
            .header("x-relay-target", upstream(up))
            .header("x-relay-path", path)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.headers().get("x-hrouter-ban").unwrap(), want);
    }
    // One OK request.
    let resp = client
        .get(&base)
        .header("x-relay-target", upstream(up))
        .header("x-relay-path", "/echo")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp.headers().get("x-hrouter-ban").is_none());

    let stats: Value = client.get(format!("{base}/stats")).send().await.unwrap().json().await.unwrap();
    assert_eq!(stats["global"]["requests"], 4);
    assert_eq!(stats["global"]["ok"], 1);
    assert_eq!(stats["global"]["ban_403"], 1);
    assert_eq!(stats["global"]["ban_429"], 1);
    assert_eq!(stats["global"]["ban_11128"], 1);
    assert_eq!(stats["global"]["last_ban_status"], 429);
    assert!(stats["global"]["last_ban_at"].as_str().is_some());
    assert_eq!(stats["per_profile"]["none"]["ban_11128"], 1);

    let health: Value = client.get(format!("{base}/health")).send().await.unwrap().json().await.unwrap();
    assert_eq!(health["status"], "degraded");
    assert_eq!(health["banned"], true);
    assert_eq!(health["ban_11128"], 1);
    assert!(health["uptime_secs"].as_u64().is_some());
}

#[tokio::test]
async fn health_ok_when_no_bans() {
    let relay = start_relay(cfg("none")).await;
    let client = reqwest::Client::new();
    let health: Value = client
        .get(format!("{}/health", relay_url(relay)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["banned"], false);
    assert_eq!(health["requests"], 0);
}
