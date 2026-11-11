"use client";

import { useCallback, useEffect, useState } from "react";

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
        <h1 className="text-2xl font-bold text-text-main">Paket &amp; Harga</h1>
        <p className="text-sm text-text-muted">
          Paket yang dijual lewat bot Telegram. Harga bisa diubah kapan saja — dari sini atau dari panel admin bot.
          Paket trial gratis (1 hari, sekali per pengguna) dibuat dengan tipe Trial.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Buat paket baru</h2>
        <form onSubmit={createPackage} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Nama</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" placeholder="Basic 30 hari" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Harga (Rp)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="numeric"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" placeholder="150000" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Durasi (hari)</span>
            <input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} required inputMode="numeric"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" placeholder="30" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Tipe</span>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main">
              <option value="paid">Berbayar</option>
              <option value="trial">Trial (gratis)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">RPM (opsional)</span>
            <input value={rpmLimit} onChange={(e) => setRpmLimit(e.target.value)} inputMode="numeric"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" placeholder="kosong = ikut default" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Catatan (opsional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" placeholder="Akses semua model" />
          </label>
          <button type="submit" disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {creating ? "Membuat…" : "Buat paket"}
          </button>
        </form>
      </div>

      <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Daftar paket</h2>
        {loading ? (
          <p className="text-sm text-text-muted">Memuat…</p>
        ) : packages.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada paket. Buat paket pertama di atas — bot tidak bisa menjual apa pun tanpa paket.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {packages.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-subtle p-3">
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
                        <input value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                          inputMode="numeric" className="w-28 rounded border border-border-subtle bg-surface px-2 py-1 text-text-main" />
                        <label className="inline-flex items-center gap-1">
                          RPM
                          <input value={editing.rpmLimit} onChange={(e) => setEditing({ ...editing, rpmLimit: e.target.value })}
                            inputMode="numeric" placeholder="ikut default" className="w-20 rounded border border-border-subtle bg-surface px-2 py-1 text-text-main" />
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input type="checkbox" checked={editing.isActive}
                            onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                          Aktif
                        </label>
                      </span>
                    ) : (
                      <span>
                        {fmtIdr(p.price)} ·{" "}
                        <span className={p.isActive ? "text-success" : "text-error"}>{p.isActive ? "Aktif" : "Nonaktif"}</span>
                        {p.access?.note ? ` · ${p.access.note}` : ""}
                        {` · RPM: ${p.rpmLimit != null ? p.rpmLimit : p.type === "trial" ? "20 (default trial)" : `ikut global (${globalRpm})`}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {editing?.id === p.id ? (
                    <>
                      <button onClick={() => saveEdit(p.id)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white">Simpan</button>
                      <button onClick={() => setEditing(null)}
                        className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main">Batal</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditing({ id: p.id, price: String(p.price), isActive: p.isActive, rpmLimit: p.rpmLimit != null ? String(p.rpmLimit) : "" })}
                        className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main">Ubah harga</button>
                      <button onClick={() => deletePkg(p.id)}
                        className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-error">Hapus</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
