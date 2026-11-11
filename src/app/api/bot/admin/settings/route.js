import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import {
  getSettings, getProviderConnections, getProxyPools, getCombos, getRecentLogs,
} from "@/lib/localDb";
import { getTelegramBotSettings } from "@/lib/bot/payment";

export const dynamic = "force-dynamic";

// GET /api/bot/admin/settings — summary of the full web admin surface for
// the bot admin panel. Counts + flags; per-CLI-tool settings and the
// translator/skills/MITM editors live on the web (linked from the bot).
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const [settings, providers, pools, combos, recentLogs] = await Promise.all([
      getSettings(), getProviderConnections(), getProxyPools(), getCombos(), getRecentLogs(10),
    ]);
    const bot = getTelegramBotSettings(settings);
    return NextResponse.json({
      counts: {
        providers: providers.length,
        activeProviders: providers.filter((p) => p.isActive !== false).length,
        proxyPools: pools.length,
        combos: combos.length,
      },
      flags: {
        requireLogin: settings.requireLogin,
        requireApiKey: settings.requireApiKey,
        rtkEnabled: settings.rtkEnabled,
        cloudEnabled: settings.cloudEnabled,
        tunnelEnabled: settings.tunnelEnabled,
      },
      // RPM (schema v5): global default requests-per-minute.
      defaultRpmLimit: settings.defaultRpmLimit ?? 50,
      telegramBot: bot,
      recentLogs,
    });
  } catch (error) {
    console.log("Error fetching bot admin settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}
