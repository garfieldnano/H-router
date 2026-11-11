"use client";

import { useState } from "react";
import { Button, Empty, List, Tag, Typography } from "antd";
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
                  title={
                    <Typography.Text strong className="font-mono text-sm">
                      {m.id}
                    </Typography.Text>
                  }
                  description={m.ownedBy ? <Typography.Text type="secondary" className="text-xs">{m.ownedBy}</Typography.Text> : null}
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
            {source === "live"
              ? "Daftar ini dibaca langsung dari /v1/models gateway ini."
              : "Daftar ini dari konfigurasi cadangan — gateway tidak mengembalikan daftar model tanpa kunci."}
          </Typography.Text>
        </>
      )}
    </section>
  );
}
