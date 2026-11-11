"use client";

import { useCallback, useEffect, useState } from "react";

// Admin-only member management (v1): list/create members, activate/deactivate,
// assign/unassign API keys. Members have no password — they log in with an
// assigned API key (POST /api/auth/member-login).
export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [unassignedKeys, setUnassignedKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [assignKey, setAssignKey] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/members");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat members");
      setMembers(data.members || []);
      setUnassignedKeys(data.unassignedKeys || []);
      setError("");
    } catch (e) {
      setError(e?.message || "Gagal memuat members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createMember = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal membuat member");
      setName("");
      setEmail("");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal membuat member");
    } finally {
      setCreating(false);
    }
  };

  const patchMember = async (id, body) => {
    setError("");
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memperbarui member");
      await load();
    } catch (err) {
      setError(err?.message || "Gagal memperbarui member");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main">Members</h1>
        <p className="text-sm text-text-muted">
          Member login dengan API key yang ditetapkan admin. Member hanya bisa melihat usage &amp; kunci API mereka sendiri (read-only).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-text-main">{error}</div>
      )}

      {/* Create member */}
      <form onSubmit={createMember} className="bg-surface-2 border border-border-subtle rounded-lg p-4">
        <h2 className="mb-3 text-lg font-semibold text-text-main">Buat member baru</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            required
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Membuat…" : "Buat member"}
          </button>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Setelah dibuat, tetapkan API key di bawah — member login dengan kunci itu (tanpa password).
        </p>
      </form>

      {/* Member list */}
      {loading ? (
        <p className="text-sm text-text-muted">Memuat…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-text-muted">Belum ada member.</p>
      ) : (
        members.map((m) => (
          <div key={m.id} className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-text-main">{m.name || m.email}</div>
                <div className="text-sm text-text-muted">{m.email}</div>
                <div className="text-xs text-text-muted">
                  Dibuat {m.createdAt ? new Date(m.createdAt).toLocaleString("id-ID") : "-"} ·{" "}
                  <span className={m.isActive ? "text-success" : "text-error"}>
                    {m.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => patchMember(m.id, { isActive: !m.isActive })}
                className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-text-main hover:bg-bg-hover"
              >
                {m.isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </div>

            {/* Assigned keys */}
            <div className="mt-3 flex flex-col gap-2">
              {(m.keys || []).map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2 text-sm">
                  <span className="text-text-main">
                    {k.name || "Unnamed key"} · <span className="font-mono text-xs text-text-muted">{k.keyMasked}</span>{" "}
                    <span className={k.isActive ? "text-success" : "text-error"}>{k.isActive ? "· Aktif" : "· Nonaktif"}</span>
                  </span>
                  <button
                    onClick={() => patchMember(m.id, { unassignKeyId: k.id })}
                    className="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-xs text-text-main hover:bg-bg-hover"
                  >
                    Lepas kunci
                  </button>
                </div>
              ))}
              {unassignedKeys.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={assignKey[m.id] || ""}
                    onChange={(e) => setAssignKey((s) => ({ ...s, [m.id]: e.target.value }))}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Pilih kunci untuk ditetapkan…</option>
                    {unassignedKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name || "Unnamed key"} ({k.keyMasked})
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!assignKey[m.id]}
                    onClick={() => {
                      patchMember(m.id, { assignKeyId: assignKey[m.id] });
                      setAssignKey((s) => ({ ...s, [m.id]: "" }));
                    }}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Tetapkan kunci
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
