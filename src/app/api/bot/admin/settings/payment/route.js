import { NextResponse } from "next/server";
import { requireBotService } from "@/lib/bot/serviceAuth";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/bot/admin/settings/payment — set manual-transfer payment details.
// Body: { bankName, accountNumber, accountName, ewalletName, ewalletNumber, notes }.
// Empty strings clear a field. Prices are never here — packages own prices.
export async function POST(request) {
  const denied = requireBotService(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const fields = ["bankName", "accountNumber", "accountName", "ewalletName", "ewalletNumber", "notes"];
    const payment = {};
    for (const f of fields) {
      if (body?.[f] !== undefined) payment[f] = String(body[f]).trim();
    }
    const settings = await getSettings();
    const currentBot = settings.telegramBot || {};
    const nextBot = {
      ...currentBot,
      payment: { ...(currentBot.payment || {}), ...payment },
    };
    // Partial update — updateSettings merges, so only telegramBot is written.
    await updateSettings({ telegramBot: nextBot });
    return NextResponse.json({ payment: nextBot.payment });
  } catch (error) {
    console.log("Error updating bot payment settings:", error);
    return NextResponse.json({ error: "Failed to update payment settings" }, { status: 500 });
  }
}
