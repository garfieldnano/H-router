# H-router — Dokumentasi Operator

> Fork 9router (v0.5.116, commit `1339107`) dengan fitur reseller/member,
> bot Telegram, dan proteksi bisnis. Dokumen ini ditulis dalam Bahasa
> Indonesia dan menjelaskan perilaku **sebagaimana dibangun** (bukan rencana).
> Setiap halaman merujuk ke build log di `~/workspace/analysis/` untuk
> detail verifikasi dan hasil test.

## Daftar isi

| Dokumen | Isi |
|---|---|
| [member-dashboard.md](member-dashboard.md) | Dashboard member (read-only), login via API key, halaman admin Members |
| [telegram-bot.md](telegram-bot.md) | Bot Telegram: beli, trial, DM owner, panel admin, laporan harian |
| [rpm.md](rpm.md) | Batas requests-per-minute per kunci (20/30/50, Trial 20) |
| [compensation.md](compensation.md) | Kompensasi gangguan: perpanjang masa aktif kunci (+1/+3/+5/+8 jam) |
| [relay.md](relay.md) | Relay Rust sidecar + rotator egress (Mode A + Mode B) |
| [rebrand-applylive.md](rebrand-applylive.md) | Rebranding model (`owned_by: h-router`) + applyLive system prompt |
| [ip-cap-scanner.md](ip-cap-scanner.md) | Batas IP aktif per kunci (default 3) + pemindai kesehatan provider |
| [observability.md](observability.md) | Live Traffic, Conversations, Playground, Pemakaian Kunci |
| [rtk.md](rtk.md) | Token Saver (RTK) + toggle per model |

## Gambaran arsitektur

```
Klien --(API key h-router-)--> Gateway /v1 (Next.js)
                                 ├─ keyAccess (allow list model per kunci)
                                 ├─ IP cap (max 3 IP aktif / 10 menit)
                                 ├─ RPM (per kunci → paket → trial 20 → global 50)
                                 ├─ rebrand resolve (brand id → upstream)
                                 ├─ applyLive (suntik system prompt, sebelum RTK)
                                 ├─ RTK token saver (global + override per model)
                                 ├─ rotator egress (403 → ganti relay, ban 5 menit)
                                 └─ upstream provider (via pool/proxy, atau relay Rust)
Admin --(dashboard web / bot Telegram)--> settings, members, keys, packages,
                                           orders, incidents, compensations
Member --(dashboard web / bot Telegram)--> usage + kunci sendiri (read-only)
```

- **Stack**: Next.js 16 + React 19 + SQLite + Node. Data di SQLite lokal
  (`DATA_DIR`, default `~/.9router/db/data.sqlite`).
- **Bot Telegram**: proses Node terpisah (`src/bot-telegram/`, Telegraf 4,
  polling). Bicara ke server **hanya** lewat internal API `/api/bot/*`
  (header `x-hrouter-bot-secret` = env `HROUTER_BOT_SECRET`).
- **Relay Rust**: sidecar terpisah (`relay/`, crate `h-router-relay`),
  didaftarkan sebagai pool tipe `http` di proxy-pools.

## Riwayat skema (SCHEMA_VERSION)

| Versi | Isi |
|---|---|
| v3 (§0) | `members`, `apiKeys.memberId` |
| v4 (§0b) | `packages`, `orders`, `telegramLinks`, `telegramChats`, `trialClaims`, `apiKeys.expiresAt` |
| v5 (§0c) | `apiKeys.rpmLimit`, `packages.rpmLimit`, `apiKeys.packageId` |
| v6 (§0d) | `system_incidents`, `compensations` |
| v7 (#1) | `egress_relays` |
| v8 (#2) | `model_brands`, `live_prompts` |
| v9 (#5) | `key_ip_usage`, `apiKeys.maxIps` |

Migrasi bersifat aditif (`syncSchemaFromTables`); setiap bump versi
mengambil satu backup safety DB sebelum perubahan.

## Kunci API

- **Kunci baru**: prefix `h-router-`, format
  `h-router-{machineId}-{keyId}-{crc8}`.
- **Kunci `sk-` lama**: masih diterima — **transitional saja**, bukan
  jaminan permanen; pencabutan penerimaannya belum dijadwalkan.
- Kunci dikirim sekali saat dibuat / saat confirm order; nilai penuh tidak
  pernah ditampilkan lagi di dashboard (hanya mask 8 pertama + 4 terakhir).
- Kunci kedaluwarsa (`expiresAt` lewat) ditolak di semua jalur
  (`validateApiKey`).

## Go-live checklist

- [ ] Server jalan (dev: `npm run dev`; produksi: build + start Next.js).
- [ ] Bot Telegram: isi [telegram-bot.md](telegram-bot.md#go-live-bot-telegram)
      — token BotFather (`TELEGRAM_BOT_TOKEN`), owner chat ID, detail
      pembayaran, lalu jalankan proses bot.
- [ ] Buat paket pertama di **Paket & Harga** (`/dashboard/packages`) —
      bot tidak bisa menjual tanpa paket aktif. Atur harga + RPM per paket.
- [ ] (Opsional) Deploy relay Rust ke VPS bila memakai armada self-hosted —
      lihat [relay.md](relay.md#deploy-ke-vps) (`relay/deploy.sh`).
- [ ] (Opsional) Buat brand + live prompt di **Rebranding**
      (`/dashboard/rebrand`) bila ingin menyembunyikan nama upstream.
- [ ] Periksa halaman **Pemindai Kesehatan** (`/dashboard/scanner`) — akun
      provider yang mati sebaiknya dihapus sebelum dijual ke member.

## Yang belum terverifikasi live

Semua fitur di bawah ini dibangun + diuji unit/E2E di DATA_DIR terisolasi
dengan mock upstream — **belum ada uji live** di lingkungan produksi:

- Bot Telegram terhadap server Telegram sungguhan (belum ada token BotFather).
- Visual check browser asli untuk halaman-halaman baru (yang dicek: HTTP
  200 + konten HTML).
- Load/concurrency: limiter RPM, IP cap, rotator egress, SSE Live Traffic.
- Komposisi gateway → sidecar Rust end-to-end (sidecar standalone ✅,
  rotator gateway ✅, tapi belum satu request `/v1` yang mengalir lewat
  binary sidecar ke upstream — butuh `/etc/hosts` + MITM port 443).

## Batasan yang diketahui

- RPM memakai sliding window **in-memory** — restart server mereset counter.
- Deteksi insiden kompensasi hanya berjalan selama proses bot hidup; kalau
  bot mati saat gangguan, insiden tidak tercatat otomatis (dan belum ada
  endpoint admin untuk membuat insiden manual).
- Deteksi kode 11128 hanya untuk respons JSON non-streaming; respons SSE
  hanya dideteksi via status 403/429.
- Redaksi live prompt tidak mencakup target Kiro (translator Kiro
  menggabungkan system prompt ke konten user turn pertama).
- `/stats` sidecar Rust sempat menghitung 1 dari 2 forward sukses pada
  smoke test (kemungkinan request Mode A tidak masuk counter) — belum
  dikonfirmasi; rotator tidak memakai counter ini (memakai status respons).
