"use client";

import { useEffect, useState } from "react";
import { Button, Card, Statistic, Tag, Typography } from "antd";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { useTheme } from "@/shared/hooks/useTheme";
import { LANDING_CONFIG, FALLBACK_MODELS } from "@/shared/constants/landing.js";
import {
  fetchWithTimeout,
  normalizeModelsResponse,
  resolveCatalogModels,
} from "@/shared/utils/landing.js";
import StatusPanel from "./StatusPanel.jsx";
import ModelCatalog from "./ModelCatalog.jsx";
import CodeSamples from "./CodeSamples.jsx";
import FlowAnimation from "./FlowAnimation.jsx";
import BrandStrip from "./BrandStrip.jsx";

// h-router public landing page. Light mode by default (forced on first
// visit when no theme is stored yet — the reference design is light;
// returning visitors keep their stored choice), dark/light toggle in the
// header. Copy is written fresh for this product; the reference site
// (h-router.web.id) was used only for structure and visual language.
// Only user-facing features belong on the public landing page. Admin-only
// capabilities (RPM limits, compensation, relay, rebrand, IP cap, scanner,
// observability, Vision Adapter, RTK toggles) live in the admin panel and
// the repo docs — they are deliberately not advertised here.
const FEATURES = [
  {
    title: "Dashboard member",
    body: "Member masuk dengan API key dan melihat pemakaian serta kuncinya sendiri — read-only, tanpa bisa melihat data member lain.",
  },
  {
    title: "Bot Telegram",
    body: "Beli kunci, klaim trial 1 hari, dan cek kuota — semua dari Telegram, tanpa buka browser.",
  },
  {
    title: "Satu kunci, banyak model",
    body: "Satu API key untuk semua model; format OpenAI & Anthropic, streaming asli, dan reasoning effort.",
  },
  {
    title: "Trial gratis 1 hari",
    body: "Coba dulu tanpa bayar: klaim trial 1 hari dari bot, kunci langsung aktif.",
  },
  {
    title: "Kuota transparan",
    body: "Pemakaian dan sisa kuota tercatat dan bisa dicek sendiri kapan saja, di dashboard atau bot.",
  },
  {
    title: "Failover otomatis",
    body: "Kalau satu jalur bermasalah, request otomatis pindah ke jalur lain — tetap jalan tanpa perlu apa-apa.",
  },
];

const CORE_CHIPS = [
  "Dua format API",
  "Streaming SSE",
  "Failover combo",
  "Reasoning effort",
  "Kuota transparan",
];

const STEPS = [
  {
    n: "01",
    title: "Ambil API key",
    body: "Dapatkan kunci lewat bot Telegram atau dari panel — gratis dan langsung bisa dipakai.",
  },
  {
    n: "02",
    title: "Pilih model",
    body: "Satu base URL untuk semua model — ganti model tinggal ganti id-nya.",
  },
  {
    n: "03",
    title: "Kirim request",
    body: "Kirim ke /chat/completions (OpenAI) atau /messages (Anthropic), dengan streaming token demi token.",
  },
  {
    n: "04",
    title: "Pemakaian tercatat",
    body: "Token dan request tercatat otomatis di dashboard member — transparan, tanpa tagihan tersembunyi.",
  },
];

// antd primary buttons use white text on the brand green (#05f170),
// which is low contrast — the landing CTAs keep the dark text the
// original green buttons had (same override pattern as wave 2).
const GREEN_CTA_CLASS = "!text-zinc-950";

export default function LandingPage() {
  const { setTheme } = useTheme();
  const [catalog, setCatalog] = useState({ models: [], total: 0, source: "empty", loading: true });

  // Light mode default: first visit without a stored theme renders light.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("theme") === null) setTheme("light");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One live fetch of the gateway's own model list; the catalog and the
  // code sample share it. Falls back to FALLBACK_MODELS when the gateway
  // list is unreachable without a key. Hard 10s timeout: a hung request
  // must never leave the catalog on "Memuat model…" forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithTimeout("/v1/models", { timeoutMs: 10000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const live = normalizeModelsResponse(await res.json());
        if (!cancelled) {
          setCatalog({ ...resolveCatalogModels({ liveModels: live, fallbackModels: FALLBACK_MODELS }), loading: false });
        }
      } catch {
        if (!cancelled) {
          setCatalog({ ...resolveCatalogModels({ liveModels: [], fallbackModels: FALLBACK_MODELS }), loading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const host = LANDING_CONFIG.baseUrl.replace(/^https?:\/\//, "");
  const sampleModelId = catalog.models[0]?.id || null;

  return (
    <div className="min-h-screen bg-white font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <a href="/" className="flex items-center gap-2">
            <img src="/h-router-logo.svg" alt="h-router" className="h-8 w-8" />
            <span className="text-lg font-extrabold tracking-tight">h-router</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex dark:text-zinc-300">
            <a href="/dashboard" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Konsol</a>
            <a href="#katalog" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Model</a>
            <a href="#cara-pakai" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Cara pakai</a>
            <a href="#fitur" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Fitur</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button type="text" href="/login" className="hidden sm:inline-flex">
              Masuk
            </Button>
            <Button type="text" href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer" className="hidden lg:inline-flex">
              Dokumentasi
            </Button>
            <Button
              type="primary"
              href={LANDING_CONFIG.telegramUrl}
              target="_blank"
              rel="noreferrer"
              className={GREEN_CTA_CLASS}
            >
              Ambil key
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="mx-auto w-full max-w-6xl px-6 pt-16 text-center md:pt-24">
          <Tag
            icon={<span className="inline-block size-2 rounded-full bg-[#05f170]" />}
            className="!px-3 !py-1 !text-xs !font-semibold"
          >
            h-router · Gateway LLM
          </Tag>
          <Typography.Title
            level={1}
            className="!mx-auto !mt-6 !max-w-3xl !text-4xl !font-extrabold !leading-tight !tracking-tight md:!text-6xl"
          >
            Satu API key untuk semua model AI.
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="!mx-auto !mt-5 !max-w-2xl !text-lg">
            h-router merutekan permintaanmu ke puluhan provider — hemat token dengan RTK, atur member dan kunci
            dari dashboard, dan beli kunci lewat bot Telegram. Tanpa kartu kredit, tanpa setup aneh.
          </Typography.Paragraph>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              type="primary"
              size="large"
              href={LANDING_CONFIG.telegramUrl}
              target="_blank"
              rel="noreferrer"
              className={GREEN_CTA_CLASS}
            >
              Ambil key gratis
            </Button>
            <Button size="large" href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer">
              Baca dokumentasi
            </Button>
          </div>
          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 text-left md:grid-cols-4">
            <Card size="small">
              <Statistic title="Base URL" value={host} valueStyle={{ fontSize: 14, fontFamily: "monospace" }} />
            </Card>
            <Card size="small">
              <Statistic title="Format" value="OpenAI & Anthropic" valueStyle={{ fontSize: 14 }} />
            </Card>
            <Card size="small">
              <Statistic title="Streaming" value="SSE · tools · reasoning" valueStyle={{ fontSize: 14 }} />
            </Card>
            <Card size="small">
              <Statistic title="Gratis" value="Trial 1 hari · tanpa kartu kredit" valueStyle={{ fontSize: 14 }} />
            </Card>
          </div>

          {/* Animated request flow: client -> h-router -> provider */}
          <FlowAnimation />
        </section>

        {/* LLM brand logos served by this gateway */}
        <BrandStrip />

        {/* ---------------------------------------------------------- status */}
        <StatusPanel modelCount={catalog.loading ? null : catalog.total} modelsSource={catalog.source} />

        {/* ---------------------------------------------------------- cara kerja */}
        <section id="cara-pakai" aria-label="Cara pakai" className="mx-auto mt-20 w-full max-w-6xl scroll-mt-24 px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[#05a843] dark:text-[#05f170]">Cara kerja</p>
          <Typography.Title level={2} className="!mt-2 !text-3xl !font-extrabold !tracking-tight md:!text-4xl">
            Empat langkah, langsung jalan.
          </Typography.Title>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {STEPS.map((s) => (
              <Card key={s.n}>
                <Typography.Text strong className="font-mono text-sm text-[#05a843] dark:text-[#05f170]">
                  {s.n}
                </Typography.Text>
                <Typography.Title level={4} className="!mt-2 !mb-1">
                  {s.title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" className="!mb-0 !text-sm">
                  {s.body}
                </Typography.Paragraph>
              </Card>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- katalog */}
        <ModelCatalog catalog={catalog} />

        {/* ---------------------------------------------------------- mulai */}
        <CodeSamples sampleModelId={sampleModelId} />

        {/* ---------------------------------------------------------- fitur */}
        <section id="fitur" aria-label="Fitur" className="mx-auto mt-20 w-full max-w-6xl scroll-mt-24 px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[#05a843] dark:text-[#05f170]">Fitur</p>
          <Typography.Title level={2} className="!mt-2 !text-3xl !font-extrabold !tracking-tight md:!text-4xl">
            Satu gateway, lengkap dengan alat jualan.
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="!mt-2 !max-w-2xl">
            Semua di bawah ini sudah termasuk — tidak ada add-on berbayar.
          </Typography.Paragraph>
          <div className="mt-6 flex flex-wrap gap-2">
            {CORE_CHIPS.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {FEATURES.map((f) => (
              <Card key={f.title} title={f.title}>
                <Typography.Paragraph type="secondary" className="!mb-0 !text-sm">
                  {f.body}
                </Typography.Paragraph>
              </Card>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- closing CTA */}
        <section className="mx-auto mt-20 w-full max-w-6xl px-6 pb-20">
          <div className="rounded-2xl bg-zinc-900 px-6 py-14 text-center dark:bg-white">
            <Typography.Title
              level={2}
              className="!text-3xl !font-extrabold !tracking-tight !text-white md:!text-4xl dark:!text-zinc-900"
            >
              Mulai sekarang, gratis.
            </Typography.Title>
            <Typography.Paragraph className="!mx-auto !mt-3 !max-w-xl !text-zinc-300 dark:!text-zinc-600">
              Buat key lewat bot, tempel base URL, kirim request pertama. Tanpa billing, tanpa kartu kredit.
            </Typography.Paragraph>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                type="primary"
                size="large"
                href={LANDING_CONFIG.telegramUrl}
                target="_blank"
                rel="noreferrer"
                className={GREEN_CTA_CLASS}
              >
                Ambil key gratis
              </Button>
              <Button size="large" href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer">
                Dokumentasi API
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <img src="/h-router-logo.svg" alt="h-router" className="h-7 w-7" />
              <span className="font-extrabold">h-router</span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Gateway LLM gratis, dengan alat jualan kunci.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            <a href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
              Dokumentasi
            </a>
            <a href="/login" className="hover:text-zinc-900 dark:hover:text-white">Masuk panel</a>
            <a href={LANDING_CONFIG.baseUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
              API
            </a>
            <a href={LANDING_CONFIG.telegramUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
              Telegram
            </a>
          </nav>
        </div>
        <p className="border-t border-zinc-200 px-6 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          h-router · © 2026
        </p>
      </footer>
    </div>
  );
}
