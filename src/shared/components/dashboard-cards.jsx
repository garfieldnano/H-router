"use client";

// Dashboard "reference card" primitives — WAVE 1.
// Visual language lives in ./dashboard-cards.css (scoped under
// `.hrouter-dash`, wired in via DashboardLayout). These components
// are thin wrappers over those classes: they render structure only
// and take ALL content as props. No data fetching, no mock data,
// no Modal usage.
//
//   <Panel title right>            .hcard-panel + title row
//   <StatCard label value unit sub />
//   <LatencyPanel title right>     .hcard-panel + LatencyBar rows
//   <LatencyBar name badge latencyMs maxMs display />
//   <RequestFlowPanel title entries input />
//   <WindowChrome url live liveLabel>  .hcard-window frame
//   <LivePill label />
//   <MiniNav items activeId onSelect />
//
// See the usage doc at the top of dashboard-cards.css for the full
// class API. Waves 2–4 consume these components (or the classes
// directly on existing antd Card/Statistic — see ANTD INTEROP).

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

/** Generic inner panel: 12px radius, thin border, title row. */
export function Panel({ title, right, children, className }) {
  return (
    <div className={cn("hcard-panel", className)}>
      {title || right ? (
        <div className="hcard-title-row">
          {title ? <span className="hcard-title">{title}</span> : <span />}
          {right ? <span className="hcard-title-right">{right}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

Panel.propTypes = {
  title: PropTypes.node,
  right: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};

/**
 * Stat card: small uppercase label, VERY LARGE value, small grey
 * unit underneath (e.g. "ms"), optional muted sub-line.
 * `value` is rendered as-is — format numbers before passing in.
 */
export function StatCard({ label, value, unit, sub, className, children }) {
  return (
    <div className={cn("hcard-stat", className)}>
      {label ? <div className="hcard-stat-label">{label}</div> : null}
      <div className="hcard-stat-value">{value}</div>
      {unit ? <div className="hcard-stat-unit">{unit}</div> : null}
      {sub ? <div className="hcard-stat-sub">{sub}</div> : null}
      {children}
    </div>
  );
}

StatCard.propTypes = {
  label: PropTypes.node,
  value: PropTypes.node.isRequired,
  unit: PropTypes.node,
  sub: PropTypes.node,
  className: PropTypes.string,
  children: PropTypes.node,
};

/**
 * One latency row: badge + truncated monospace model name, green
 * bar on a light-grey track, right-aligned monospace latency.
 * Bar width = clamp(latencyMs / maxMs). `display` overrides the
 * right-hand text (e.g. "0.84s"); otherwise `${latencyMs}ms`.
 * `badge` is a short label or a logo node (img/svg, 16px).
 */
export function LatencyBar({ name, badge, latencyMs, maxMs, display }) {
  const pct =
    maxMs && maxMs > 0
      ? Math.max(0, Math.min(100, (latencyMs / maxMs) * 100))
      : 0;
  return (
    <div className="hcard-lat-row">
      <span className="hcard-lat-badge" aria-hidden={badge == null}>
        {badge}
      </span>
      <span className="hcard-lat-name" title={name}>
        {name}
      </span>
      <span className="hcard-lat-track">
        <span className="hcard-lat-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="hcard-lat-value">
        {display != null ? display : `${latencyMs}ms`}
      </span>
    </div>
  );
}

LatencyBar.propTypes = {
  name: PropTypes.string.isRequired,
  badge: PropTypes.node,
  latencyMs: PropTypes.number.isRequired,
  maxMs: PropTypes.number,
  display: PropTypes.string,
};

/** Panel wrapper for LatencyBar rows ("Latensi per model"). */
export function LatencyPanel({
  title = "Latensi per model",
  right = "health check",
  children,
  className,
}) {
  return (
    <Panel title={title} right={right} className={className}>
      {children}
    </Panel>
  );
}

LatencyPanel.propTypes = {
  title: PropTypes.node,
  right: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};

/**
 * Request-flow panel ("ALIRAN PERMINTAAN").
 * entries: [{ key?, status, endpoint, latency, model?, ok? }]
 *   status: string/number, e.g. "200" (green) — a 4xx/5xx status
 *     renders red via .hcard-flow-status--err, as does any non-empty
 *     string status other than "ok"/"success"/2xx (the live feed
 *     carries string statuses like "ok"/"error", no HTTP code).
 *   latency: right-aligned mono text, e.g. "867ms".
 *   model: sub-line model id; `ok` (default true) shows the
 *     right-aligned "ok" marker; pass ok={false} to hide it.
 * input: { method, path } or a plain string — rendered as the
 *   bottom input line with a solid green block cursor.
 */
export function RequestFlowPanel({
  title = "ALIRAN PERMINTAAN",
  entries = [],
  input,
  className,
}) {
  const inputMethod = input != null && typeof input === "object" ? input.method : null;
  const inputPath = input != null && typeof input === "object" ? input.path : input;
  return (
    <div className={cn("hcard-panel", className)}>
      <div className="hcard-flow-heading">{title}</div>
      {entries.map((e, i) => {
        const statusNum = Number(e.status);
        const statusStr = String(e.status ?? "").toLowerCase();
        const isErr =
          (Number.isFinite(statusNum) && statusNum >= 400) ||
          (Number.isNaN(statusNum) &&
            statusStr !== "" &&
            statusStr !== "ok" &&
            statusStr !== "success" &&
            !statusStr.startsWith("2"));
        return (
          <div key={e.key != null ? e.key : i}>
            <div className="hcard-flow-entry">
              <span
                className={cn(
                  "hcard-flow-status",
                  isErr && "hcard-flow-status--err"
                )}
              >
                {e.status}
              </span>
              <span className="hcard-flow-endpoint" title={e.endpoint}>
                {e.endpoint}
              </span>
              <span className="hcard-flow-lat">{e.latency}</span>
            </div>
            {e.model ? (
              <div className="hcard-flow-sub">
                <span className="hcard-flow-dot" aria-hidden />
                <span className="hcard-flow-model" title={e.model}>
                  {e.model}
                </span>
                {e.ok !== false ? <span className="hcard-flow-ok">ok</span> : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {input != null ? (
        <div className="hcard-flow-input">
          {inputMethod ? (
            <span className="hcard-flow-method">{inputMethod}</span>
          ) : null}
          <span className="hcard-flow-input-path">{inputPath}</span>
          <span className="hcard-flow-cursor" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}

RequestFlowPanel.propTypes = {
  title: PropTypes.node,
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      status: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      endpoint: PropTypes.string.isRequired,
      latency: PropTypes.node.isRequired,
      model: PropTypes.string,
      ok: PropTypes.bool,
    })
  ),
  input: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({ method: PropTypes.string, path: PropTypes.string }),
  ]),
  className: PropTypes.string,
};

/** Pale-green "live" pill with a pulsing dot. */
export function LivePill({ label = "live", className }) {
  return (
    <span className={cn("hcard-live-pill", className)}>
      <span className="hcard-live-dot" aria-hidden />
      {label}
    </span>
  );
}

LivePill.propTypes = {
  label: PropTypes.node,
  className: PropTypes.string,
};

/**
 * Browser-window frame: traffic-light dots, monospace URL,
 * live pill on the right, body below. Use instead of .hcard when
 * the card should read as a browser window / preview frame.
 */
export function WindowChrome({ url, live = true, liveLabel = "live", children, className }) {
  return (
    <div className={cn("hcard-window", className)}>
      <div className="hcard-window-bar">
        <span className="hcard-window-dots" aria-hidden>
          <span className="hcard-window-dot hcard-window-dot--red" />
          <span className="hcard-window-dot hcard-window-dot--yellow" />
          <span className="hcard-window-dot hcard-window-dot--green" />
        </span>
        {url ? <span className="hcard-window-url">{url}</span> : <span className="hcard-window-url" />}
        {live ? <LivePill label={liveLabel} /> : null}
      </div>
      <div className="hcard-window-body">{children}</div>
    </div>
  );
}

WindowChrome.propTypes = {
  url: PropTypes.string,
  live: PropTypes.bool,
  liveLabel: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};

/**
 * Left mini-nav (as in the reference preview): square bullets,
 * active item on a light-grey rounded pill. `items` is
 * [{ id, label }]; `onSelect(id)` fires on click. If onSelect is
 * omitted the items render as plain non-interactive rows.
 */
export function MiniNav({ items = [], activeId, onSelect, className }) {
  return (
    <nav className={cn("hcard-mininav", className)} aria-label="Mini navigation">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!onSelect}
            onClick={onSelect ? () => onSelect(item.id) : undefined}
            aria-current={active ? "true" : undefined}
            className={cn(
              "hcard-mininav-item",
              active && "hcard-mininav-item--active"
            )}
          >
            <span className="hcard-mininav-bullet" aria-hidden />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

MiniNav.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      label: PropTypes.node.isRequired,
    })
  ),
  activeId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onSelect: PropTypes.func,
  className: PropTypes.string,
};
