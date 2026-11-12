"use client";

import { useMemo, useState } from "react";
import { Card, Tabs, Typography } from "antd";
import { buildCodeSamples } from "@/shared/utils/landing.js";
import { LANDING_CONFIG } from "@/shared/constants/landing.js";
import CopyButton from "./CopyButton.jsx";

const TABS = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
];

// "Mulai" section: code samples for the public gateway. One base URL
// (the `baseUrl` prop — the real deployed address, resolved per request
// by the page; defaults to LANDING_CONFIG.baseUrl), a placeholder key,
// and the first catalog model id when known — never a made-up model id.
export default function CodeSamples({ sampleModelId, baseUrl = LANDING_CONFIG.baseUrl }) {
  const [tab, setTab] = useState("curl");
  const samples = useMemo(
    () =>
      buildCodeSamples({
        baseUrl,
        apiKey: LANDING_CONFIG.sampleApiKey,
        model: sampleModelId,
      }),
    [sampleModelId, baseUrl]
  );

  return (
    <section id="mulai" aria-label="Mulai" className="mx-auto mt-16 w-full max-w-6xl scroll-mt-24 px-6">
      <p className="text-xs font-bold uppercase tracking-widest text-[#027a39] dark:text-[#05f170]">Mulai</p>
      <Typography.Title level={2} className="!mt-2 !text-3xl !font-extrabold !tracking-tight md:!text-4xl">
        Mulai dari sini.
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="!mt-2 !max-w-2xl">
        Salin contoh di bawah, ganti kunci dan id model, lalu kirim request pertama.
      </Typography.Paragraph>

      <Card
        className="mt-8"
        styles={{ body: { padding: 0 } }}
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
            <Tabs
              size="small"
              activeKey={tab}
              onChange={setTab}
              tabBarStyle={{ margin: 0 }}
              items={TABS.map((t) => ({ key: t.id, label: t.label }))}
            />
            <CopyButton text={samples[tab]} label="Salin kode" />
          </div>
        }
      >
        {/* key={tab} remounts the block per tab, so the panel height is
            always computed from the active snippet alone — a shorter
            snippet (cURL) never inherits the taller tab's height. */}
        <pre key={tab} className="mb-0 overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          <code>{samples[tab]}</code>
        </pre>
        <Typography.Text type="secondary" className="block border-t border-zinc-200 px-4 py-2 font-mono text-xs dark:border-zinc-800">
          Base URL{" "}
          <Typography.Text
            strong
            className="inline-block max-w-[240px] cursor-pointer truncate align-middle font-mono text-xs"
            title={baseUrl}
            onClick={() => navigator.clipboard?.writeText(baseUrl)}
          >
            {baseUrl}
          </Typography.Text>
        </Typography.Text>
      </Card>
    </section>
  );
}
