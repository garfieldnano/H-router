<div align="center">
  <img src="./public/h-router-logo.svg" alt="H-router" width="120"/>

  # H-router — FREE AI Router & Token Saver

  **Never stop coding. Save 20–40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

  **Connect Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw and more to 40+ AI providers & 100+ models — with member accounts, a Telegram bot, and reseller controls built in.**

  Fork of [decolua/9router](https://github.com/decolua/9router) v0.5.116.

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[🚀 Quick Start](#-quick-start) • [✨ Features](#-features) • [👥 Members & reselling](#-members--reselling) • [⚙️ Configuration](#-configuration) • [📖 Docs](#-docs)
</div>

---

## What is H-router?

H-router is a self-hosted AI gateway. Point your coding tools at its OpenAI-compatible `/v1` endpoint and it routes each request to the best provider account: it translates formats between OpenAI, Claude, Gemini and others, compresses tool outputs to save tokens (RTK), tracks quotas, refreshes tokens automatically, and falls back from paid subscriptions to cheap and free models so you never stop mid-task.

On top of that, H-router adds a reseller layer: member accounts with their own API keys, a Telegram bot for buying keys and trials, per-key rate limits, downtime compensation, and a Rust relay sidecar that rotates egress when a provider blocks traffic.

## ✨ Features

### Core gateway

- **RTK Token Saver** — automatically compresses `tool_result` content (git diffs, grep output, file listings) to cut 20–40% of tokens per request. Per-model on/off toggles.
- **Universal `/v1` endpoint** — OpenAI-compatible; works with Claude Code, Codex, Cursor, Cline, OpenClaw, Antigravity, Copilot, Gemini CLI, and any OpenAI-compatible client.
- **Format translation** — OpenAI ↔ Claude ↔ Gemini and more, including tool calls and thinking blocks.
- **Auto-fallback** — subscription → cheap → free, with per-account quota tracking and automatic token refresh.
- **Multi-account** — round-robin across accounts per provider; one key per account, pooled.
- **Live Traffic & observability** — live request feed, conversation inspector, a Playground to test models through the gateway, and per-key usage breakdowns.

### H-router additions

- **Member dashboard** — members log in with their API key and see only their own usage and keys (read-only). Admins create accounts and assign keys; no self-registration. [Docs](docs/h-router/member-dashboard.md)
- **Telegram bot** — buy keys via manual transfer + admin confirmation, 1-day free trial (once per user), member menu, full admin panel, and a daily usage digest every morning ~08:00 WIB. [Docs](docs/h-router/telegram-bot.md)
- **RPM limits** — per-key → per-package → trial default 20 → global default 50 requests/minute; over-limit returns 429 + `Retry-After`. [Docs](docs/h-router/rpm.md)
- **Downtime compensation** — an outage extends affected keys by +1h / +3h / +5h / +8h depending on its length, granted manually by admin. [Docs](docs/h-router/compensation.md)
- **Rust relay sidecar** — egress proxy (default `127.0.0.1:20129`) that rotates to a healthy relay when a provider answers with abusive-traffic or rate-limit errors. [Docs](docs/h-router/relay.md)
- **Model rebranding + applyLive** — `/v1/models` shows your H-router brand and hides upstream names; live system prompts (prepend/replace/append) are injected per brand or model and never written to logs. [Docs](docs/h-router/rebrand-applylive.md)
- **Per-key IP caps + health scanner** — default 3 IPs per key (1–100); the scanner classifies providers Healthy / Limit / Dead / Unknown. [Docs](docs/h-router/ip-cap-scanner.md)
- **Vision Adapter** — image requests only reach vision-capable models; anything else is rejected with a 400 and up to 5 allowed alternatives. Admin overrides via `/api/vision-overrides`.
- **Per-model RTK toggles** — `provider/model` overrides on top of the global Token Saver setting. [Docs](docs/h-router/rtk.md)

New API keys use the `h-router-` prefix.

## 🚀 Quick Start

### Requirements

- Node.js 20+ (tested on 24), npm, and Git.
- A provider account to connect (or use a free one like Kiro AI / OpenCode Free — see below).

### 1. Clone & install

```bash
git clone https://github.com/garfieldnano/H-router.git
cd H-router
cp .env.example .env
npm install --legacy-peer-deps
```

> `npm install` needs `--legacy-peer-deps`: this repo ships no lockfile and npm hits a dependency-resolution bug without it.

### 2. Run it

```bash
npm run dev -- --port 20128
```

Dashboard: **http://localhost:20128**

> The `dev` script hardcodes port 20127, so the trailing `-- --port 20128` is what actually puts the dashboard on 20128.

### 3. Connect a provider

Dashboard → **Providers** → connect **Kiro AI** (~50 credits/month free) or **OpenCode Free** (no auth) → done.

### 4. Use it in your CLI tool

```
Endpoint: http://localhost:20128/v1
API Key:  [copy from the dashboard]
Model:    [pick a branded model — list them at GET /v1/models]
```

That's it — start coding with free AI models.

### Production

```bash
npm run build
npm run start -- --port 20128
```

### Docker (build from source)

```bash
docker build -t h-router .
docker run -p 20128:20128 -v "$HOME/.h-router:/app/data" -e DATA_DIR=/app/data h-router
```

There is no published H-router image — build it from this repo.

## 👥 Members & reselling

- **Admin** creates members and assigns `h-router-` keys from **Dashboard → Members**. Members never self-register and never see each other's data.
- **Members** log in to `/dashboard/member` with their API key and see their own usage, per-model breakdown, and keys (read-only).
- **Telegram bot** handles the storefront: packages & prices are set in **Dashboard → Paket & Harga**, buyers pay by manual transfer, admin confirms, and the key is issued automatically. Free trial: 1 day, once per user.
- Details: [member dashboard](docs/h-router/member-dashboard.md) · [Telegram bot](docs/h-router/telegram-bot.md) · [RPM](docs/h-router/rpm.md) · [compensation](docs/h-router/compensation.md)

## ⚙️ Configuration

| Variable | What it does |
|---|---|
| `DATA_DIR` | App data location (SQLite). Set it explicitly in production, e.g. `/var/lib/h-router`. |
| `JWT_SECRET` | Signs the dashboard auth cookie. Auto-generated if unset; set one value to share sessions across instances. |
| `TELEGRAM_BOT_TOKEN` | BotFather token for the Telegram bot. |
| `TELEGRAM_OWNER_CHAT_ID` | Your Telegram chat ID — order notifications and the daily digest go here. |
| `HROUTER_BOT_SECRET` | Shared secret between the bot and the gateway (`/api/bot/*`). |

Full settings reference and the go-live checklist live in the [operator docs](docs/h-router/README.md).

## 📖 Docs

Operator docs (Indonesian) in [docs/h-router/](docs/h-router/README.md):

- [Member dashboard](docs/h-router/member-dashboard.md)
- [Telegram bot](docs/h-router/telegram-bot.md)
- [RPM limits](docs/h-router/rpm.md)
- [Downtime compensation](docs/h-router/compensation.md)
- [Rust relay](docs/h-router/relay.md) — deploy with `relay/deploy.sh`
- [Rebrand + applyLive](docs/h-router/rebrand-applylive.md)
- [IP caps + health scanner](docs/h-router/ip-cap-scanner.md)
- [Observability](docs/h-router/observability.md)
- [RTK per-model toggles](docs/h-router/rtk.md)

## 🤝 Development

```bash
npm run dev -- --port 20128          # dev server (Turbopack)
npm run dev:webpack -- --port 20128   # dev server (webpack — use this if Turbopack fails behind a proxy)
npm run build                        # production build
```

## 📄 License

MIT License — see [LICENSE](LICENSE).
