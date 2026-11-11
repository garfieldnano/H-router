"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Select, Spin, Tag, Typography } from "antd";
import { StatCard } from "@/shared/components/dashboard-cards";

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
        <h1 className="text-xl font-semibold tracking-tight text-text-main">Members</h1>
        <p className="text-sm text-text-muted">
          Member login dengan API key yang ditetapkan admin. Member hanya bisa melihat usage &amp; kunci API mereka sendiri (read-only).
        </p>
      </div>

      {error && <Alert type="error" message={error} showIcon />}

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Member" value={members.length} sub={members.filter((m) => m.isActive).length + " aktif"} />
        <StatCard label="Kunci tak terikat" value={unassignedKeys.length} sub="siap ditetapkan ke member" />
      </div>

      {/* Create member */}
      <Card title="Buat member baru" className="hcard">
        <form onSubmit={createMember} className="flex flex-wrap gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama"
            style={{ width: 220 }}
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            required
            style={{ width: 260 }}
          />
          <Button type="primary" htmlType="submit" loading={creating}>
            {creating ? "Membuat…" : "Buat member"}
          </Button>
        </form>
        <Typography.Text type="secondary" className="text-xs">
          Setelah dibuat, tetapkan API key di bawah — member login dengan kunci itu (tanpa password).
        </Typography.Text>
      </Card>

      {/* Member list */}
      {loading ? (
        <Spin tip="Memuat…" />
      ) : members.length === 0 ? (
        <Typography.Text type="secondary">Belum ada member.</Typography.Text>
      ) : (
        members.map((m) => (
          <Card key={m.id} className="hcard">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-text-main">{m.name || m.email}</div>
                <div className="text-sm text-text-muted">{m.email}</div>
                <div className="text-xs text-text-muted">
                  Dibuat {m.createdAt ? new Date(m.createdAt).toLocaleString("id-ID") : "-"} ·{" "}
                  <Tag color={m.isActive ? "success" : "error"}>{m.isActive ? "Aktif" : "Nonaktif"}</Tag>
                </div>
              </div>
              <Button onClick={() => patchMember(m.id, { isActive: !m.isActive })}>
                {m.isActive ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>

            {/* Assigned keys */}
            <div className="mt-3 flex flex-col gap-2">
              {(m.keys || []).map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-sm">
                  <span className="text-text-main">
                    {k.name || "Unnamed key"} · <span className="hcard-mono font-mono text-xs text-text-muted">{k.keyMasked}</span>{" "}
                    <Tag color={k.isActive ? "success" : "error"}>{k.isActive ? "Aktif" : "Nonaktif"}</Tag>
                  </span>
                  <Button size="small" onClick={() => patchMember(m.id, { unassignKeyId: k.id })}>
                    Lepas kunci
                  </Button>
                </div>
              ))}
              {unassignedKeys.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={assignKey[m.id] || ""}
                    onChange={(v) => setAssignKey((s) => ({ ...s, [m.id]: v }))}
                    placeholder="Pilih kunci untuk ditetapkan…"
                    style={{ width: 320 }}
                    options={[
                      { value: "", label: "Pilih kunci untuk ditetapkan…" },
                      ...unassignedKeys.map((k) => ({
                        value: k.id,
                        label: `${k.name || "Unnamed key"} (${k.keyMasked})`,
                      })),
                    ]}
                  />
                  <Button
                    type="primary"
                    disabled={!assignKey[m.id]}
                    onClick={() => {
                      patchMember(m.id, { assignKeyId: assignKey[m.id] });
                      setAssignKey((s) => ({ ...s, [m.id]: "" }));
                    }}
                  >
                    Tetapkan kunci
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
