"use client";

import { useState } from "react";
import { Button, Empty, List, Tag, Typography } from "antd";
import { LANDING_BRANDS } from "@/shared/constants/landing.js";
import { resolveModelBrand } from "@/shared/utils/landing.js";
import CopyButton from "./CopyButton.jsx";

const PAGE_SIZE = 12;

// Brand mark for one catalog row: the model's brand logo (vendored SVG)
// in a white chip so the monochrome mark reads in both themes, or a
// styled initial badge when the brand has no logo. Nothing renders when
// the brand cannot be resolved at all.
function BrandAvatar({ model }) {
  const brand = resolveModelBrand({ id: model.id, ownedBy: model.ownedBy, brands: LANDING_BRANDS });
  if (!brand) return null;
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white shadow-sm">
      {brand.logo ? (
        <img src={brand.logo} alt={brand.name} width={20} height={20} loading="lazy" className="h-5 w-5" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-extrabold text-white"
        >
          {brand.name.charAt(0)}
        </span>
      )}
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
          <List
            bordered
            className="mt-8"
            dataSource={visible}
            renderItem={(m) => (
              <List.Item
                actions={[
                  m.tier ? (
                    <Tag key="tier" color={m.tier === "FREE" ? "green" : "default"}>
                      {m.tier}
                    </Tag>
                  ) : null,
                  <CopyButton key="copy" text={m.id} />,
                ]}
              >
                <List.Item.Meta
                  avatar={<BrandAvatar model={m} />}
                  title={
                    <Typography.Text strong className={m.name && m.name !== m.id ? "text-sm" : "font-mono text-sm"}>
                      {m.name || m.id}
                    </Typography.Text>
                  }
                  description={
                    m.name && m.name !== m.id ? (
                      <Typography.Text type="secondary" className="font-mono text-xs">{m.id}</Typography.Text>
                    ) : m.ownedBy ? (
                      <Typography.Text type="secondary" className="text-xs">{m.ownedBy}</Typography.Text>
                    ) : null
                  }
                />
              </List.Item>
            )}
          />
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
