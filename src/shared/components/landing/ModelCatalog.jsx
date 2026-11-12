"use client";

import { useState } from "react";
import { Button, Empty, List, Tag, Typography } from "antd";
import { LANDING_BRANDS } from "@/shared/constants/landing.js";
import { resolveModelBrand } from "@/shared/utils/landing.js";
import CopyButton from "./CopyButton.jsx";

const PAGE_SIZE = 12;

// Brand mark for one catalog row: the model's brand logo only — no chip,
// no background, so the mark sits clean on the page (dark or light).
// A styled initial badge only when the brand has no logo. Nothing renders
// when the brand cannot be resolved at all.
function BrandAvatar({ model }) {
  const brand = resolveModelBrand({ id: model.id, ownedBy: model.ownedBy, brands: LANDING_BRANDS });
  if (!brand) return null;
  if (brand.logo) {
    return <img src={brand.logo} alt={brand.name} width={28} height={28} loading="lazy" className="h-7 w-7 shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-extrabold text-white"
    >
      {brand.name.charAt(0)}
    </span>
  );
}

// Live signal that fills the empty middle of a catalog row: a "Live"
// badge at a fixed spot plus a full-width equalizer (many bars spanning
// the whole middle, staggered) so the animation is long and every row's
// signal starts at the same x. Pure CSS, subtle green, so the row reads
// as a live model instead of an empty gap between the name and the copy
// button.
function LiveSignal() {
  const BARS = 22;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3" aria-hidden="true">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
        <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-[#05a843] dark:bg-[#05f170]" />
        Live
      </span>
      <span className="flex h-4 min-w-0 flex-1 items-end gap-[2px]">
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            className="animate-wave min-w-0 flex-1 rounded-full bg-[#05a843] dark:bg-[#05f170]"
            style={{ height: "100%", animationDelay: `${(i % 7) * 0.13}s` }}
          />
        ))}
      </span>
    </span>
  );
}

// Data-driven model catalog. `catalog` comes from the parent page:
// { models, total, source, loading } — the admin panel's published list
// first (source "admin"), live /v1/models data next, FALLBACK_MODELS only
// when the gateway list is unreachable, empty state when neither source
// has anything. Tiers render only when the entry actually carries one
// ("FREE"/"PRO"); live entries have none.
export default function ModelCatalog({ catalog }) {
  const [expanded, setExpanded] = useState(false);
  const { models, total, source, loading } = catalog;
  const visible = expanded ? models : models.slice(0, PAGE_SIZE);

  return (
    <section id="katalog" aria-label="Katalog model" className="mx-auto mt-20 w-full max-w-6xl scroll-mt-24 px-6">
      <p className="text-xs font-bold uppercase tracking-widest text-[#05a843] dark:text-[#05f170]">Katalog</p>
      <Typography.Title level={2} className="!mt-2 !text-3xl !font-extrabold !tracking-tight md:!text-4xl">
        Model yang tersedia.
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="!mt-2 !max-w-2xl">
        {loading
          ? "Memuat daftar model dari gateway…"
          : total > 0
            ? `${total} model · klik baris untuk menyalin id`
            : "Belum ada model yang dipublikasikan."}
      </Typography.Paragraph>

      {loading ? (
        <List loading bordered dataSource={[]} renderItem={() => null} className="mt-8" />
      ) : models.length === 0 ? (
        <Empty
          className="mt-8 rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700"
          description="Belum ada model yang dipublikasikan. Hubungkan provider di Konsol, atau tambahkan model ke daftar cadangan di konfigurasi landing."
        />
      ) : (
        <>
          <div className="mt-8 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            {visible.map((m) => (
              <div
                key={m.id}
                className="flex cursor-pointer items-center gap-3 border-b border-zinc-200 px-4 py-3 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60"
                onClick={() => navigator.clipboard?.writeText(m.id)}
                title="Klik untuk menyalin id"
              >
                <BrandAvatar model={m} />
                <span
                  className={`w-48 shrink-0 truncate text-sm font-semibold ${
                    m.name && m.name !== m.id ? "" : "font-mono"
                  }`}
                >
                  {m.name || m.id}
                </span>
                <LiveSignal />
                {m.tier ? (
                  <Tag color={m.tier === "FREE" ? "green" : "default"} className="shrink-0">
                    {m.tier}
                  </Tag>
                ) : null}
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CopyButton text={m.id} />
                </span>
              </div>
            ))}
          </div>
          {total > PAGE_SIZE ? (
            <div className="mt-4 text-center">
              <Button type="default" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Tampilkan lebih sedikit" : `Tampilkan semua (${total})`}
              </Button>
            </div>
          ) : null}
          <Typography.Text type="secondary" className="mt-3 block text-xs">
            {source === "admin"
              ? "Daftar ini mengikuti pengaturan model di Konsol admin."
              : source === "live"
                ? "Daftar ini dibaca langsung dari /v1/models gateway ini."
                : "Daftar ini dari konfigurasi cadangan — gateway tidak mengembalikan daftar model tanpa kunci."}
          </Typography.Text>
        </>
      )}
    </section>
  );
}
