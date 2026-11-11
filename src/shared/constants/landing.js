// h-router landing page config — single source of truth for the public
// landing page's links and defaults. The base URL is the PUBLIC gateway
// address shown in code samples; override it with
// NEXT_PUBLIC_HROUTER_BASE_URL when this repo is deployed elsewhere.
export const LANDING_CONFIG = {
  brand: "h-router",
  accent: "#05f170",
  baseUrl: (process.env.NEXT_PUBLIC_HROUTER_BASE_URL || "https://h-router.web.id/v1").replace(/\/+$/, ""),
  docsUrl: "https://github.com/garfieldnano/H-router/tree/master/docs/h-router",
  repoUrl: "https://github.com/garfieldnano/H-router",
  telegramUrl: "https://t.me/routermm_bot",
  // Sample API key shown in code samples — never a real key.
  sampleApiKey: "h-router-...",
};

// Fallback model catalog. Shown ONLY when GET /v1/models is not reachable
// without an API key (i.e. the gateway has requireApiKey on). Edit this list
// to publish branded models statically; entries are
// { id, name?, tier? ("FREE" | "PRO") }.
// Ships empty on purpose: the live gateway list is the source of truth.
// Do not paste another gateway's catalog here.
export const FALLBACK_MODELS = [
  // { id: "h-router/contoh-model", name: "Contoh Model", tier: "FREE" },
];
