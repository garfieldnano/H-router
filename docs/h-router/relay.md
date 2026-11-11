# Relay Rust + Rotator Egress

> Build log: `~/workspace/analysis/9router-relay-build.md`
> (plan §1 + G2, skema v7). Unit 41/41 + E2E 18/18 + Rust 7 unit +
> 13 integrasi.
> **Belum terverifikasi:** komposisi gateway → sidecar end-to-end
> (butuh `/etc/hosts` + MITM :443); load test rotator.

## Keputusan kontrak (G2, diputuskan user 2026-11-11)

Sidecar Rust mendukung **keduanya**:

- **Mode A — HTTP proxy standar**: absolute-form
  (`POST http://upstream-host/path`) + `CONNECT host:port` tunnel
  (undici `ProxyAgent` memakai CONNECT untuk target https, jadi tunnel
  wajib). Cocok untuk armada self-hosted di VPS.
- **Mode B — header `x-relay-target` / `x-relay-path`**: meniru
  `RELAY_FUNCTION_CODE` persis (trim trailing-slash, strip header relay,
  target hilang → 400). Cocok untuk jalur function ter-deploy.

## Sidecar Rust (`relay/`, crate `h-router-relay`)

- Stack: tokio + hyper + reqwest (rustls), single static binary
  (~8,1 MB release), RAM ~10–20 MB. Toolchain rustc/cargo **1.99.1** di
  `~/.cargo/bin` (**belum di PATH**).
- Default listen `127.0.0.1:20129`, profil default `none`.
- **SSE streaming passthrough** — response tidak pernah di-buffer
  (terbukti di integration test: chunk pertama jauh sebelum upstream
  selesai).
- 7 profil header (cermin `HEADER_HOOKS` di
  `open-sse/executors/default.js`): `codebuddy` (`X-Request-ID` +
  `X-Conversation-*`), `kimi` (`X-Msh-*`), `minimax`, `muse`
  (hanya mode subscription), `cline`, `kilocode`, `none`.
- **Pelaporan ban**: setiap respons yang di-proxy membawa
  `x-hrouter-relay: 1`, dan saat upstream mengembalikan status ban juga
  `x-hrouter-ban: <status>` (+ `x-hrouter-ban-code: 11128` bila terdeteksi).
  `GET /health` → `{"status": "ok"|"degraded", "uptime_secs": ...,
  "banned": ...}` (`degraded` begitu ada ban tercatat).
  `GET /stats` → counter lengkap (global + per profil).
- Log terstruktur ke stdout, satu baris JSON per request; body dan header
  auth tidak pernah di-log.
- **Batasan 11128**: kode 11128 hanya terdeteksi di respons JSON
  non-streaming (HTTP 400 + body JSON berisi `"code": 11128`). Respons
  SSE/chunked tidak pernah di-buffer, jadi untuk itu hanya deteksi
  berbasis status 403/429. Tunnel CONNECT tidak punya status HTTP upstream
  dan tidak dihitung.

### Build

```sh
export PATH="$HOME/.cargo/bin:$PATH"   # rustc/cargo 1.99.1, NOT on PATH
cargo build --release                  # binary: target/release/h-router-relay
cargo test                             # unit + integration (mock upstream)
```

Catatan env VM ini: download cargo gagal lewat egress proxy ("transfer
too slow") sementara `curl` ke host yang sama berhasil. Kalau build gagal
dengan cara itu, seed cache cargo dulu dengan helper di direktori ini
(`fill-index-cache.sh`, `fetch-crates.py`), lalu
`cargo build --release --offline`.

### Deploy ke VPS

Lihat `relay/README.md` bagian "Deploy to a VPS" — atau langsung:

```sh
./relay/deploy.sh user@your-vps   # build + scp + install + enable + cek /health
./relay/deploy.sh --local         # install di mesin ini (butuh sudo)
```

Yang di-install di target: binary ke `/usr/local/bin/h-router-relay`,
unit ke `/etc/systemd/system/h-router-relay.service`, user sistem
`hrouter`, dan `/etc/h-router/relay.env` (mode 0600, dibuat kosong bila
belum ada — **secret tidak pernah disalin oleh script ini**).
Unit sudah divalidasi dengan `systemd-analyze verify` (systemd 255).

Setelah deploy pertama, di VPS:

1. Edit `/etc/h-router/relay.env` (minimal secret profil yang dipakai:
   `HROUTER_RELAY_KIMI_DEVICE_ID`, `HROUTER_RELAY_CLINE_API_KEY`,
   `HROUTER_RELAY_KILOCODE_ORG_ID`, …).
2. `sudo systemctl restart h-router-relay`
3. `curl http://127.0.0.1:20129/health` → `{"status":"ok",...}`
4. Di dashboard H-router, daftarkan relay sebagai pool tipe `http` dengan
   `proxyUrl` `http://<vps-ip>:20129` (halaman proxy-pools) dan ikat ke
   koneksi provider (`proxyPoolId`).

Update binary: `cargo build --release`, stop service, install binary baru,
start lagi — atau `./relay/deploy.sh user@host` (lihat juga
"Update the binary" di `relay/README.md`).

### Konfigurasi

Precedence: flag CLI (`--listen` / `--profile` / `--config`) > env
(`HROUTER_RELAY_LISTEN`, `HROUTER_RELAY_PROFILE`, `HROUTER_RELAY_CONFIG`,
`HROUTER_RELAY_KIMI_DEVICE_ID`, `HROUTER_RELAY_CLINE_API_KEY`,
`HROUTER_RELAY_CLINE_ACCESS_TOKEN`, `HROUTER_RELAY_KILOCODE_ORG_ID`,
`HROUTER_RELAY_MUSE_SUBSCRIPTION`, `HROUTER_RELAY_APP_VERSION`) > file
config (TOML, atau JSON bila suffix `.json`; contoh:
`relay/config.example.toml`) > default bawaan. `app_version` default
`0.5.116` (versi `package.json` fork saat build).

## Rotator egress (gateway)

- **Taksonomi error** (wajib): `400` + code `11128` / "request illegal"
  → `request-error`: kembalikan respons, **jangan rotasi, jangan ban,
  jangan fallback akun**. `403` + kata-kata abusive-traffic ("abusive",
  "unusual traffic", "ip banned/blocked", "too many requests from this
  ip", …) → `rotate-relay`: ban pool **5 menit**, retry via relay berikut
  (maks **3x**), akun tetap sama. `403` tanpa kata-kata itu → serahkan ke
  account fallback yang sudah ada. `429` → `backoff-account`: jangan ban
  relay; rotasi akun yang sudah ada.
- **Unit rotasi**: 1 pool = 1 `proxyUrl` (1 egress). Kandidat untuk satu
  provider = `proxyPoolId` berbeda yang terikat ke koneksi AKTIF provider
  itu (urutan = urutan prioritas koneksi). Rotasi **menjaga akun yang sama,
  hanya menukar egress** (pin koneksi dipertahankan).
- State ban per `poolId` di tabel `egress_relays` (`bannedUntil`,
  `lastBanAt`, `lastBanStatus`, `lastBanCode`, `failCount`,
  `lastSuccessAt`). Pool tanpa baris = belum pernah kena ban. Sukses tidak
  membuka ban lebih awal; admin bisa clear manual.
- **Auto-rotate per provider**: switch di
  `settings.providerStrategies[providerId].autoRotate` (default ON),
  diatur dari card "Egress Auto-Rotate" di halaman proxy-pools.
- **API**: `GET /api/proxy-pools/egress` → status per pool (`healthy` /
  `cooldown` / `banned`); `POST {poolId, action:"clear"}` → clear ban
  (admin-only). Halaman proxy-pools: badge per pool + polling 30 detik +
  card info "Rust Relay Sidecar".

## Canonical tool-schema injector + header hooks registry-driven

- **Canonical tool-schema injector** (`open-sse/translator/concerns/canonicalToolSchema.js`):
  normalisasi `tools` request ke bentuk kanonik
  `{type:"function", function:{name, description, parameters}}`
  (menangani `input_schema` Anthropic, bare `{name, parameters}`, wrapper
  `function` yang hilang; buang tool tanpa nama; dedupe per nama).
  Hook di `chatCore.js` tepat setelah blok `dedupeTools`, gate
  `transport.canonicalTools: true` (aktif di opencode / opencode-go /
  opencode-zen) dan hanya bila target berbentuk OpenAI. Fail-open.
- **Header hooks registry-driven** (`open-sse/executors/headerHooks.js`):
  hook header per provider dideklarasikan di registry
  (`transport.headerHooks: [...]`) — provider free-tier baru tinggal tambah
  config, bukan kode. 9 registry dimigrasi (cline, clinepass,
  codebuddy-cn/intl, kilocode, kimi, minimax-code/global, muse).
  Koreksi selama build: `PROVIDERS[id]` **adalah** objek transport itu
  sendiri — lookup `.transport.*` diam-diam tidak bekerja; sudah diperbaiki.
