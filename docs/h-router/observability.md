# Observabilitas (G7)

> Build log: `~/workspace/analysis/9router-observability-build.md`
> (plan G7, skema tetap v9 — tidak ada tabel baru). 35/35 unit + 181/181
> regresi terkait + 52/52 E2E.
> **Belum ada visual check browser asli dan load/concurrency SSE +
> playground.**

Empat halaman **admin-only** (guard yang sudah ada memblokir member:
API 403, halaman 307 — diverifikasi E2E untuk keempat halaman + kelima
API). Member tetap hanya melihat usage sendiri di dashboard member.

## Live Traffic — `/dashboard/traffic`

- Stream trafik gateway live: waktu, kunci (masked), model, provider,
  token in/out, biaya, status.
- **Transport**: SSE stream yang sudah ada
  (`GET /api/usage/stream?period=today`) via `EventSource`. Kalau
  `EventSource` gagal/error, halaman otomatis pindah ke polling REST
  (`GET /api/usage/stats?period=today`) tiap 5 detik dengan banner
  "Mode polling". Ada tombol pause/resume; saat pause, event yang masuk
  dihitung dan ditampilkan sebagai "+N baru".

## Conversations — `/dashboard/conversations`

- Penampil log percakapan (bukan basic-chat — itu hanya UI chat). Dibangun
  di atas data yang sudah ada: `requestDetails` (detail per request) +
  `usageHistory` (daftar). **Tidak ada tabel `conversations`** — tiap
  request ditampilkan sebagai satu "percakapan" (turn user/assistant/tool)
  dengan panel detail.
- `GET /api/conversations/[id]` mengembalikan turns yang diekstrak +
  metadata saja — tidak pernah raw headers/body. Turn dipotong di 4000
  karakter (`MAX_TURN_CHARS`) dengan flag `truncated`.
- `requestDetails` kosong secara default kecuali observabilitas aktif
  (`enableObservability: false` / `ENABLE_REQUEST_LOGS=true`): halaman
  menampilkan empty state eksplisit ("Observabilitas belum diaktifkan —
  aktifkan di Profil → Observabilitas…"), bukan halaman rusak.
  `/api/usage/request-details` mengembalikan `observabilityEnabled` agar
  halaman bisa membedakan "belum diaktifkan" dari "belum ada request".
- Anti-leak (aturan #2): prompt live tidak pernah muncul — turns
  menampilkan placeholder `[live system prompt injected — content hidden]`
  + marker `live_injected: true` di metadata saja.

## Playground — `/dashboard/playground`

- Uji satu model sekali jalan: pilih model, kirim prompt, lihat jawaban
  lengkap + token/biaya/finish reason. Selalu non-streaming.
- `POST /api/playground/chat` membangun synthetic `Request` dan memanggil
  `handleChat()` yang **sama** dengan route `/v1` — brand resolution,
  applyLive, gate RPM / IP-cap / key-access, dan pencatatan usage persis
  seperti panggilan klien nyata.
- Dijalankan sebagai API key admin (dipilih admin, atau key aktif pertama);
  tanpa key aktif, playground menolak dengan pesan jelas (400).
- `GET /api/playground/models`: picker menampilkan daftar brand dulu
  (cepat); **"Muat semua model"** fetch `?full=1` untuk katalog live
  lengkap. Daftar key yang dikembalikan hanya masked — nilai penuh tidak
  pernah keluar dari server.
- Catatan: route `/api/dashboard/chat/completions` basic-chat tidak ada
  (basic-chat disembunyikan di sidebar) — playground tidak bisa reuse itu,
  makanya lewat `handleChat` langsung.

## Pemakaian Kunci — `/dashboard/key-usage`

- Halaman khusus (bukan perluasan halaman Usage): satu baris per key —
  termasuk key tanpa usage di periode itu (baris nol) — + breakdown per
  model, member, RPM, batas IP. Bucket "Local (No API Key)" selalu paling
  bawah.
- `GET /api/usage/by-key?period=` — periode: today / 24h / 7d / 30d / 60d /
  all (default 7d).

## Endpoint & Kunci — sudah mengelola kunci (terverifikasi, tidak digabung)

`dashboard/endpoint` sudah mengelola API key seperti nikahub
(buat/hapus/pause/restrict/list, URL endpoint lokal/tunnel/tailscale,
toggle `requireApiKey`) — E2E mengonfirmasi halaman render 200 dan
`/api/keys` me-list key yang dibuat. **Tidak ada merge.** Satu-satunya yang
masih terbuka: halaman endpoint tidak menampilkan kolom "Pemakaian Kunci"
per key — itu sudah tercakup halaman G7 baru, bukan kekurangan endpoint.

## Perbaikan keamanan selama build ini (AUDIT-002 #1962)

E2E menemukan (bukan bug G7 — perilaku lama): `getUsageStats()` mengunci
`byApiKey` dengan composite mentah `${apiKey}|${model}|${provider}`,
sehingga **nilai penuh API key ikut terkirim ke browser** lewat
`/api/usage/stream` dan `/api/usage/stats`. Perilaku lama itu sengaja
(komentar di jalur live bilang masking "collided") — tapi itu terjadi
karena mask waktu itu hanya prefix (8 karakter pertama, yang untuk semua
key `h-router-` selalu sama). `apiKeyMasked` adalah mask PENUH (8 pertama
+ 4 terakhir).

Perbaikan di akar: `byApiKey` sekarang dikunci composite masked
(`${apiKeyMasked}|${model}|${provider}`, no-key = satu bucket
`"local-no-key"`); entry membawa `keyId` untuk join agregasi per-key;
`sanitizeUsageStatsForBrowser()` tetap sebagai boundary guard di
stream/stats/history. **AUDIT-002 (#1962) kini lolos.**
