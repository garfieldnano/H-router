"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Select, Statistic, Typography } from "antd";

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
    ? allModels.map((m) => ({ value: m.id, label: m.ownedBy === "h-router" ? `${m.id} (brand)` : m.id }))
    : brands.map((b) => ({ value: b.id, label: `${b.displayName} → ${b.upstream}` }));

  const keyOptions = [
    { value: "", label: "Otomatis (key aktif pertama)" },
    ...keys.map((k) => ({ value: k.id, label: `${k.name} (${k.maskedKey})` })),
  ];

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

      {error && <Alert type="error" message={error} showIcon />}

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <Card>
          <div className="flex flex-col gap-3">
            <div>
              <Typography.Text strong>Model</Typography.Text>
              <Select
                value={model || undefined}
                onChange={setModel}
                disabled={loadingModels}
                loading={loadingModels}
                options={options}
                placeholder={loadingModels ? "Memuat model…" : options.length === 0 ? "Tidak ada model" : "Pilih model"}
                style={{ width: "100%", marginTop: 4 }}
                showSearch
                optionFilterProp="label"
              />
              {!allModels && (
                <Button
                  onClick={loadAllModels}
                  disabled={loadingAll || loadingModels}
                  loading={loadingAll}
                  style={{ marginTop: 8 }}
                >
                  {loadingAll ? "Memuat semua model…" : "Muat semua model → Playground"}
                </Button>
              )}
              {allModels && <p className="mt-2 text-xs text-text-muted">{allModels.length} model dimuat (brand + upstream).</p>}
            </div>

            <div>
              <Typography.Text strong>API Key (yang dipakai untuk uji)</Typography.Text>
              <Select
                value={apiKeyId}
                onChange={setApiKeyId}
                options={keyOptions}
                style={{ width: "100%", marginTop: 4 }}
              />
              {keys.length === 0 && !loadingModels && (
                <p className="mt-1 text-xs text-warning">Belum ada API key aktif — buat dulu di halaman Endpoint &amp; Key.</p>
              )}
            </div>

            <div>
              <Typography.Text strong>System prompt (opsional)</Typography.Text>
              <Input.TextArea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                placeholder="Instruksi sistem untuk model…"
                style={{ marginTop: 4 }}
              />
            </div>

            <div>
              <Typography.Text strong>Prompt</Typography.Text>
              <Input.TextArea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="Tulis prompt untuk diuji…"
                style={{ marginTop: 4 }}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <Typography.Text strong>Temperature (0–2)</Typography.Text>
                <Input
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="kosong = default"
                  inputMode="decimal"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div className="flex-1">
                <Typography.Text strong>Max tokens</Typography.Text>
                <Input
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                  placeholder="kosong = default"
                  inputMode="numeric"
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>

            <Button
              type="primary"
              onClick={send}
              loading={sending}
              disabled={sending || !model || !prompt.trim()}
            >
              {sending ? "Mengirim…" : "Kirim"}
            </Button>
            {sendError && <Alert type="error" message={sendError} showIcon />}
          </div>
        </Card>

        <Card title="Jawaban">
          {!result ? (
            <p className="text-sm text-text-muted">Jawaban model akan muncul di sini.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-bg-subtle p-3 font-sans text-sm text-text-main">{result.content || "(jawaban kosong)"}</pre>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  ["Token input", (result.usage?.promptTokens ?? 0).toLocaleString("id-ID")],
                  ["Token output", (result.usage?.completionTokens ?? 0).toLocaleString("id-ID")],
                  ["Biaya", result.cost === null || result.cost === undefined ? "—" : `$${Number(result.cost).toFixed(4)}`],
                  ["Finish reason", result.finishReason || "—"],
                ].map(([label, value]) => (
                  <Card key={label} size="small">
                    <Statistic title={label} value={value} />
                  </Card>
                ))}
              </div>
              <p className="text-xs text-text-muted">
                Model: {result.model} · Key: {result.apiKeyName || "—"} · Tercatat di Usage &amp; Trafik Langsung.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
