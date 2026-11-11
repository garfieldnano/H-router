# Rebranding Model + applyLive

> Build log: `~/workspace/analysis/9router-rebrand-applylive-build.md`
> (plan §2 + G4 + G6, skema v8). 61/61 unit + 139/139 regresi terkait +
> 34/34 E2E.

## Rebranding model (`model_brands`)

Tabel `model_brands`: `id`, `brandModelId` (UNIQUE, format `prefix/nama`
tanpa spasi), `upstreamProvider`, `upstreamModel`, `displayName`,
`isActive`.

- `GET /v1/models` (dan `filterModelsListForKey`) menampilkan nama brand
  menggantikan upstream: satu entri brand per brand aktif,
  **`owned_by: "h-router"`**, `display_name` dari brand; capabilities +
  limit token diwariskan dari entri upstream. Brand nonaktif disembunyikan
  dan entri upstream-nya kembali tampil. Entri combo tidak disentuh.
- Rebrand diterapkan **setelah** filter keyAccess — kunci restricted hanya
  melihat brand yang upstream-nya boleh ia panggil.
- Request masuk dengan brand id di-resolve ke upstream **sebelum** gate
  keyAccess / combo / credential lookup. Allow list kunci restricted
  dievaluasi pada target upstream. `body.model` sengaja **tidak** ditulis
  ulang — raw-request log menyimpan brand yang diminta klien.
- CRUD API: `POST/GET /api/model-brands`, `GET/PUT/DELETE
  /api/model-brands/[id]` — admin-only. Duplikat ditolak.
- Admin UI: **`/dashboard/rebrand`** (tab "Rebranding Model") — CRUD +
  toggle `isActive`, picker upstream dari `/api/models`. Member diblokir
  (API 403, halaman 307).

## applyLive — Live System Prompt Injector (`live_prompts`)

Tabel `live_prompts`: `id`, `brandModelId`, `provider`, `model`,
`systemPrompt`, `mode` (`prepend` | `replace` | `append`), `isActive`.

- **Lookup prioritas**: brand → provider+model persis → provider saja.
  Duplikat pada spesifisitas yang sama ditolak; prompt tanpa target atau
  mode tidak valid ditolak.
- **Injeksi** di `handleSingleModelChat`, **sebelum** `handleChatCore` —
  jadi sebelum RTK (prompt injeksi tidak ikut dikompres token saver) dan
  sebelum translasi (prompt diterjemahkan ke format provider seperti system
  message biasa). Injeksi ke **salinan** body; body asli tidak dimutasi.
- **Mode**: `prepend` = system message baru di index 0 (system message user
  tetap ada setelahnya); `replace` = isi system message pertama diganti
  (sisip di 0 bila tidak ada); `append` = prompt digabung ke system message
  yang ada dengan pemisah `\n\n` (sisip di 0 bila tidak ada). Bentuk konten
  dipertahankan (string tetap string, array parts mendapat text part
  tambahan).
- Injeksi per format sumber: OpenAI → `messages[]`; Claude → `system`;
  Gemini family → `systemInstruction` (termasuk envelope Antigravity);
  Responses → `instructions` (fallback: system item di `input[]`).
  Fail-open: format tak dikenal / body tanpa messages → tidak injeksi.
- CRUD API: `POST/GET /api/live-prompts`, `GET/PUT/DELETE
  /api/live-prompts/[id]` — admin-only.
- Admin UI: **`/dashboard/rebrand`** (tab "System Prompt (applyLive)") —
  CRUD + edit + toggle `isActive`.

## Anti-bocor (no-leak)

Isi prompt **tidak pernah** ditulis ke request details, usage, atau file
log mentah:

- Pesan/field yang hanya berisi prompt → placeholder
  `[live system prompt injected — content hidden]`; prompt yang tergabung
  dengan teks user → hanya segmennya yang hilang, teks user utuh.
- Marker `live_injected: true` dicatat **hanya di metadata internal**.
- Pesan injeksi di wire berupa `{ role, content }` polos — identik dengan
  system message klien, tanpa key tambahan.
- **Batasan**: translator **Kiro** menggabungkan system prompt ke konten
  user turn pertama, sehingga teks prompt tidak bisa dibedakan dari konten
  user — redaksi detail **tidak mencakup target Kiro**. Request details
  bersifat admin-only + API-redacted, jadi dashboard member tetap aman.

## Verifikasi per translator (G4)

Leading system message (bentuk hasil injeksi applyLive) bertahan di semua
pasangan yang diuji: openai → claude, openai → gemini, openai →
openai-responses, openai → openai, claude → openai, gemini → openai,
openai-responses → openai. RTK (`compressMessages`) tidak menyentuh system
message di depan — injeksi-sebelum-RTK aman.
