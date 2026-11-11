// Pure helpers for the Telegram bot — no imports, no DB, no Telegraf.
// Importable by the standalone bot process (plain node, relative import),
// by Next.js API routes, and by vitest.

// ---------------------------------------------------------------- numbers

export function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

export function fmtCost(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

/** Format an integer rupiah amount: 150000 -> "Rp150.000". */
export function fmtIdr(n) {
  const v = Math.trunc(Number(n) || 0);
  return `Rp${v.toLocaleString("id-ID")}`;
}

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} rb`;
  return String(v);
}

export function fmtDateWib(iso, { withTime = true } = {}) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  } catch {
    return String(iso);
  }
}

export function fmtTimeWib(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

// ------------------------------------------------------- usage rendering

/** Render a member/global usage-stats payload (getMemberUsageStats shape). */
export function renderUsageStats(stats, { title = "📊 Penggunaan", periodLabel = "" } = {}) {
  if (!stats) return `${title}\n\nBelum ada data.`;
  const lines = [title + (periodLabel ? ` — ${periodLabel}` : ""), ""];
  lines.push(`Total request: ${fmtNum(stats.totalRequests)}`);
  lines.push(`Total token: ${fmtNum(stats.totalTokens)} (prompt ${fmtNum(stats.totalPromptTokens)} · completion ${fmtNum(stats.totalCompletionTokens)})`);
  lines.push(`Total biaya: ${fmtCost(stats.totalCost)}`);
  const byModel = stats.byModel ? Object.entries(stats.byModel).sort((a, b) => b[1].requests - a[1].requests) : [];
  if (byModel.length) {
    lines.push("", "Per model:");
    for (const [model, m] of byModel.slice(0, 10)) {
      lines.push(`• ${model}: ${fmtNum(m.requests)} req · ${fmtNum(m.tokens)} token · ${fmtCost(m.cost)}`);
    }
    if (byModel.length > 10) lines.push(`…dan ${byModel.length - 10} model lainnya`);
  }
  const recent = Array.isArray(stats.recentRequests) ? stats.recentRequests : [];
  if (recent.length) {
    lines.push("", "Request terbaru:");
    for (const r of recent.slice(0, 5)) {
      lines.push(`• ${fmtTimeWib(r.timestamp)} — ${r.model || "-"} · ${fmtNum((r.promptTokens || 0) + (r.completionTokens || 0))} token`);
    }
  }
  return lines.join("\n");
}

/** One-line RPM status for a key: "RPM: 3/20 per menit (batas paket — Pro)". */
export function renderRpm(rate) {
  if (!rate || rate.limit == null) return "";
  const source = { key: "per kunci", package: "paket", "trial-default": "default trial", global: "global" }[rate.source] || rate.source || "";
  const used = rate.used != null ? `${rate.used}/` : "";
  return `RPM: ${used}${rate.limit} per menit (batas ${source}${rate.packageName ? ` — ${rate.packageName}` : ""})`;
}

export function renderKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return "Belum ada kunci API. Minta admin untuk menetapkan kunci, atau beli paket lewat menu Beli Kunci.";
  }
  return keys.map((k) => {
    const masked = k.maskedKey || maskKey(k.key);
    const expiry = k.expiresAt ? ` · berakhir ${fmtDateWib(k.expiresAt)}` : "";
    const rpm = k.rate ? `\n  ${renderRpm(k.rate)}` : "";
    return `• ${k.name || "Unnamed key"}\n  \`${masked}\`\n  ${k.isActive ? "✅ Aktif" : "⛔ Nonaktif"} · dibuat ${fmtDateWib(k.createdAt)}${expiry}${rpm}`;
  }).join("\n\n");
}

export function maskKey(key) {
  if (!key || typeof key !== "string") return "-";
  const t = key.trim();
  if (t.length <= 12) return `${t.charAt(0)}***`;
  return `${t.slice(0, 8)}***${t.slice(-4)}`;
}

// -------------------------------------------------------- package rendering

export function renderPackage(pkg) {
  const dur = pkg.durationDays === 1 ? "1 hari" : `${pkg.durationDays} hari`;
  const type = pkg.type === "trial" ? "🆓 Trial" : "💎 Berbayar";
  // RPM: package default, or "ikut default" (trial → 20, paid → global).
  const rpm = pkg.rpmLimit != null ? `${pkg.rpmLimit}/menit` : "ikut default";
  return `${type} — *${escapeMd(pkg.name)}*\n${fmtIdr(pkg.price)} · ${dur} · RPM: ${rpm}${pkg.access?.note ? `\n_${escapeMd(pkg.access.note)}_` : ""}`;
}

export function renderPackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return "Belum ada paket yang tersedia. Hubungi owner untuk info paket.";
  }
  return packages.map(renderPackage).join("\n\n");
}

export function escapeMd(text) {
  return String(text ?? "").replace(/([_*`[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}
