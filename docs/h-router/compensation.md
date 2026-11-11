# Kompensasi Gangguan (Downtime Compensation)

> Build log: `~/workspace/analysis/9router-compensation-build.md`
> (plan §0d, skema v6). 44/44 unit + 32/32 E2E.
> **Belum ada uji beban/konkurensi grant simultan.**

## Bentuk kompensasi

**Perpanjangan masa aktif kunci** (`apiKeys.expiresAt`) — bukan kredit
kuota. Grant menambah jam ke masa berlaku kunci yang terdampak.

| Durasi gangguan | Kompensasi |
|---|---|
| < 1 jam | +1 jam |
| 1–3 jam | +3 jam |
| 3–5 jam | +5 jam |
| > 5 jam | +8 jam |

Batas band: tepat 60 menit = band 1–3 jam (+3j); tepat 180 menit = +3j;
tepat 300 menit = +5j. Kalau kunci sudah kedaluwarsa, perpanjangan
dihitung **dari sekarang** (bukan dari expiry lama — kalau tidak, grant ke
kunci kedaluwarsa tidak ada efeknya).

## Pemberian: manual oleh admin (tidak pernah otomatis)

Sistem hanya **mendeteksi + mencatat** insiden. Admin memberi kompensasi
via:

- Web: halaman **`/dashboard/compensations`** (admin) — daftar insiden →
  detail → pilih member → kunci → tier → terapkan.
- Bot admin: tombol **"🚨 Insiden & Kompensasi"** → insiden → member →
  kunci → tier → terapkan. Tier default dari durasi insiden (ditandai ⭐)
  dan bisa di-override per grant (1/3/5/8).

Aturan grant (ditegakkan atomik di transaksi + UNIQUE index):

- Satu pasangan (insiden, kunci) hanya bisa dikompensasi **sekali**
  (`UNIQUE (incidentId, keyId)`) — grant kedua ditolak 409.
- Ditolak dengan pesan jelas (tanpa silent no-op): insiden/kunci tidak ada
  (404), kunci nonaktif (409), kunci tanpa `expiresAt` (409 — kunci tanpa
  masa berlaku tidak bisa diperpanjang), tier bukan 1/3/5/8 (400).
- Member yang terhubung ke Telegram diberitahu saat grant diterapkan.
- Member melihat riwayat kompensasinya sendiri (read-only) di dashboard web
  ("Riwayat Kompensasi") dan menu bot ("🎁 Kompensasi"). Member **tidak**
  bisa melihat `/api/incidents` (403).

## Deteksi insiden (minimal — bukan scanner #5)

Detector berjalan di **proses bot** (`src/bot-telegram/healthProbe.mjs`,
failure domain terpisah dari server Next.js, jadi tetap bisa mencatat saat
gateway mati):

- Probe `<webUrl>/api/health` tiap **60 detik** (timeout 10 dtk);
  **3 gagal beruntun** → insiden dibuka (`startedAt` = kegagalan pertama);
  pulih → insiden ditutup dengan durasi.
- Gateway terjangkau tapi error rate **> 50%** dalam 5 menit terakhir
  (min. 10 request) → insiden juga dibuka (reason `error-rate`).
- Owner diberitahu saat insiden dibuka dan ditutup.
- Maksimal satu insiden open per scope (`gateway`; scope `provider`
  dicadangkan untuk scanner #5).

Env opsional: `HROUTER_HEALTH_PROBE_INTERVAL_MS` (min 5 dtk),
`HROUTER_HEALTH_PROBE_FAILURES` (min 1).

## Batasan yang diketahui

- **Deteksi hanya berjalan selama proses bot hidup.** Kalau bot mati saat
  gangguan, insiden tidak tercatat otomatis — dan **belum ada cara membuat
  insiden manual** (tidak ada endpoint admin `POST /api/incidents`).
  Gangguan yang terjadi saat bot down tidak punya jalur kompensasi.
- Scanner kesehatan provider (#5) mencakup kesehatan *kredensial
  provider*; detector ini mencakup uptime *gateway*. Sengaja tidak digabung.

## Skema (v6)

- `system_incidents`: `id`, `scope`, `reason` (`unreachable` | `timeout` |
  `http-5xx` | `health-not-ok` | `error-rate`), `status` (`open` |
  `closed`), `startedAt`, `endedAt`, `durationMinutes` (NULL saat open),
  `lastSeenAt`, `createdAt`, `updatedAt`.
- `compensations`: `id`, `memberId` (nullable — kunci tanpa member tetap
  bisa diberi), `keyId`, `incidentId`, `type` (`'hours'`), `amount` (jam),
  `grantedAt`, `grantedBy` (`'admin'`), `oldExpiresAt`, `newExpiresAt`.
