"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Alert, Button, Form, Input, Modal, Select, Switch } from "antd";
import { CAPACITY_META, STT_TRANSPORT_META, STT_TRANSPORTS } from "@/shared/constants/models";

const defaultCaps = () => Object.fromEntries(Object.keys(CAPACITY_META).map((key) => [key, false]));

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [caps, setCaps] = useState(defaultCaps);
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  // Realtime dispatch marker for the transport select; "" = provider default REST.
  const [transport, setTransport] = useState("");

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setModelId(""); setCaps(defaultCaps()); setTransport(""); setTestStatus(null); setTestError(""); }
  }, [isOpen]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      // caps.stt is UI-only; the parent save flow derives the model type from
      // it and forwards the pinned transport (null unless the caller picked one).
      await onSave(cleanId, caps, caps.stt ? transport : null);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      title="Add Custom Model"
      footer={null}
    >
      <Form layout="vertical">
        <Form.Item label="Model ID" style={{ marginBottom: 12 }}>
          <div className="flex gap-2">
            <Input
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="hcard-mono flex-1"
              autoFocus
            />
            <Button
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="hcard-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </Form.Item>

        <Form.Item label="Capabilities" style={{ marginBottom: 12 }}>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {Object.entries(CAPACITY_META).map(([key, meta]) => (
              <span key={key} className="flex items-center gap-2">
                <Switch
                  size="small"
                  checked={!!caps[key]}
                  onChange={(v) => setCaps((prev) => ({ ...prev, [key]: v }))}
                />
                <span>
                  <span className="block text-sm">{meta.label}</span>
                  <span className="block text-xs text-text-muted">{meta.desc}</span>
                </span>
              </span>
            ))}
          </div>
        </Form.Item>

        {/* STT is a model TYPE, not a chat capability: the save flow turns this
            flag into type "stt" (the API honours a transport only on stt
            records). The select pins the realtime dispatch marker persisted
            with the model; the whitelist is the shared STT_TRANSPORT_META. */}
        <Form.Item style={{ marginBottom: 12 }}>
          <span className="flex items-center gap-2">
            <Switch
              size="small"
              checked={!!caps.stt}
              onChange={(v) => { setCaps((prev) => ({ ...prev, stt: v })); if (!v) setTransport(""); }}
            />
            <span>
              <span className="block text-sm">Speech to text</span>
              <span className="block text-xs text-text-muted">Transcribes audio via /v1/audio/transcriptions</span>
            </span>
          </span>
          {caps.stt && (
            <div className="mt-3">
              <Form.Item
                label="Transport"
                help="Realtime transport marker for the STT dispatcher. Empty keeps the provider's REST format."
                style={{ marginBottom: 0 }}
              >
                <Select
                  value={transport}
                  onChange={(v) => setTransport(v)}
                  placeholder="Provider default (REST)"
                  options={STT_TRANSPORTS.map((t) => ({ value: t, label: STT_TRANSPORT_META[t].label }))}
                />
              </Form.Item>
            </div>
          )}
        </Form.Item>

        {/* Test result */}
        {testStatus === "ok" && (
          <Alert type="success" showIcon message="Model is reachable" className="mb-3" />
        )}
        {testStatus === "error" && (
          <Alert type="error" showIcon message={testError || "Model not reachable"} className="mb-3" />
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} block>Cancel</Button>
          <Button
            type="primary"
            onClick={handleSave}
            block
            loading={saving}
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
