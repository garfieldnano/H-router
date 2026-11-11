import { NextResponse } from "next/server";
import { getDistinctProviders } from "@/lib/requestDetailsDb";
import { getMemberDistinctProviders } from "@/lib/usageDb";
import { getProviderNodes } from "@/lib/localDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { getRequestMemberSession } from "@/lib/auth/memberAuth";
import { getApiKeysByMemberId } from "@/lib/localDb";

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET() {
  try {
    // Members: only providers they actually used (from their own
    // usageHistory rows). The requestDetails table has no apiKey column,
    // so its global distinct list cannot be scoped.
    const member = await getRequestMemberSession();
    if (member) {
      const ownKeys = await getApiKeysByMemberId(member.memberId);
      const providerIds = await getMemberDistinctProviders(ownKeys.map((k) => k.key));
      const providerNodes = await getProviderNodes();
      const nodeMap = {};
      for (const node of providerNodes) {
        nodeMap[node.id] = node.name;
      }
      const providers = providerIds.map(providerId => {
        let name = providerId;
        if (nodeMap[providerId]) {
          name = nodeMap[providerId];
        } else {
          const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
          if (providerConfig?.name) name = providerConfig.name;
        }
        return { id: providerId, name };
      });
      return NextResponse.json({ providers });
    }

    // Query DISTINCT provider column directly — avoids parsing every row's
    // full JSON blob (can be hundreds of MB), which previously caused OOM.
    const providerIds = await getDistinctProviders();

    const providerNodes = await getProviderNodes();
    const nodeMap = {};
    for (const node of providerNodes) {
      nodeMap[node.id] = node.name;
    }

    const providers = providerIds.map(providerId => {
      let name = providerId;
      if (nodeMap[providerId]) {
        name = nodeMap[providerId];
      } else {
        const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
        if (providerConfig?.name) name = providerConfig.name;
      }
      return { id: providerId, name };
    });

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[API] Failed to get providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
