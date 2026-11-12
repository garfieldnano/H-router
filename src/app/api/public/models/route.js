import { NextResponse } from "next/server";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { AI_PROVIDERS, getProviderAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getCustomModels } from "@/models";

// GET /api/public/models — public catalog for the landing page.
//
// Returns the models the admin panel publishes: the curated AI_MODELS list
// minus models the admin disabled, plus the admin's custom models. This is
// the admin panel's model settings as the public sees them — the landing
// catalog reads this endpoint first, so disabling a model in the Console
// removes it from the landing, and adding a custom model publishes it.
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
    const seenRouted = new Set(models.map((m) => m.id));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenRouted.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      models.push({
        id: `${m.providerAlias}/${m.id}`,
        name: m.name || m.id,
        owned_by: displayName(m.providerAlias),
      });
    }

    return NextResponse.json({ data: models, total: models.length });
  } catch (error) {
    console.log("Error fetching public models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
