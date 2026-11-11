import PropTypes from "prop-types";
import { Button, Tooltip } from "antd";
import { CapacityBadges } from "@/shared/components";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
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
      className="hcard-panel group w-full sm:w-auto min-w-0 max-w-full px-3 py-2"
      style={borderColor ? { borderColor } : undefined}
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base mt-0.5 sm:mt-0"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="hcard-mono w-fit max-w-full break-all rounded bg-sidebar px-1.5 py-0.5 text-xs text-text-muted sm:max-w-[360px] sm:truncate">{displayModel}</code>
          <span className="flex min-w-0 items-center text-[9px] gap-1 pl-1">
            {model.name && <span className="break-all sm:truncate text-[9px] italic text-text-muted/70">{model.name}</span>}
            <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {onTest && (
            <Tooltip title={isTesting ? "Testing..." : "Test"}>
              <Button
                type="text"
                size="small"
                onClick={onTest}
                disabled={isTesting}
                className={isTesting ? "" : "sm:opacity-0 sm:group-hover:opacity-100"}
                icon={
                  <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                    {isTesting ? "progress_activity" : "science"}
                  </span>
                }
              />
            </Tooltip>
          )}
          <Tooltip title={copied === `model-${model.id}` ? "Copied!" : "Copy"}>
            <Button
              type="text"
              size="small"
              onClick={() => onCopy(displayModel, `model-${model.id}`)}
              icon={
                <span className="material-symbols-outlined text-sm">
                  {copied === `model-${model.id}` ? "check" : "content_copy"}
                </span>
              }
            />
          </Tooltip>
          {isCustom ? (
            <Tooltip title="Remove custom model">
              <Button
                type="text"
                size="small"
                danger
                onClick={onDeleteAlias}
                className="sm:opacity-0 sm:group-hover:opacity-100"
                icon={<span className="material-symbols-outlined text-sm">close</span>}
              />
            </Tooltip>
          ) : onDisable ? (
            <Tooltip title="Disable this model">
              <Button
                type="text"
                size="small"
                danger
                onClick={onDisable}
                className="sm:opacity-0 sm:group-hover:opacity-100"
                icon={<span className="material-symbols-outlined text-sm">close</span>}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
