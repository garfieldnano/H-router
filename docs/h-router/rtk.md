# Token Saver (RTK) + Toggle Per Model

> RTK sudah ada sejak awal 9router (bukan fitur baru H-router). Yang baru
> di G9: **toggle per model**. 15 unit test baru
> (`tests/unit/rtk-model-overrides.test.js`).

## Apa itu RTK

RTK (token saver) mengompres output tool (`git diff`, `grep`, `ls`, `tree`,
logs, …) sebelum masuk ke model — klaim penghematan 20–40% token input
per request (klaim upstream, belum diverifikasi independen di fork ini).
Kompresi berjalan di `handleChatCore` (sebelum translasi, dan setelah
translasi untuk body yang sudah diterjemahkan) — **tidak menyentuh system
message di depan** (terverifikasi saat build #2).

Halaman: **Token Saver** (`/dashboard/token-saver`) — toggle global
"Compress tool output" (RTK), plus Headroom, Caveman, Ponytail, custom
prompt, dan PXPIPE.

## Toggle per model (baru, G9)

Sebelumnya `rtkEnabled` hanya global (settings). Sekarang admin bisa
meng-override per model:

- Penyimpanan: `settings.rtkModelOverrides` — objek
  `{ "provider/model": true|false }`, mis.
  `{ "kimi/k2": false, "codebuddy/claude-sonnet-4-5": true }`.
- **Aturan resolusi**: entri boolean untuk model persis itu menang atas
  global; tidak ada entri = global berlaku (perilaku lama tidak berubah).
- Kunci memakai format `provider/model` yang sama dengan `body.model`
  gateway (mis. `kimi/k2`). Kunci harus cocok persis — provider id
  bersifat case-sensitive di codebase ini.
- **UI** (halaman Token Saver, di bawah toggle global): daftar override
  (model, On/Off + penanda "(same as global)", toggle, tombol Remove) +
  form tambah (input `provider/model` dengan datalist dari `/api/models`,
  tombol "Add: On" / "Add: Off"). Kunci tidak valid (bukan
  `provider/model`) ditolak dengan pesan error; kunci yang sudah ada
  tidak bisa ditambah dua kali.
- **Implementasi**: `src/shared/utils/rtkModel.js`
  (`resolveRtkEnabled(settings, provider, model)`,
  `normalizeRtkModelOverrides`, `setRtkModelOverride`,
  `removeRtkModelOverride`). Dipakai di `src/sse/handlers/chat.js` saat
  memanggil `handleChatCore`. Default settings: `rtkModelOverrides: {}`.
- **Batasan**: `handleResponsesCore`
  (`open-sse/handlers/responsesHandler.js`, handler Workers) tidak
  meneruskan `rtkEnabled` ke `handleChatCore` — tapi tidak ada route di repo
  ini yang memanggilnya (semua route `/v1` — chat/completions, messages,
  responses, responses/compact — lewat `handleChat` di
  `src/sse/handlers/chat.js`, yang memakai flag hasil resolusi). Jadi di
  deployment ini toggle berlaku di semua jalur `/v1` yang memakai RTK.
