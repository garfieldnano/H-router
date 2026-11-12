import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getSettings, getProviderConnections } from "@/lib/localDb";
import { applyVisionOverrideToCaps } from "@/shared/utils/visionAdapter.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps: {
            vision: c.vision,
            search: c.search,
            reasoning: c.reasoning,
            contextWindow: c.contextWindow,
            maxOutput: c.maxOutput,
          },
        };
      });

    // Custom models ride along; their stored caps override the name heuristic.
    // A custom row whose provider alias routes to an already-listed model is a
    // pure shadow: the real entry wins (and is listed first), but this row would
    // land later with the same routedModel key and the client's last-write-wins
    // map then serves its thinner caps (a pre-registry "add custom model" row
    // stores {vision, reasoning} only — no contextWindow). Drop the shadow and
    // resolve the survivors' provider id, not the UI alias: the capability
    // tables are keyed by provider id, and an alias like `ocg` misses the
    // provider-scoped entries and falls back to the generic patterns.
    //
    // Display alias: a user-created provider is stored under its raw id
    // (openai-compatible-chat-…), but the gateway routes it by the friendly
    // prefix the admin gave it (e.g. "coarena") — the same prefix /v1/models
    // uses. The picker's value (routedModel) uses the friendly alias so the
    // landing catalog, the public catalog and /v1/models all agree
    // (coarena/claude-fable-5); fullModel keeps the raw id so alias lookups
    // and capability tables (keyed by provider id) keep working.
    let prefixByProvider = new Map();
    try {
      const connections = await getProviderConnections();
      for (const conn of Array.isArray(connections) ? connections : []) {
        const prefix = conn?.providerSpecificData?.prefix;
        if (conn?.provider && typeof prefix === "string" && prefix.trim()) {
          prefixByProvider.set(conn.provider, prefix.trim());
        }
      }
    } catch {
      prefixByProvider = new Map();
    }
    const displayAlias = (providerId) =>
      prefixByProvider.get(providerId) || getProviderAlias(providerId) || providerId;
    const seenFull = new Set(models.map((m) => m.fullModel));
    const seenRouted = new Set(models.map((m) => m.routedModel));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      if (seenRouted.has(`${displayAlias(m.providerAlias)}/${m.id}`)) return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const providerId = ALIAS_TO_ID[m.providerAlias] || m.providerAlias;
      const c = getCapabilitiesForModel(providerId, m.id);
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: `${displayAlias(m.providerAlias)}/${m.id}`,
        alias: modelAliases[fullModel] || m.id,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
          ...(m.caps || {}),
        },
      });
    }

    // Vision Adapter (plan G10): admin overrides win over the advertised
    // caps, so the dashboard shows the same vision capability the chat
    // gate enforces. Fail-open when settings cannot be read.
    try {
      const { visionOverrides } = await getSettings();
      if (visionOverrides && typeof visionOverrides === "object") {
        for (const m of models) {
          if (!m?.caps) continue;
          m.caps = applyVisionOverrideToCaps(m.caps, m.fullModel || m.routedModel, visionOverrides);
        }
      }
    } catch { /* fail-open: serve the un-overridden caps */ }

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
