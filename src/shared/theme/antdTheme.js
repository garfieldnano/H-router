// h-router Ant Design theme tokens (pilot: Usage page).
// Pure module (no DOM, no React) so it can be unit-tested.
import { theme as antdTheme } from "antd";

export const HROUTER_ANTD_TOKEN = {
  // h-router brand green
  colorPrimary: "#05f170",
  fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
  // Matches --radius-brand in globals.css
  borderRadius: 10,
};

export function getAntdTheme(isDark) {
  return {
    token: HROUTER_ANTD_TOKEN,
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  };
}
