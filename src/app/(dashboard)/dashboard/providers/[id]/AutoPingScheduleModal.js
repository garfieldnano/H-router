"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Form, Input, Modal, Segmented } from "antd";
import {
  PING_SCHEDULE_DEFAULTS,
  getLocalTimezone,
  getScheduleSlotLabels,
  maxSlotsPerDay,
  parseAnchor,
} from "@/shared/services/quotaPingSchedule";

const MODE_OPTIONS = [
  { value: "off", label: "Off", icon: <span className="material-symbols-outlined text-[15px] leading-none">block</span> },
  { value: "reset", label: "On reset", icon: <span className="material-symbols-outlined text-[15px] leading-none">bolt</span> },
  { value: "schedule", label: "Schedule", icon: <span className="material-symbols-outlined text-[15px] leading-none">schedule</span> },
];

function toFormState(schedule, reactive) {
  return {
    mode: schedule?.enabled === true ? "schedule" : reactive === true ? "reset" : "off",
    anchor: schedule?.anchor || PING_SCHEDULE_DEFAULTS.anchor,
    timezone: getLocalTimezone(),
    windowHours: String(schedule?.windowHours ?? PING_SCHEDULE_DEFAULTS.windowHours),
    slotsPerDay: String(schedule?.slotsPerDay ?? PING_SCHEDULE_DEFAULTS.slotsPerDay),
  };
}

export default function AutoPingScheduleModal({ isOpen, onClose, onSave, connection, reactive = false, schedule = null }) {
  // Mounted only while the modal is open, so the initial state is always fresh.
  const [form, setForm] = useState(() => toFormState(schedule, reactive));

  const windowHours = Number(form.windowHours);
  const slotsPerDay = Number(form.slotsPerDay);
  const anchorValid = Boolean(parseAnchor(form.anchor));
  const windowValid = Number.isFinite(windowHours) && windowHours >= 0.5 && windowHours <= 24;
  const slotsMax = windowValid ? maxSlotsPerDay(windowHours) : 24;
  const slotsValid = Number.isInteger(slotsPerDay) && slotsPerDay >= 1 && slotsPerDay <= slotsMax;
  const canSaveSchedule = anchorValid && windowValid && slotsValid;
  const canSave = form.mode !== "schedule" || canSaveSchedule;

  const previewSlots = canSaveSchedule
    ? getScheduleSlotLabels({ enabled: true, ...form, windowHours, slotsPerDay })
    : [];

  // Last slot's window end — the moment coverage stops until the next anchor.
  const coverageEnd = previewSlots.length && windowValid
    ? (() => {
      const { hour, minute } = parseAnchor(form.anchor);
      const total = Math.round(hour * 60 + minute + slotsPerDay * windowHours * 60) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    })()
    : "";

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      reactive: form.mode === "reset",
      schedule: form.mode === "schedule"
        ? {
          enabled: true,
          anchor: form.anchor,
          timezone: form.timezone,
          windowHours,
          slotsPerDay,
        }
        : { enabled: false },
    });
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      title="Auto-ping settings"
      width={640}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" onClick={handleSave} disabled={!canSave}>Save</Button>,
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Configure automated quota pings{connection?.name ? ` for ${connection.name}` : ""} — pick one mode.
        </p>

        <Segmented
          block
          options={MODE_OPTIONS}
          value={form.mode}
          onChange={(v) => update({ mode: v })}
        />

        {form.mode === "reset" && (
          <p className="text-xs text-text-muted">
            Pings right after the 5h quota window resets, so a new window starts immediately.
          </p>
        )}

        {form.mode === "schedule" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-text-muted">
              Pings at fixed local times so the 5h windows align with your workday.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Form.Item
                label="Anchor time"
                validateStatus={anchorValid ? "" : "error"}
                help={anchorValid ? "" : "Use HH:MM"}
                style={{ marginBottom: 0 }}
              >
                <Input
                  type="time"
                  value={form.anchor}
                  onChange={(e) => update({ anchor: e.target.value })}
                />
              </Form.Item>
              <Form.Item
                label="Window (hours)"
                validateStatus={windowValid ? "" : "error"}
                help={windowValid ? "" : "0.5 – 24"}
                style={{ marginBottom: 0 }}
              >
                <Input
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  value={form.windowHours}
                  onChange={(e) => update({ windowHours: e.target.value })}
                />
              </Form.Item>
              <Form.Item
                label="Pings per day"
                validateStatus={slotsValid ? "" : "error"}
                help={slotsValid ? `Max ${slotsMax}` : `1 – ${slotsMax}`}
                style={{ marginBottom: 0 }}
              >
                <Input
                  type="number"
                  min="1"
                  max={String(slotsMax)}
                  step="1"
                  value={form.slotsPerDay}
                  onChange={(e) => update({ slotsPerDay: e.target.value })}
                />
              </Form.Item>
            </div>

            {previewSlots.length > 0 && (
              <div className="hcard-panel">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Daily slots ({form.timezone})
                </p>
                <p className="hcard-mono mt-1 text-sm font-medium text-text-main">{previewSlots.join("  →  ")}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Covers {previewSlots[0]} – {coverageEnd}, then pauses until {previewSlots[0]} next day.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

AutoPingScheduleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  connection: PropTypes.object,
  reactive: PropTypes.bool,
  schedule: PropTypes.object,
};
