import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getSettings } from "@/lib/localDb";
import { getTelegramBotSettings } from "@/lib/bot/payment";

export const dynamic = "force-dynamic";

// GET /api/bot/config — bot runtime config (no secrets).
// Tells the bot process the owner chat id, bot username, and whether
// payment details are configured. Env overrides are applied by the bot.
export async function GET(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const settings = await getSettings();
    const bot = getTelegramBotSettings(settings);
    return NextResponse.json({
      ownerChatId: bot.ownerChatId,
      botUsername: bot.botUsername,
      paymentConfigured: Boolean(
        (bot.payment.bankName && bot.payment.accountNumber) ||
        (bot.payment.ewalletName && bot.payment.ewalletNumber)
      ),
    });
  } catch (error) {
    console.log("Error reading bot config:", error);
    return NextResponse.json({ error: "Failed to read bot config" }, { status: 500 });
  }
}
