import { NextResponse } from "next/server";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getSettings, getProviderConnections } from "@/lib/localDb";
import { AI_MODELS } from "@/shared/constants/config";
import { AI_PROVIDERS, getProviderAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { resolvePublishedModels } from "@/shared/utils/landing.js";
import { getCustomModels } from "@/models";

// GET /api/public/models — public catalog for the landing page.
//
// Returns the models the admin panel publishes: the curated AI_MODELS list
// minus models the admin disabled, plus the admin's custom models —
// restricted to settings.landingModels when the admin picked a landing
// catalog in Settings (empty = show everything). This is the admin panel's
// model settings as the public sees them — the landing catalog reads this
// endpoint first, so disabling a model in the Console removes it from the
// landing, adding a custom model publishes it, and picking a landing list
// shows exactly those models.
//
// Shape mirrors GET /v1/models ({ data: [{ id, name, owned_by }] }) so the
// landing normalizes it with the same helper. Public by design (see
// PUBLIC_API_PATHS in dashboardGuard.js): ids and display names only —
// no API keys, no aliases, no caps, no connection data.
function displayName(providerAlias) {
  const id = ALIAS_TO_ID[providerAlias] || providerAlias;
  return AI_PROVIDERS[id]?.name || providerAlias;
}

export async function GET() {
  try {
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        return {
          id: `${providerAlias}/${m.model}`,
          name: m.name || m.model,
          owned_by: displayName(providerAlias),
        };
      });

    // Custom models ride along, with the same dedup as GET /api/models: a
    // custom row that routes to an already-listed model is a pure shadow
    // and is dropped so it cannot replace the real entry's name.
    //
    // Display alias: a user-created provider (e.g. an OpenAI-compatible
    // one) is stored under its raw id (openai-compatible-chat-…), but the
    // gateway routes it by the friendly prefix the admin gave it (e.g.
    // "coarena") — the same prefix /v1/models uses. Resolve it here so the
    // public catalog, the Settings picker and /v1/models all show the same
    // id (coarena/claude-fable-5), not the raw provider id.
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
    const seenRouted = new Set(models.map((m) => m.id));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenRouted.has(`${displayAlias(m.providerAlias)}/${m.id}`);
    });
    for (const m of customModels) {
      const alias = displayAlias(m.providerAlias);
      models.push({
        id: `${alias}/${m.id}`,
        name: m.name || m.id,
        owned_by: displayName(alias),
      });
    }

    // Landing picker (Settings → Landing catalog): when the admin picked a
    // list, the catalog shows exactly those models, in the picked order.
    // Empty/missing = no restriction. Fail-open: a settings read failure
    // must not blank the public catalog.
    let picked = [];
    try {
      const settings = await getSettings();
      picked = settings?.landingModels;
    } catch {
      picked = [];
    }
    const published = resolvePublishedModels({ models, picked });

    return NextResponse.json({ data: published, total: published.length });
  } catch (error) {
    console.log("Error fetching public models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
