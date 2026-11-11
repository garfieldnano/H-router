import { NextResponse } from "next/server";
import { getLivePrompts, createLivePrompt } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/live-prompts*, this check is defense in depth. The prompt text
// itself is an admin secret — it is only ever served to admin sessions.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/live-prompts — list live prompts (admin web panel)
export async function GET() {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const prompts = await getLivePrompts();
    return NextResponse.json({ prompts });
  } catch (error) {
    console.log("Error fetching live prompts:", error);
    return NextResponse.json({ error: "Failed to fetch live prompts" }, { status: 500 });
  }
}

// POST /api/live-prompts — create a live prompt (admin web panel)
export async function POST(request) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const data = await request.json();
    const prompt = await createLivePrompt(data);
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    console.log("Error creating live prompt:", error);
    return NextResponse.json({ error: error.message || "Failed to create live prompt" }, { status: 400 });
  }
}
