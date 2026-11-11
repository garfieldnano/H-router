"use client";

import { Button, Card, Tag } from "antd";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  SKILLS,
  SKILLS_REPO_URL,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <Button
      type="primary"
      size="small"
      onClick={() => copy(value)}
      title={value}
      icon={
        <span className="material-symbols-outlined text-[12px]">
          {copied ? "check" : "content_copy"}
        </span>
      }
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return (
    <Card
      styles={{ body: { padding: 16 } }}
      className={skill.isEntry ? "!border-[#05f170]/40 !bg-[#05f170]/5" : ""}
    >
      <div className="flex items-start gap-3">
        <div
          className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
            skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
            {skill.isEntry && <Tag color="#05f170">START HERE</Tag>}
            {skill.endpoint && (
              <Tag>
                <code className="text-[10px]">{skill.endpoint}</code>
              </Tag>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
          <a
            href={getSkillBlobUrl(skill.id)}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
          >
            {url}
            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
          </a>
        </div>

        <CopyButton value={url} />
      </div>
    </Card>
  );
}

export default function SkillsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <div className="text-xs text-text-muted mb-2">Paste this to your AI:</div>
        <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main">
          Read this skill and use it: {getSkillRawUrl("9router")}
        </div>
      </Card>

      <div className="space-y-2">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-main">More on GitHub</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Browse source, README, and examples.
            </p>
          </div>
          <a
            href={`${SKILLS_REPO_URL}/tree/master/skills`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
