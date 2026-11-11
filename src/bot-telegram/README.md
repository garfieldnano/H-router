# Bot Telegram H-router

Bot Telegram untuk H-router: member cek penggunaan & kunci, beli paket (transfer manual + konfirmasi admin), klaim trial gratis 1 hari, hubungi owner, dan panel admin lengkap di dalam bot. Laporan harian: digest otomatis ke owner tiap pagi ~08:00 WIB + laporan harian member on-demand. Kompensasi gangguan: pemantau uptime gateway mencatat insiden otomatis; admin memberi perpanjangan masa aktif kunci secara manual dari bot atau web.

## Arsitektur

- Proses Node terpisah (`src/bot-telegram/index.mjs`), **polling** (Telegraf long-polling).
- Bot **tidak pernah** menyentuh database langsung. Semua lewat internal API server `POST/GET /api/bot/*` (localhost), dijaga service secret `HROUTER_BOT_SECRET`. Scoping member ditegakkan server-side.
- Token bot **hanya** dari env `TELEGRAM_BOT_TOKEN` — tidak pernah di code, tidak pernah di settings, tidak pernah di log.
- Kunci API mentah hanya dikirim ke pembeli saat diterbitkan (order confirm / trial) — tidak pernah di-log.

## Menjalankan

```bash
cd ~/workspace/analysis/9router   # atau folder repo
TELEGRAM_BOT_TOKEN="<token dari @BotFather>" \
HROUTER_BOT_SECRET="<secret yang sama dengan server>" \
HROUTER_BASE_URL="http://127.0.0.1:20127" \
node src/bot-telegram/index.mjs
```

Env lain (opsional):

| Variabel | Default | Keterangan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (wajib) | Token dari @BotFather |
| `HROUTER_BOT_SECRET` | — (wajib) | Secret internal API; harus sama dengan server |
| `HROUTER_BASE_URL` | `http://127.0.0.1:20127` | URL server 9router |
| `HROUTER_WEB_URL` | = `HROUTER_BASE_URL` | URL dashboard web (tombol "Buka Dashboard") |
| `TELEGRAM_OWNER_CHAT_ID` | dari settings | Chat ID owner/admin (mengalahkan settings) |
| `TELEGRAM_BOT_USERNAME` | dari settings | Username bot tanpa @ (untuk link `t.me/...?start=`) |
| `HROUTER_BOT_DRY_RUN` | `0` | `1` = verifikasi konfigurasi + handler lalu keluar (tanpa polling) |
| `HROUTER_HEALTH_PROBE_INTERVAL_MS` | `60000` | Seberapa sering probe uptime gateway (`/api/health`) |
| `HROUTER_HEALTH_PROBE_FAILURES` | `3` | Berapa kali gagal beruntun sebelum insiden dibuka |

Server juga harus punya `HROUTER_BOT_SECRET` yang sama di env-nya saat berjalan.

## Verifikasi konfigurasi tanpa token Telegram asli

```bash
HROUTER_BOT_DRY_RUN=1 TELEGRAM_BOT_TOKEN=dummy HROUTER_BOT_SECRET=test-secret \
  node src/bot-telegram/index.mjs
```

Dry-run memeriksa: token & secret terisi, server bisa dihubungi (`/api/bot/config`), lalu keluar dengan status 0. Polling Telegram tidak dijalankan — uji live butuh token asli dari BotFather.

## Alur utama

- **Link akun**: member buka dashboard web → *Hubungkan Telegram* → dapat kode 6 huruf (10 menit, sekali pakai) → kirim `/start <kode>` ke bot.
- **Beli**: pilih paket → bot buat order → tampilkan detail pembayaran (dari settings; kalau belum diatur, bot bilang begitu — tidak pernah mengarang nomor rekening) → pembeli kirim foto bukti → order masuk antrean admin → admin konfirmasi/tolak di bot → kunci `h-router-` baru diterbitkan otomatis dan dikirim ke pembeli.
- **Trial**: klaim dari bot — 1 hari, sekali per pengguna (Telegram ID + member), tanpa bayar, tanpa konfirmasi admin. Setelah habis, kunci nonaktif otomatis (sweeper tiap jam + `validateApiKey` menolak kunci kedaluwarsa).
- **DM owner**: tombol *Hubungi Owner* → pesan diteruskan ke owner; owner **balas pesan yang diteruskan** untuk menjawab.
- **Admin**: hanya chat ID owner. `/admin` atau menu admin — order, member, kunci, paket & harga (ubah harga dari bot), penggunaan, digest, pengaturan, atur pembayaran.
- **Digest harian**: tiap ~08:00 WIB bot kirim ringkasan hari sebelumnya ke owner (total request, token prompt/completion, biaya, top model, member & kunci teraktif). Admin juga bisa minta kapan saja dari panel (*Kirim Digest*).
- **Laporan harian member**: menu *Laporan Harian* — penggunaan member hari ini (batas hari Asia/Jakarta), mirror filter "Hari ini" di dashboard web.
- **Pemantau uptime & kompensasi (§0d)**: bot mem-probe `/api/health` tiap 60 detik; 3 kali gagal beruntun → insiden dibuka, owner diberitahu; pulih → insiden ditutup (durasi tercatat). Kalau gateway bisa diakses tapi sebagian besar request error (>50% dalam 5 menit terakhir, min. 10 request), insiden juga dibuka. Admin memberi kompensasi **manual** dari panel admin bot (*Insiden & Kompensasi*) atau web (`/dashboard/compensations`): pilih insiden → member → kunci → tier (+1/+3/+5/+8 jam sesuai durasi gangguan; tier dari durasi jadi default, bisa di-override). Kunci tanpa masa berlaku tidak bisa diberi kompensasi; satu (insiden, kunci) hanya bisa dikompensasi sekali. Member melihat riwayat kompensasinya di bot (*Kompensasi*) dan dashboard web. Deteksi hanya berjalan selama proses bot hidup — kalau bot mati saat gangguan, insiden tidak tercatat.

## File

| File | Isi |
|---|---|
| `index.mjs` | Entry: config, Telegraf, registrasi handler, polling, scheduler |
| `config.mjs` | Resolusi env |
| `api.mjs` | Client internal API `/api/bot/*` (secret header) |
| `state.mjs` | State percakapan in-memory (buy flow, DM, input admin) |
| `handlers/member.mjs` | Menu member, beli, trial, DM owner, link, riwayat kompensasi |
| `handlers/admin.mjs` | Panel admin, insiden & pemberian kompensasi |
| `digest.mjs` | Scheduler digest 08:00 WIB + sweeper trial tiap jam |
| `healthProbe.mjs` | Pemantau uptime gateway (§0d): probe `/api/health`, buka/tutup insiden |

Logika murni yang bisa diuji ada di `src/lib/bot/*.mjs` (format, orderFlow, trial, digest, adminGuard, payment, compensation) + service server-side `src/lib/bot/orderService.js` dan `src/lib/bot/compensationService.js`.
