"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Tag, Typography } from "antd";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { useTheme } from "@/shared/hooks/useTheme";
import { LANDING_CONFIG, FALLBACK_MODELS, LANDING_BRANDS } from "@/shared/constants/landing.js";
import {
  fetchWithTimeout,
  normalizeModelsResponse,
  resolveCatalogModels,
  resolveCatalogBrands,
} from "@/shared/utils/landing.js";
import DashboardPreview from "./DashboardPreview.jsx";
import ModelCatalog from "./ModelCatalog.jsx";
import CodeSamples from "./CodeSamples.jsx";
import BrandStrip from "./BrandStrip.jsx";

// h-router public landing page. Light mode by default (forced on first
// visit when no theme is stored yet — the reference design is light;
// returning visitors keep their stored choice), dark/light toggle in the
// header. The hero follows the reference site (h-router.web.id) closely —
// layout, copy and spec table — per the user's order "samain persis kayak
// contoh" (2026-11-12). The spec-table quota line ("5 req/menit · 1 jt
// token/hari") is the reference's stated free tier. Only user-facing
// features belong on the public landing page. Admin-only capabilities
// (RPM limits, compensation, relay, rebrand, IP cap, scanner,
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
  "Tanpa kartu kredit",
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

// Landing CTAs use the plain Daytona primary button — no text-color
// override. The antd token + the Daytona CSS layer give it white text
// on the black pill (light mode) and black text on the white pill (dark
// mode). The old override forced dark text with !important in BOTH
// modes, which made the light-mode CTAs unreadable (black on black).
// (Kept out of this comment on purpose: the literal class name would
// make Tailwind generate the unused utility again.)

export default function LandingPage({ baseUrl = LANDING_CONFIG.baseUrl } = {}) {
  const { setTheme } = useTheme();
  const [catalog, setCatalog] = useState({ models: [], allModels: [], total: 0, source: "empty", loading: true });

  // Live gateway health: liveness + latency measured here, 24h request and
  // token counts from /api/health. The dashboard preview and the hero badge
  // both read it. Hard 10s timeout and a 30s poll; anything unreachable
  // renders as a dash — never an invented number.
  const [health, setHealth] = useState({ status: "checking", latencyMs: null, requests24h: null, tokens24h: null, updatedAt: null });
  const checkHealth = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetchWithTimeout("/api/health", { timeoutMs: 10000 });
      const ms = performance.now() - t0;
      const json = await res.json().catch(() => ({}));
      setHealth({
        status: res.ok && json.ok === true ? "online" : "offline",
        latencyMs: res.ok ? ms : null,
        requests24h: typeof json.requests24h === "number" ? json.requests24h : null,
        tokens24h: typeof json.tokens24h === "number" ? json.tokens24h : null,
        updatedAt: new Date(),
      });
    } catch {
      setHealth({ status: "offline", latencyMs: null, requests24h: null, tokens24h: null, updatedAt: new Date() });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 30000);
    return () => clearInterval(id);
  }, [checkHealth]);

  // Light mode default: first visit without a stored theme renders light.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("theme") === null) setTheme("light");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The catalog follows the admin panel: first the public admin-published
  // list (GET /api/public/models — curated models minus admin-disabled,
  // plus admin custom models, no key needed). When that endpoint answers,
  // its list is the catalog even when empty — the admin disabled everything
  // on purpose, so falling through would re-publish removed models. Only
  // when the admin endpoint is unreachable do we try the live /v1/models
  // list (needs a key remotely), then FALLBACK_MODELS. Hard 10s timeout
  // per fetch: a hung request must never leave the catalog on
  // "Memuat model…" forever. The catalog and the code sample share the
  // resolved list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithTimeout("/api/public/models", { timeoutMs: 10000 });
        if (res.ok) {
          const admin = normalizeModelsResponse(await res.json());
          if (!cancelled) {
            setCatalog({ ...resolveCatalogModels({ adminModels: admin, fallbackModels: FALLBACK_MODELS }), allModels: admin, loading: false });
          }
          return;
        }
        // Non-OK from the admin endpoint: fall through to /v1/models.
      } catch {
        // Admin endpoint unreachable: fall through to /v1/models.
      }
      try {
        const res = await fetchWithTimeout("/v1/models", { timeoutMs: 10000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const live = normalizeModelsResponse(await res.json());
        if (!cancelled) {
          setCatalog({ ...resolveCatalogModels({ liveModels: live, fallbackModels: FALLBACK_MODELS }), allModels: live, loading: false });
        }
      } catch {
        if (!cancelled) {
          setCatalog({ ...resolveCatalogModels({ liveModels: [], fallbackModels: FALLBACK_MODELS }), allModels: FALLBACK_MODELS, loading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const host = baseUrl.replace(/^https?:\/\//, "");
  const sampleModelId = catalog.models[0]?.id || null;

  return (
    <div className="min-h-screen bg-white font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <a href="/" className="flex items-center gap-2">
            <img src="/h-router-logo.svg" alt="H-router" className="h-8 w-8" />
            <span className="text-lg font-extrabold tracking-tight">H-router</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex dark:text-zinc-300">
            <a href="/dashboard" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Konsol</a>
            <a href="#katalog" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Model</a>
            <a href="#cara-pakai" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Cara pakai</a>
            <a href="#fitur" className="transition-colors hover:text-zinc-900 dark:hover:text-white">Fitur</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button href="/login" className="hidden sm:inline-flex">
              Masuk
            </Button>
            <Button href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer" className="hidden lg:inline-flex">
              Dokumentasi
            </Button>
            <Button
              type="primary"
              href={LANDING_CONFIG.telegramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ambil key
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        {/* Two-column hero like the reference: copy + CTAs on the left,
            spec table on the right. The model count in the badge and the
            subtext follows the admin catalog (1 model when the admin picked
            one, all of them when nothing is picked). */}
        <section className="mx-auto w-full max-w-6xl px-6 pt-16 md:pt-24">
          <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <Typography.Title
                level={1}
                className="!mt-6 !text-4xl !font-extrabold !leading-tight !tracking-tight md:!text-6xl"
              >
                Gateway LLM gratis
                <br />
                <span className="text-[#05f170]">tanpa ribet.</span>
              </Typography.Title>
              <Typography.Paragraph type="secondary" className="!mt-5 !max-w-xl !text-lg">
                Satu API key untuk {catalog.loading ? "semua model" : `${catalog.total} model`} — kompatibel
                OpenAI dan Anthropic, streaming, reasoning effort, tanpa kartu kredit.
              </Typography.Paragraph>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="primary"
                  size="large"
                  href={LANDING_CONFIG.telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ambil key gratis
                </Button>
                <Button size="large" href={LANDING_CONFIG.docsUrl} target="_blank" rel="noreferrer">
                  Baca dokumentasi
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <dl className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {[
                  { label: "Base URL", value: host, mono: true },
                  { label: "Format", value: "OpenAI & Anthropic" },
                  { label: "Kuota gratis", value: "5 req/menit · 1 jt token/hari" },
                  { label: "Streaming", value: "SSE · tools · reasoning" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-4">
                    <dt className="text-sm text-zinc-500 dark:text-zinc-400">{row.label}</dt>
                    <dd className={`text-sm font-medium ${row.mono ? "font-mono" : ""}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* LLM brand logos served by this gateway — follows the catalog */}
        <BrandStrip
          brands={
            catalog.loading
              ? undefined
              : resolveCatalogBrands({ models: catalog.allModels, brands: LANDING_BRANDS })
          }
        />

        {/* ---------------------------------------------------------- dashboard preview */}
        <DashboardPreview
          modelCount={catalog.loading ? null : catalog.total}
          models={catalog.models}
          health={health}
          host={host}
        />

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
        <CodeSamples sampleModelId={sampleModelId} baseUrl={baseUrl} />

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
        {/* Soft green-tint card in the Daytona theme (the old near-black
            card did not match the light theme). The buttons are the plain
            Daytona primary + default — no color override. */}
        <section className="mx-auto mt-20 w-full max-w-6xl px-6 pb-20">
          <div className="rounded-2xl border border-[#b8e6c6] bg-[#e9fbf0] px-6 py-14 text-center dark:border-emerald-900 dark:bg-emerald-950/60">
            <Typography.Title
              level={2}
              className="!text-3xl !font-extrabold !tracking-tight !text-zinc-900 md:!text-4xl dark:!text-white"
            >
              Mulai sekarang, gratis.
            </Typography.Title>
            <Typography.Paragraph className="!mx-auto !mt-3 !max-w-xl !text-zinc-600 dark:!text-zinc-300">
              Buat key lewat bot, tempel base URL, kirim request pertama. Tanpa billing, tanpa kartu kredit.
            </Typography.Paragraph>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                type="primary"
                size="large"
                href={LANDING_CONFIG.telegramUrl}
                target="_blank"
                rel="noreferrer"
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
              <img src="/h-router-logo.svg" alt="H-router" className="h-7 w-7" />
              <span className="font-extrabold">H-router</span>
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
            <a href={baseUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
              API
            </a>
            <a href={LANDING_CONFIG.telegramUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
              Telegram
            </a>
          </nav>
        </div>
        <p className="border-t border-zinc-200 px-6 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          H-router · © 2026
        </p>
      </footer>
    </div>
  );
}
