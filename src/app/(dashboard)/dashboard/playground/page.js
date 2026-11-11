"use client";

import { useCallback, useEffect, useState } from "react";

// Playground (plan G7) — test one model at a time through the gateway.
// The picker shows brand models first; "Muat semua model" loads the full
// upstream catalog into the picker (same list /v1/models serves). Sending
// goes through POST /api/playground/chat, which runs the prompt through
// the gateway's own handleChat() — RPM / IP-cap / key-access gates and
// usage recording apply exactly like a real client call. Always
// non-streaming: one complete answer + its token/cost.
export default function PlaygroundPage() {
  const [brands, setBrands] = useState([]);
  const [allModels, setAllModels] = useState(null);
  const [keys, setKeys] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState("");

  const [model, setModel] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [sendError, setSendError] = useState("");

  const loadBrands = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/playground/models");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat model (${res.status})`);
      setBrands(Array.isArray(data.brands) ? data.brands : []);
      setKeys(Array.isArray(data.keys) ? data.keys : []);
      if (Array.isArray(data.brands) && data.brands.length > 0) setModel(data.brands[0].id);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat model");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);

  const loadAllModels = async () => {
    setLoadingAll(true);
    try {
      const res = await fetch("/api/playground/models?full=1");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal memuat semua model (${res.status})`);
      setAllModels(Array.isArray(data.models) ? data.models : []);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat semua model");
    } finally {
      setLoadingAll(false);
    }
  };

  const options = allModels
    ? allModels.map((m) => ({ id: m.id, label: m.ownedBy === "h-router" ? `${m.id} (brand)` : m.id }))
    : brands.map((b) => ({ id: b.id, label: `${b.displayName} → ${b.upstream}` }));

  const send = async () => {
    setSending(true);
    setSendError("");
    setResult(null);
    try {
      const messages = [];
      if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt.trim() });
      messages.push({ role: "user", content: prompt });
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 120000);
      let res;
      try {
        res = await fetch("/api/playground/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, apiKeyId: apiKeyId || undefined, temperature: temperature || undefined, maxTokens: maxTokens || undefined }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Playground gagal (${res.status})`);
      setResult(data);
    } catch (e) {
      setSendError(e?.name === "AbortError" ? "Waktu habis (120 dtk) — upstream tidak merespons" : (e?.message || "Playground gagal"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Playground</h1>
        <p className="text-sm text-text-muted">
          Uji satu model pada satu waktu lewat gateway — sama seperti klien asli (batas RPM, IP cap, dan pencatatan usage tetap berlaku).
        </p>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loadingModels}
              className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
            >
              {loadingModels ? (
                <option value="">Memuat model…</option>
              ) : options.length === 0 ? (
                <option value="">Tidak ada model</option>
              ) : (
                options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)
              )}
            </select>
            {!allModels && (
              <button
                onClick={loadAllModels}
                disabled={loadingAll || loadingModels}
                className="mt-2 rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle disabled:opacity-50"
              >
                {loadingAll ? "Memuat semua model…" : "Muat semua model → Playground"}
              </button>
            )}
            {allModels && <p className="mt-2 text-xs text-text-muted">{allModels.length} model dimuat (brand + upstream).</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">API Key (yang dipakai untuk uji)</label>
            <select
              value={apiKeyId}
              onChange={(e) => setApiKeyId(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
            >
              <option value="">Otomatis (key aktif pertama)</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ({k.maskedKey})</option>
              ))}
            </select>
            {keys.length === 0 && !loadingModels && (
              <p className="mt-1 text-xs text-warning">Belum ada API key aktif — buat dulu di halaman Endpoint &amp; Key.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">System prompt (opsional)</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={2}
              placeholder="Instruksi sistem untuk model…"
              className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Tulis prompt untuk diuji…"
              className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-text-main">Temperature (0–2)</label>
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="kosong = default"
                inputMode="decimal"
                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-text-main">Max tokens</label>
              <input
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="kosong = default"
                inputMode="numeric"
                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
              />
            </div>
          </div>

          <button
            onClick={send}
            disabled={sending || !model || !prompt.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? "Mengirim…" : "Kirim"}
          </button>
          {sendError && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{sendError}</div>}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-main">Jawaban</h2>
          {!result ? (
            <p className="text-sm text-text-muted">Jawaban model akan muncul di sini.</p>
          ) : (
            <>
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-bg-subtle p-3 font-sans text-sm text-text-main">{result.content || "(jawaban kosong)"}</pre>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <div className="rounded-lg border border-border-subtle p-2">
                  <div className="text-lg font-semibold text-text-main">{(result.usage?.promptTokens ?? 0).toLocaleString("id-ID")}</div>
                  <div className="text-xs text-text-muted">Token input</div>
                </div>
                <div className="rounded-lg border border-border-subtle p-2">
                  <div className="text-lg font-semibold text-text-main">{(result.usage?.completionTokens ?? 0).toLocaleString("id-ID")}</div>
                  <div className="text-xs text-text-muted">Token output</div>
                </div>
                <div className="rounded-lg border border-border-subtle p-2">
                  <div className="text-lg font-semibold text-text-main">{result.cost === null || result.cost === undefined ? "—" : `$${Number(result.cost).toFixed(4)}`}</div>
                  <div className="text-xs text-text-muted">Biaya</div>
                </div>
                <div className="rounded-lg border border-border-subtle p-2">
                  <div className="text-lg font-semibold text-text-main">{result.finishReason || "—"}</div>
                  <div className="text-xs text-text-muted">Finish reason</div>
                </div>
              </div>
              <p className="text-xs text-text-muted">
                Model: {result.model} · Key: {result.apiKeyName || "—"} · Tercatat di Usage &amp; Trafik Langsung.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
