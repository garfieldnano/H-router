"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Form, Input, Modal, Select, Tag } from "antd";

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  // Modal-crash guard: antd evaluates Modal title + children on every
  // render even while closed, and the title dereferences `isAnthropic`
  // only — but the body below reads `node`-derived form state, so bail
  // out entirely while there is no node, exactly as before.
  if (!node) return null;

  return (
    <Modal
      open={isOpen}
      title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`}
      onCancel={onClose}
      footer={null}
    >
      <Form layout="vertical">
        <Form.Item
          label="Name"
          help="Required. A friendly label for this node."
          style={{ marginBottom: 12 }}
        >
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          />
        </Form.Item>
        <Form.Item
          label="Prefix"
          help="Required. Used as the provider prefix for model IDs."
          style={{ marginBottom: 12 }}
        >
          <Input
            value={formData.prefix}
            onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
            placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
            className="hcard-mono"
          />
        </Form.Item>
        {!isAnthropic && (
          <Form.Item label="API Type" style={{ marginBottom: 12 }}>
            <Select
              options={apiTypeOptions}
              value={formData.apiType}
              onChange={(v) => setFormData({ ...formData, apiType: v })}
            />
          </Form.Item>
        )}
        <Form.Item
          label="Base URL"
          help={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
          style={{ marginBottom: 12 }}
        >
          <Input
            value={formData.baseUrl}
            onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
            className="hcard-mono"
          />
        </Form.Item>
        <div className="flex gap-2 items-end">
          <Form.Item label="API Key (for Check)" className="flex-1" style={{ marginBottom: 12 }}>
            <Input.Password
              value={checkKey}
              onChange={(e) => setCheckKey(e.target.value)}
            />
          </Form.Item>
          <div className="pb-3">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} loading={validating}>
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        <Form.Item
          label="Model ID (optional)"
          help="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
          style={{ marginBottom: 12 }}
        >
          <Input
            value={checkModelId}
            onChange={(e) => setCheckModelId(e.target.value)}
            placeholder="e.g. my-model-id"
            className="hcard-mono"
          />
        </Form.Item>
        {validationResult && (
          <div className="mb-3">
            <Tag color={validationResult === "success" ? "success" : "error"}>
              {validationResult === "success" ? "Valid" : "Invalid"}
            </Tag>
          </div>
        )}
        <div className="flex gap-2">
          <Button type="primary" onClick={handleSubmit} block loading={saving} disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} block>
            Cancel
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
