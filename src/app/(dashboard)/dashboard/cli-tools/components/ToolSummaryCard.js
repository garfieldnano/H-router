"use client";

import Link from "next/link";
import Image from "next/image";
import { Card, Tag } from "antd";

// Derive simple connected/configured/not-installed status from API payload
function getStatus(status, tool) {
  if (tool?.configType === "guide") return { label: "Guide", color: "blue" };
  if (!status) return { label: "Unknown", color: "default" };
  if (!status.installed) return { label: "Not installed", color: "default" };
  if (status.has9Router) return { label: "Connected", color: "success" };
  return { label: "Not configured", color: "warning" };
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const s = getStatus(status, tool);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block">
      <Card styles={{ body: { padding: 16 } }} className="hcard h-full overflow-hidden hover:border-success/50 transition-colors cursor-pointer">
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="size-8 flex items-center justify-center shrink-0">
              {tool.image ? (
                <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-md" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
              ) : tool.icon ? (
                <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }}>{tool.icon}</span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{tool.name}</h3>
              <Tag color={s.color} style={{ marginTop: 4 }}>{s.label}</Tag>
            </div>
            <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
