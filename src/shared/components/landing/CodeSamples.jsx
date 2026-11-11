"use client";

import { useMemo, useState } from "react";
import { buildCodeSamples } from "@/shared/utils/landing.js";
import { LANDING_CONFIG } from "@/shared/constants/landing.js";
import CopyButton from "./CopyButton.jsx";

const TABS = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
];

// "Mulai" section: code samples for the public gateway. One base URL
// (LANDING_CONFIG.baseUrl), a placeholder key, and the first catalog model
// id when known — never a made-up model id.
export default function CodeSamples({ sampleModelId }) {
  const [tab, setTab] = useState("curl");
  const samples = useMemo(
    () =>
      buildCodeSamples({
        baseUrl: LANDING_CONFIG.baseUrl,
        apiKey: LANDING_CONFIG.sampleApiKey,
        model: sampleModelId,
      }),
    [sampleModelId]
  );

  return (
    <section id="mulai" aria-label="Mulai" className="mx-auto mt-20 w-full max-w-6xl scroll-mt-24 px-6">
      <p className="text-xs font-bold uppercase tracking-widest text-[#05a843] dark:text-[#05f170]">Mulai</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900 md:text-4xl dark:text-white">
        Mulai dari sini.
      </h2>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Salin contoh di bawah, ganti kunci dan id model, lalu kirim request pertama.
      </p>

      <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="flex gap-1" role="tablist" aria-label="Bahasa contoh kode">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.id
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <CopyButton text={samples[tab]} label="Salin kode" />
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          <code>{samples[tab]}</code>
        </pre>
        <p className="border-t border-zinc-200 px-4 py-2 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Base URL <span className="font-semibold text-zinc-800 dark:text-zinc-200">{LANDING_CONFIG.baseUrl}</span>
        </p>
      </div>
    </section>
  );
}
