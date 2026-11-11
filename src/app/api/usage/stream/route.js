import { getUsageStats, getMemberUsageStats, statsEmitter, getActiveRequests, getMemberActiveRequests, sanitizeUsageStatsForBrowser } from "@/lib/usageDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { getApiKeysByMemberId } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// Same periods as /api/usage/stats. The G7 Live Traffic page passes
// ?period=today for "requests today" totals; existing callers (UsageStats)
// send no period and keep the old "all" behavior.
const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  const period = request?.nextUrl?.searchParams?.get("period") || new URL(request.url).searchParams.get("period") || "all";
  if (!VALID_PERIODS.has(period)) {
    return new Response(JSON.stringify({ error: "Invalid period" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Members get ONLY their own usage: member stats + member-filtered live
  // feed. Active per-account requests cannot be attributed to an API key,
  // so getMemberActiveRequests omits them (and the global error provider).
  const member = await getRequestMemberSession();
  const ownKeyValues = member
    ? (await getApiKeysByMemberId(member.memberId)).map((k) => k.key)
    : null;

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = member
              ? await getMemberActiveRequests(ownKeyValues)
              : await getActiveRequests();
            const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache.
          // Sanitize before sending: getUsageStats() keys byApiKey by the
          // RAW apiKey composite — full key values must never reach the
          // browser (G7). recentRequests / activeRequests already carry
          // masked keys only.
          const stats = member
            ? await getMemberUsageStats(ownKeyValues, period)
            : sanitizeUsageStatsForBrowser(await getUsageStats(period));
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = member
            ? await getMemberActiveRequests(ownKeyValues)
            : await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
