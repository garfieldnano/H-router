# h-router-relay

Rust relay sidecar for h-router. Two contracts, both live (user decision
2026-11-11):

- **Mode A — standard HTTP proxy.** Absolute-form requests
  (`POST http://upstream-host/path`) and `CONNECT host:port` tunnels
  (undici `ProxyAgent` uses CONNECT for https targets, so the tunnel is
  mandatory). Method + headers + body are forwarded; the response is
  streamed back without buffering (SSE passthrough).
- **Mode B — `x-relay-target` / `x-relay-path` headers.** Mirrors the JS
  reference implementation in
  `src/app/api/proxy-pools/vercel-deploy/route.js` (`RELAY_FUNCTION_CODE`)
  exactly: `target = x-relay-target`, `path = x-relay-path` (default `"/"`),
  `targetUrl = target minus trailing "/" + path`; all headers forwarded
  except `x-relay-target` / `x-relay-path` / `host`; body forwarded
  streaming (duplex); upstream status + headers + streamed body returned.
  Missing target → HTTP 400 `{"error":"Missing x-relay-target header"}`.

Header profiles apply to the upstream request in **both** modes (not to
CONNECT tunnels — a tunnel carries raw TLS, there are no HTTP headers to
inject). Profiles mirror `open-sse/executors/default.js` `HEADER_HOOKS`,
`open-sse/config/appConstants.js` `buildKimiHeaders` and
`open-sse/shared/clineAuth.js` `buildClineHeaders`:

| Profile | Injected headers |
|---|---|
| `codebuddy` | `X-Request-ID=<uuid>`, `X-Conversation-ID=<uuid>`, `X-Conversation-Request-ID=<same uuid as X-Request-ID>`, `X-Conversation-Message-ID=<same uuid>` |
| `kimi` | `X-Msh-Platform: 9router`, `X-Msh-Version: <app_version>`, `X-Msh-Device-Name: <hostname>`, `X-Msh-Device-Model: <OS> <arch>` (e.g. `Linux x86_64`), `X-Msh-Device-Id: <device_id>` |
| `minimax` | `x-api-key: sk-xxx`, `X-Mavis-Timezone-Offset: <system tz offset in seconds>`, `X-Mavis-Session-Id: <uuid, only if the request doesn't already carry one>` |
| `muse` | `x-api-version: 1.0.0`, only in subscription mode (`muse_subscription = true`) |
| `cline` | `HTTP-Referer: https://cline.bot`, `X-Title: Cline`, `User-Agent: 9Router/<app_version>`, `X-PLATFORM`, `X-PLATFORM-VERSION` (= rustc version), `X-CLIENT-TYPE: 9router`, `X-CLIENT-VERSION` / `X-CORE-VERSION: <app_version>`, `X-IS-MULTIROOT: false`, `Authorization: Bearer <token>` |
| `kilocode` | `X-Kilocode-OrganizationID: <org_id>` (only if configured) |
| `none` (default) | nothing |

Cline token rule (from `clineAuth.js`): a `workos:` prefix is kept;
WorkOS JWTs (`eyJ… . …`) get `workos:` prepended; ClinePass API keys
(`clp_…`, not JWTs) are sent verbatim — prefixing them makes the Cline
API reject the request with 401.

Secrets / ids (`device_id`, org id, Cline token) come from the config file
or environment, never hardcoded. `app_version` defaults to `0.5.116`
(the 9router `package.json` version the JS code stamps into Kimi/Cline
headers); override it in the config if the fork version moves.

## Build

```sh
export PATH="$HOME/.cargo/bin:$PATH"   # rustc/cargo 1.99.1, NOT on PATH
cargo build --release                  # binary: target/release/h-router-relay
cargo test                             # unit + integration tests (mock upstream)
```

First build downloads crates from crates.io. On this VM the egress proxy
stalls cargo's own downloads ("transfer too slow", cargo aborts after
30 s at <10 B/s) while `curl` to the same hosts succeeds; if a build
fails that way, use the helper scripts in this directory
(`fill-index-cache.sh`, `fetch-crates.py`) to pre-seed the cargo cache
with curl, then build with `cargo build --release --offline`.
The debug build dir is ~2 GB; if the disk quota bites, `cargo clean
--profile dev` frees it (the release binary is unaffected).

## Run

```sh
./target/release/h-router-relay \
  --listen 127.0.0.1:20129 \
  --profile codebuddy \
  --config /etc/h-router/relay.toml
```

Precedence: `--listen` / `--profile` flags > env
(`HROUTER_RELAY_LISTEN`, `HROUTER_RELAY_PROFILE`, `HROUTER_RELAY_CONFIG`,
`HROUTER_RELAY_KIMI_DEVICE_ID`, `HROUTER_RELAY_CLINE_API_KEY`,
`HROUTER_RELAY_CLINE_ACCESS_TOKEN`, `HROUTER_RELAY_KILOCODE_ORG_ID`,
`HROUTER_RELAY_MUSE_SUBSCRIPTION`, `HROUTER_RELAY_APP_VERSION`) >
config file > built-in defaults (listen `127.0.0.1:20129`, profile `none`).
Config file is TOML (or JSON with a `.json` suffix); see
`config.example.toml`.

Minimal structured logs go to stdout, one JSON line per proxied request:
`{"ts": ..., "method": ..., "host": ..., "status": ..., "duration_ms": ...}`.
Request bodies and auth headers are never logged.

## Ban reporting

Counters (global + per profile): `requests`, `ok`, `ban_403`, `ban_429`,
`ban_11128`, `last_ban_at`, `last_ban_status`, `last_ban_code`.

- Every proxied response carries `x-hrouter-relay: 1`, and when upstream
  returned a ban status also `x-hrouter-ban: <status>` (plus
  `x-hrouter-ban-code: 11128` when code 11128 was detected).
- `GET /health` → `{"status": "ok"|"degraded", "uptime_secs": ...,
  "banned": ..., ...}` (`degraded` once any ban has ever been recorded).
  `/health` and `/stats` are origin-form local endpoints only;
  absolute-form `http://.../health` is proxied, not answered locally.
- `GET /stats` → full counters JSON (global + per-profile).

**11128 limitation (by design):** code 11128 is only detectable in
non-streaming JSON error responses — HTTP 400 with an
`application/json` body containing `"code": 11128` (e.g. CodeBuddy
"request illegal"). Those bodies are buffered (bounded by the response
itself) solely to inspect them. Streamed responses (SSE / chunked) are
never buffered, so for them only status-based 403/429 detection applies.
CONNECT tunnels have no upstream HTTP status and are not counted.

## Deploy to a VPS

`deploy.sh` in this directory does the whole install (build → copy →
install → enable → health check). Secrets are never copied — they live in
`/etc/h-router/relay.env` on the target (created empty on first install;
edit it there, then `systemctl restart h-router-relay`).

```sh
./deploy.sh user@your-vps        # build release, scp, install, enable, check /health
./deploy.sh --local              # same, on this machine (needs sudo)
./deploy.sh user@your-vps --no-build   # reuse target/release/h-router-relay
```

What it installs on the target: the binary to
`/usr/local/bin/h-router-relay`, the unit to
`/etc/systemd/system/h-router-relay.service`, a `hrouter` system user, and
`/etc/h-router/relay.env` (mode 0600). The unit was validated with
`systemd-analyze verify` (systemd 255) — the only warning it produces on a
machine without the binary installed is the missing
`/usr/local/bin/h-router-relay`, which the install itself resolves.

First install checklist (on the VPS, after deploy.sh):
1. Edit `/etc/h-router/relay.env` — at minimum the profile secrets you use
   (`HROUTER_RELAY_KIMI_DEVICE_ID`, `HROUTER_RELAY_CLINE_API_KEY`,
   `HROUTER_RELAY_KILOCODE_ORG_ID`, …). See `config.example.toml`.
2. `sudo systemctl restart h-router-relay`
3. `curl http://127.0.0.1:20129/health` → `{"status":"ok",...}`
4. In the h-router dashboard, register the relay as a pool of type `http`
   with `proxyUrl` `http://<vps-ip>:20129` (proxy-pools page) and bind it to
   a provider connection (`proxyPoolId`). Requests then flow
   gateway → relay → upstream, and the rotator reads ban status from the
   relay's `/health` + `/stats`.

## Update the binary (systemd)

```sh
cargo build --release
sudo systemctl stop h-router-relay
sudo install -m 0755 target/release/h-router-relay /usr/local/bin/h-router-relay
sudo systemctl start h-router-relay
sudo systemctl status h-router-relay --no-pager
```

The unit file `h-router-relay.service` runs it as `User=hrouter` with
`Restart=always` and an `EnvironmentFile` for the secrets; copy it to
`/etc/systemd/system/h-router-relay.service`, create the user and the
env file, then `systemctl daemon-reload && systemctl enable --now
h-router-relay`. See the comments inside the unit file.
