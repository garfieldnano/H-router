"use client";

import { useState } from "react";
import { Button } from "antd";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";

// Small copy-to-clipboard button used by the catalog and code samples.
export default function CopyButton({ text, label = "Salin", className = "" }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (non-secure context) — fallback.
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="default"
      size="small"
      icon={copied ? <CheckOutlined /> : <CopyOutlined />}
      onClick={onCopy}
      className={className}
    >
      {copied ? "Disalin" : label}
    </Button>
  );
}
