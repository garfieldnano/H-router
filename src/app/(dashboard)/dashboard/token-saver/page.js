"use client";

import TokenSaverClient from "./TokenSaverClient";

// Token Saver is admin-only (user correction 2026-11-11): the member
// read-only view (MemberTokenSaver) was removed with the menu item.
export default function TokenSaverPage() {
  return <TokenSaverClient />;
}
