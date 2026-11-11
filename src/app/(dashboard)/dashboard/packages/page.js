"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Select, Spin, Tag, Typography } from "antd";
import { StatCard } from "@/shared/components/dashboard-cards";

// Admin-only packages management (v1): create/edit/deactivate packages sold
// via the Telegram bot. Prices are INTEGER rupiah, admin-editable here and
// in the bot admin panel — never hardcoded.
function fmtIdr(n) {
  return `Rp${Number(n || 0).toLocaleString("id-ID")}`;
}

export default function PackagesPage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [type, setType] = useState("paid");
  const [note, setNote] = useState("");
  const [rpmLimit, setRpmLimit] = useState("");
  const [globalRpm, setGlobalRpm] = useState(50);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // { id, price, isActive, rpmLimit }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/packages");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat paket");
      setPackages(data.packages || []);
      setError("");
      // Global default RPM (for the "ikut global" label).
      const sRes = await fetch("/api/settings");
      const sData = await sRes.json().catch(() => ({}));
      if (sRes.ok && sData?.defaultRpmLimit != null) setGlobalRpm(sData.defaultRpmLimit);
    } catch (e) {
      setError(e?.message || "Gagal memuat paket");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createPackage = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          price: Number(price),
          durationDays: Number(durationDays),
          type,
          access: note ? { note } : {},
          // RPM: empty = inherit (trial → 20, paid → global default).
          rpmLimit: rpmLimit === "" ? null : Number(rpmLimit),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal membuat paket");
      setName("");
      setPrice("");
      setDurationDays("30");
      setType("paid");
      setNote("");
      setRpmLimit("");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal membuat paket");
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async (id) => {
    setError("");
    try {
      const res = await fetch(`/api/packages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: Number(editing.price),
          isActive: editing.isActive,
          // RPM: empty = inherit (trial → 20, paid → global default).
          rpmLimit: editing.rpmLimit === "" ? null : Number(editing.rpmLimit),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal mengubah paket");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.message || "Gagal mengubah paket");
    }
  };

  const deletePkg = async (id) => {
    if (!window.confirm("Hapus paket ini? Order yang sudah ada tidak terpengaruh.")) return;
    setError("");
    try {
      const res = await fetch(`/api/packages/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menghapus paket");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal menghapus paket");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-main">Paket &amp; Harga</h1>
        <p className="text-sm text-text-muted">
          Paket yang dijual lewat bot Telegram. Harga bisa diubah kapan saja — dari sini atau dari panel admin bot.
          Paket trial gratis (1 hari, sekali per pengguna) dibuat dengan tipe Trial.
        </p>
      </div>

      {error && <Alert type="error" message={error} showIcon />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Paket" value={packages.length} sub={packages.filter((p) => p.isActive).length + " aktif"} />
        <StatCard label="Paket Trial" value={packages.filter((p) => p.type === "trial").length} sub="gratis 1 hari, sekali per pengguna" />
        <StatCard label="RPM Global" value={globalRpm} sub="dipakai paket tanpa RPM sendiri" />
      </div>

      <Card title="Buat paket baru" className="hcard">
        <form onSubmit={createPackage} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Nama</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Basic 30 hari" style={{ width: 180 }} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Harga (Rp)</span>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="numeric" placeholder="150000" style={{ width: 140 }} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Durasi (hari)</span>
            <Input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} required inputMode="numeric" placeholder="30" style={{ width: 110 }} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Tipe</span>
            <Select
              value={type}
              onChange={setType}
              style={{ width: 150 }}
              options={[
                { value: "paid", label: "Berbayar" },
                { value: "trial", label: "Trial (gratis)" },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">RPM (opsional)</span>
            <Input value={rpmLimit} onChange={(e) => setRpmLimit(e.target.value)} inputMode="numeric" placeholder="kosong = ikut default" style={{ width: 170 }} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Catatan (opsional)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Akses semua model" style={{ width: 180 }} />
          </label>
          <Button type="primary" htmlType="submit" loading={creating}>
            {creating ? "Membuat…" : "Buat paket"}
          </Button>
        </form>
      </Card>

      <Card title="Daftar paket" className="hcard">
        {loading ? (
          <Spin tip="Memuat…" />
        ) : packages.length === 0 ? (
          <Typography.Text type="secondary">Belum ada paket. Buat paket pertama di atas — bot tidak bisa menjual apa pun tanpa paket.</Typography.Text>
        ) : (
          <div className="flex flex-col gap-3">
            {packages.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-subtle p-3">
                <div>
                  <div className="font-medium text-text-main">
                    {p.name}{" "}
                    <span className="text-xs text-text-muted">
                      ({p.type === "trial" ? "Trial" : "Berbayar"} · {p.durationDays} hari)
                    </span>
                  </div>
                  <div className="text-sm text-text-muted">
                    {editing?.id === p.id ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        Rp
                        <Input value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                          inputMode="numeric" style={{ width: 110 }} />
                        <label className="inline-flex items-center gap-1">
                          RPM
                          <Input value={editing.rpmLimit} onChange={(e) => setEditing({ ...editing, rpmLimit: e.target.value })}
                            inputMode="numeric" placeholder="ikut default" style={{ width: 90 }} />
                        </label>
                        <Checkbox
                          checked={editing.isActive}
                          onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                        >
                          Aktif
                        </Checkbox>
                      </span>
                    ) : (
                      <span>
                        <span className="hcard-mono">{fmtIdr(p.price)}</span> ·{" "}
                        <Tag color={p.isActive ? "success" : "error"}>{p.isActive ? "Aktif" : "Nonaktif"}</Tag>
                        {p.access?.note ? ` · ${p.access.note}` : ""}
                        {` · RPM: ${p.rpmLimit != null ? p.rpmLimit : p.type === "trial" ? "20 (default trial)" : `ikut global (${globalRpm})`}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {editing?.id === p.id ? (
                    <>
                      <Button type="primary" onClick={() => saveEdit(p.id)}>Simpan</Button>
                      <Button onClick={() => setEditing(null)}>Batal</Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => setEditing({ id: p.id, price: String(p.price), isActive: p.isActive, rpmLimit: p.rpmLimit != null ? String(p.rpmLimit) : "" })}>
                        Ubah harga
                      </Button>
                      <Button danger onClick={() => deletePkg(p.id)}>Hapus</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
