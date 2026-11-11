"use client";

import { useState } from "react";
import CopyButton from "./CopyButton.jsx";

const PAGE_SIZE = 12;

// Data-driven model catalog. `catalog` comes from the parent page:
// { models, total, source, loading } — live /v1/models data first,
// FALLBACK_MODELS only when the gateway list is unreachable, empty state
// when neither source has anything. Tiers render only when the entry
// actually carries one ("FREE"/"PRO"); live entries have none.
export default function ModelCatalog({ catalog }) {
  const [expanded, setExpanded] = useState(false);
  const { models, total, source, loading } = catalog;
  const visible = expanded ? models : models.slice(0, PAGE_SIZE);

  return (
    <section id="katalog" aria-label="Katalog model" className="mx-auto mt-20 w-full max-w-6xl scroll-mt-24 px-6">
      <p className="text-xs font-bold uppercase tracking-widest text-[#05a843] dark:text-[#05f170]">Katalog</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900 md:text-4xl dark:text-white">
        Model yang tersedia.
      </h2>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
        {loading
          ? "Memuat daftar model dari gateway…"
          : total > 0
            ? `${total} model · klik baris untuk menyalin id`
            : "Belum ada model yang dipublikasikan."}
      </p>

      {loading ? (
        <p className="mt-8 rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Memuat model…
        </p>
      ) : models.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Belum ada model yang dipublikasikan. Hubungkan provider di Konsol, atau tambahkan model ke daftar
          cadangan di konfigurasi landing.
        </p>
      ) : (
        <>
          <ul className="mt-8 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {visible.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold text-zinc-900 dark:text-white">{m.id}</p>
                  {m.ownedBy ? (
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{m.ownedBy}</p>
                  ) : null}
                </div>
                {m.tier ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      m.tier === "FREE"
                        ? "bg-[#05f170]/15 text-[#038a3c] dark:text-[#05f170]"
                        : "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    }`}
                  >
                    {m.tier}
                  </span>
                ) : null}
                <CopyButton text={m.id} />
              </li>
            ))}
          </ul>
          {total > PAGE_SIZE ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {expanded ? "Tampilkan lebih sedikit" : `Tampilkan semua (${total})`}
              </button>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {source === "live"
              ? "Daftar ini dibaca langsung dari /v1/models gateway ini."
              : "Daftar ini dari konfigurasi cadangan — gateway tidak mengembalikan daftar model tanpa kunci."}
          </p>
        </>
      )}
    </section>
  );
}
