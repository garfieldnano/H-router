import { NextResponse } from "next/server";
import { getLivePromptById, updateLivePrompt, deleteLivePrompt } from "@/lib/localDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";

export const dynamic = "force-dynamic";

async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

export async function GET(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const prompt = await getLivePromptById(id);
    if (!prompt) return NextResponse.json({ error: "Live prompt not found" }, { status: 404 });
    return NextResponse.json({ prompt });
  } catch (error) {
    console.log("Error fetching live prompt:", error);
    return NextResponse.json({ error: "Failed to fetch live prompt" }, { status: 500 });
  }
}

// PUT /api/live-prompts/[id] — edit a live prompt (admin web panel)
export async function PUT(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const data = await request.json();
    const prompt = await updateLivePrompt(id, data);
    if (!prompt) return NextResponse.json({ error: "Live prompt not found" }, { status: 404 });
    return NextResponse.json({ prompt });
  } catch (error) {
    console.log("Error updating live prompt:", error);
    return NextResponse.json({ error: error.message || "Failed to update live prompt" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;
    const { id } = await params;
    const deleted = await deleteLivePrompt(id);
    if (!deleted) return NextResponse.json({ error: "Live prompt not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error deleting live prompt:", error);
    return NextResponse.json({ error: "Failed to delete live prompt" }, { status: 500 });
  }
}
