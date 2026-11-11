"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import MemberQuota from "./MemberQuota";
import { useMemberRole } from "@/shared/hooks/useMemberRole";

export default function QuotaPage() {
  // Members get their OWN quota only (MemberQuota, read-only). Admins keep
  // the full provider-limits manager.
  const isMember = useMemberRole();
  if (isMember) return <MemberQuota />;
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ProviderLimits />
    </Suspense>
  );
}
