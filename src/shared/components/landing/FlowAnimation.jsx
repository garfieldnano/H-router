"use client";

import { useEffect, useState } from "react";

// Animated request-flow diagram for the hero, restyled from the upstream
// 9router landing FlowAnimation (recovered from git history, commit
// 1339107) for h-router: light mode default, green #05f170 accent,
// Indonesian context. Clients on the left send requests through the
// h-router hub to LLM providers on the right; one provider path lights
// up every 2s. Pure CSS motion + a tiny interval — no external libs.
// Respects prefers-reduced-motion (interval off, CSS animations off via
// the .landing-anim rule in globals.css). Desktop diagram only from md
// up; small screens get a compact three-node flow with a travelling dot.
const CLIENTS = ["cURL", "Python", "Node.js", "Telegram"];

const PROVIDERS = [
  { id: "openai", name: "OpenAI", logo: "/brands/openai.svg" },
  { id: "anthropic", name: "Anthropic", logo: "/brands/anthropic.svg" },
  { id: "gemini", name: "Google Gemini", logo: "/brands/googlegemini.svg" },
  { id: "deepseek", name: "DeepSeek", logo: "/brands/deepseek.svg" },
];

// Row centers (px) in the 800x340 diagram space; hub center is (400, 170).
// Both node columns use fixed h-9 rows, so these centers match exactly.
const ROW_Y = [42, 127, 213, 298];
const HUB = { x: 400, y: 170, leftEdge: 344, rightEdge: 456 };

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const id = setInterval(() => {
      setActiveFlow((prev) => (prev + 1) % PROVIDERS.length);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="landing-anim mx-auto mt-14 w-full max-w-4xl">
      {/* ------------------------------------------------ desktop diagram */}
      <div className="relative hidden h-[340px] w-full animate-[landing-float_6s_ease-in-out_infinite] md:block">
        {/* h-router hub — center */}
        <div className="absolute left-1/2 top-1/2 z-20 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border-2 border-[#05f170] bg-white shadow-[0_0_40px_rgba(5,241,112,0.25)] transition-transform duration-500 hover:scale-105 dark:bg-zinc-900 dark:shadow-[0_0_40px_rgba(5,241,112,0.15)]">
          <img src="/h-router-logo.svg" alt="" aria-hidden="true" className="h-10 w-10" />
          <span className="text-xs font-bold tracking-widest text-zinc-900 uppercase dark:text-white">H-router</span>
          <span className="absolute inset-0 animate-ping rounded-full border border-[#05f170]/30 opacity-20" aria-hidden="true" />
        </div>

        {/* Clients — left */}
        <div className="absolute left-0 top-0 bottom-0 z-20 flex flex-col justify-between py-6">
          {CLIENTS.map((c) => (
            <div
              key={c}
              className="flex h-9 w-[110px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-2 py-2 font-mono text-xs font-bold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {c}
            </div>
          ))}
        </div>

        {/* Providers — right */}
        <div className="absolute right-0 top-0 bottom-0 z-20 flex flex-col justify-between py-6">
          {PROVIDERS.map((p, idx) => (
            <div
              key={p.id}
              title={p.name}
              className={`flex h-9 w-[170px] items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm transition-all hover:scale-105 ${
                activeFlow === idx ? "scale-105 ring-2 ring-[#05f170]" : ""
              }`}
            >
              <img src={p.logo} alt="" aria-hidden="true" width={20} height={20} loading="lazy" className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap">{p.name}</span>
            </div>
          ))}
        </div>

        {/* Animated dashed lines: clients -> hub, hub -> providers */}
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          viewBox="0 0 800 340"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {ROW_Y.map((y) => (
            <path
              key={`in-${y}`}
              d={`M 110 ${y} C 220 ${y}, 240 ${HUB.y}, ${HUB.leftEdge} ${HUB.y}`}
              fill="none"
              strokeWidth="2"
              strokeDasharray="5 5"
              className="animate-[landing-flow-dash_1.5s_linear_infinite] stroke-zinc-400 dark:stroke-zinc-600"
            />
          ))}
          {ROW_Y.map((y, idx) => (
            <path
              key={`out-${y}`}
              d={`M ${HUB.rightEdge} ${HUB.y} C 560 ${HUB.y}, 580 ${y}, 650 ${y}`}
              fill="none"
              stroke={activeFlow === idx ? "#05f170" : undefined}
              strokeWidth={activeFlow === idx ? 3 : 2}
              className={activeFlow === idx ? "animate-pulse stroke-[#05f170]" : "stroke-zinc-400 dark:stroke-zinc-600"}
            />
          ))}
        </svg>
      </div>

      {/* ------------------------------------------------ mobile mini-flow */}
      <div className="flex items-center gap-2 md:hidden" aria-hidden="true">
        <span className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          Aplikasi
        </span>
        <span className="relative h-px flex-1 bg-zinc-300 dark:bg-zinc-700">
          <span className="absolute top-1/2 size-2 -translate-y-1/2 animate-[landing-dot-travel_2s_linear_infinite] rounded-full bg-[#05f170]" />
        </span>
        <span className="flex items-center gap-1.5 rounded-full border-2 border-[#05f170] bg-white px-3 py-1.5 text-xs font-bold text-zinc-900 dark:bg-zinc-900 dark:text-white">
          <img src="/h-router-logo.svg" alt="" className="h-4 w-4" />
          H-router
        </span>
        <span className="relative h-px flex-1 bg-zinc-300 dark:bg-zinc-700">
          <span className="absolute top-1/2 size-2 -translate-y-1/2 animate-[landing-dot-travel_2s_linear_infinite] rounded-full bg-[#05f170]" style={{ animationDelay: "1s" }} />
        </span>
        <span className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          Model AI
        </span>
      </div>
      <p className="mt-3 text-center text-xs text-zinc-500 md:hidden dark:text-zinc-400">
        Aplikasi kamu → H-router → model AI
      </p>
    </div>
  );
}
