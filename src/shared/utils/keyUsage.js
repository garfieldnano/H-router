// Per-key usage aggregation (plan G7) — pure function over the stats
// shape getUsageStats() returns.
//
// getUsageStats().byApiKey is keyed by the MASKED composite
// `${apiKeyMasked}|${model}|${provider}` (or the literal "local-no-key"
// for requests without an API key) — AUDIT-002 #1962: full key values
// must never appear in byApiKey object keys, because the stats object is
// sent to browsers. Entries carry `keyId` (the apiKeys row id) for the
// join to key/member metadata; entries without a keyId belong to a key
// that has since been deleted and are grouped by their masked key. This
// groups those entries back per API key, so the Pemakaian Kunci page has
// one row per key — including keys with zero usage in the period.

/**
 * @param {object} stats - getUsageStats() result (only .byApiKey is read)
 * @param {Array} keys - apiKeys rows ({ id, key, name, memberId, isActive, rpmLimit, maxIps })
 * @param {Array} members - members rows ({ id, name })
 * @returns {Array} rows sorted by requests desc (local-no-key last),
 *   each { keyId, keyName, maskedKey, memberId, memberName, isActive,
 *   rpmLimit, maxIps, requests, promptTokens, completionTokens, cost,
 *   models: [{ model, provider, requests }], lastUsed }
 */
export function aggregateUsageByKey(stats, keys = [], members = []) {
  const byApiKey = stats?.byApiKey && typeof stats.byApiKey === "object" ? stats.byApiKey : {};
  const memberById = new Map((members || []).map((m) => [m.id, m.name || m.id]));
  const keyById = new Map((keys || []).map((k) => [k.id, k]));

  const rows = new Map();

  function ensureRow(rowId, meta) {
    if (rows.has(rowId)) return rows.get(rowId);
    const row = {
      keyId: meta?.id || null,
      keyName: meta?.name || null,
      maskedKey: null,
      memberId: meta?.memberId || null,
      memberName: meta?.memberId ? memberById.get(meta.memberId) || null : null,
      isActive: meta ? meta.isActive !== false && meta.isActive !== 0 : null,
      rpmLimit: meta?.rpmLimit ?? null,
      maxIps: meta?.maxIps ?? null,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      models: new Map(),
      lastUsed: null,
    };
    rows.set(rowId, row);
    return row;
  }

  for (const [mapKey, entry] of Object.entries(byApiKey)) {
    if (!entry || typeof entry !== "object") continue;
    const model = entry.rawModel || "";
    const provider = entry.provider || "";
    // Join via entry.keyId — the map key is masked by design and carries
    // no full key value to join on (AUDIT-002).
    let rowId;
    let meta = null;
    if (entry.apiKeyKey === "local-no-key" || mapKey === "local-no-key") {
      rowId = "local-no-key";
    } else if (entry.keyId && keyById.has(entry.keyId)) {
      rowId = `id:${entry.keyId}`;
      meta = keyById.get(entry.keyId);
    } else {
      // Key deleted since the usage was recorded: group by the masked key.
      rowId = `masked:${entry.apiKeyKey || entry.apiKeyMasked || mapKey}`;
    }
    const row = ensureRow(rowId, meta);
    if (!row.keyName) row.keyName = meta?.name || entry.keyName || null;
    if (!row.maskedKey) row.maskedKey = entry.apiKeyMasked || entry.apiKeyKey || null;
    row.requests += entry.requests || 0;
    row.promptTokens += entry.promptTokens || 0;
    row.completionTokens += entry.completionTokens || 0;
    row.cost += entry.cost || 0;
    if (entry.lastUsed && (!row.lastUsed || new Date(entry.lastUsed) > new Date(row.lastUsed))) {
      row.lastUsed = entry.lastUsed;
    }
    const modelKey = provider ? `${model} (${provider})` : model || "unknown";
    const m = row.models.get(modelKey) || { model, provider, requests: 0 };
    m.requests += entry.requests || 0;
    row.models.set(modelKey, m);
  }

  // Keys with no usage in the period still get a zero row.
  for (const k of keys || []) {
    const val = typeof k.key === "string" ? k.key.trim() : k.key;
    const row = ensureRow(`id:${k.id}`, k);
    if (!row.keyName) row.keyName = k.name || null;
    if (!row.maskedKey && val) {
      row.maskedKey = val.length > 12 ? `${val.slice(0, 8)}***${val.slice(-4)}` : val;
    }
  }

  const out = [...rows.entries()].map(([rowId, row]) => {
    const models = [...row.models.values()].sort((a, b) => b.requests - a.requests);
    return {
      ...row,
      models,
      isLocalNoKey: rowId === "local-no-key",
      keyName: row.keyName || (rowId === "local-no-key" ? "Local (No API Key)" : row.maskedKey || rowId),
    };
  });

  // Most-used first; the local-no-key bucket always goes last.
  out.sort((a, b) => {
    if (a.isLocalNoKey !== b.isLocalNoKey) return a.isLocalNoKey ? 1 : -1;
    if (b.requests !== a.requests) return b.requests - a.requests;
    return String(b.lastUsed || "") < String(a.lastUsed || "") ? -1 : 1;
  });
  return out;
}
