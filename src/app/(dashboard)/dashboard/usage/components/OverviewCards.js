"use client";

import PropTypes from "prop-types";
import { Card, Statistic } from "antd";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const items = [
    { title: "Total Requests", value: fmt(stats.totalRequests) },
    {
      title: "Total Input Tokens",
      value: fmt(stats.totalPromptTokens),
      valueStyle: { color: "var(--color-primary)" },
    },
    {
      title: "Cached Tokens",
      value: fmt(stats.totalCachedTokens),
      valueStyle: { color: "var(--color-info)" },
    },
    {
      title: "Output Tokens",
      value: fmt(stats.totalCompletionTokens),
      valueStyle: { color: "var(--color-success)" },
    },
    {
      title: "Est. Cost",
      value: `~${fmtCost(stats.totalCost)}`,
      valueStyle: { color: "var(--color-warning)" },
      extra: "Estimated, not actual billing",
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      {items.map((item) => (
        <Card key={item.title} styles={{ body: { padding: "12px 16px", textAlign: "center" } }}>
          <Statistic
            title={item.title}
            value={item.value}
            valueStyle={{ fontSize: 20, fontWeight: 700, ...(item.valueStyle || {}) }}
          />
          {item.extra && (
            <div className="text-[10px] text-text-muted">{item.extra}</div>
          )}
        </Card>
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
