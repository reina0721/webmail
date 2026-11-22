"use client";
import { useState } from "react";
import { Action, ConsoleStatusBanner, FileField, TextField } from "@mail-web/ui";
import { api, errorMessage } from "@platform/lib/api";
import { AuthBackgroundUpload } from "./auth-background-upload";

export function SiteAssetField({
  kind,
  label,
  hint,
  value,
  defaultValue,
  uploaded,
  darkSurface = false,
  disabled = false,
  onChangeUrl,
  onUploaded,
  onReset,
  runMutation,
}: {
  kind:
    | "favicon"
    | "apple-touch-icon"
    | "app-logo-light"
    | "app-logo-dark"
    | "login-logo-light"
    | "login-logo-dark"
    | "auth-background"
    | "og-image";
  label: string;
  hint: string;
  value: string;
  defaultValue: string;
  uploaded: boolean;
  darkSurface?: boolean;
  disabled?: boolean;
  onChangeUrl: (url: string) => void;
  onUploaded: (kind: string, url: string) => void;
  onReset: (kind: string) => Promise<void>;
  runMutation?: (operation: () => Promise<void>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await api<{ kind: string; url: string }>(
      `/admin/site/assets/${kind}`,
      { method: "POST", body: form },
    );
    onUploaded(res.kind, res.url);
  }

  async function write(operation: () => Promise<void>) {
    if (runMutation) return runMutation(operation);
    await operation();
    return true;
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError("");
    try {
      await write(() => upload(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError("");
    try {
      await write(() => onReset(kind));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const reset = (uploaded || value !== defaultValue) && (
    <Action
      variant="quiet"
      size="sm"
      disabled={disabled || busy}
      onPress={() => void handleReset()}
    >
      恢复默认
    </Action>
  );

  return (
    <div className="console-asset-card">
      <div>
        <strong>{label}</strong>
        <p className="console-hint">{hint}</p>
      </div>
      <div
        className="console-asset-preview"
        data-surface={darkSurface ? "dark" : "light"}
      >
        <img src={value || defaultValue} alt={label} />
      </div>
      <TextField
        label="资源地址（支持站内路径或 HTTPS URL）"
        value={value}
        disabled={disabled || busy}
        onChange={(e) => onChangeUrl(e.target.value)}
      />
      {kind === "auth-background" ? (
        <AuthBackgroundUpload
          disabled={disabled || busy}
          onUpload={(file) => {
            setError("");
            return write(() => upload(file));
          }}
        >
          {reset}
        </AuthBackgroundUpload>
      ) : (
        <div className="console-actions">
          <FileField
            label={busy ? "上传中…" : "上传图片"}
            accept={
              kind === "og-image" || kind === "apple-touch-icon"
                ? "image/png,image/jpeg,image/webp"
                : "image/svg+xml,image/png,image/jpeg,image/webp,image/x-icon,.svg,.png,.jpg,.jpeg,.webp,.ico"
            }
            disabled={disabled || busy}
            onFile={(file) => void handleFile(file)}
          />
          {reset}
        </div>
      )}
      {error && (
        <ConsoleStatusBanner severity="error" role="alert">
          {error}
        </ConsoleStatusBanner>
      )}
    </div>
  );
}
