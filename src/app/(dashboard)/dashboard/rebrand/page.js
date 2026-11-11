"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Segmented, Select, Table, Tag, Typography } from "antd";

// Admin-only rebranding + live system prompts (plan #2).
// Brands: client-facing model id (e.g. "h-router/ultra-pro") → upstream
// provider/model. Live prompts: a system prompt injected into the
// request before RTK/translation, per brand, per provider+model, or per
// provider. The prompt text is an admin secret — this page is admin-only
// (dashboard guard + API forbidMember).
const MODES = [
  { value: "prepend", label: "Prepend — di awal (system message baru)" },
  { value: "replace", label: "Replace — ganti system message yang ada" },
  { value: "append", label: "Append — tempel di akhir system message" },
];

function targetLabel(p) {
  if (p.brandModelId) return `Brand ${p.brandModelId}`;
  if (p.provider && p.model) return `${p.provider}/${p.model}`;
  if (p.provider) return `${p.provider} (semua model)`;
  return "—";
}

const BRAND_COLUMNS = (toggleBrand, deleteBrand) => [
  {
    title: "Brand",
    dataIndex: "brandModelId",
    key: "brand",
    render: (_v, b) => (
      <div>
        <div className="font-medium">{b.brandModelId}</div>
        <div className="text-xs text-text-muted">
          → {b.upstreamProvider}/{b.upstreamModel}
        </div>
      </div>
    ),
  },
  { title: "Nama tampil", dataIndex: "displayName", key: "display", render: (v) => v || "—" },
  {
    title: "Status",
    dataIndex: "isActive",
    key: "status",
    render: (v) => <Tag color={v ? "success" : "error"}>{v ? "Aktif" : "Nonaktif"}</Tag>,
  },
  {
    title: "",
    key: "actions",
    render: (_v, b) => (
      <div className="flex gap-2">
        <Button size="small" onClick={() => toggleBrand(b)}>
          {b.isActive ? "Nonaktifkan" : "Aktifkan"}
        </Button>
        <Button size="small" danger onClick={() => deleteBrand(b)}>Hapus</Button>
      </div>
    ),
  },
];

export default function RebrandPage() {
  const [tab, setTab] = useState("brands");
  const [brands, setBrands] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [upstreamModels, setUpstreamModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Brand form
  const [brandId, setBrandId] = useState("");
  const [upstream, setUpstream] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creatingBrand, setCreatingBrand] = useState(false);

  // Live prompt form
  const [targetKind, setTargetKind] = useState("brand");
  const [targetBrand, setTargetBrand] = useState("");
  const [targetUpstream, setTargetUpstream] = useState("");
  const [targetProvider, setTargetProvider] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptMode, setPromptMode] = useState("prepend");
  const [creatingPrompt, setCreatingPrompt] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null); // { id, systemPrompt, mode, isActive }

  // Vision Adapter (plan G10): admin overrides for model vision capability.
  const [visionOverrides, setVisionOverrides] = useState({});
  const [visionKey, setVisionKey] = useState("");
  const [visionValue, setVisionValue] = useState("true");
  const [savingVision, setSavingVision] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, pRes, mRes, vRes] = await Promise.all([
        fetch("/api/model-brands"),
        fetch("/api/live-prompts"),
        fetch("/api/models"),
        fetch("/api/vision-overrides"),
      ]);
      const bData = await bRes.json();
      const pData = await pRes.json();
      const mData = await mRes.json().catch(() => []);
      const vData = await vRes.json().catch(() => ({}));
      if (!bRes.ok) throw new Error(bData?.error || "Gagal memuat brand");
      if (!pRes.ok) throw new Error(pData?.error || "Gagal memuat live prompt");
      setBrands(bData.brands || []);
      setPrompts(pData.prompts || []);
      setUpstreamModels(Array.isArray(mData) ? mData : []);
      setVisionOverrides(vData?.overrides || {});
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upstreamOptions = upstreamModels
    .map((m) => m.fullModel)
    .filter((x) => typeof x === "string" && x.includes("/"))
    .sort();
  const providerOptions = [...new Set(upstreamOptions.map((f) => f.split("/")[0]))].sort();

  const createBrand = async (e) => {
    e.preventDefault();
    setCreatingBrand(true);
    setError("");
    try {
      const slash = upstream.indexOf("/");
      if (slash <= 0) throw new Error("Pilih upstream provider/model dari daftar");
      const res = await fetch("/api/model-brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandModelId: brandId.trim(),
          upstreamProvider: upstream.slice(0, slash),
          upstreamModel: upstream.slice(slash + 1),
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal membuat brand");
      setBrandId("");
      setUpstream("");
      setDisplayName("");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal membuat brand");
    } finally {
      setCreatingBrand(false);
    }
  };

  const toggleBrand = async (b) => {
    setError("");
    try {
      const res = await fetch(`/api/model-brands/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !b.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal mengubah brand");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal mengubah brand");
    }
  };

  const deleteBrand = async (b) => {
    if (!window.confirm(`Hapus brand ${b.brandModelId}? Request dengan id ini akan gagal sebagai model tidak dikenal.`)) return;
    setError("");
    try {
      const res = await fetch(`/api/model-brands/${b.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menghapus brand");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal menghapus brand");
    }
  };

  const createPrompt = async (e) => {
    e.preventDefault();
    setCreatingPrompt(true);
    setError("");
    try {
      const payload = { systemPrompt: promptText, mode: promptMode };
      if (targetKind === "brand") {
        if (!targetBrand) throw new Error("Pilih brand target");
        payload.brandModelId = targetBrand;
      } else if (targetKind === "model") {
        const slash = targetUpstream.indexOf("/");
        if (slash <= 0) throw new Error("Pilih upstream provider/model dari daftar");
        payload.provider = targetUpstream.slice(0, slash);
        payload.model = targetUpstream.slice(slash + 1);
      } else {
        if (!targetProvider) throw new Error("Pilih provider target");
        payload.provider = targetProvider;
      }
      const res = await fetch("/api/live-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal membuat live prompt");
      setPromptText("");
      setPromptMode("prepend");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal membuat live prompt");
    } finally {
      setCreatingPrompt(false);
    }
  };

  const savePromptEdit = async (id) => {
    setError("");
    try {
      const res = await fetch(`/api/live-prompts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: editingPrompt.systemPrompt,
          mode: editingPrompt.mode,
          isActive: editingPrompt.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal mengubah live prompt");
      setEditingPrompt(null);
      await load();
    } catch (err) {
      setError(err?.message || "Gagal mengubah live prompt");
    }
  };

  const deletePrompt = async (p) => {
    if (!window.confirm(`Hapus live prompt untuk ${targetLabel(p)}?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/live-prompts/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menghapus live prompt");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal menghapus live prompt");
    }
  };

  // Vision Adapter: effective vision of an upstream model, from /api/models
  // (the server already applies overrides there, so this IS the enforced value).
  const visionOfUpstream = (provider, model) => {
    const m = upstreamModels.find(
      (x) => x.fullModel === `${provider}/${model}` || x.routedModel === `${provider}/${model}`
    );
    return m?.caps?.vision;
  };
  const overrideForBrand = (b) => {
    if (visionOverrides[b.brandModelId] !== undefined) return visionOverrides[b.brandModelId];
    return visionOverrides[`${b.upstreamProvider}/${b.upstreamModel}`];
  };
  const visionModels = upstreamModels.filter((m) => m?.caps?.vision === true);

  const saveVisionOverride = async (e) => {
    e.preventDefault();
    setSavingVision(true);
    setError("");
    try {
      const key = visionKey.trim();
      if (!key.includes("/")) throw new Error("Key harus berbentuk 'provider/model' (atau id brand)");
      const res = await fetch("/api/vision-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, vision: visionValue === "true" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menyimpan override");
      setVisionKey("");
      setVisionValue("true");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal menyimpan override");
    } finally {
      setSavingVision(false);
    }
  };

  const deleteVisionOverride = async (key) => {
    if (!window.confirm(`Hapus override vision untuk ${key}? Kemampuan kembali mengikuti tabel kapabilitas.`)) return;
    setError("");
    try {
      const res = await fetch(`/api/vision-overrides?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menghapus override");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal menghapus override");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main">Rebranding</h1>
        <p className="text-sm text-text-muted">
          Jual model dengan nama brand sendiri (mis. <code>h-router/ultra-pro</code>) dan suntik system prompt
          live ke request — sebelum RTK dan sebelum translasi. Prompt live hanya terlihat admin di sini.
        </p>
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "brands", label: "Rebranding Model" },
          { value: "prompts", label: "System Prompt (applyLive)" },
          { value: "vision", label: "Vision Adapter" },
        ]}
      />

      {error && <Alert type="error" message={error} showIcon />}

      {tab === "brands" && (
        <>
          <Card title="Buat brand baru">
            <form onSubmit={createBrand} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Brand model id</span>
                <Input value={brandId} onChange={(e) => setBrandId(e.target.value)} required placeholder="h-router/ultra-pro" style={{ width: 220 }} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Upstream provider/model</span>
                <Select
                  value={upstream || undefined}
                  onChange={setUpstream}
                  placeholder="— pilih —"
                  style={{ width: 260 }}
                  showSearch
                  options={upstreamOptions.map((f) => ({ value: f, label: f }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Nama tampil (opsional)</span>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ultra Pro" style={{ width: 180 }} />
              </label>
              <Button type="primary" htmlType="submit" loading={creatingBrand}>
                {creatingBrand ? "Membuat…" : "Buat brand"}
              </Button>
            </form>
            <Typography.Text type="secondary" className="text-xs">
              Brand aktif tampil di /v1/models sebagai <code>owned_by: h-router</code> dan menggantikan entri
              upstream-nya. Brand nonaktif disembunyikan dan request dengan id itu gagal.
            </Typography.Text>
          </Card>

          <Card title="Daftar brand">
            <Table
              columns={BRAND_COLUMNS(toggleBrand, deleteBrand)}
              dataSource={brands}
              rowKey="id"
              loading={loading}
              pagination={false}
              scroll={{ x: 700 }}
              locale={{ emptyText: "Belum ada brand. Buat brand pertama di atas." }}
            />
          </Card>
        </>
      )}

      {tab === "prompts" && (
        <>
          <Card title="Buat live prompt">
            <form onSubmit={createPrompt} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-muted">Target</span>
                  <Select
                    value={targetKind}
                    onChange={setTargetKind}
                    style={{ width: 220 }}
                    options={[
                      { value: "brand", label: "Brand" },
                      { value: "model", label: "Provider + model" },
                      { value: "provider", label: "Satu provider (semua model)" },
                    ]}
                  />
                </label>
                {targetKind === "brand" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-muted">Brand</span>
                    <Select
                      value={targetBrand || undefined}
                      onChange={setTargetBrand}
                      placeholder="— pilih brand —"
                      style={{ width: 220 }}
                      options={brands.filter((b) => b.isActive).map((b) => ({ value: b.brandModelId, label: b.brandModelId }))}
                    />
                  </label>
                )}
                {targetKind === "model" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-muted">Provider/model</span>
                    <Select
                      value={targetUpstream || undefined}
                      onChange={setTargetUpstream}
                      placeholder="— pilih —"
                      style={{ width: 260 }}
                      showSearch
                      options={upstreamOptions.map((f) => ({ value: f, label: f }))}
                    />
                  </label>
                )}
                {targetKind === "provider" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-muted">Provider</span>
                    <Select
                      value={targetProvider || undefined}
                      onChange={setTargetProvider}
                      placeholder="— pilih —"
                      style={{ width: 200 }}
                      options={providerOptions.map((p) => ({ value: p, label: p }))}
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-muted">Mode</span>
                  <Select
                    value={promptMode}
                    onChange={setPromptMode}
                    style={{ width: 280 }}
                    options={MODES.map((m) => ({ value: m.value, label: m.label }))}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">System prompt</span>
                <Input.TextArea value={promptText} onChange={(e) => setPromptText(e.target.value)} required rows={4} placeholder="Kamu adalah asisten yang…" />
              </label>
              <div>
                <Button type="primary" htmlType="submit" loading={creatingPrompt}>
                  {creatingPrompt ? "Menyimpan…" : "Buat live prompt"}
                </Button>
              </div>
            </form>
            <Typography.Text type="secondary" className="text-xs">
              Prioritas: prompt brand mengalahkan prompt provider+model, yang mengalahkan prompt satu provider.
              Prompt disuntik sebelum RTK/translasi dan tidak pernah tersimpan di log/usage.
            </Typography.Text>
          </Card>

          <Card title="Daftar live prompt">
            {loading ? (
              <Typography.Text type="secondary">Memuat…</Typography.Text>
            ) : prompts.length === 0 ? (
              <Typography.Text type="secondary">Belum ada live prompt. Buat yang pertama di atas.</Typography.Text>
            ) : (
              <div className="flex flex-col gap-3">
                {prompts.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-text-main">
                          {targetLabel(p)}{" "}
                          <span className="text-xs text-text-muted">· mode {p.mode}</span>
                        </div>
                        <div className="text-sm text-text-muted">
                          <Tag color={p.isActive ? "success" : "error"}>{p.isActive ? "Aktif" : "Nonaktif"}</Tag>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {editingPrompt?.id === p.id ? (
                          <>
                            <Button type="primary" size="small" onClick={() => savePromptEdit(p.id)}>Simpan</Button>
                            <Button size="small" onClick={() => setEditingPrompt(null)}>Batal</Button>
                          </>
                        ) : (
                          <>
                            <Button size="small" onClick={() => setEditingPrompt({ id: p.id, systemPrompt: p.systemPrompt, mode: p.mode, isActive: p.isActive })}>Ubah</Button>
                            <Button size="small" danger onClick={() => deletePrompt(p)}>Hapus</Button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingPrompt?.id === p.id ? (
                      <div className="flex flex-col gap-2">
                        <Input.TextArea value={editingPrompt.systemPrompt}
                          onChange={(e) => setEditingPrompt({ ...editingPrompt, systemPrompt: e.target.value })} rows={4} />
                        <div className="flex gap-3">
                          <Select value={editingPrompt.mode}
                            onChange={(e) => setEditingPrompt({ ...editingPrompt, mode: e })}
                            style={{ width: 280 }}
                            options={MODES.map((m) => ({ value: m.value, label: m.label }))}
                          />
                          <Checkbox
                            checked={editingPrompt.isActive}
                            onChange={(e) => setEditingPrompt({ ...editingPrompt, isActive: e.target.checked })}
                          >
                            Aktif
                          </Checkbox>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm text-text-muted">{p.systemPrompt}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
      {tab === "vision" && (
        <>
          <Card title="Vision Adapter (G10)">
            <p className="mb-3 text-sm text-text-muted">
              Request berisi gambar hanya dikirim ke model yang bisa baca gambar. Model non-vision ditolak
              dengan error 400 yang menyebut modelnya + alternatif vision-capable — kecuali admin mengaktifkan
              pool vision di capacity adapter (request dialihkan ke sana). Tidak ada jembatan image-to-text.
            </p>
            <h3 className="mb-2 text-sm font-semibold text-text-main">Brand &amp; kemampuan vision upstream-nya</h3>
            {loading ? (
              <Typography.Text type="secondary">Memuat…</Typography.Text>
            ) : brands.length === 0 ? (
              <Typography.Text type="secondary">Belum ada brand. Buat brand dulu di tab Rebranding Model.</Typography.Text>
            ) : (
              <div className="flex flex-col gap-2">
                {brands.map((b) => {
                  const vision = visionOfUpstream(b.upstreamProvider, b.upstreamModel);
                  const override = overrideForBrand(b);
                  return (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3">
                      <div>
                        <div className="font-medium text-text-main">
                          {b.brandModelId}{" "}
                          <span className="text-xs text-text-muted">→ {b.upstreamProvider}/{b.upstreamModel}</span>
                        </div>
                        <div className="text-sm text-text-muted">
                          {vision === true ? (
                            <Tag color="success">Bisa baca gambar (vision)</Tag>
                          ) : vision === false ? (
                            <Tag color="error">Teks saja — request gambar ditolak 400</Tag>
                          ) : (
                            <Tag>Tidak diketahui</Tag>
                          )}
                          {override !== undefined && (
                            <span> · override admin: {override ? "vision" : "teks saja"}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-sm text-text-muted">
              Model vision-capable yang tersedia: {visionModels.length > 0
                ? visionModels.slice(0, 30).map((m) => m.fullModel || m.routedModel).join(", ")
                : "—"}
              {visionModels.length > 30 && ` (+${visionModels.length - 30} lagi)`}
            </p>
          </Card>

          <Card title="Override kemampuan vision">
            <form onSubmit={saveVisionOverride} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Provider/model atau id brand</span>
                <Input value={visionKey} onChange={(e) => setVisionKey(e.target.value)} required
                  placeholder="kimi/kimi-latest atau h-router/ultra" style={{ width: 300 }} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Bisa baca gambar?</span>
                <Select value={visionValue} onChange={setVisionValue}
                  style={{ width: 180 }}
                  options={[
                    { value: "true", label: "Ya — vision" },
                    { value: "false", label: "Tidak — teks saja" },
                  ]}
                />
              </label>
              <Button type="primary" htmlType="submit" loading={savingVision}>
                {savingVision ? "Menyimpan…" : "Simpan override"}
              </Button>
            </form>
            <Typography.Text type="secondary" className="text-xs">
              Override menang atas tabel kapabilitas — dipakai gate chat DAN daftar /v1/models. Berguna saat
              metadata model salah atau belum ada. Kosongkan dengan hapus di bawah.
            </Typography.Text>
            <div className="mt-3 flex flex-col gap-2">
              {Object.keys(visionOverrides).length === 0 ? (
                <Typography.Text type="secondary">Belum ada override.</Typography.Text>
              ) : (
                Object.entries(visionOverrides).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3">
                    <div className="font-medium text-text-main">
                      {key} <span className="text-sm text-text-muted">→ {value ? "vision" : "teks saja"}</span>
                    </div>
                    <Button size="small" danger onClick={() => deleteVisionOverride(key)}>Hapus</Button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
