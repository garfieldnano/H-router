// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 9;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // Member who owns this key (admin-assigned). NULL = unassigned / admin key.
      // Added in schema v3 for the member dashboard (read-only own keys/usage).
      memberId: "TEXT",
      // Per-key access control. Additive columns, picked up by
      // syncSchemaFromTables() on boot; existing rows read as unrestricted (0).
      accessRestricted: "INTEGER DEFAULT 0",
      accessAllow: "TEXT",
      // Optional expiry (ISO timestamp). NULL = never expires. Set for trial
      // keys issued by the Telegram bot (schema v4); validateApiKey() rejects
      // expired keys, and the bot sweeps them to isActive = 0.
      expiresAt: "TEXT",
      // RPM limit (schema v5): requests per minute for this key. NULL = inherit
      // from the key's package (packages.rpmLimit), then the global default.
      rpmLimit: "INTEGER",
      // Package this key was issued from (schema v5). Set at issuance by the
      // bot (order confirm / trial claim); NULL = no package (admin key) → the
      // global default applies. Used to resolve the per-package RPM level.
      packageId: "TEXT",
      // Active IP cap (schema v9, plan #5): max distinct client IPs that may
      // use this key inside the 10-minute sliding window. NULL = the global
      // default (3, DEFAULT_MAX_IPS in src/shared/utils/ipCap.js). 1 = the
      // key is bound to a single IP. No unlimited value: the cap always
      // applies to known, active, unexpired keys.
      maxIps: "INTEGER",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_member ON apiKeys(memberId)",
    ],
  },
  // Active IP usage (schema v9, plan #5): one row per (key, client IP),
  // lastSeenAt refreshed on every /v1 request from that IP. Rows older than
  // the 10-minute window are stale — pruned lazily per key on enforcement
  // and globally by the periodic sweep (startIpUsageSweep). Transient
  // window state: deliberately NOT included in exportDb/importDb.
  key_ip_usage: {
    columns: {
      keyId: "TEXT NOT NULL",
      ip: "TEXT NOT NULL",
      lastSeenAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (keyId, ip)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_kiu_key_seen ON key_ip_usage(keyId, lastSeenAt)",
      "CREATE INDEX IF NOT EXISTS idx_kiu_seen ON key_ip_usage(lastSeenAt)",
    ],
  },
  // Telegram bot (v1, schema v4): packages sold via the bot + orders +
  // account linking. Prices are INTEGER rupiah (no decimals); the admin
  // edits them from the web panel (/dashboard/packages) and the bot admin
  // panel — never hardcoded.
  packages: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      price: "INTEGER NOT NULL DEFAULT 0",
      durationDays: "INTEGER NOT NULL DEFAULT 30",
      // 'paid' | 'trial'. Trial packages are free (price ignored, must be 0).
      type: "TEXT NOT NULL DEFAULT 'paid'",
      // JSON: { models: [..] | null (all), note: string } — access/limits.
      access: "TEXT",
      // RPM limit (schema v5): default requests-per-minute for keys issued
      // from this package. NULL = inherit: trial packages fall back to the
      // trial default (20), paid packages to the global default (50).
      rpmLimit: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pkg_type ON packages(type)",
      "CREATE INDEX IF NOT EXISTS idx_pkg_active ON packages(isActive)",
    ],
  },
  // Orders placed via the Telegram bot (manual transfer + admin confirm).
  // status: pending_payment -> pending_confirm -> confirmed | rejected.
  orders: {
    columns: {
      id: "TEXT PRIMARY KEY",
      buyerTelegramId: "TEXT NOT NULL",
      buyerTelegramUsername: "TEXT",
      buyerName: "TEXT",
      packageId: "TEXT",
      packageName: "TEXT",
      amount: "INTEGER NOT NULL DEFAULT 0",
      status: "TEXT NOT NULL DEFAULT 'pending_payment'",
      // Telegram file_id of the payment proof photo (null until uploaded).
      proofFileId: "TEXT",
      // API key id issued on confirm (null until confirmed).
      keyId: "TEXT",
      memberId: "TEXT",
      // Admin decision note / reject reason.
      note: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ord_buyer ON orders(buyerTelegramId)",
      "CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status)",
      "CREATE INDEX IF NOT EXISTS idx_ord_member ON orders(memberId)",
    ],
  },
  // One-time Telegram link codes (dashboard -> bot). A member requests a code
  // from the member dashboard; /start <code> in the bot links the chat.
  telegramLinks: {
    columns: {
      code: "TEXT PRIMARY KEY",
      memberId: "TEXT NOT NULL",
      expiresAt: "TEXT NOT NULL",
      usedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_tgl_member ON telegramLinks(memberId)"],
  },
  // Telegram chats linked to members (one chat = one member at most).
  // memberId NULL = unlinked chat (may still browse / buy; buying creates one).
  telegramChats: {
    columns: {
      chatId: "TEXT PRIMARY KEY",
      memberId: "TEXT",
      username: "TEXT",
      firstName: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_tgc_member ON telegramChats(memberId)"],
  },
  // Free-trial claims — the once-per-user guard. One row per Telegram user
  // (telegramId UNIQUE) and per member; a second claim is rejected.
  trialClaims: {
    columns: {
      id: "TEXT PRIMARY KEY",
      telegramId: "TEXT NOT NULL UNIQUE",
      memberId: "TEXT NOT NULL",
      keyId: "TEXT NOT NULL",
      claimedAt: "TEXT NOT NULL",
      expiresAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_tc_member ON trialClaims(memberId)"],
  },
  // Downtime compensation (schema v6, plan §0d): gateway-uptime incidents
  // recorded by the health prober + manual time-extension grants by admin.
  // scope: 'gateway' for now; the #5 health scanner will extend this with
  // 'provider' scope later (same tables, same grant flow).
  system_incidents: {
    columns: {
      id: "TEXT PRIMARY KEY",
      // 'gateway' | 'provider' (provider scope reserved for scanner #5).
      scope: "TEXT NOT NULL DEFAULT 'gateway'",
      // Machine-readable cause: 'unreachable' | 'timeout' | 'http-5xx' |
      // 'health-not-ok' | 'error-rate' (+ free text in reasonDetail).
      reason: "TEXT",
      reasonDetail: "TEXT",
      // 'open' | 'closed'.
      status: "TEXT NOT NULL DEFAULT 'open'",
      startedAt: "TEXT NOT NULL",
      endedAt: "TEXT",
      // Minutes between startedAt and endedAt (rounded); NULL while open.
      durationMinutes: "INTEGER",
      // Last failed probe seen (so an open incident shows a running duration).
      lastSeenAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_si_status ON system_incidents(status)",
      "CREATE INDEX IF NOT EXISTS idx_si_started ON system_incidents(startedAt DESC)",
    ],
  },
  // Manual compensation grants. type is always 'hours' in v1 (extend the
  // key's active period); amount = hours added. The (incidentId, keyId)
  // UNIQUE index enforces the no-double-grant rule at the DB level.
  compensations: {
    columns: {
      id: "TEXT PRIMARY KEY",
      memberId: "TEXT",
      keyId: "TEXT NOT NULL",
      incidentId: "TEXT NOT NULL",
      type: "TEXT NOT NULL DEFAULT 'hours'",
      amount: "INTEGER NOT NULL",
      grantedAt: "TEXT NOT NULL",
      grantedBy: "TEXT NOT NULL DEFAULT 'admin'",
      oldExpiresAt: "TEXT",
      newExpiresAt: "TEXT",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_incident_key ON compensations(incidentId, keyId)",
      "CREATE INDEX IF NOT EXISTS idx_cmp_member ON compensations(memberId)",
      "CREATE INDEX IF NOT EXISTS idx_cmp_key ON compensations(keyId)",
      "CREATE INDEX IF NOT EXISTS idx_cmp_incident ON compensations(incidentId)",
    ],
  },
  // Egress relay state (schema v7, plan #1): per-pool ban/health state for
  // the egress rotator. One row per proxy pool id; a pool with no row has
  // never been banned. bannedUntil (ISO) is the cooldown expiry — the
  // rotator skips pools whose bannedUntil is in the future. failCount counts
  // consecutive bans (reset on success); lastSuccessAt clears the streak.
  egress_relays: {
    columns: {
      poolId: "TEXT PRIMARY KEY",
      bannedUntil: "TEXT",
      lastBanAt: "TEXT",
      lastBanStatus: "INTEGER",
      lastBanCode: "TEXT",
      failCount: "INTEGER NOT NULL DEFAULT 0",
      lastSuccessAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_er_banned ON egress_relays(bannedUntil)",
    ],
  },
  // Model rebranding (schema v8, plan #2): brand_model_id is the
  // client-facing model id (e.g. "h-router/ultra-pro") sold to members;
  // it resolves to one upstream provider/model before execution.
  // displayName defaults to brandModelId when empty. isActive = 0 hides
  // the brand from /v1/models and stops resolution (requests with the
  // brand id then fail as an unknown model).
  model_brands: {
    columns: {
      id: "TEXT PRIMARY KEY",
      brandModelId: "TEXT NOT NULL",
      upstreamProvider: "TEXT NOT NULL",
      upstreamModel: "TEXT NOT NULL",
      displayName: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_brand ON model_brands(brandModelId)",
      "CREATE INDEX IF NOT EXISTS idx_mb_upstream ON model_brands(upstreamProvider, upstreamModel)",
    ],
  },
  // Live system prompts (schema v8, plan #2, applyLive): injected into
  // the request before RTK and before translation. A row targets exactly
  // one scope: a brand (brandModelId), a provider+model, or a whole
  // provider (model NULL). mode: prepend | replace | append. The prompt
  // text itself is an admin secret — it must never be stored in request
  // details or request logs (see sanitizeLivePromptFromBody).
  live_prompts: {
    columns: {
      id: "TEXT PRIMARY KEY",
      brandModelId: "TEXT",
      provider: "TEXT",
      model: "TEXT",
      systemPrompt: "TEXT NOT NULL",
      mode: "TEXT NOT NULL DEFAULT 'prepend'",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_lp_brand ON live_prompts(brandModelId)",
      "CREATE INDEX IF NOT EXISTS idx_lp_provider ON live_prompts(provider, model)",
    ],
  },
  // Member dashboard (v1, schema v3): members are identity/contact records
  // created by the admin. Members log in with an assigned API key (no member
  // password); isActive is the admin's disable switch.
  members: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT",
      email: "TEXT UNIQUE",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
