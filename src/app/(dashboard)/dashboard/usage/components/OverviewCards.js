"use client";

import PropTypes from "prop-types";
import { StatCard } from "@/shared/components/dashboard-cards";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const items = [
    { title: "Total Requests", value: fmt(stats.totalRequests) },
    {
      title: "Total Input Tokens",
      value: fmt(stats.totalPromptTokens),
    },
    {
      title: "Cached Tokens",
      value: fmt(stats.totalCachedTokens),
    },
    {
      title: "Output Tokens",
      value: fmt(stats.totalCompletionTokens),
    },
    {
      title: "Est. Cost",
      value: `~${fmtCost(stats.totalCost)}`,
      extra: "Estimated, not actual billing",
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      {items.map((item) => (
        <StatCard
          key={item.title}
          label={item.title}
          value={item.value}
          sub={item.extra}
        />
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
