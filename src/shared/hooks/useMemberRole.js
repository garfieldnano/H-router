"use client";

import { useEffect, useState } from "react";

// Member dashboard expansion: shared role check for the 7 read-only member
// pages. Reads GET /api/auth/status (same pattern as Sidebar/HeaderMenu).
// Returns true only for a member JWT session; false while loading or for
// admin sessions. Admin pages render first (fail-open) to avoid flashing
// the member view for admins.
export function useMemberRole() {
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.role === "member") setIsMember(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return isMember;
}
