// h-router Ant Design theme tokens — Daytona design system (wave 1).
// Pure module (no DOM, no React) so it can be unit-tested.
//
// Design targets (Daytona dashboard, dark-first):
// - Near-black base, flat panels (#0a0a0a–#111), thin #1f1f1f borders,
//   6px radius, compact density, muted zinc-400 secondary text.
// - Brand green #05f170 stays the primary accent (links, switches,
//   active indicators, status). Primary *buttons* are the exception:
//   white bg + black text in dark mode, black bg + white text in light
//   mode (Daytona CTA language) — implemented via the Button component
//   token (primaryColor = text) + the CSS overrides in globals.css
//   (background), because antd v6 has no component token for the
//   primary button background (it comes from global colorPrimary).
//
// Constraints the tests pin down:
// - getAntdTheme(true).token === getAntdTheme(false).token ===
//   HROUTER_ANTD_TOKEN (same object reference). So the shared `token`
//   holds only mode-agnostic values; everything mode-specific lives in
//   `components` (per-mode component tokens, verified against
//   node_modules/antd/es/*/style/*.d.ts) or in the Daytona CSS layer.
// - The dark/light surface colors (#000 base, #0a0a0a containers) cannot
//   be global tokens for the same reason (colorBgBase is shared), so the
//   CSS layer in globals.css pins them per mode via --daytona-* vars
//   under `html.dark` / `html:not(.dark)`.
import { theme as antdTheme } from "antd";

export const HROUTER_ANTD_TOKEN = {
  // h-router brand green — accent for links, switches, active states.
  colorPrimary: "#05f170",
  // Green links. NOTE: #05f170 on a white background is low contrast,
  // so globals.css overrides antd links to --daytona-link (#00853f) in
  // light mode; dark mode keeps #05f170.
  colorLink: "#05f170",
  fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
  // Daytona radius: small and flat (was 10). Deliberately smaller than
  // --radius-brand (10px) in globals.css, which still serves the
  // non-antd components until their wave restyles them.
  borderRadius: 6,
  // Compact density
  fontSize: 13,
  controlHeight: 30,
  controlHeightSM: 24,
  controlHeightLG: 36,
  // Flat: no shadows anywhere (thin borders carry the elevation instead).
  // The CSS layer adds 1px borders to overlays that would otherwise
  // look borderless (Modal, Drawer, Dropdown, Popover, Select list).
  boxShadow: "none",
  boxShadowSecondary: "none",
};

// ---------------------------------------------------------------------------
// Per-mode component tokens (verified against antd 6.7.0 .d.ts files).
// Only tokens that exist on the component are listed here; anything
// without a component token (Card/Table/Input/Drawer background, primary
// button background) is handled by the Daytona CSS layer instead.
// ---------------------------------------------------------------------------

const DAYTONA_DARK_COMPONENTS = {
  Button: {
    // Text on the white primary button (bg comes from CSS).
    primaryColor: "#000000",
    defaultBg: "#0a0a0a",
    defaultColor: "#fafafa",
    defaultBorderColor: "#262626",
    defaultHoverBg: "#141414",
    defaultHoverColor: "#ffffff",
    defaultHoverBorderColor: "#3a3a3a",
    defaultActiveBg: "#1a1a1a",
    defaultActiveColor: "#ffffff",
    defaultActiveBorderColor: "#3a3a3a",
    primaryShadow: "none",
    defaultShadow: "none",
    dangerShadow: "none",
    ghostBg: "transparent",
  },
  Card: {
    headerBg: "#0a0a0a",
    actionsBg: "#0a0a0a",
    headerFontSize: 14,
    bodyPadding: 16,
    headerPadding: 16,
  },
  Table: {
    headerBg: "#0a0a0a",
    headerColor: "#a1a1aa",
    headerSplitColor: "#1f1f1f",
    borderColor: "#1f1f1f",
    rowHoverBg: "#111111",
    rowSelectedBg: "rgba(5, 241, 112, 0.08)",
    rowSelectedHoverBg: "rgba(5, 241, 112, 0.12)",
    rowExpandedBg: "#0a0a0a",
    bodySortBg: "#0a0a0a",
    headerSortActiveBg: "#111111",
    headerSortHoverBg: "#111111",
    footerBg: "#0a0a0a",
    footerColor: "#a1a1aa",
    cellPaddingBlock: 8,
    cellPaddingInline: 12,
    cellPaddingBlockSM: 6,
    cellPaddingInlineSM: 8,
    cellFontSize: 13,
    cellFontSizeSM: 12,
    headerBorderRadius: 6,
  },
  Input: {
    hoverBorderColor: "#3a3a3a",
    activeBorderColor: "#05f170",
    activeShadow: "none",
    hoverBg: "#0a0a0a",
    activeBg: "#0a0a0a",
    addonBg: "#111111",
    inputFontSize: 13,
  },
  Select: {
    selectorBg: "#0a0a0a",
    optionSelectedBg: "rgba(5, 241, 112, 0.08)",
    optionSelectedColor: "#fafafa",
    optionActiveBg: "#111111",
    multipleItemBg: "#1a1a1a",
    multipleItemBorderColor: "#262626",
    hoverBorderColor: "#3a3a3a",
    activeBorderColor: "#05f170",
    activeOutlineColor: "rgba(5, 241, 112, 0.25)",
    clearBg: "#0a0a0a",
    optionFontSize: 13,
  },
  Tabs: {
    inkBarColor: "#05f170",
    itemColor: "#a1a1aa",
    itemHoverColor: "#fafafa",
    // Active tab text stays near-white; the green ink bar is the
    // active indicator (Daytona: white text + green underline).
    itemActiveColor: "#fafafa",
    itemSelectedColor: "#fafafa",
    cardBg: "#0a0a0a",
    titleFontSize: 13,
  },
  Tag: {
    defaultBg: "#111111",
    defaultColor: "#d4d4d8",
  },
  Modal: {
    contentBg: "#0a0a0a",
    headerBg: "#0a0a0a",
    footerBg: "#0a0a0a",
    titleColor: "#fafafa",
  },
  Segmented: {
    trackBg: "#0a0a0a",
    itemSelectedBg: "#1f1f1f",
    itemSelectedColor: "#fafafa",
    itemColor: "#a1a1aa",
    itemHoverColor: "#fafafa",
    itemHoverBg: "#141414",
    itemActiveBg: "#1a1a1a",
  },
  Switch: {
    // Checked track color comes from global colorPrimary (#05f170).
    handleShadow: "none",
  },
};

const DAYTONA_LIGHT_COMPONENTS = {
  Button: {
    // Text on the black primary button (bg comes from CSS).
    primaryColor: "#ffffff",
    defaultBg: "#ffffff",
    defaultColor: "#0a0a0a",
    // Light-mode default buttons (Masuk, Dokumentasi, Salin) need a
    // visible border on white — the old #e4e4e7 was almost borderless.
    defaultBorderColor: "#a1a1aa",
    defaultHoverBg: "#fafafa",
    defaultHoverColor: "#000000",
    defaultHoverBorderColor: "#71717a",
    defaultActiveBg: "#f4f4f5",
    defaultActiveColor: "#000000",
    defaultActiveBorderColor: "#71717a",
    primaryShadow: "none",
    defaultShadow: "none",
    dangerShadow: "none",
    ghostBg: "transparent",
  },
  Card: {
    headerBg: "#ffffff",
    actionsBg: "#ffffff",
    headerFontSize: 14,
    bodyPadding: 16,
    headerPadding: 16,
  },
  Table: {
    headerBg: "#fafafa",
    headerColor: "#71717a",
    headerSplitColor: "#e4e4e7",
    borderColor: "#e4e4e7",
    rowHoverBg: "#fafafa",
    rowSelectedBg: "rgba(5, 241, 112, 0.10)",
    rowSelectedHoverBg: "rgba(5, 241, 112, 0.14)",
    rowExpandedBg: "#ffffff",
    bodySortBg: "#ffffff",
    headerSortActiveBg: "#f4f4f5",
    headerSortHoverBg: "#f4f4f5",
    footerBg: "#fafafa",
    footerColor: "#71717a",
    cellPaddingBlock: 8,
    cellPaddingInline: 12,
    cellPaddingBlockSM: 6,
    cellPaddingInlineSM: 8,
    cellFontSize: 13,
    cellFontSizeSM: 12,
    headerBorderRadius: 6,
  },
  Input: {
    hoverBorderColor: "#d4d4d8",
    activeBorderColor: "#05f170",
    activeShadow: "none",
    hoverBg: "#ffffff",
    activeBg: "#ffffff",
    addonBg: "#f4f4f5",
    inputFontSize: 13,
  },
  Select: {
    selectorBg: "#ffffff",
    optionSelectedBg: "rgba(5, 241, 112, 0.10)",
    optionSelectedColor: "#0a0a0a",
    optionActiveBg: "#f4f4f5",
    multipleItemBg: "#f4f4f5",
    multipleItemBorderColor: "#e4e4e7",
    hoverBorderColor: "#d4d4d8",
    activeBorderColor: "#05f170",
    activeOutlineColor: "rgba(5, 241, 112, 0.30)",
    clearBg: "#ffffff",
    optionFontSize: 13,
  },
  Tabs: {
    inkBarColor: "#05f170",
    // Inactive tabs must read as tabs, not disabled text.
    itemColor: "#52525b",
    itemHoverColor: "#0a0a0a",
    itemActiveColor: "#0a0a0a",
    itemSelectedColor: "#0a0a0a",
    cardBg: "#fafafa",
    titleFontSize: 13,
  },
  Tag: {
    defaultBg: "#f4f4f5",
    // Chips (feature list) read as disabled when the text is too pale;
    // zinc-700 on a bordered chip is clearly intentional.
    defaultColor: "#3f3f46",
    defaultBorderColor: "#d4d4d8",
  },
  Modal: {
    contentBg: "#ffffff",
    headerBg: "#ffffff",
    footerBg: "#ffffff",
    titleColor: "#0a0a0a",
  },
  Segmented: {
    trackBg: "#f4f4f5",
    itemSelectedBg: "#ffffff",
    itemSelectedColor: "#0a0a0a",
    itemColor: "#71717a",
    itemHoverColor: "#0a0a0a",
    itemHoverBg: "#e4e4e7",
    itemActiveBg: "#d4d4d8",
  },
  Switch: {
    handleShadow: "none",
  },
};

export function getAntdTheme(isDark) {
  return {
    token: HROUTER_ANTD_TOKEN,
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    components: isDark ? DAYTONA_DARK_COMPONENTS : DAYTONA_LIGHT_COMPONENTS,
  };
}
