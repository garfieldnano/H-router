"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Tooltip, Typography } from "antd";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }) {
  const borderColor = testStatus === "ok"
    ? "#05f170"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div
      className="hcard-panel flex items-center gap-3 p-3"
      style={borderColor ? { borderColor } : undefined}
    >
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>

        <div className="flex items-center gap-1 mt-1">
          <code className="hcard-mono text-xs text-text-muted bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <Tooltip title={copied === `model-${modelId}` ? "Copied!" : "Copy"}>
            <Button
              type="text"
              size="small"
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              icon={
                <span className="material-symbols-outlined text-sm">
                  {copied === `model-${modelId}` ? "check" : "content_copy"}
                </span>
              }
            />
          </Tooltip>
          {onTest && (
            <Tooltip title={isTesting ? "Testing..." : "Test"}>
              <Button
                type="text"
                size="small"
                onClick={onTest}
                disabled={isTesting}
                icon={
                  <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                    {isTesting ? "progress_activity" : "science"}
                  </span>
                }
              />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Delete button */}
      <Tooltip title="Remove model">
        <Button
          type="text"
          size="small"
          danger
          onClick={onDeleteAlias}
          icon={<span className="material-symbols-outlined text-sm">delete</span>}
        />
      </Tooltip>
    </div>
  );
}

PassthroughModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
};

export default function PassthroughModelsSection({ providerAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();

    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Typography.Text type="secondary" className="text-sm">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </Typography.Text>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</label>
          <Input
            id="new-model-input"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onPressEnter={handleAdd}
            placeholder="anthropic/claude-3-opus"
          />
        </div>
        <Button
          type="primary"
          loading={adding}
          disabled={!newModel.trim() || adding}
          icon={<span className="material-symbols-outlined text-[14px]">add</span>}
          onClick={handleAdd}
        >
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, fullModel, alias, source }) => (
            <PassthroughModelRow
              key={`${source}-${fullModel}`}
              modelId={id}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
};
