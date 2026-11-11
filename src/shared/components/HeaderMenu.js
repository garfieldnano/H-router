"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import { ConfirmModal } from "./Modal";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-[var(--daytona-text)] hover:bg-[var(--daytona-panel-3)]"
      }`}
    >
      <span className={`material-symbols-outlined text-[18px] ${danger ? "" : "text-[var(--daytona-text-muted)]"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [role, setRole] = useState(null);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

  // Same role fetch as Sidebar: members must not see Shutdown (their JWTs
  // are blocked from /api/version/shutdown by dashboardGuard, so the button
  // would only be a dead button for them). While the role is still loading
  // (null) Shutdown renders as today — fail-open for admins.
  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => { if (data?.role) setRole(data.role); })
      .catch(() => {});
  }, []);

  const isMember = role === "member";

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center size-8 rounded-md text-[var(--daytona-text-muted)] hover:text-[var(--daytona-text)] hover:bg-[var(--daytona-panel-2)] transition-colors"
          title="Menu"
        >
          <span className="material-symbols-outlined text-[20px]">grid_view</span>
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--daytona-panel-2)] border border-[var(--daytona-border)] rounded-md z-50 fade-in overflow-hidden py-1">
            <MenuItem
              icon="history"
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            {!isMember && (
              <MenuItem
                icon="power_settings_new"
                label="Shutdown"
                danger
                onClick={() => { close(); setShutdownOpen(true); }}
              />
            )}
            <MenuItem
              icon="logout"
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
