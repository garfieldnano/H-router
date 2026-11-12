import { headers } from "next/headers";
import LandingPage from "@/shared/components/landing/LandingPage.jsx";
import { LANDING_CONFIG } from "@/shared/constants/landing.js";
import { resolvePublicBaseUrl } from "@/shared/utils/landing.js";

export const metadata = {
  title: "H-router — Gateway LLM gratis",
  description:
    "Satu API key untuk semua model AI. Hemat token dengan RTK, atur member dan kunci dari dashboard, beli kunci lewat bot Telegram.",
};

// The landing advertises the gateway's real public address, not a
// hardcoded host: the base URL is resolved per request from the public
// host the visitor actually reached (x-forwarded-host behind the Daytona
// proxy, else host), unless the operator pinned NEXT_PUBLIC_HROUTER_BASE_URL.
// force-dynamic: the address depends on the request, so the page cannot be
// prerendered once at build time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const h = await headers();
  const baseUrl = resolvePublicBaseUrl({
    host: h.get("x-forwarded-host") || h.get("host"),
    proto: h.get("x-forwarded-proto"),
    pinnedBaseUrl: LANDING_CONFIG.baseUrlPinned ? LANDING_CONFIG.baseUrl : "",
  });
  return <LandingPage baseUrl={baseUrl} />;
}
