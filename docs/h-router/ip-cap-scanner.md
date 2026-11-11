# Batas IP Aktif + Pemindai Kesehatan

> Build log: `~/workspace/analysis/9router-ipcap-scanner-build.md`
> (plan §5 + G6/G8/G10, skema v9). 25/25 unit + 45/45 terkait + 38/38 E2E.
> **Belum ada uji beban/konkurensi; window 10 menit live tidak di-E2E-kan.**

## Active IP Cap

Tabel `key_ip_usage` (`keyId`, `ip`, `lastSeenAt`, PK `(keyId, ip)`).

- Setiap request `/v1` mencatat IP klien; **window geser 10 menit**.
  IP aktif melebihi cap → HTTP **429** + `Retry-After` (detik sampai entri
  tertua di window kedaluwarsa) + header `X-IpCap-Limit` /
  `X-IpCap-Active`.
- **Default cap = 3 IP** per kunci (keputusan user 2026-11-11; plan sempat
  menulis "default 11/22" yang tidak jelas — user memilih 3 dari opsi
  3/5/10). Per kunci: kolom `apiKeys.maxIps` (NULL = default 3; range
  1–100; **tidak ada nilai unlimited**).
- **Semantik count-then-record**: IP yang sudah ada di window selalu lolos
  (timestamp di-refresh); IP baru di atas cap **ditolak TANPA dicatat** —
  IP yang ditolak tidak boleh meracuni window (kalau tidak, satu request
  nyasar dari IP ke-4 akan mengunci 3 IP sah sampai entri tertua
  kedaluwarsa).
- **Sumber IP: hanya `x-9r-real-ip`** (dicap `custom-server.js` dari socket
  TCP, forwarding header palsu di-strip). Tidak pernah dari header yang
  bisa dipalsukan klien (`X-Forwarded-For` dll diabaikan; prefix `::ffff:`
  dikupas). Kalau header tidak ada (mis. `next dev` tanpa custom-server),
  gate fail-open + log debug.
- **Urutan gate**: keyAccess → **IP cap** → RPM — penolakan IP cap tidak
  menghabiskan slot RPM. Gate ada di 10 handler `/v1` (chat, embeddings,
  fetch, image generation, search, STT, systemone, TTS, video generation,
  `v1beta/models`). Kunci tidak dikenal / nonaktif / kedaluwarsa dilewati
  gate ini (ditolak 401 di tempat lain).
- **Pembersihan**: prune per-key di setiap enforcement + sweep global tiap
  5 menit (`startIpUsageSweep`).
- `key_ip_usage` sengaja **tidak** masuk `exportDb`/`importDb` (state
  window sementara).

### Mengatur batas IP

- Web: halaman keys (`EndpointPageClient.js`) — baris "IP aktif: X dari Y"
  + tombol **"Ubah batas IP"** (min 1, max 100). `POST /api/keys` dan
  `PUT /api/keys/[id]` menerima `maxIps`; `GET` list/detail mengembalikan
  `ip: { keyId, cap, source: "key"|"default", activeCount, activeIps,
  resetAtMs }` di samping `rate` (pola yang sama seperti RPM).
- Member melihat baris IP read-only untuk kuncinya sendiri di
  `/dashboard/member`.

### `machineId` (G10) — diabaikan

`apiKeys.machineId` menyimpan ID mesin **lokal** (`getMachineId()`), bukan
binding perangkat per key — tidak ada pengecekan di `keyAccess.js`. IP cap
adalah **satu-satunya** mekanisme binding; memakai `machineId` sebagai
mekanisme kedua akan menciptakan dua binding yang tidak konsisten. Kolom
tetap tersimpan, tetap tidak ditegakkan.

## Parallel Health Scanner

Worker `src/lib/keys/healthScanner.js` + route `GET/POST/DELETE
/api/keys/scan` (admin-only; member 403 eksplisit di route karena
`dashboardGuard` mengizinkan member GET di semua path `/api/keys`).

- Memeriksa **semua koneksi provider aktif** secara paralel: global **10**,
  per-provider **3** (semaphore), timeout per probe 30 detik.
  **Single-flight**: POST kedua saat run berjalan → 409.
- **Klasifikasi**: `healthy` (probe valid) / `limit` (429 / rate-limit /
  quota) / `dead` (invalid / revoked / expired / access-denied /
  no-access-token) / `unknown` (probe tidak didukung, config hilang,
  error jaringan, 5xx, timeout — **tidak pernah klaim mati tanpa bukti**).
- **Tidak ada probe baru (G8)**: scanner memakai ulang
  `testSingleConnection()` dari `src/app/api/providers/[id]/test/testUtils.js`
  — test yang sama dengan tombol "Test Connection" di halaman Providers.
  Inventaris probe → provider tercatat di build log §3 (mis. `GET
  {baseUrl}/v1/models` untuk OpenAI-compat, `POST /v1/messages` untuk
  Anthropic, `loadCodeAssist` untuk gemini-cli/antigravity, dst.).
- **Penyimpanan**: `healthStatus` / `healthCheckedAt` / `healthError` /
  `healthLatencyMs` di **`providerConnections.data` (kolom JSON)** —
  tanpa perubahan skema untuk tabel koneksi.
- **Bulk delete**: `DELETE` hanya menghapus koneksi yang status
  tersimpannya `dead`; id lain di-`skip`, tidak dihapus; respons berisi
  `deleted` + `skipped`.
- **UI**: `/dashboard/scanner` (sidebar "Pemindai Kesehatan") — kartu
  ringkasan (total / sehat / limit / mati / unknown), tombol jalankan,
  polling 2 detik saat run berjalan, filter status, tombol **"hapus yang
  mati" dua langkah** (klik → konfirmasi → hapus).
- **Bukan detector 0d**: scanner mencakup kesehatan *kredensial provider*;
  detector kompensasi (bot `healthProbe.mjs`, probe `/api/health` tiap 60
  dtk) mencakup uptime *gateway*. Sengaja tidak digabung.
