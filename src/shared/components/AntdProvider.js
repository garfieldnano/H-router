"use client";

import { useEffect, useState } from "react";
import { ConfigProvider } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import useThemeStore from "@/store/themeStore";
import { getAntdTheme } from "@/shared/theme/antdTheme";

// Resolve the effective (light/dark) theme the same way applyTheme() does:
// store value wins, "system" falls back to the OS preference. The root
// layout's inline script and ThemeProvider apply the matching `dark` class
// on <html>; we also watch that class so antd follows every theme change
// (including ones made before this component mounts).
function resolveIsDark() {
  if (typeof window === "undefined") return false;
  const t = useThemeStore.getState().theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function AntdProvider({ children }) {
  const storeTheme = useThemeStore((s) => s.theme);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const update = () => setIsDark(resolveIsDark());
    update();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      mq.removeEventListener("change", update);
      obs.disconnect();
    };
  }, [storeTheme]);

  // `layer` on AntdRegistry forwards to cssinjs StyleProvider, so all antd
  // styles are emitted inside `@layer antd`. globals.css declares the layer
  // order (theme, base, antd, components, utilities) so Tailwind utilities
  // keep winning over antd styles.
  return (
    <AntdRegistry layer>
      <ConfigProvider theme={getAntdTheme(isDark)}>{children}</ConfigProvider>
    </AntdRegistry>
  );
}
