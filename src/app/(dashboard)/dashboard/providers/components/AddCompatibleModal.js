"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Form, Input, Modal, Select, Tag } from "antd";

const VARIANT_CONFIG = {
  openai: {
    title: "Add OpenAI Compatible",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "OpenAI Compatible (Prod)",
    prefixPlaceholder: "oc-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus",
    errorLabel: "OpenAI Compatible",
    hasApiType: true,
  },
  anthropic: {
    title: "Add Anthropic Compatible",
    type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Anthropic Compatible (Prod)",
    prefixPlaceholder: "ac-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus",
    errorLabel: "Anthropic Compatible",
    hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

function AddCompatibleModal({ variant, isOpen, onClose, onCreated }) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => ({
    name: "",
    prefix: "",
    ...(config.hasApiType ? { apiType: "chat" } : {}),
    baseUrl: config.defaultBaseUrl,
  });

  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // openai: reset baseUrl when apiType changes; anthropic: reset checks when opened
  useEffect(() => {
    if (config.hasApiType) {
      setFormData((prev) => ({ ...prev, baseUrl: config.defaultBaseUrl }));
    } else if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
      setCheckModelId("");
    }
  }, [config.hasApiType ? formData.apiType : isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
          baseUrl: formData.baseUrl,
          type: config.type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log(`Error creating ${config.errorLabel} node:`, error);
    } finally {
      setSubmitting(false);
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
          type: config.type,
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;
    if (valid) {
      return (
        <>
          <Tag color="success">Valid</Tag>
          {method === "chat" && (
            <span className="text-sm text-text-muted">(via inference test)</span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Tag color="error">Invalid</Tag>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  const submitDisabled =
    !formData.name.trim() ||
    !formData.prefix.trim() ||
    !formData.baseUrl.trim() ||
    submitting;

  return (
    <Modal
      open={isOpen}
      title={config.title}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={submitting ? "Creating..." : "Create"}
      okButtonProps={{ disabled: submitDisabled, loading: submitting }}
      cancelText="Cancel"
    >
      <div className="flex flex-col gap-4">
        <Form.Item
          label="Name"
          help="Required. A friendly label for this node."
          style={{ marginBottom: 0 }}
        >
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={config.namePlaceholder}
          />
        </Form.Item>
        <Form.Item
          label="Prefix"
          help="Required. Used as the provider prefix for model IDs."
          style={{ marginBottom: 0 }}
        >
          <Input
            value={formData.prefix}
            onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
            placeholder={config.prefixPlaceholder}
          />
        </Form.Item>
        {config.hasApiType && (
          <Form.Item label="API Type" style={{ marginBottom: 0 }}>
            <Select
              options={API_TYPE_OPTIONS}
              value={formData.apiType}
              onChange={(v) => setFormData({ ...formData, apiType: v })}
            />
          </Form.Item>
        )}
        <Form.Item label="Base URL" help={config.baseUrlHint} style={{ marginBottom: 0 }}>
          <Input
            value={formData.baseUrl}
            onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            placeholder={config.defaultBaseUrl}
          />
        </Form.Item>
        <Form.Item label="API Key (for Check)" style={{ marginBottom: 0 }}>
          <Input.Password
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
          />
        </Form.Item>
        <Form.Item
          label="Model ID (optional)"
          help="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
          style={{ marginBottom: 0 }}
        >
          <Input
            value={checkModelId}
            onChange={(e) => setCheckModelId(e.target.value)}
            placeholder={config.modelIdPlaceholder}
          />
        </Form.Item>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !formData.baseUrl.trim()}
            loading={validating}
            className="w-full sm:w-auto"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
      </div>
    </Modal>
  );
}

AddCompatibleModal.propTypes = {
  variant: PropTypes.oneOf(["openai", "anthropic"]).isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

export default AddCompatibleModal;
