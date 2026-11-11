"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Alert, Button, Form, Input, Modal, Segmented, Select, Tag } from "antd";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { planBulkAdd } from "@/shared/utils/bulkAdd";

const BULK_PLACEHOLDER = `name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named`;

export default function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, authType, authHint, website, proxyPools, error, existingNames, onSave, onBulkDone, onClose }) {
  const NONE_PROXY_POOL_VALUE = "__none__";
  const isOllamaLocal = provider === "ollama-local";
  const isCookie = authType === "cookie";
  const isXaiApiKey = provider === "xai" && !isCookie;
  const credentialLabel = isCookie ? "Cookie Value" : provider === "qoder" || provider === "qoder-cn" ? "Personal Access Token (PAT)" : "API Key";
  const credentialPlaceholder = isCookie
    ? (provider === "grok-web" ? "sso=xxxxx... or just the raw value" : "eyJhbGciOi...")
    : (isXaiApiKey ? "xai-..." : provider === "qoder" || provider === "qoder-cn" ? "pt-..." : "");

  const isAzure = provider === "azure";
  const isCloudflareAi = provider === "cloudflare-ai";
  // Capability, not identity: gating this on `provider === "bedrock"` left bedrock-xai with no
  // way to enter a profile at all, which is the same mistake as hardcoding the API-key exemption.
  const usesAwsCredentialForm =
    AI_PROVIDERS?.[provider]?.credentialForm === "aws";
  // Registry-declared: names the providerSpecificData field that stands in for an API key, so
  // a provider whose credential lives outside the key field can be saved without one.
  const apiKeyOptionalWith = AI_PROVIDERS?.[provider]?.apiKeyOptionalWith || null;
  const providerRegions = AI_PROVIDERS?.[provider]?.regions || null;
  const defaultRegion = AI_PROVIDERS?.[provider]?.defaultRegion || providerRegions?.[0]?.id || "";

  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    defaultModel: "",
    priority: 1,
    proxyPoolId: NONE_PROXY_POOL_VALUE,
    ollamaHostUrl: "",
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [bedrockData, setBedrockData] = useState({
    profile: "",
    region: "",
    accessKeyId: "",
    sessionToken: "",
  });
  const [region, setRegion] = useState(defaultRegion);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cliDetecting, setCliDetecting] = useState(false);
  const [cliDetectError, setCliDetectError] = useState(null);

  const handleCommandCodeAutoImport = async () => {
    setCliDetecting(true);
    setCliDetectError(null);
    try {
      const res = await fetch("/api/oauth/commandcode/auto-import");
      const data = await res.json();
      if (data.found && data.apiKey) {
        setFormData((prev) => ({
          ...prev,
          name: prev.name || data.userName || data.keyName || "CommandCode CLI",
          apiKey: data.apiKey,
        }));
      } else {
        setCliDetectError(data.error || "Could not find Command Code credentials");
      }
    } catch {
      setCliDetectError("Failed to auto-import from Command Code CLI");
    } finally {
      setCliDetecting(false);
    }
  };
  const bulkPlaceholder = isCloudflareAi
    ? `name1|sk-key1|acc123456\nname2|sk-key2|def789012\nsk-key-only-auto-named`
    : provider === "qoder" || provider === "qoder-cn"
      ? `name1|pt-xxxxx\nname2|pt-yyyyy\npt-only-auto-named`
      : BULK_PLACEHOLDER;

  const [mode, setMode] = useState("single"); // "single" | "bulk"
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null); // { success, failed }

  const buildProviderSpecificData = () => {
    if (isOllamaLocal && formData.ollamaHostUrl.trim()) {
      return { baseUrl: formData.ollamaHostUrl.trim() };
    }
    if (isAzure) {
      return {
        azureEndpoint: azureData.azureEndpoint,
        apiVersion: azureData.apiVersion,
        deployment: azureData.deployment,
        organization: azureData.organization,
      };
    }
    if (isCloudflareAi) {
      return { accountId: cloudflareData.accountId };
    }
    if (usesAwsCredentialForm) {
      // Only send what the user filled in: an empty `profile` would otherwise select profile
      // mode and shadow static keys, since detectCredentialMode prefers a profile.
      const data = {};
      if (bedrockData.profile.trim()) data.profile = bedrockData.profile.trim();
      if (bedrockData.region.trim()) data.region = bedrockData.region.trim();
      if (bedrockData.accessKeyId.trim()) data.accessKeyId = bedrockData.accessKeyId.trim();
      if (bedrockData.sessionToken.trim()) data.sessionToken = bedrockData.sessionToken.trim();
      return Object.keys(data).length ? data : undefined;
    }
    if (providerRegions && region) {
      return { region };
    }
    return undefined;
  };

  // One place decides whether the credential requirement is met. The button's disabled state and
  // handleSubmit's early return both read it; encoding the rule twice is what let Save look
  // clickable while silently doing nothing for profile-only Bedrock connections.
  const apiKeySatisfied = () => {
    const psd = buildProviderSpecificData();
    if (apiKeyOptionalWith && psd?.[apiKeyOptionalWith]) return true;
    // AWS static keys are a pair: a secret alone saves a connection that can never sign.
    if (usesAwsCredentialForm) return !!formData.apiKey && !!psd?.accessKeyId;
    return !!formData.apiKey;
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider) return;
    if (!isOllamaLocal && !apiKeySatisfied()) return;
    if (!isOllamaLocal) {
      // Non-ollama providers require a name
      if (!formData.name) return;
    }
    if (isCompatible && !formData.defaultModel.trim()) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name || (isOllamaLocal ? "Ollama Local" : ""),
        apiKey: formData.apiKey,
        defaultModel: isCompatible ? formData.defaultModel.trim() : undefined,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
        providerSpecificData: buildProviderSpecificData()
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async () => {
    const lines = bulkText.split("\n");
    if (!lines.length) return;
    // Plan collision-free names against existing connections so a generated
    // "Key N" never matches a saved name (which the backend would upsert /
    // overwrite instead of inserting). See bulkAdd.js for the full rationale.
    const plan = planBulkAdd(lines, existingNames, { isCloudflareAi });
    if (!plan.length) return;
    setSaving(true);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    for (const entry of plan) {
      try {
        // Validate each key before saving so bulk-added connections get a
        // real status (active/unknown) like single adds, instead of a
        // hardcoded "unknown" that never flips until a manual test.
        let isValid = false;
        try {
          const vres = await fetch("/api/providers/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, apiKey: entry.apiKey }),
          });
          const vdata = await vres.json().catch(() => ({}));
          isValid = !!vdata.valid;
        } catch {
          isValid = false;
        }
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: entry.apiKey,
            name: entry.name,
            priority: 1,
            testStatus: isValid ? "active" : "unknown",
            ...(entry.providerSpecificData ? { providerSpecificData: entry.providerSpecificData } : {}),
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setBulkResult({ success, failed });
    if (success > 0 && onBulkDone) onBulkDone();
  };

  // Modal-crash guard: antd evaluates Modal title + children on every
  // render even while closed. The title dereferences `providerName` /
  // `provider` / `credentialLabel` (all derived from props, safe once
  // provider is truthy) — bail out entirely while there is no provider,
  // exactly as before.
  if (!provider) return null;

  const saveDisabled = saving
    || (!isOllamaLocal && (!formData.name || !apiKeySatisfied()))
    || (isCompatible && !formData.defaultModel.trim())
    || (isAzure && (!azureData.azureEndpoint || !azureData.deployment || !azureData.organization))
    || (isCloudflareAi && !cloudflareData.accountId);

  const credentialInput = isCookie
    ? (
      <Input
        value={formData.apiKey}
        onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
        placeholder={credentialPlaceholder}
        className="hcard-mono"
      />
    )
    : (
      <Input.Password
        value={formData.apiKey}
        onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
        placeholder={credentialPlaceholder}
        className="hcard-mono"
      />
    );

  return (
    <Modal
      open={isOpen}
      title={`Add ${providerName || provider} ${credentialLabel}`}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <div className="flex flex-col gap-4">
        {/* Mode switcher. Hidden for AWS credentials: bulk lines carry only a key, so a
            Bedrock entry would be saved with no access key id or profile and never work. */}
        {!usesAwsCredentialForm && (
          <Segmented
            options={[
              { value: "single", label: "Single" },
              { value: "bulk", label: "Bulk Add" },
            ]}
            value={mode}
            onChange={(v) => { setMode(v); setBulkResult(null); }}
          />
        )}

        {mode === "bulk" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              {isCloudflareAi
                ? <>One key per line. Format: <code className="hcard-mono">name|apiKey|accountId</code> or just <code className="hcard-mono">apiKey</code> (auto-named by index).</>
                : provider === "qoder" || provider === "qoder-cn"
                  ? <>One PAT per line. Format: <code className="hcard-mono">name|pt-...</code> or just <code className="hcard-mono">pt-...</code> (auto-named by index).</>
                  : <>One key per line. Format: <code className="hcard-mono">name|apiKey</code> or just <code className="hcard-mono">apiKey</code> (auto-named by index).</>
              }
            </p>
            <Input.TextArea
              rows={6}
              className="hcard-mono"
              placeholder={bulkPlaceholder}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkResult && (
              <Tag color={bulkResult.failed > 0 ? "warning" : "success"}>
                ✓ {bulkResult.success} added{bulkResult.failed > 0 ? `, ✗ ${bulkResult.failed} failed` : ""}
              </Tag>
            )}
            <div className="flex gap-2">
              <Button type="primary" onClick={handleBulkSubmit} block loading={saving} disabled={saving || !bulkText.trim()}>
                {saving ? "Adding..." : "Add All Keys"}
              </Button>
              <Button onClick={onClose} block>Cancel</Button>
            </div>
          </div>
        )}

        {mode === "single" && (
        <Form layout="vertical">
        <Form.Item label="Name" style={{ marginBottom: 12 }}>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={isOllamaLocal ? "Ollama Local" : "Production Key"}
          />
        </Form.Item>
        {isOllamaLocal && (
          <div className="flex gap-2 items-end">
            <Form.Item label="Ollama Host URL" className="flex-1" style={{ marginBottom: 12 }}>
              <Input
                value={formData.ollamaHostUrl}
                onChange={(e) => setFormData({ ...formData, ollamaHostUrl: e.target.value })}
                placeholder="http://localhost:11434"
                className="hcard-mono"
              />
            </Form.Item>
            <div className="pb-3">
              <Button onClick={handleValidate} disabled={validating || saving} loading={validating}>
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {provider === "commandcode" && (
          <div className="hcard-panel flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-text">Command Code CLI detected?</div>
              <div className="text-xs text-text-muted">Import API key directly from ~/.commandcode/auth.json</div>
              {cliDetectError && <div className="text-xs text-red-400 mt-1">{cliDetectError}</div>}
            </div>
            <Button
              onClick={handleCommandCodeAutoImport}
              disabled={cliDetecting || saving}
              loading={cliDetecting}
            >
              {cliDetecting ? "Importing..." : "Import from CLI"}
            </Button>
          </div>
        )}
        {!isOllamaLocal && (
          <div className="flex gap-2 items-end">
            <Form.Item label={credentialLabel} className="flex-1" style={{ marginBottom: 12 }}>
              {credentialInput}
            </Form.Item>
            <div className="pb-3">
              <Button onClick={handleValidate} disabled={!apiKeySatisfied() || validating || saving} loading={validating}>
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {isXaiApiKey && (
          <p className="text-xs text-text-muted">
            Use a direct xAI API key from console.x.ai. This is separate from Grok Build OAuth.
          </p>
        )}
        {isCookie && authHint && (
          <p className="text-xs text-text-muted">
            {authHint}
            {website && (
              <>
                {" "}
                <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Open {website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
        )}
        {providerRegions && (
          <Form.Item label="Region" style={{ marginBottom: 12 }}>
            <Select
              value={region}
              onChange={(v) => setRegion(v)}
              options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
            />
          </Form.Item>
        )}
        {isCompatible && (
          <Form.Item label="Default Model" style={{ marginBottom: 12 }}>
            <Input
              value={formData.defaultModel}
              onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
              placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
              className="hcard-mono"
            />
          </Form.Item>
        )}
        {isOllamaLocal && (
          <p className="text-xs text-text-muted">
            Leave blank to use <code className="hcard-mono">http://localhost:11434</code>. For remote Ollama, enter the full host URL (e.g. <code className="hcard-mono">http://192.168.1.10:11434</code>).
          </p>
        )}
        {validationResult && (
          <div className="mb-3">
            <Tag color={validationResult === "success" ? "success" : "error"}>
              {validationResult === "success" ? "Valid" : "Invalid"}
            </Tag>
          </div>
        )}
        {error && (
          <Alert type="error" showIcon message={error} className="mb-3" />
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            Enter the model ID exactly as your compatible endpoint expects it. This model will be saved as the connection default.
          </p>
        )}
        {isCloudflareAi && (
          <div className="hcard-panel">
            <h3 className="font-semibold mb-3 text-sm">Cloudflare Workers AI</h3>
            <Form.Item label="Account ID" style={{ marginBottom: 12 }}>
              <Input
                value={cloudflareData.accountId}
                onChange={(e) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
                placeholder="abc123def456..."
                className="hcard-mono"
              />
            </Form.Item>
            <p className="text-xs text-text-muted mt-2">
              Find your Account ID in the right sidebar of <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a>
            </p>
          </div>
        )}
        {usesAwsCredentialForm && (
          <div className="hcard-panel">
            <h3 className="font-semibold mb-3 text-sm">AWS Bedrock Credentials</h3>
            <div className="flex flex-col gap-3">
              <Form.Item label="AWS Profile (SSO — recommended)" style={{ marginBottom: 0 }}>
                <Input
                  value={bedrockData.profile}
                  onChange={(e) => setBedrockData({ ...bedrockData, profile: e.target.value })}
                  placeholder="my-sso-profile"
                  className="hcard-mono"
                />
              </Form.Item>
              <Form.Item label="Region" style={{ marginBottom: 0 }}>
                <Input
                  value={bedrockData.region}
                  onChange={(e) => setBedrockData({ ...bedrockData, region: e.target.value })}
                  placeholder="us-east-1"
                  className="hcard-mono"
                />
              </Form.Item>
            </div>
            <p className="text-xs text-text-muted mt-2">
              Set a profile from <code className="hcard-mono">~/.aws/config</code> and leave the API key empty, then run
              {" "}<code className="hcard-mono">aws sso login --profile {bedrockData.profile || "my-sso-profile"}</code>.
              Credentials refresh automatically.
            </p>
            <div className="flex flex-col gap-3 mt-4">
              <Form.Item label="Access Key ID (only for static keys)" style={{ marginBottom: 0 }}>
                <Input
                  value={bedrockData.accessKeyId}
                  onChange={(e) => setBedrockData({ ...bedrockData, accessKeyId: e.target.value })}
                  placeholder="AKIA..."
                  className="hcard-mono"
                />
              </Form.Item>
              <Form.Item label="Session Token (only for temporary ASIA… keys)" style={{ marginBottom: 0 }}>
                <Input.Password
                  value={bedrockData.sessionToken}
                  onChange={(e) => setBedrockData({ ...bedrockData, sessionToken: e.target.value })}
                  placeholder="FwoGZXIvYXdz..."
                  className="hcard-mono"
                />
              </Form.Item>
            </div>
            <p className="text-xs text-text-muted mt-2">
              For static keys instead: put the AWS <strong>secret</strong> access key in the API Key
              field above and the access key id here. A profile, if set, takes precedence.
            </p>
          </div>
        )}
        {isAzure && (
          <div className="hcard-panel">
            <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
            <div className="flex flex-col gap-3">
              <Form.Item label="Azure Endpoint" style={{ marginBottom: 0 }}>
                <Input
                  value={azureData.azureEndpoint}
                  onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
                  placeholder="https://your-resource.openai.azure.com"
                  className="hcard-mono"
                />
              </Form.Item>
              <Form.Item label="Deployment Name" style={{ marginBottom: 0 }}>
                <Input
                  value={azureData.deployment}
                  onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                  placeholder="gpt-4"
                  className="hcard-mono"
                />
              </Form.Item>
              <Form.Item label="API Version" style={{ marginBottom: 0 }}>
                <Input
                  value={azureData.apiVersion}
                  onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                  placeholder="2024-10-01-preview"
                  className="hcard-mono"
                />
              </Form.Item>
              <Form.Item label="Organization" style={{ marginBottom: 0 }}>
                <Input
                  value={azureData.organization}
                  onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                  placeholder="Organization ID"
                />
              </Form.Item>
            </div>
          </div>
        )}

        <Form.Item label="Priority" style={{ marginBottom: 12 }}>
          <Input
            type="number"
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
          />
        </Form.Item>

        <Form.Item label="Proxy Pool" style={{ marginBottom: 12 }}>
          <Select
            value={formData.proxyPoolId}
            onChange={(v) => setFormData({ ...formData, proxyPoolId: v })}
            options={[
              { value: NONE_PROXY_POOL_VALUE, label: "None" },
              ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
            placeholder="None"
          />
        </Form.Item>

        {(proxyPools || []).length === 0 && (
          <p className="text-xs text-text-muted">
            No active proxy pools available. Create one in Proxy Pools page first.
          </p>
        )}

        <p className="text-xs text-text-muted">
          Legacy manual proxy fields are still accepted by API for backward compatibility.
        </p>

        <div className="flex gap-2">
          <Button type="primary" onClick={handleSubmit} block loading={saving} disabled={saveDisabled}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} block>
            Cancel
          </Button>
        </div>
        </Form>
        )}
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  authType: PropTypes.string,
  authHint: PropTypes.string,
  website: PropTypes.string,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  error: PropTypes.string,
  existingNames: PropTypes.arrayOf(PropTypes.string),
  onSave: PropTypes.func.isRequired,
  onBulkDone: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
