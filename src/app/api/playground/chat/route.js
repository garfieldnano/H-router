import { NextResponse } from "next/server";
import { getApiKeys, resolveBrandModel } from "@/lib/localDb";
import { calculateCost } from "@/lib/usageDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { canonicalizeUsage } from "open-sse/utils/usageTracking.js";
import { buildPlaygroundBody, parsePlaygroundResponse, pickPlaygroundApiKey } from "@/shared/utils/playground.js";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/playground*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

// POST /api/playground/chat — run one prompt through the gateway (G7).
// The request is executed by the SAME handleChat() the /v1 route uses, so
// brand resolution, applyLive, RPM / IP-cap / key-access gates and usage
// recording behave exactly like a real client call. The call runs as an
// admin API key (chosen by the admin, or the first active key); without
// any active key the playground cannot run and says so plainly.
// Always non-streaming: the page renders one complete answer + usage.
export async function POST(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const data = await request.json().catch(() => ({}));
    const checked = buildPlaygroundBody(data || {});
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    const keys = await getApiKeys();
    const apiKey = pickPlaygroundApiKey(keys, data.apiKeyId);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Belum ada API key aktif — buat dulu di halaman Endpoint & Key" },
        { status: 400 }
      );
    }

    await ensureTranslators();

    // Synthetic /v1 request. No x-9r-real-ip header: the IP-cap gate
    // skips the cap when the header is absent (same as any local call),
    // while RPM + key-access still apply to the chosen key.
    const upstream = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.key}`,
      },
      body: JSON.stringify(checked.body),
    });

    const res = await handleChat(upstream);
    let json = null;
    try {
      json = await res.json();
    } catch {
      return NextResponse.json(
        { error: "Gateway mengembalikan respons yang bukan JSON" },
        { status: 502 }
      );
    }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || `Gateway error (${res.status})`;
      return NextResponse.json({ error: typeof msg === "string" ? msg : "Gateway error" }, { status: res.status });
    }

    const parsed = parsePlaygroundResponse(json);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 502 });
    }

    // Cost for the answer, priced exactly like usage recording does.
    let cost = null;
    try {
      let provider = null;
      let modelName = checked.body.model;
      try {
        const brand = await resolveBrandModel(checked.body.model);
        if (brand) {
          provider = brand.provider;
          modelName = brand.model;
        }
      } catch {}
      if (!provider && modelName.includes("/")) {
        [provider, modelName] = [modelName.slice(0, modelName.indexOf("/")), modelName.slice(modelName.indexOf("/") + 1)];
      }
      const tokens = canonicalizeUsage({
        prompt_tokens: parsed.usage.promptTokens,
        completion_tokens: parsed.usage.completionTokens,
      }) || {
        prompt_tokens: parsed.usage.promptTokens,
        completion_tokens: parsed.usage.completionTokens,
      };
      const c = await calculateCost(provider, modelName, tokens);
      if (typeof c === "number" && Number.isFinite(c)) cost = c;
    } catch {}

    return NextResponse.json({
      content: parsed.content,
      usage: parsed.usage,
      cost,
      model: parsed.model || checked.body.model,
      finishReason: parsed.finishReason,
      apiKeyId: apiKey.id,
      apiKeyName: apiKey.name || apiKey.id,
    });
  } catch (error) {
    console.error("[API] Playground chat failed:", error);
    return NextResponse.json({ error: "Playground gagal — coba lagi" }, { status: 500 });
  }
}
