"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button, Card, Checkbox, Input, Modal, Switch, Tag } from "antd";
import { useNotificationStore } from "@/store/notificationStore";

// Small label+hint wrapper (replaces the shared Input's built-in label/hint).
function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label ? <span className="text-text-muted">{label}</span> : null}
      {children}
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </label>
  );
}

function getStatusVariant(status) {
  if (status === "active") return "success";
  if (status === "error") return "error";
  return "default";
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function normalizeFormData(data = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [showDenoModal, setShowDenoModal] = useState(false);
  const [showNetlifyModal, setShowNetlifyModal] = useState(false);
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [cloudflareForm, setCloudflareForm] = useState({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
  const [denoForm, setDenoForm] = useState({ denoToken: "", orgDomain: "", projectName: "" });
  const [netlifyForm, setNetlifyForm] = useState({ netlifyToken: "", projectName: "netlify-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  // Egress relay rotation (plan #1): per-pool ban state + per-provider
  // auto-rotate switches.
  const [egressById, setEgressById] = useState({});
  const [autoRotateProviders, setAutoRotateProviders] = useState([]);
  const [providerStrategies, setProviderStrategies] = useState({});
  const [autoRotateSaving, setAutoRotateSaving] = useState(null);
  const relayMenuRef = useRef(null);
  const notify = useNotificationStore();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (relayMenuRef.current && !relayMenuRef.current.contains(e.target)) {
        setShowRelayMenu(false);
      }
    };
    if (showRelayMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRelayMenu]);

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProxyPools();
  }, [fetchProxyPools]);

  const fetchEgress = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools/egress", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        const map = {};
        for (const r of data.relays || []) map[r.id] = r;
        setEgressById(map);
      }
    } catch (error) {
      console.log("Error fetching egress relay status:", error);
    }
  }, []);

  const fetchAutoRotate = useCallback(async () => {
    try {
      const [connRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connData = connRes.ok ? await connRes.json() : {};
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      setProviderStrategies(settingsData.providerStrategies || {});
      const byProvider = new Map();
      for (const c of connData.connections || []) {
        const poolId = c?.providerSpecificData?.proxyPoolId;
        if (!poolId) continue;
        const entry = byProvider.get(c.provider) || { providerId: c.provider, poolIds: new Set() };
        entry.poolIds.add(poolId);
        byProvider.set(c.provider, entry);
      }
      setAutoRotateProviders(
        [...byProvider.values()]
          .map((e) => ({ providerId: e.providerId, poolCount: e.poolIds.size }))
          .sort((a, b) => a.providerId.localeCompare(b.providerId))
      );
    } catch (error) {
      console.log("Error fetching auto-rotate providers:", error);
    }
  }, []);

  useEffect(() => {
    fetchEgress();
    fetchAutoRotate();
    const timer = setInterval(fetchEgress, 30000);
    return () => clearInterval(timer);
  }, [fetchEgress, fetchAutoRotate]);

  const handleClearBan = async (poolId) => {
    try {
      const res = await fetch("/api/proxy-pools/egress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolId, action: "clear" }),
      });
      if (res.ok) {
        await fetchEgress();
        notify.success("Relay ban cleared");
      } else {
        notify.error("Failed to clear relay ban");
      }
    } catch (error) {
      console.log("Error clearing relay ban:", error);
      notify.error("Failed to clear relay ban");
    }
  };

  const handleToggleAutoRotate = async (providerId, next) => {
    setAutoRotateSaving(providerId);
    const prev = providerStrategies;
    const updated = { ...prev, [providerId]: { ...(prev[providerId] || {}), autoRotate: next } };
    setProviderStrategies(updated);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      if (!res.ok) {
        setProviderStrategies(prev);
        notify.error("Failed to update auto-rotate");
      }
    } catch (error) {
      console.log("Error updating auto-rotate:", error);
      setProviderStrategies(prev);
      notify.error("Failed to update auto-rotate");
    } finally {
      setAutoRotateSaving(null);
    }
  };

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        notify.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.log("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
          if (res.ok) {
            setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
            notify.success("Proxy pool deleted");
            return;
          }

          const data = await res.json();
          if (res.status === 409) {
            notify.warning(`Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`);
          } else {
            notify.error(data.error || "Failed to delete proxy pool");
          }
        } catch (error) {
          console.log("Error deleting proxy pool:", error);
          notify.error("Failed to delete proxy pool");
        }
      }
    });
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
      notify.success(data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.log("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: next } : p));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
        notify.error("Failed to update active state");
      }
    } catch (error) {
      console.log("Error toggling active:", error);
      setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
    }
  };

  const allSelected = proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : proxyPools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : proxyPools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      for (const id of targets) {
        try {
          const res = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          let ok = 0; let blocked = 0; let failed = 0;
          for (const id of selectedIds) {
            try {
              const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
              if (res.ok) ok += 1;
              else if (res.status === 409) blocked += 1;
              else failed += 1;
            } catch { failed += 1; }
          }
          await fetchProxyPools();
          clearSelection();
          notify.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`);
        } finally {
          setBulkBusy(false);
        }
      }
    });
  };

  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? proxyPools.filter((p) => selectedIds.includes(p.id))
      : proxyPools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0; const deadIds = [];
    let done = 0;
    const CONCURRENCY = 10;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const res = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data = await res.json();
          if (res.ok && data.ok) alive += 1; else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      setConfirmState({
        title: "Disable Dead Proxies",
        message: `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
        onConfirm: async () => {
          setConfirmState(null);
          setBulkBusy(true);
          try {
            for (const id of deadIds) {
              try {
                await fetch(`/api/proxy-pools/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: false }),
                });
              } catch {}
            }
            await fetchProxyPools();
            notify.success(`Disabled ${deadIds.length} dead proxies`);
          } finally {
            setBulkBusy(false);
          }
        }
      });
    } else {
      notify.success(`Health check done. Alive: ${alive}, Dead: ${deadIds.length}`);
    }
  };

  // Cleanup selectedIds when pools change
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => proxyPools.some((p) => p.id === id)));
  }, [proxyPools]);

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const openCloudflareModal = () => {
    setCloudflareForm({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
    setShowCloudflareModal(true);
  };

  const closeCloudflareModal = () => {
    if (deploying) return;
    setShowCloudflareModal(false);
  };

  const openDenoModal = () => {
    setDenoForm({ denoToken: "", orgDomain: "", projectName: "" });
    setShowDenoModal(true);
  };

  const closeDenoModal = () => {
    if (deploying) return;
    setShowDenoModal(false);
  };

  const openNetlifyModal = () => {
    setNetlifyForm({ netlifyToken: "", projectName: "netlify-relay" });
    setShowNetlifyModal(true);
  };

  const closeNetlifyModal = () => {
    if (deploying) return;
    setShowNetlifyModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeVercelModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Vercel relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleCloudflareDeploy = async () => {
    if (!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/cloudflare-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloudflareForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeCloudflareModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Cloudflare relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleDenoDeploy = async () => {
    if (!denoForm.denoToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/deno-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(denoForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeDenoModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Deno relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleNetlifyDeploy = async () => {
    if (!netlifyForm.netlifyToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/netlify-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netlifyForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeNetlifyModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Netlify relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const parseProxyLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${hostLabel}`,
      };
    }

    const parts = trimmed.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (!host || !port || !username || !password) {
        throw new Error("Invalid host:port:user:pass format");
      }

      const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
      const parsed = new URL(proxyUrl);
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${host}:${port}`,
      };
    }

    throw new Error("Unsupported format");
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`)
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.log("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <Card loading />
        <Card loading />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Proxy Pools</h1>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <div className="relative" ref={relayMenuRef}>
            <Button
              size="small"
              icon={<span className="material-symbols-outlined text-[18px]">rocket_launch</span>}
              onClick={() => setShowRelayMenu(!showRelayMenu)}
            >
              Deploy Relay
              <span className="material-symbols-outlined ml-1 text-[18px]">
                {showRelayMenu ? "expand_less" : "expand_more"}
              </span>
            </Button>

            {showRelayMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-white p-1 dark:bg-[#111111] sm:left-auto sm:right-0">
                <button
                  onClick={() => {
                    openCloudflareModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-orange-500">cloud</span>
                  Cloudflare Relay
                </button>
                <button
                  onClick={() => {
                    openVercelModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-blue-500">cloud_upload</span>
                  Vercel Relay
                </button>
                <button
                  onClick={() => {
                    openDenoModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-green-500">terminal</span>
                  Deno Relay
                </button>
                <button
                  onClick={() => {
                    openNetlifyModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-teal-500">deployed_code</span>
                  Netlify Relay
                </button>
              </div>
            )}
          </div>

          <Button size="small" icon={<span className="material-symbols-outlined text-[18px]">upload</span>} onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <Button size="small" type="primary" icon={<span className="material-symbols-outlined text-[18px]">add</span>} onClick={openCreateModal}>Add Proxy Pool</Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {proxyPools.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <Checkbox checked={allSelected} onChange={toggleSelectAll} />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          )}
          <Tag>Total: {proxyPools.length}</Tag>
          <Tag color="success">Active: {activeCount}</Tag>
        </div>

        {(selectedIds.length > 0 || healthChecking) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
            <span className="text-xs font-medium text-primary">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "All pools"}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="small"
                type="primary"
                icon={<span className="material-symbols-outlined text-[18px]">{healthChecking ? "progress_activity" : "health_and_safety"}</span>}
                onClick={handleHealthCheck}
                disabled={healthChecking || bulkBusy || proxyPools.length === 0}
              >
                {healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health Check"}
              </Button>
              {selectedIds.length > 0 && (
                <>
                  <Button size="small" icon={<span className="material-symbols-outlined text-[18px]">toggle_on</span>} onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>
                    Activate
                  </Button>
                  <Button size="small" icon={<span className="material-symbols-outlined text-[18px]">toggle_off</span>} onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>
                    Deactivate
                  </Button>
                  <Button size="small" icon={<span className="material-symbols-outlined text-[18px]">delete</span>} onClick={bulkDelete} disabled={bulkBusy || healthChecking}>
                    Delete
                  </Button>
                  <Button size="small" type="text" onClick={clearSelection} disabled={bulkBusy || healthChecking}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pool entries yet</p>
            <p className="text-sm text-text-muted mb-4">
              Create a proxy pool entry, then assign it to connections.
            </p>
            <Button type="primary" icon={<span className="material-symbols-outlined text-[18px]">add</span>} onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {proxyPools.map((pool) => (
              <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <Checkbox
                    checked={selectedIds.includes(pool.id)}
                    onChange={() => toggleSelect(pool.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                    <Tag color={getStatusVariant(pool.testStatus)}>
                      {pool.testStatus || "unknown"}
                    </Tag>
                    <Tag color={pool.isActive ? "success" : "default"}>
                      {pool.isActive ? "active" : "inactive"}
                    </Tag>
                    {pool.type === "vercel" && (
                      <Tag>vercel relay</Tag>
                    )}
                    {pool.type === "cloudflare" && (
                      <Tag>cloudflare relay</Tag>
                    )}
                    {pool.type === "deno" && (
                      <Tag>deno relay</Tag>
                    )}
                    {pool.type === "netlify" && (
                      <Tag>netlify relay</Tag>
                    )}
                    <Tag>
                      {pool.boundConnectionCount || 0} bound
                    </Tag>
                    {(() => {
                      const relay = egressById[pool.id];
                      if (!relay) return null;
                      if (relay.status === "banned") {
                        return (
                          <>
                            <Tag color="error">
                              relay banned{relay.bannedUntil ? ` until ${new Date(relay.bannedUntil).toLocaleTimeString()}` : ""}
                            </Tag>
                            <button
                              onClick={() => handleClearBan(pool.id)}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              Clear ban
                            </button>
                          </>
                        );
                      }
                      if (relay.status === "cooldown") return <Tag color="warning">relay cooldown</Tag>;
                      return <Tag color="success">relay healthy</Tag>;
                    })()}
                  </div>
                  <p className="text-xs text-text-muted truncate mt-1">{pool.proxyUrl}</p>
                  {pool.noProxy ? (
                    <p className="text-xs text-text-muted truncate">No proxy: {pool.noProxy}</p>
                  ) : null}
                  <p className="text-[11px] text-text-muted mt-1">
                    Last tested: {formatDateTime(pool.lastTestedAt)}
                    {pool.lastError ? ` · ${pool.lastError}` : ""}
                  </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1">
                  <Switch
                    size="small"
                    checked={pool.isActive === true}
                    onChange={() => handleToggleActive(pool)}
                    title={pool.isActive ? "Disable" : "Enable"}
                  />
                  <button
                    onClick={() => handleTest(pool.id)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Test proxy"
                    disabled={testingId === pool.id}
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      style={testingId === pool.id ? { animation: "spin 1s linear infinite" } : undefined}
                    >
                      {testingId === pool.id ? "progress_activity" : "science"}
                    </span>
                  </button>
                  <button
                    onClick={() => openEditModal(pool)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Edit"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(pool)}
                    className="p-2 rounded hover:bg-red-500/10 text-red-500"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2">
          <h2 className="text-base font-semibold">Egress Auto-Rotate</h2>
          <p className="text-xs text-text-muted mt-1">
            When upstream answers 403 Abusive Traffic, the request retries through the next relay for the same provider instead of burning the account. 429 keeps the existing account rotation; 400/11128 never rotates.
          </p>
        </div>
        {autoRotateProviders.length === 0 ? (
          <p className="text-sm text-text-muted py-2">
            No provider has a connection bound to a proxy pool yet — bind a pool to a connection to enable rotation for that provider.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {autoRotateProviders.map(({ providerId, poolCount }) => {
              const enabled = (providerStrategies[providerId] || {}).autoRotate !== false;
              return (
                <div key={providerId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{providerId}</p>
                    <p className="text-xs text-text-muted">
                      {poolCount} pool{poolCount === 1 ? "" : "s"} bound{poolCount < 2 ? " — rotation needs at least 2 pools" : ""}
                    </p>
                  </div>
                  <Switch
                    size="small"
                    checked={enabled}
                    onChange={() => handleToggleAutoRotate(providerId, !enabled)}
                    disabled={autoRotateSaving === providerId}
                    title={enabled ? "Disable auto-rotate" : "Enable auto-rotate"}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 rounded-md border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
          <p className="text-sm font-medium">Rust Relay Sidecar</p>
          <p className="text-xs text-text-muted mt-1">
            Self-hosted relay (<code className="text-text-main">relay/target/release/h-router-relay</code>, default listen <code className="text-text-main">127.0.0.1:20129</code>). Supports both contracts: standard HTTP proxy and <code className="text-text-main">x-relay-target</code> mode. Register it as a pool of type <code className="text-text-main">http</code> with its URL to use it as an egress relay. See <code className="text-text-main">relay/README.md</code> for build, systemd, and update steps.
          </p>
        </div>
      </Card>

      <Modal
        open={showBatchImportModal}
        title="Batch Import Proxies"
        onCancel={closeBatchImportModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-text-main mb-1 block">Paste Proxy List (One per line)</label>
            <Input.TextArea
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              rows={8}
              className="w-full text-sm"
            />
            <p className="text-xs text-text-muted mt-1">
              Supported formats: protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button block type="primary" onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button block type="text" onClick={closeBatchImportModal} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showVercelModal}
        title="Deploy Vercel Relay"
        onCancel={closeVercelModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-blue-500/5 border border-blue-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Vercel Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel&apos;s edge network, masking your real IP from providers.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds of IPs across 20+ global regions)</li>
              <li>Vercel serves millions of apps — providers can&apos;t block Vercel IPs without affecting legitimate traffic</li>
              <li>Free tier: 100GB bandwidth/month, 500K edge invocations</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
          </div>
          <Field label="Vercel API Token" hint={<>Token is used once for deployment and not stored. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}>
            <Input.Password value={vercelForm.vercelToken} onChange={(e) => setVercelForm((prev) => ({ ...prev, vercelToken: e.target.value }))} placeholder="your-vercel-api-token" />
          </Field>
          <Field label="Project Name">
            <Input value={vercelForm.projectName} onChange={(e) => setVercelForm((prev) => ({ ...prev, projectName: e.target.value }))} placeholder="my-relay" />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              block
              type="primary"
              onClick={handleVercelDeploy}
              disabled={!vercelForm.vercelToken.trim() || deploying}
            >
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button block type="text" onClick={closeVercelModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showCloudflareModal}
        title="Deploy Cloudflare Relay"
        onCancel={closeCloudflareModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-orange-500/5 border border-orange-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Cloudflare Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys a Cloudflare Worker as a proxy relay. All AI provider requests will be forwarded through Cloudflare&apos;s global edge network.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>High performance global routing and IP masking via Cloudflare Workers</li>
              <li>Free tier: 100,000 requests per day</li>
              <li>Requires Cloudflare Account ID and a Workers API Token (Edit Workers permission)</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-orange-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate your API Token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>My Profile</b> → <b>API Tokens</b> → <b>Create Token</b></li>
                <li>Scroll down to <b>Custom Token</b> and click <b>Get started</b></li>
                <li>Under <b>Permissions</b>: Account | Workers Scripts | Edit</li>
                <li>Under <b>Account Resources</b>: Include | Account | <i>Your Account Name</i></li>
                <li>Click <b>Continue to summary</b> → <b>Create Token</b></li>
              </ol>
            </div>
          </div>
          <Field label="Account ID" hint={<>Found on the right side of the Cloudflare dashboard overview page.</>}>
            <Input value={cloudflareForm.accountId} onChange={(e) => setCloudflareForm((prev) => ({ ...prev, accountId: e.target.value }))} placeholder="your-cloudflare-account-id" />
          </Field>
          <Field label="API Token" hint={<>Requires "Workers Scripts: Edit" permission. <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}>
            <Input.Password value={cloudflareForm.apiToken} onChange={(e) => setCloudflareForm((prev) => ({ ...prev, apiToken: e.target.value }))} placeholder="your-cloudflare-api-token" />
          </Field>
          <Field label="Worker Name">
            <Input value={cloudflareForm.projectName} onChange={(e) => setCloudflareForm((prev) => ({ ...prev, projectName: e.target.value }))} placeholder="my-relay" />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              block
              type="primary"
              onClick={handleCloudflareDeploy}
              disabled={!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim() || deploying}
            >
              {deploying ? "Deploying..." : "Deploy Worker"}
            </Button>
            <Button block type="text" onClick={closeCloudflareModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showDenoModal}
        title="Deploy Deno Relay"
        onCancel={closeDenoModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Deno Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys a relay worker to Deno Deploy&apos;s global edge network. All AI provider requests are forwarded through Deno&apos;s edge, masking your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Deno Deploy v2 runs on a high-performance global edge network</li>
              <li>Free tier: 1M requests & 100GiB outbound traffic per month</li>
              <li>No per-request CPU time limits (unlike Vercel/Cloudflare)</li>
              <li>Support up to 20 active apps & 50 custom domains</li>
              <li>Deploy multiple relays for maximum IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate API token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>console.deno.com</b></li>
                <li>Select your <b>Organization</b> → <b>Settings</b> → <b>Organization Tokens</b></li>
                <li>Create a <b>Organization Token</b> (prefix <b>ddo_</b>)</li>
              </ol>
            </div>
          </div>
          <Field label="Deno Deploy API Token" hint={<>Token is used once for deployment, not stored. Found in Organization Settings.</>}>
            <Input.Password value={denoForm.denoToken} onChange={(e) => setDenoForm((prev) => ({ ...prev, denoToken: e.target.value }))} placeholder="ddo_xxxxxxxxxxxxxxxx" />
          </Field>
          <Field label="Organization Domain">
            <Input value={denoForm.orgDomain} onChange={(e) => setDenoForm((prev) => ({ ...prev, orgDomain: e.target.value }))} placeholder="your-org.deno.net" />
          </Field>
          <Field label="App Name">
            <Input value={denoForm.projectName} onChange={(e) => setDenoForm((prev) => ({ ...prev, projectName: e.target.value }))} placeholder="deno-relay" />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              block
              type="primary"
              onClick={handleDenoDeploy}
              disabled={!denoForm.denoToken.trim() || !denoForm.orgDomain.trim() || deploying}
            >
              {deploying ? "Deploying..." : "Deploy Relay"}
            </Button>
            <Button block type="text" onClick={closeDenoModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showNetlifyModal}
        title="Deploy Netlify Relay"
        onCancel={closeNetlifyModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-teal-500/5 border border-teal-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Netlify Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys a serverless relay function to Netlify&apos;s global edge network. All AI provider requests are forwarded through Netlify&apos;s edge, masking your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Runs on Netlify Functions with a 60-second execution limit and streaming support</li>
              <li>Free tier: 125,000 function invocations and 100GB bandwidth per month</li>
              <li>Relay URL format: https://your-site.netlify.app/.netlify/functions/relay</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-teal-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate API token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>User Settings</b> → <b>Applications</b> → <b>Personal access tokens</b></li>
                <li>Select <b>New access token</b> and generate a token</li>
                <li>Copy the token — you won&apos;t see it again after leaving the page</li>
              </ol>
            </div>
          </div>
          <Field label="Netlify API Token" hint={<>Token is used once for deployment and not stored. <a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}>
            <Input.Password value={netlifyForm.netlifyToken} onChange={(e) => setNetlifyForm((prev) => ({ ...prev, netlifyToken: e.target.value }))} placeholder="nfp_xxxxxxxxxxxxxxxx" />
          </Field>
          <Field label="Site Name">
            <Input value={netlifyForm.projectName} onChange={(e) => setNetlifyForm((prev) => ({ ...prev, projectName: e.target.value }))} placeholder="netlify-relay" />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              block
              type="primary"
              onClick={handleNetlifyDeploy}
              disabled={!netlifyForm.netlifyToken.trim() || deploying}
            >
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button block type="text" onClick={closeNetlifyModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showFormModal}
        title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"}
        onCancel={closeFormModal}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Office Proxy" />
          </Field>
          <Field label="Proxy URL">
            <Input value={formData.proxyUrl} onChange={(e) => setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }))} placeholder="http://127.0.0.1:7897" />
          </Field>
          <Field label="No Proxy">
            <Input value={formData.noProxy} onChange={(e) => setFormData((prev) => ({ ...prev, noProxy: e.target.value }))} placeholder="localhost,127.0.0.1,.internal" />
          </Field>

          <div className="flex flex-col gap-3 rounded-md border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p>
            </div>
            <Switch
              checked={formData.isActive === true}
              onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Strict Proxy</p>
              <p className="text-xs text-text-muted">Fail request if proxy is unreachable instead of falling back to direct.</p>
            </div>
            <Switch
              checked={formData.strictProxy === true}
              onChange={() => setFormData((prev) => ({ ...prev, strictProxy: !prev.strictProxy }))}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              block
              type="primary"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button block type="text" onClick={closeFormModal} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* antd Modal evaluates title/children on every render even while
          closed, so the body is guarded by confirmState (quota-crash
          lesson, wave 2). */}
      <Modal
        open={!!confirmState}
        onCancel={() => setConfirmState(null)}
        onOk={confirmState ? confirmState.onConfirm : undefined}
        title={confirmState?.title || "Confirm"}
        okButtonProps={{ danger: true }}
      >
        {confirmState ? <p className="text-text-muted">{confirmState.message}</p> : null}
      </Modal>
    </div>
  );
}
