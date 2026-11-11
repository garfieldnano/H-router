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
// without an API key (i.e. the gateway has requireApiKey on — remote
// visitors get a 401 from /v1/models while localhost gets the live list).
// Entries are { id, name?, ownedBy?, tier? ("FREE" | "PRO") } and were
// curated 2026-11-11 from THIS gateway's own live /v1/models (864 models):
// flagship ids, verified to exist in the live list. No tier is set — the
// gateway does not publish tiers, so none is invented. Re-sync this list
// when the flagship lineup changes; it is the catalog remote visitors see.
// Do not paste another gateway's catalog here.
export const FALLBACK_MODELS = [
  { id: "openai/gpt-5.5", name: "GPT-5.5", ownedBy: "OpenAI" },
  { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4", ownedBy: "Anthropic" },
  { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", ownedBy: "Anthropic" },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", ownedBy: "DeepSeek" },
  { id: "gemini/gemini-3.8-flash", name: "Gemini 3.8 Flash", ownedBy: "Google" },
  { id: "kimi/kimi-k3", name: "Kimi K3", ownedBy: "Moonshot" },
  { id: "glm/glm-5.3", name: "GLM 5.3", ownedBy: "Zhipu" },
  { id: "alicode/qwen3.5-plus", name: "Qwen 3.5 Plus", ownedBy: "Alibaba" },
  { id: "xai/grok-4.7", name: "Grok 4.7", ownedBy: "xAI" },
  { id: "mistral/mistral-large-latest", name: "Mistral Large", ownedBy: "Mistral" },
  { id: "minimax/MiniMax-M2.7", name: "MiniMax M2.7", ownedBy: "MiniMax" },
  { id: "groq/meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick", ownedBy: "Meta" },
];

// LLM brands served by this gateway, for the logo strip under the hero.
// Static on purpose: the strip renders even when /v1/models is unreachable.
// Derived 2026-11-11 from this gateway's own live /v1/models (model
// families present in the list). Logos are vendored in public/brands/
// (simple-icons, CC0) — `logo: null` means no usable logo exists for the
// brand (Kimi, GLM, xAI have no simple-icons entry) and renders a styled
// text badge instead. Never hotlink a logo CDN at runtime.
export const LANDING_BRANDS = [
  { name: "OpenAI", logo: "/brands/openai.svg" },
  { name: "Anthropic", logo: "/brands/anthropic.svg" },
  { name: "Google Gemini", logo: "/brands/googlegemini.svg" },
  { name: "DeepSeek", logo: "/brands/deepseek.svg" },
  { name: "Meta", logo: "/brands/meta.svg" },
  { name: "Qwen", logo: "/brands/qwen.svg" },
  { name: "Mistral", logo: "/brands/mistralai.svg" },
  { name: "NVIDIA", logo: "/brands/nvidia.svg" },
  { name: "MiniMax", logo: "/brands/minimax.svg" },
  { name: "Kimi", logo: "/brands/moonshot.svg" },
  { name: "GLM", logo: "/brands/zai.svg" },
  { name: "xAI", logo: "/brands/xai.svg" },
];
