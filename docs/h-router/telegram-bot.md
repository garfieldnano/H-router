# Bot Telegram

> Build log: `~/workspace/analysis/9router-telegram-bot-build.md`
> (plan §0b + laporan harian, skema v4). 53 unit + 38 regresi + 41/41 E2E.
> **Belum diuji live** terhadap server Telegram sungguhan (belum ada token).

## Arsitektur

- Proses Node terpisah: `src/bot-telegram/index.mjs` (Telegraf 4.16.3,
  **polling** — jalan di balik NAT tanpa URL publik). Tetap jalan walau
  dashboard restart; bisa dijadikan service.
- Bicara ke server **hanya** lewat internal API `/api/bot/*` — tidak pernah
  akses DB langsung. Auth: header `x-hrouter-bot-secret` vs env
  `HROUTER_BOT_SECRET` (constant-time). Tanpa secret → 503; salah → 401.
- Repo ini CommonJS, jadi file bot + logika murni memakai `.mjs`
  (`src/bot-telegram/*.mjs`, `src/lib/bot/*.mjs`); route Next.js mengimpor
  lewat shim `.js` tipis supaya path `@/lib/bot/*` tetap jalan.
- Format pesan: Markdown legacy (`*tebal*`, `` `kode` ``).

## Menjalankan bot

```bash
cd ~/workspace/analysis/9router
TELEGRAM_BOT_TOKEN="<token dari @BotFather>" \
HROUTER_BOT_SECRET="<secret yang sama dengan server>" \
HROUTER_BASE_URL="http://127.0.0.1:20127" \
node src/bot-telegram/index.mjs
```

Env opsional: `HROUTER_WEB_URL` (default = base URL, untuk tombol
"Buka Dashboard"), `TELEGRAM_OWNER_CHAT_ID` (mengalahkan settings),
`TELEGRAM_BOT_USERNAME`, `HROUTER_BOT_DRY_RUN=1` (verifikasi konfigurasi +
handler lalu keluar, tanpa polling). Server harus punya
`HROUTER_BOT_SECRET` yang sama di env-nya.

## Go-live bot Telegram

1. Buat bot di **@BotFather** → dapatkan `TELEGRAM_BOT_TOKEN`.
2. Cari tahu chat ID Telegram owner (mis. via @userinfobot) → isi
   `TELEGRAM_OWNER_CHAT_ID` (env) atau `settings.telegramBot.ownerChatId`.
   Tanpa ini: **tidak ada panel admin dan tidak ada digest harian**.
3. Atur detail pembayaran (bank/e-wallet + nama pemilik) dari panel admin
   bot atau web — sampai diatur, bot memberi tahu pembeli bahwa pembayaran
   belum disiapkan (bot **tidak pernah** mengarang nomor rekening).
4. Buat paket pertama di **Paket & Harga** (`/dashboard/packages`) — bot
   tidak bisa menjual tanpa paket aktif.
5. (Opsional) Isi `TELEGRAM_BOT_USERNAME` supaya link
   `t.me/<bot>?start=<kode>` di kartu "Hubungkan Telegram" bekerja.

## Menu member (cermin dashboard web + fitur bot)

- Usage: statistik (termasuk biaya), per-model, request terbaru, filter
  periode (Hari ini / 24 jam / 7 / 30 hari / Semua).
- **📊 Laporan Harian**: usage sendiri hari ini (model + token
  prompt/completion + biaya). Batas hari dihitung eksplisit Asia/Jakarta
  (WIB, UTC+7).
- **Kunci API saya**: read-only, masked.
- **Beli kunci**: pilih paket → detail pembayaran dari settings → transfer
  manual → kirim bukti (foto) via bot → order pending → admin konfirmasi /
  tolak → kunci `h-router-` baru diterbitkan otomatis dan dikirim ke pembeli.
  Kalau pembeli belum punya akun member, member dibuat otomatis (email
  sintetis `tg-<telegramId>@telegram.local` — hanya identitas, bukan
  kredensial; login web tetap via API key).
- **Trial gratis**: 1 hari, sekali per Telegram user **dan** per member
  (guard + `trialClaims.telegramId` UNIQUE), tanpa bayar, tanpa konfirmasi
  admin, kunci auto-issued. Sweeper bot tiap jam menonaktifkan kunci trial
  kedaluwarsa + memberi tahu member.
- **Hubungi Owner**: pesan diteruskan ke owner; balasan owner di-relay
  balik ke user.
- **Link akun**: member minta kode 6 huruf sekali pakai (10 menit) dari
  kartu "Hubungkan Telegram" di `/dashboard/member`, lalu `/start <kode>`
  di bot.

## Panel admin (hanya owner chat ID)

Hanya chat ID owner yang melihat panel admin; chat lain tidak mendapat
menu admin sama sekali (tidak ada petunjuk bahwa panel itu ada).

- Order (pending → konfirmasi/tolak), member (aktif/nonaktif), kunci
  (aktif/nonaktif, RPM — lihat [rpm.md](rpm.md)), paket & harga (buat/edit
  harga), usage, digest on-demand, ringkasan settings + link web, atur
  pembayaran, insiden & kompensasi (lihat
  [compensation.md](compensation.md)).
- Semua pengaturan admin web lainnya dicerminkan sebagai menu bot
  (providers, proxy-pools, usage, quota, combos, token-saver, translator,
  skills, MITM, settings, database, dll.); edit yang tidak muat di chat UI
  mengarah balik ke web.

## Paket (packages)

- Tabel `packages`: `id`, `name`, `price` (INTEGER rupiah — tidak pernah
  hardcode), `durationDays`, `type` (`paid` | `trial`), `access` (JSON),
  `isActive`, `createdAt`, `updatedAt`.
- Harga trial dipaksa 0. Admin kelola paket dari web
  (`/dashboard/packages`) **dan** panel admin bot.
- Status order: `pending_payment` → `pending_confirm` →
  `confirmed` | `rejected`.

## Laporan harian (digest admin)

- Scheduler di proses bot: tiap pagi **~08:00 WIB** bot mengirim ke owner
  ringkasan hari sebelumnya — total request, total token (split
  prompt/completion), total biaya, **model paling banyak dipakai**
  (top model/member/kunci).
- Member bisa meminta laporan hariannya sendiri kapan saja (on-demand).

## Skema (v4)

Tabel baru: `packages`, `orders`, `telegramLinks` (kode sekali pakai,
**sengaja tidak** ikut `exportDb`), `telegramChats`, `trialClaims`;
kolom baru `apiKeys.expiresAt` (NULL = tidak pernah kedaluwarsa).
`validateApiKey()` menolak kunci kedaluwarsa di semua jalur.
