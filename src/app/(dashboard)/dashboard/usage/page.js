"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Segmented } from "antd";
import { RequestLogger, CardSkeleton } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import { useMemberRole } from "@/shared/hooks/useMemberRole";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMember = useMemberRole();

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          options={
            // Members have no per-request conversation details: those rows
            // carry no API key, so they cannot be attributed to a member
            // and the server returns an empty list for them.
            isMember
              ? [{ value: "overview", label: "Overview" }]
              : [
                  { value: "overview", label: "Overview" },
                  { value: "details", label: "Details" },
                ]
          }
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <Segmented
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            onChange={setPeriod}
            size="small"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" &&
        (isMember ? (
          <p className="text-sm text-text-muted">
            Per-request conversation details are not available for member
            accounts — they cannot be attributed to a single API key.
          </p>
        ) : (
          <RequestDetailsTab />
        ))}
    </div>
  );
}
