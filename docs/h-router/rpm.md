# Batas RPM (Requests Per Minute)

> Build log: `~/workspace/analysis/9router-rpm-build.md`
> (plan §0c, skema v5). 31/31 unit inti + 36/36 E2E.
> **Belum ada uji beban/konkurensi limiter.**

## Aturan

Setiap kunci API `/v1` punya batas requests-per-minute. Melebihi batas →
HTTP **429** + header `Retry-After` (+ `X-RateLimit-Limit` /
`X-RateLimit-Remaining` / `X-RateLimit-Reset`). Dihitung **per kunci**
(bukan per member — member dengan banyak kunci mendapat batas per kunci),
sliding window 60 detik, **in-memory** (restart server mereset counter —
batasan yang diterima).

## Rantai prioritas

```
apiKeys.rpmLimit  (NULL = warisi)
  → packages.rpmLimit  (NULL = warisi)
  → default trial 20 RPM (hanya kunci trial yang paketnya tanpa rpmLimit)
  → default global di settings (default 50)
  → TIDAK ADA tier unlimited
```

- Default tier **20 / 30 / 50** ascending (pemetaan ke nama paket mengikuti
  paket yang dibuat admin; contoh Starter 20, Pro 30, tier tertinggi 50).
- Trial = **20 RPM** (`TRIAL_DEFAULT_RPM`) — dipakai saat paket trial
  dibuat tanpa rpmLimit dan saat kunci trial di-claim tanpa batas paket.
- Global default **50** (`GLOBAL_DEFAULT_RPM`,
  `settings.defaultRpmLimit`); nilai di luar 1–10000 dinormalisasi ke 50.
- `parseRpmLimit()`: null/"" = warisi; integer 1–10000 (`RPM_MIN=1`,
  `RPM_MAX=10000`); selebihnya error.

## Kunci mana yang dibatasi

- Kunci KNOWN + AKTIF + BELUM KEDALUWARSA → selalu dibatasi (kunci admin
  tanpa paket dan tanpa batas per kunci mendapat default global 50).
- TANPA kunci (local mode) → unlimited di sini.
- Kunci UNKNOWN / INACTIVE / EXPIRED → unlimited di sini (ditolak 401 di
  tempat lain).

## Enforcement

- Satu kali per request klien, tepat setelah gate keyAccess, sebelum
  bypass/combo/credential lookup — request over-limit **tidak pernah
  menyentuh akun provider**, dan satu request combo dihitung **satu**
  request.
- Berlaku di `handleChat` (mencakup `/v1/messages` dan `/v1/responses`)
  plus embeddings, fetch, image generation, search, STT, systemone, TTS,
  video generation, dan `v1beta/models`. **Tidak** di `/v1/models`
  (listing metadata).
- Urutan gate di jalur `/v1`: keyAccess → **IP cap** → **RPM** — penolakan
  IP cap tidak menghabiskan slot RPM (lihat
  [ip-cap-scanner.md](ip-cap-scanner.md)).

## Mengatur RPM

| Tempat | Yang diatur |
|---|---|
| Web: halaman endpoint (editor per kunci) | `rpmLimit` per kunci (null = clear) |
| Web: Paket & Harga (`/dashboard/packages`) | `rpmLimit` per paket |
| Web: Profil (`/dashboard/profile`) | Default RPM global |
| Bot admin: tombol "⚡ RPM" di kunci/paket/settings | Sama seperti web (angka 1–10000; 0/kosong = clear override untuk kunci/paket; global wajib angka) |

Member melihat batas RPM + pemakaian menit berjalan tiap kuncinya
(read-only) di dashboard web dan menu bot (`renderRpm`, mis.
`"RPM: 3/20 per menit (batas paket — Pro)"`).

## Skema (v5)

`apiKeys.rpmLimit` (INTEGER, NULL), `packages.rpmLimit` (INTEGER, NULL),
dan `apiKeys.packageId` (tautan kunci→paket — ditambahkan karena sebelumnya
tidak ada; diisi saat issuance + lazy backfill).
