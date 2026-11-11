# Dashboard Member (v1)

> Build log: `~/workspace/analysis/9router-member-dashboard-build.md`
> (plan §0, skema v3). 141 unit test + E2E di DATA_DIR terisolasi.

## Aturan peran (diputuskan user)

Member **hanya** melihat usage + kunci API sendiri (read-only). Admin yang
membuat akun member + menetapkan kunci. **Tidak ada** self-registration,
member membuat kunci, katalog model, atau ganti-password member di v1.

## Login member — via API key (bukan password)

- `POST /api/auth/member-login` dengan body `{ apiKey }`.
- Kunci harus aktif **dan** terikat ke member (`apiKeys.memberId`); member
  harus ada + aktif. Kalau lolos → cookie sesi JWT 24 jam
  `{ role: 'member', memberId, keyId, memberName }`.
- Kunci dikirim sekali untuk mendapat sesi; **tidak disimpan di browser**.
- Kunci tak terikat → 403; kunci sampah → 401. Rate-limit memakai
  `loginLimiter` yang sama seperti login admin.
- Halaman `/login` punya tab **Admin / Member**. Login admin menerbitkan
  `{ role: 'admin' }` (token tanpa klaim peran = admin, backward compatible).

## Halaman member — `/dashboard/member`

- Statistik (Requests, Prompt, Completion, Biaya) + penggunaan per model +
  request terbaru + **Kunci API saya** (masked + tombol salin, tanpa tombol
  buat/hapus).
- **Polling tiap 5 detik** ke `/api/usage/history` (skip saat tab
  tersembunyi), pemilih periode: Hari ini / 24 jam / 7 / 30 hari / Semua.
- Kartu **"Hubungkan Telegram"**: minta kode sekali pakai → tampilkan kode
  + link `t.me/<bot>?start=<kode>` (lihat [telegram-bot.md](telegram-bot.md)).

## Halaman admin — `/dashboard/members`

- Buat member (nama + email, **tanpa password**), daftar member (Aktif /
  Nonaktif + tombol aktif/nonaktif), kunci yang ditetapkan per member
  (tombol "Lepas kunci"), dropdown kunci belum ditetapkan + "Tetapkan kunci".
- Satu kunci = satu member; menetapkan ke member lain memindahkan kunci.

## Guard + scoping (defense in depth)

Guard (`src/dashboardGuard.js`) + scoping di tiap route API:

| Member boleh | Member diblokir |
|---|---|
| `GET /api/keys`, `GET /api/keys/[id]` (kunci sendiri) | `POST /api/keys`, `PUT`/`DELETE` kunci → 403 |
| `GET /api/usage/history`, `GET /api/usage/stats` (data sendiri) | `GET /api/settings`, `/api/members`, `/api/providers` → 403 |
| `GET /api/auth/status`, `POST /api/auth/logout` | `GET /api/compensations` hanya riwayat sendiri (lihat [compensation.md](compensation.md)) |
| Halaman `/dashboard/member*` | Halaman dashboard lain → redirect ke `/dashboard/member` |

- Member membaca kunci orang lain via `GET /api/keys/[id]` → **404**
  (bukan 403, supaya keberadaan kunci tidak bocor).
- Agregasi member (`getMemberUsageStats`) dihitung dari baris raw
  `usageHistory` milik kunci member — bukan rollup harian `usageDaily`.
- Sidebar member hanya menampilkan "Dashboard Member"; admin mendapat item
  "Members" di bagian System. Logo sidebar: `public/h-router-logo.svg` +
  heading `h-router`.

## Skema (v3)

- Tabel `members`: `id`, `name`, `email` (UNIQUE), `isActive`, `createdAt`.
  **Tanpa `password_hash`.**
- `apiKeys.memberId` (NULL = kunci admin / tidak ditetapkan) + index.
- `exportDb`/`importDb` membawa `members` + `apiKeys.memberId`.

## Catatan lingkungan

- Di VM ini, halaman dashboard 500 di **Turbopack** dev server karena
  Turbopack gagal mengunduh font `next/font/google` (client HTTP internal
  Turbopack tidak memakai `https_proxy`). Verifikasi dilakukan via server
  **webpack** (`NODE_USE_ENV_PROXY=1 npx next dev --webpack`) — render 200.
  Di mesin tanpa egress proxy, Turbopack kemungkinan normal.
- `GET /api/usage/history?period=all` mengembalikan 0 untuk baris yang
  di-seed langsung ke `usageHistory` — bukan bug: periode `all` memakai
  rollup `usageDaily`, bukan live history.
