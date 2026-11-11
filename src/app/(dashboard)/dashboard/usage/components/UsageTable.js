"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Table } from "antd";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Cell content for one value column (tokens or costs). `item` is a group
// summary (isSummary) or a detail row item.
function valueContent(item, field, viewMode, isSummary) {
  if (viewMode === "tokens") {
    switch (field) {
      case "promptTokens":
        return isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens);
      case "cachedTokens":
        return item.cachedTokens ? fmt(item.cachedTokens) : "—";
      case "completionTokens":
        return isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens);
      case "totalTokens":
        return <span className="font-medium">{fmt(item.totalTokens)}</span>;
      default:
        return "—";
    }
  }
  switch (field) {
    case "promptTokens":
      return isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost);
    case "cachedCost":
      return item.cachedCost ? fmtCost(item.cachedCost) : "—";
    case "completionTokens":
      return isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost);
    case "cost":
      return <span className="font-medium text-warning">{fmtCost(item.totalCost || item.cost)}</span>;
    default:
      return "—";
  }
}

/**
 * Sortable usage table with expandable group rows, rendered with Ant Design.
 *
 * Data comes pre-grouped (groupDataByKey) and pre-sorted (sortData, driven by
 * the sortBy/sortOrder URL params) from the UsageStats orchestrator — the
 * table itself does not sort; a header click calls onToggleSort, exactly like
 * the previous custom table.
 *
 * @param {object} props
 * @param {string} props.title - Table title (empty hides the Card header)
 * @param {Array} props.columns - Column definitions [{field, label, align}]
 * @param {Array} props.groupedData - Grouped data from groupDataByKey
 * @param {string} props.tableType - Table type key for sort URL params
 * @param {string} props.sortBy - Current sort field
 * @param {string} props.sortOrder - Current sort order ("asc" | "desc")
 * @param {function} props.onToggleSort - Sort toggle handler
 * @param {string} props.viewMode - "tokens" or "costs"
 * @param {string} props.storageKey - localStorage key for expanded state
 * @param {function} props.renderCell - (record, field) => cell content.
 *   record.isGroup distinguishes group summary rows from detail rows.
 * @param {string} props.emptyMessage - Empty state message
 */
export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderCell,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(new Set());

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "cachedCost", label: "Cached Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  const dataSource = useMemo(
    () =>
      groupedData.map((group) => ({
        key: group.groupKey,
        isGroup: true,
        groupKey: group.groupKey,
        summary: group.summary,
        children: group.items.map((item) => ({
          ...item,
          key: `detail-${item.key}`,
          isGroup: false,
        })),
      })),
    [groupedData]
  );

  const antdColumns = useMemo(() => {
    const sortOrderFor = (field) =>
      sortBy === field ? (sortOrder === "asc" ? "ascend" : "descend") : undefined;
    const detail = columns.map((col) => ({
      title: col.label,
      dataIndex: col.field,
      key: col.field,
      align: col.align === "right" ? "right" : "left",
      sorter: true,
      sortOrder: sortOrderFor(col.field),
      render: (_, record) => renderCell(record, col.field),
    }));
    const values = valueColumns.map((col) => ({
      title: col.label,
      dataIndex: col.field,
      key: `value-${col.field}`,
      align: "right",
      sorter: true,
      sortOrder: sortOrderFor(col.field),
      render: (_, record) => {
        const item = record.isGroup ? record.summary : record;
        return valueContent(item, col.field, viewMode, record.isGroup);
      },
    }));
    return [...detail, ...values];
  }, [columns, valueColumns, sortBy, sortOrder, renderCell, viewMode]);

  // antd reports sorter changes (ascend/descend/undefined). The orchestrator
  // owns sorting via URL params, so translate a real change back into one
  // onToggleSort call; ignore the "clear sort" click (old table only flipped
  // asc <-> desc) and no-op changes.
  const handleChange = (_pagination, _filters, sorter) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    if (!s || !s.column || !s.order) return;
    const field = s.column.dataIndex;
    const desired = s.order === "ascend" ? "asc" : "desc";
    if (sortBy === field && sortOrder === desired) return;
    onToggleSort(tableType, field);
  };

  const expandedKeys = useMemo(() => [...expanded], [expanded]);

  return (
    <Card title={title || undefined} styles={{ body: { padding: 0 } }} className="hcard-panel">
      <Table
        columns={antdColumns}
        dataSource={dataSource}
        rowKey="key"
        pagination={false}
        size="middle"
        scroll={{ x: 900 }}
        locale={{ emptyText: emptyMessage }}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpand: (_isExpanded, record) => toggleGroup(record.key),
        }}
        onChange={handleChange}
      />
    </Card>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string.isRequired,
  columns: PropTypes.arrayOf(PropTypes.shape({
    field: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    align: PropTypes.string,
  })).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderCell: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtCost, fmtTime };
