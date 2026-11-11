"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import useSettingsStore from "@/store/settingsStore";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt", "systemone"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/scanner", label: "Pemindai Kesehatan", icon: "health_and_safety" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  // G7 observability pages (plan G7): per-key usage, live traffic,
  // conversation log, model playground.
  { href: "/dashboard/key-usage", label: "Pemakaian Kunci", icon: "vpn_key" },
  { href: "/dashboard/traffic", label: "Trafik Langsung", icon: "monitoring" },
  { href: "/dashboard/conversations", label: "Percakapan", icon: "forum" },
  { href: "/dashboard/playground", label: "Playground", icon: "science" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/members", label: "Members", icon: "group" },
  { href: "/dashboard/packages", label: "Paket & Harga", icon: "sell" },
  { href: "/dashboard/compensations", label: "Kompensasi", icon: "history" },
  { href: "/dashboard/rebrand", label: "Rebranding", icon: "style" },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

// Members see their own dashboard + the 4 read-only pages below (2026-11-11).
// Providers, Combo & Vision Adapter, and Token Saver are admin-only
// (user correction 2026-11-11). Each page gates its admin controls behind
// the member role, and every API it calls scopes by the session memberId
// server-side. No System items.
const memberNavItems = [
  { href: "/dashboard/member", label: "Dashboard Member", icon: "person" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

// ---------------------------------------------------------------------------
// Daytona nav-item presentation (presentation only — no behavior change).
// Active = subtle green-tinted bg + green left bar + green filled icon;
// inactive = muted text, subtle hover. Green is #05f170 written out
// explicitly: the legacy --color-primary orange must not leak into the
// dashboard chrome (globals :root is shared with the landing page).
// ---------------------------------------------------------------------------
function navItemClass(active) {
  return cn(
    "relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium transition-colors group",
    active
      ? "bg-[var(--daytona-selected-bg)] text-[var(--daytona-text)]"
      : "text-[var(--daytona-text-muted)] hover:bg-[var(--daytona-panel-2)] hover:text-[var(--daytona-text)]"
  );
}

function subNavItemClass(active) {
  return cn(
    "relative flex items-center gap-2.5 px-2.5 py-[6px] rounded-md text-xs font-medium transition-colors group",
    active
      ? "bg-[var(--daytona-selected-bg)] text-[var(--daytona-text)]"
      : "text-[var(--daytona-text-muted)] hover:bg-[var(--daytona-panel-2)] hover:text-[var(--daytona-text)]"
  );
}

function navIconClass(active, size = "text-[18px]") {
  return cn(
    "material-symbols-outlined shrink-0",
    size,
    active ? "fill-1 text-[#05f170]" : "group-hover:text-[var(--daytona-text)] transition-colors"
  );
}

function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[#05f170]"
    />
  );
}

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [role, setRole] = useState(null);

  // Member dashboard (v1): the sidebar only shows the member page.
  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => { if (data?.role) setRole(data.role); })
      .catch(() => {});
  }, []);

  const isMember = role === "member";
  const isAdmin = role === "admin";
  // While the role is still loading (role === null), render a NEUTRAL
  // skeleton — never either role's nav. The previous fix showed the
  // member items while loading, which flashed the member nav to admins
  // right after login (the mirror of the member-direction flash).
  // Admin sections render only once the role is positively known.

  useEffect(() => {
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, []);

  // Same logout as the header menu: POST /api/auth/logout, then /login.
  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) window.location.assign("/login");
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <aside className="flex w-60 flex-col border-r border-[var(--daytona-border)] bg-[var(--daytona-panel)] min-h-full">
        {/* Logo */}
        <div className="px-5 pt-4 pb-3">
          <Link href={isMember ? "/dashboard/member" : "/dashboard"} className="flex items-center gap-2.5">
            <img src="/h-router-logo.svg" alt="H-router logo" className="size-7 shrink-0" width={28} height={28} />
            <div className="flex flex-col leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight text-[var(--daytona-text)]">
                H-router
              </h1>
            </div>
          </Link>
          {/* NOTE: the upstream npm updater panel ("Update now" + install command)
              was removed for h-router — this is a git fork, not an npm package,
              so `npm i -g 9router@latest` would install upstream 9Router. */}
        </div>

        {/* Navigation — neutral skeleton while the role is unresolved */}
        <nav className="flex-1 px-3 py-2 space-y-px overflow-y-auto custom-scrollbar">
          {role === null ? (
            <div className="space-y-px" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[34px] rounded-md bg-[var(--daytona-panel-2)] animate-pulse" />
              ))}
            </div>
          ) : (isMember ? memberNavItems : navItems).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={navItemClass(isActive(item.href))}
            >
              {isActive(item.href) && <ActiveBar />}
              <span className={navIconClass(isActive(item.href))}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}

          {/* System section (admin only — rendered only once the role is
              positively known to be admin, never while it is loading) */}
          {isAdmin && (
          <div className="mt-3 space-y-px border-t border-[var(--daytona-border)] pt-3">
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-[var(--daytona-text-subtle)] uppercase tracking-wider">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={navItemClass(pathname.startsWith("/dashboard/media-providers"))}
              aria-expanded={mediaOpen}
            >
              {pathname.startsWith("/dashboard/media-providers") && <ActiveBar />}
              <span className={navIconClass(pathname.startsWith("/dashboard/media-providers"))}>perm_media</span>
              <span className="flex-1 text-left">Media Providers</span>
              <span className="material-symbols-outlined text-[16px] text-[var(--daytona-text-subtle)] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div className="ml-[13px] mt-0.5 space-y-px border-l border-[var(--daytona-border)] pl-2">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={subNavItemClass(pathname.startsWith(`/dashboard/media-providers/${kind.id}`))}
                  >
                    {pathname.startsWith(`/dashboard/media-providers/${kind.id}`) && <ActiveBar />}
                    <span className={navIconClass(pathname.startsWith(`/dashboard/media-providers/${kind.id}`), "text-[16px]")}>{kind.icon}</span>
                    <span>{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  className={subNavItemClass(pathname.startsWith(COMBINED_WEB_ITEM.href))}
                >
                  {pathname.startsWith(COMBINED_WEB_ITEM.href) && <ActiveBar />}
                  <span className={navIconClass(pathname.startsWith(COMBINED_WEB_ITEM.href), "text-[16px]")}>{COMBINED_WEB_ITEM.icon}</span>
                  <span>{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={navItemClass(isActive(item.href))}
              >
                {isActive(item.href) && <ActiveBar />}
                <span className={navIconClass(isActive(item.href))}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={navItemClass(isActive(item.href))}
                >
                  {isActive(item.href) && <ActiveBar />}
                  <span className={navIconClass(isActive(item.href))}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* NOTE: upstream promo links 9Remote / 9English removed for h-router. */}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={navItemClass(isActive("/dashboard/profile"))}
            >
              {isActive("/dashboard/profile") && <ActiveBar />}
              <span className={navIconClass(isActive("/dashboard/profile"))}>
                settings
              </span>
              <span>Settings</span>
            </Link>
          </div>
          )}
        </nav>

        {/* Logout — footer; renders in the desktop sidebar AND in the
            mobile drawer (previously logout was only in the header menu) */}
        <div className="border-t border-[var(--daytona-border)] px-3 py-2">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium text-[var(--daytona-text-muted)] hover:bg-[var(--daytona-panel-2)] hover:text-[var(--daytona-text)] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] shrink-0">logout</span>
            <span>Keluar</span>
          </button>
        </div>
      </aside>
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};
