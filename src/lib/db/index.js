// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, getApiKeysByMemberId, setApiKeyMember,
  createApiKey, updateApiKey, deleteApiKey, validateApiKey, setApiKeyExpiry,
  setApiKeyPackage,
} from "./repos/apiKeysRepo.js";

// Members (member dashboard v1)
export {
  getMembers, getMemberById, getMemberByEmail, createMember, updateMember,
} from "./repos/membersRepo.js";

// Telegram bot (v1): packages, orders, link codes, chats, trial claims
export {
  getPackages, getPackageById, getActiveTrialPackage,
  createPackage, updatePackage, deletePackage,
} from "./repos/packagesRepo.js";

export {
  createOrder, getOrderById, getOrderByKeyId, getOrders, getPendingOrders, countOrders, updateOrder,
} from "./repos/ordersRepo.js";

export {
  generateLinkCode, createLinkCode, consumeLinkCode, linkChat, LINK_CODE_TTL_MS,
  getChatById, getChatByMemberId,
  getTrialClaimByTelegramId, getTrialClaimByMemberId, getTrialClaimByKeyId, createTrialClaim,
} from "./repos/telegramRepo.js";

// Downtime compensation (plan §0d, schema v6): incidents + manual grants
export {
  createIncident, getIncidentById, getOpenIncident, getIncidents,
  updateIncidentLastSeen, closeIncident,
  getCompensationByIncidentAndKey, getCompensations, getCompensationsByMemberId,
  countCompensations, insertCompensationAndExtendKey, getRecentErrorRate,
} from "./repos/compensationRepo.js";

// Egress relay state (plan #1, schema v7): per-pool ban/health for the rotator
export {
  getRelayState, getRelayStates, isRelayBanned, getBannedRelayPoolIds,
  markRelayBanned, recordRelaySuccess, clearRelayBan,
} from "./repos/egressRelaysRepo.js";

// Model rebranding + live system prompts (plan #2, schema v8)
export {
  LIVE_PROMPT_MODES,
  getModelBrands, getModelBrandById, getModelBrandByBrandId, resolveBrandModel,
  createModelBrand, updateModelBrand, deleteModelBrand,
  getLivePrompts, getLivePromptById, createLivePrompt, updateLivePrompt,
  deleteLivePrompt, findLivePromptForRequest,
} from "./repos/modelBrandsRepo.js";

// Active IP cap (plan #5, schema v9): per-(key, IP) sightings in the
// 10-minute sliding window. Transient window state — deliberately NOT in
// exportDb/importDb (like telegramLinks: short-lived, must never survive
// a restore).
export {
  recordIpUsage, getActiveIps, countActiveIps, getOldestActiveIp,
  pruneStaleIpUsageForKey, sweepStaleIpUsage, deleteIpUsageForKey,
} from "./repos/keyIpUsageRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageRowsBetween, getUsageStats, getMemberUsageStats, buildMemberUsageStats, getChartData,
  appendRequestLog, getRecentLogs, calculateCost, sanitizeUsageStatsForBrowser,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
  isObservabilityEnabled,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, memberId: r.memberId || null, isActive: r.isActive === 1, createdAt: r.createdAt, expiresAt: r.expiresAt || null, rpmLimit: r.rpmLimit ?? null, maxIps: r.maxIps ?? null, packageId: r.packageId || null, access: keyAccessFromColumns(r.accessRestricted, r.accessAllow) })),
    members: db.all(`SELECT * FROM members`).map((r) => ({ id: r.id, name: r.name, email: r.email, isActive: r.isActive === 1, createdAt: r.createdAt })),
    packages: db.all(`SELECT * FROM packages`).map((r) => ({ id: r.id, name: r.name, price: r.price ?? 0, durationDays: r.durationDays ?? 30, type: r.type, access: parseJson(r.access, {}), rpmLimit: r.rpmLimit ?? null, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    orders: db.all(`SELECT * FROM orders`).map((r) => ({ id: r.id, buyerTelegramId: r.buyerTelegramId, buyerTelegramUsername: r.buyerTelegramUsername || null, buyerName: r.buyerName || null, packageId: r.packageId || null, packageName: r.packageName || null, amount: r.amount ?? 0, status: r.status, proofFileId: r.proofFileId || null, keyId: r.keyId || null, memberId: r.memberId || null, note: r.note || null, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    telegramChats: db.all(`SELECT * FROM telegramChats`).map((r) => ({ chatId: r.chatId, memberId: r.memberId || null, username: r.username || null, firstName: r.firstName || null, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    trialClaims: db.all(`SELECT * FROM trialClaims`).map((r) => ({ id: r.id, telegramId: r.telegramId, memberId: r.memberId, keyId: r.keyId, claimedAt: r.claimedAt, expiresAt: r.expiresAt })),
    system_incidents: db.all(`SELECT * FROM system_incidents`).map((r) => ({ id: r.id, scope: r.scope, reason: r.reason || null, reasonDetail: r.reasonDetail || null, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt || null, durationMinutes: r.durationMinutes ?? null, lastSeenAt: r.lastSeenAt || null, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    compensations: db.all(`SELECT * FROM compensations`).map((r) => ({ id: r.id, memberId: r.memberId || null, keyId: r.keyId, incidentId: r.incidentId, type: r.type, amount: r.amount, grantedAt: r.grantedAt, grantedBy: r.grantedBy, oldExpiresAt: r.oldExpiresAt || null, newExpiresAt: r.newExpiresAt || null })),
    egress_relays: db.all(`SELECT * FROM egress_relays`).map((r) => ({ poolId: r.poolId, bannedUntil: r.bannedUntil || null, lastBanAt: r.lastBanAt || null, lastBanStatus: r.lastBanStatus ?? null, lastBanCode: r.lastBanCode || null, failCount: r.failCount ?? 0, lastSuccessAt: r.lastSuccessAt || null, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    model_brands: db.all(`SELECT * FROM model_brands`).map((r) => ({ id: r.id, brandModelId: r.brandModelId, upstreamProvider: r.upstreamProvider, upstreamModel: r.upstreamModel, displayName: r.displayName || null, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    live_prompts: db.all(`SELECT * FROM live_prompts`).map((r) => ({ id: r.id, brandModelId: r.brandModelId || null, provider: r.provider || null, model: r.model || null, systemPrompt: r.systemPrompt, mode: r.mode || "prepend", isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    // telegramLinks deliberately NOT exported: one-time codes are short-lived
    // (10 min) and must never survive a restore.
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM members`);
    db.run(`DELETE FROM packages`);
    db.run(`DELETE FROM orders`);
    db.run(`DELETE FROM telegramChats`);
    db.run(`DELETE FROM trialClaims`);
    db.run(`DELETE FROM telegramLinks`);
    db.run(`DELETE FROM system_incidents`);
    db.run(`DELETE FROM compensations`);
    db.run(`DELETE FROM egress_relays`);
    db.run(`DELETE FROM model_brands`);
    db.run(`DELETE FROM live_prompts`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      // Per-key access: a backup without `access` (older version) restores
      // unrestricted, exactly as before; a malformed `access` is refused.
      let access = KEY_ACCESS_UNRESTRICTED;
      if (k.access !== undefined) {
        const checked = validateKeyAccessInput(k.access);
        if (!checked.ok) throw new Error(`apiKeys ${k.id}: ${checked.error}`);
        access = checked.value;
      }
      const cols = keyAccessToColumns(access);
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, memberId, isActive, expiresAt, rpmLimit, maxIps, packageId, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.memberId || null, k.isActive === false ? 0 : 1, k.expiresAt || null, k.rpmLimit ?? null, k.maxIps ?? null, k.packageId || null, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow]
      );
    }
    for (const m of payload.members || []) {
      db.run(
        `INSERT OR REPLACE INTO members(id, name, email, isActive, createdAt) VALUES(?, ?, ?, ?, ?)`,
        [m.id, m.name || null, m.email || null, m.isActive === false ? 0 : 1, m.createdAt || new Date().toISOString()]
      );
    }
    for (const p of payload.packages || []) {
      db.run(
        `INSERT OR REPLACE INTO packages(id, name, price, durationDays, type, access, rpmLimit, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.name, p.price ?? 0, p.durationDays ?? 30, p.type || "paid", stringifyJson(p.access || {}), p.rpmLimit ?? null, p.isActive === false ? 0 : 1, p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString()]
      );
    }
    for (const o of payload.orders || []) {
      db.run(
        `INSERT OR REPLACE INTO orders(id, buyerTelegramId, buyerTelegramUsername, buyerName, packageId, packageName, amount, status, proofFileId, keyId, memberId, note, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [o.id, o.buyerTelegramId, o.buyerTelegramUsername || null, o.buyerName || null, o.packageId || null, o.packageName || null, o.amount ?? 0, o.status || "pending_payment", o.proofFileId || null, o.keyId || null, o.memberId || null, o.note || null, o.createdAt || new Date().toISOString(), o.updatedAt || new Date().toISOString()]
      );
    }
    for (const c of payload.telegramChats || []) {
      db.run(
        `INSERT OR REPLACE INTO telegramChats(chatId, memberId, username, firstName, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [c.chatId, c.memberId || null, c.username || null, c.firstName || null, c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const t of payload.trialClaims || []) {
      db.run(
        `INSERT OR REPLACE INTO trialClaims(id, telegramId, memberId, keyId, claimedAt, expiresAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [t.id, t.telegramId, t.memberId, t.keyId, t.claimedAt || new Date().toISOString(), t.expiresAt || new Date().toISOString()]
      );
    }
    for (const s of payload.system_incidents || []) {
      db.run(
        `INSERT OR REPLACE INTO system_incidents(id, scope, reason, reasonDetail, status, startedAt, endedAt, durationMinutes, lastSeenAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.scope || "gateway", s.reason || null, s.reasonDetail || null, s.status || "closed", s.startedAt || new Date().toISOString(), s.endedAt || null, s.durationMinutes ?? null, s.lastSeenAt || null, s.createdAt || new Date().toISOString(), s.updatedAt || new Date().toISOString()]
      );
    }
    for (const c of payload.compensations || []) {
      db.run(
        `INSERT OR REPLACE INTO compensations(id, memberId, keyId, incidentId, type, amount, grantedAt, grantedBy, oldExpiresAt, newExpiresAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.memberId || null, c.keyId, c.incidentId, c.type || "hours", c.amount ?? 0, c.grantedAt || new Date().toISOString(), c.grantedBy || "admin", c.oldExpiresAt || null, c.newExpiresAt || null]
      );
    }
    for (const e of payload.egress_relays || []) {
      db.run(
        `INSERT OR REPLACE INTO egress_relays(poolId, bannedUntil, lastBanAt, lastBanStatus, lastBanCode, failCount, lastSuccessAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.poolId, e.bannedUntil || null, e.lastBanAt || null, e.lastBanStatus ?? null, e.lastBanCode || null, e.failCount ?? 0, e.lastSuccessAt || null, e.createdAt || new Date().toISOString(), e.updatedAt || new Date().toISOString()]
      );
    }
    for (const b of payload.model_brands || []) {
      db.run(
        `INSERT OR REPLACE INTO model_brands(id, brandModelId, upstreamProvider, upstreamModel, displayName, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.id, b.brandModelId, b.upstreamProvider, b.upstreamModel, b.displayName || null, b.isActive ? 1 : 0, b.createdAt || new Date().toISOString(), b.updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.live_prompts || []) {
      db.run(
        `INSERT OR REPLACE INTO live_prompts(id, brandModelId, provider, model, systemPrompt, mode, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.brandModelId || null, p.provider || null, p.model || null, p.systemPrompt, p.mode || "prepend", p.isActive ? 1 : 0, p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString()]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
