import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// Model rebranding + live system prompts (plan #2, schema v8).
// A brand maps one client-facing model id (brandModelId, e.g.
// "h-router/ultra-pro") to one upstream provider/model. A live prompt
// targets exactly one scope — a brand, a provider+model, or a whole
// provider (model NULL) — and is injected before RTK/translation.

export const LIVE_PROMPT_MODES = ["prepend", "replace", "append"];

// Brand ids look like model ids: "prefix/name", no whitespace, no
// leading/trailing slash. The model part may itself contain slashes.
const BRAND_ID_RE = /^[^\s\/][^\s]*\/[^\s]+$/;

function rowToBrand(row) {
  if (!row) return null;
  return {
    id: row.id,
    brandModelId: row.brandModelId,
    upstreamProvider: row.upstreamProvider,
    upstreamModel: row.upstreamModel,
    displayName: row.displayName || row.brandModelId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToLivePrompt(row) {
  if (!row) return null;
  return {
    id: row.id,
    brandModelId: row.brandModelId || null,
    provider: row.provider || null,
    model: row.model || null,
    systemPrompt: row.systemPrompt,
    mode: LIVE_PROMPT_MODES.includes(row.mode) ? row.mode : "prepend",
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateBrandInput(data, { partial = false } = {}) {
  const out = {};
  if (data.brandModelId !== undefined || !partial) {
    const id = typeof data.brandModelId === "string" ? data.brandModelId.trim() : "";
    if (!id) return { ok: false, error: "brandModelId diperlukan" };
    if (!BRAND_ID_RE.test(id)) {
      return { ok: false, error: "brandModelId harus berbentuk 'prefix/nama' tanpa spasi" };
    }
    out.brandModelId = id;
  }
  if (data.upstreamProvider !== undefined || !partial) {
    const p = typeof data.upstreamProvider === "string" ? data.upstreamProvider.trim() : "";
    if (!p || /\s/.test(p)) return { ok: false, error: "upstreamProvider diperlukan (tanpa spasi)" };
    out.upstreamProvider = p;
  }
  if (data.upstreamModel !== undefined || !partial) {
    const m = typeof data.upstreamModel === "string" ? data.upstreamModel.trim() : "";
    if (!m || /\s/.test(m)) return { ok: false, error: "upstreamModel diperlukan (tanpa spasi)" };
    out.upstreamModel = m;
  }
  if (data.displayName !== undefined) {
    const d = typeof data.displayName === "string" ? data.displayName.trim() : "";
    out.displayName = d || null;
  }
  if (data.isActive !== undefined) out.isActive = data.isActive ? 1 : 0;
  return { ok: true, value: out };
}

function validateLivePromptInput(data, { partial = false } = {}) {
  const out = {};
  if (data.brandModelId !== undefined) {
    const id = typeof data.brandModelId === "string" ? data.brandModelId.trim() : "";
    if (id && !BRAND_ID_RE.test(id)) {
      return { ok: false, error: "brandModelId harus berbentuk 'prefix/nama' tanpa spasi" };
    }
    out.brandModelId = id || null;
  }
  if (data.provider !== undefined) {
    const p = typeof data.provider === "string" ? data.provider.trim() : "";
    if (p && /\s/.test(p)) return { ok: false, error: "provider tidak boleh mengandung spasi" };
    out.provider = p || null;
  }
  if (data.model !== undefined) {
    const m = typeof data.model === "string" ? data.model.trim() : "";
    if (m && /\s/.test(m)) return { ok: false, error: "model tidak boleh mengandung spasi" };
    out.model = m || null;
  }
  if (data.systemPrompt !== undefined || !partial) {
    const s = typeof data.systemPrompt === "string" ? data.systemPrompt : "";
    if (!s.trim()) return { ok: false, error: "systemPrompt tidak boleh kosong" };
    out.systemPrompt = s;
  }
  if (data.mode !== undefined) {
    if (!LIVE_PROMPT_MODES.includes(data.mode)) {
      return { ok: false, error: "mode harus 'prepend', 'replace', atau 'append'" };
    }
    out.mode = data.mode;
  }
  if (data.isActive !== undefined) out.isActive = data.isActive ? 1 : 0;
  return { ok: true, value: out };
}

// ---------------------------------------------------------- model_brands
export async function getModelBrands({ activeOnly = false } = {}) {
  const db = await getAdapter();
  const rows = activeOnly
    ? db.all(`SELECT * FROM model_brands WHERE isActive = 1 ORDER BY brandModelId ASC`)
    : db.all(`SELECT * FROM model_brands ORDER BY brandModelId ASC`);
  return rows.map(rowToBrand);
}

export async function getModelBrandById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToBrand(db.get(`SELECT * FROM model_brands WHERE id = ?`, [id]));
}

export async function getModelBrandByBrandId(brandModelId) {
  if (!brandModelId) return null;
  const db = await getAdapter();
  return rowToBrand(
    db.get(`SELECT * FROM model_brands WHERE brandModelId = ?`, [String(brandModelId).trim()])
  );
}

// Resolve a client-facing brand id to its upstream provider/model.
// Inactive brands do NOT resolve (a request with the brand id then fails
// as an unknown model — same as a brand that never existed).
export async function resolveBrandModel(brandModelId) {
  const brand = await getModelBrandByBrandId(brandModelId);
  if (!brand || !brand.isActive) return null;
  return { provider: brand.upstreamProvider, model: brand.upstreamModel, brand };
}

export async function createModelBrand(data) {
  const checked = validateBrandInput(data);
  if (!checked.ok) throw new Error(checked.error);
  const db = await getAdapter();
  const existing = db.get(`SELECT id FROM model_brands WHERE brandModelId = ?`, [checked.value.brandModelId]);
  if (existing) throw new Error(`Brand '${checked.value.brandModelId}' sudah ada`);
  const now = new Date().toISOString();
  const brand = {
    id: uuidv4(),
    brandModelId: checked.value.brandModelId,
    upstreamProvider: checked.value.upstreamProvider,
    upstreamModel: checked.value.upstreamModel,
    displayName: checked.value.displayName || checked.value.brandModelId,
    isActive: checked.value.isActive ?? 1,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO model_brands(id, brandModelId, upstreamProvider, upstreamModel, displayName, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [brand.id, brand.brandModelId, brand.upstreamProvider, brand.upstreamModel, brand.displayName, brand.isActive, brand.createdAt, brand.updatedAt]
  );
  return getModelBrandById(brand.id);
}

export async function updateModelBrand(id, data) {
  const checked = validateBrandInput(data, { partial: true });
  if (!checked.ok) throw new Error(checked.error);
  const db = await getAdapter();
  const current = await getModelBrandById(id);
  if (!current) return null;
  if (checked.value.brandModelId && checked.value.brandModelId !== current.brandModelId) {
    const clash = db.get(`SELECT id FROM model_brands WHERE brandModelId = ? AND id != ?`, [checked.value.brandModelId, id]);
    if (clash) throw new Error(`Brand '${checked.value.brandModelId}' sudah ada`);
  }
  const next = {
    ...current,
    ...checked.value,
    displayName: checked.value.displayName !== undefined
      ? (checked.value.displayName || checked.value.brandModelId || current.brandModelId)
      : current.displayName,
    updatedAt: new Date().toISOString(),
  };
  db.run(
    `UPDATE model_brands SET brandModelId = ?, upstreamProvider = ?, upstreamModel = ?, displayName = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    [next.brandModelId, next.upstreamProvider, next.upstreamModel, next.displayName, next.isActive ? 1 : 0, next.updatedAt, id]
  );
  return getModelBrandById(id);
}

export async function deleteModelBrand(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM model_brands WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// ---------------------------------------------------------- live_prompts
export async function getLivePrompts({ activeOnly = false } = {}) {
  const db = await getAdapter();
  const rows = activeOnly
    ? db.all(`SELECT * FROM live_prompts WHERE isActive = 1 ORDER BY updatedAt DESC`)
    : db.all(`SELECT * FROM live_prompts ORDER BY updatedAt DESC`);
  return rows.map(rowToLivePrompt);
}

export async function getLivePromptById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToLivePrompt(db.get(`SELECT * FROM live_prompts WHERE id = ?`, [id]));
}

// A live prompt targets exactly one scope: a brand, a provider+model, or
// a whole provider (model NULL). Two rows at the same specificity would
// make the lookup ambiguous, so create/update refuses the duplicate.
async function findConflictingLivePrompt(db, { brandModelId, provider, model }, excludeId = null) {
  const rows = db.all(`SELECT * FROM live_prompts`);
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const p = rowToLivePrompt(row);
    if (brandModelId && p.brandModelId === brandModelId) return p;
    if (provider && !brandModelId && !p.brandModelId && p.provider === provider
      && (p.model || null) === (model || null)) return p;
  }
  return null;
}

export async function createLivePrompt(data) {
  const checked = validateLivePromptInput(data);
  if (!checked.ok) throw new Error(checked.error);
  const v = checked.value;
  if (!v.brandModelId && !v.provider) {
    throw new Error("Live prompt harus menarget brand (brandModelId) atau provider");
  }
  if (v.model && !v.provider) {
    throw new Error("model hanya berlaku bersama provider");
  }
  const db = await getAdapter();
  const clash = await findConflictingLivePrompt(db, v);
  if (clash) throw new Error("Sudah ada live prompt untuk target yang sama");
  const now = new Date().toISOString();
  const prompt = {
    id: uuidv4(),
    brandModelId: v.brandModelId || null,
    provider: v.provider || null,
    model: v.model || null,
    systemPrompt: v.systemPrompt,
    mode: v.mode || "prepend",
    isActive: v.isActive ?? 1,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO live_prompts(id, brandModelId, provider, model, systemPrompt, mode, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [prompt.id, prompt.brandModelId, prompt.provider, prompt.model, prompt.systemPrompt, prompt.mode, prompt.isActive, prompt.createdAt, prompt.updatedAt]
  );
  return getLivePromptById(prompt.id);
}

export async function updateLivePrompt(id, data) {
  const checked = validateLivePromptInput(data, { partial: true });
  if (!checked.ok) throw new Error(checked.error);
  const db = await getAdapter();
  const current = await getLivePromptById(id);
  if (!current) return null;
  const next = { ...current, ...checked.value, updatedAt: new Date().toISOString() };
  if (!next.brandModelId && !next.provider) {
    throw new Error("Live prompt harus menarget brand (brandModelId) atau provider");
  }
  if (next.model && !next.provider) {
    throw new Error("model hanya berlaku bersama provider");
  }
  const clash = await findConflictingLivePrompt(db, next, id);
  if (clash) throw new Error("Sudah ada live prompt untuk target yang sama");
  db.run(
    `UPDATE live_prompts SET brandModelId = ?, provider = ?, model = ?, systemPrompt = ?, mode = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    [next.brandModelId, next.provider, next.model, next.systemPrompt, next.mode, next.isActive ? 1 : 0, next.updatedAt, id]
  );
  return getLivePromptById(id);
}

export async function deleteLivePrompt(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM live_prompts WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Lookup order for one request (first match wins, active rows only):
//   1. the brand the request used (brandModelId),
//   2. the exact upstream provider+model,
//   3. the whole upstream provider (model NULL).
// A brand-scoped prompt beats a provider-scoped one even when both exist.
export async function findLivePromptForRequest({ brandModelId, provider, model } = {}) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM live_prompts WHERE isActive = 1 ORDER BY updatedAt DESC`)
    .map(rowToLivePrompt);
  if (brandModelId) {
    const byBrand = rows.find((p) => p.brandModelId === brandModelId);
    if (byBrand) return byBrand;
  }
  if (provider && model) {
    const exact = rows.find((p) => !p.brandModelId && p.provider === provider && p.model === model);
    if (exact) return exact;
  }
  if (provider) {
    const byProvider = rows.find((p) => !p.brandModelId && p.provider === provider && !p.model);
    if (byProvider) return byProvider;
  }
  return null;
}
