import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { extractConversationTurns } from "@/shared/utils/conversations.js";

export const dynamic = "force-dynamic";

// Admin-only: the dashboard guard blocks member sessions from
// /api/conversations*, this check is defense in depth.
async function forbidMember() {
  if (await getRequestMemberSession()) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  return null;
}

// GET /api/conversations/[id] — one stored request as a conversation.
// Built on the existing requestDetails store (plan G7): no conversations
// table. Returns the extracted turns (user / assistant / tool) + metadata.
//
// Anti-leak (plan #2): the stored request/response bodies already had any
// injected live prompt replaced by the placeholder at save time
// (buildRequestDetail + sanitizeLivePromptFromBody). This route returns
// only the extracted turns and metadata — never raw headers or raw
// request/response bodies.
export async function GET(request, { params }) {
  try {
    const denied = await forbidMember();
    if (denied) return denied;

    const { id } = await params;
    const detail = await getRequestDetailById(decodeURIComponent(id));
    if (!detail) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { turns, liveInjected } = extractConversationTurns(detail);
    return NextResponse.json({
      detail: {
        id: detail.id,
        timestamp: detail.timestamp,
        provider: detail.provider,
        model: detail.model,
        connectionId: detail.connectionId || null,
        status: detail.status || "success",
        latency: detail.latency || {},
        tokens: detail.tokens || {},
        liveInjected,
      },
      turns,
    });
  } catch (error) {
    console.error("[API] Failed to get conversation:", error);
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}
