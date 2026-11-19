"use client";
import { useState } from "react";
import {
  Action,
  ConfirmDialog,
  ConsoleAccordionSection,
  ConsoleSectionCard,
  ConsoleStatusBanner,
  OpenInNewOutlined,
  PasswordField,
  PublicOutlined,
  ShieldOutlined,
  TextField,
} from "@mail-web/ui";
import { api, errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import type { components } from "@platform/lib/generated-api";
import { TurnstileSetup } from "./turnstile-setup";
import { turnstileKeyValid } from "./turnstile-key";

type Settings = components["schemas"]["ConfigurationInput"];
type SiteUpdate = components["schemas"]["SiteUpdate"];

export function SiteSettings({
  initial,
  directAccessUrl,
  mode = "all",
  onSave,
}: {
  initial: Settings;
  directAccessUrl?: string | null;
  mode?: "all" | "general" | "turnstile-manual";
  onSave: (value: SiteUpdate) => Promise<void>;
}) {
  const [value, setValue] = useState({
    brand: initial.brand,
    publicOrigin: initial.publicOrigin,
  });
  const [siteKey, setSiteKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [automaticBusy, setAutomaticBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const dirty =
    value.brand !== initial.brand ||
    value.publicOrigin !== initial.publicOrigin;
  const editingKeys = !!(siteKey || secret);
  const leave = useInstallationLeave(dirty || editingKeys);
  const legacyKey =
    !!initial.turnstileSiteKey && !turnstileKeyValid(initial.turnstileSiteKey);
  const locked = busy || automaticBusy;

  async function saveSite() {
    setNotice("");
    setError("");
    let url: URL;
    try {
      url = new URL(value.publicOrigin.trim());
    } catch {
      setError("请填写完整访问地址，例如 https://webmail.example.com。");
      return;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.href !== url.origin + "/"
    ) {
      setError("请填写网站地址，保留协议、主机名和端口。");
      return;
    }
    const update = { brand: value.brand.trim(), publicOrigin: url.origin };
    setBusy(true);
    try {
      await onSave(update);
      setValue(update);
      setNotice(
        update.publicOrigin !== initial.publicOrigin
          ? "主地址已保存。请打开主地址确认邮箱能正常访问，再到「Turnstile 人机验证」分区核对是否允许新域名。"
          : "站点名称与访问地址已保存。",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveKeys() {
    const keys = { siteKey: siteKey.trim(), secret: secret.trim() };
    if (!turnstileKeyValid(keys.siteKey) || !turnstileKeyValid(keys.secret)) {
      setManualMessage(
        "请填写同一个 Turnstile 组件的 Site Key 和 Secret。网站地址和 API Token 请填在各自的配置区域。",
      );
      return;
    }
    setBusy(true);
    setManualMessage("");
    try {
      await api("/installation/config", {
        method: "PATCH",
        body: JSON.stringify({ turnstile: keys }),
      });
      setSiteKey("");
      setSecret("");
      setManualMessage(
        "密钥已保存。应用后可在「注册与验证」进行人机与收信验证。",
      );
    } catch (e) {
      setManualMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const showGeneral = mode === "all" || mode === "general";
  const showTurnstileAuto = mode === "all";
  const showTurnstileManual = mode === "all" || mode === "turnstile-manual";

  return (
    <>
      {showGeneral && (
        <ConsoleSectionCard
          title="站点名称与访问地址"
          description="主地址用于公开注册、找回密码和验证链接。先把域名反代到 Webmail，并确认 HTTPS 可以访问。"
          icon={<PublicOutlined fontSize="small" />}
          badge={
            dirty
              ? { label: "有未保存更改", tone: "warning" }
              : initial.publicOrigin
                ? { label: "已配置", tone: "success" }
                : undefined
          }
        >
          <div className="console-form-grid">
            <TextField
              label="站点名称"
              value={value.brand}
              disabled={locked}
              onChange={(e) => setValue({ ...value, brand: e.target.value })}
            />
            <TextField
              label="公开访问来源（主地址）"
              value={value.publicOrigin}
              disabled={locked}
              onChange={(e) =>
                setValue({ ...value, publicOrigin: e.target.value })
              }
            />
          </div>
          {directAccessUrl && (
            <p className="console-hint">
              IP 备用入口{" "}
              <a className="console-link" href={directAccessUrl}>
                {directAccessUrl}
              </a>
            </p>
          )}
          <div className="console-actions">
            <Action
              disabled={!dirty || automaticBusy}
              loading={busy && dirty}
              onPress={() => void saveSite()}
            >
              保存站点配置
            </Action>
            {dirty && (
              <Action
                variant="quiet"
                disabled={locked}
                onPress={() => {
                  setValue({
                    brand: initial.brand,
                    publicOrigin: initial.publicOrigin,
                  });
                  setError("");
                  setNotice("");
                }}
              >
                还原更改
              </Action>
            )}
            {initial.publicOrigin && (
              <a
                className="console-link"
                href={initial.publicOrigin}
                target="_blank"
                rel="noreferrer"
              >
                打开已保存的主地址
                <OpenInNewOutlined sx={{ fontSize: 15 }} />
              </a>
            )}
          </div>
          {notice && (
            <ConsoleStatusBanner severity="success">{notice}</ConsoleStatusBanner>
          )}
          {error && (
            <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
          )}
        </ConsoleSectionCard>
      )}

      {showTurnstileAuto && (
        <TurnstileSetup
          publicOrigin={initial.publicOrigin}
          disabled={dirty || busy || editingKeys}
          onBusyChange={setAutomaticBusy}
        />
      )}

      {showTurnstileManual && (
        <ConsoleAccordionSection
          title="手动配置已有的 Turnstile 组件（可选）"
          description="使用上方自动配置后可跳过。若已有 Cloudflare 组件，可手动保存该组件的 Site Key 和 Secret。"
          icon={<ShieldOutlined fontSize="small" />}
          badge={
            legacyKey
              ? { label: "旧密钥需修复", tone: "warning" }
              : { label: "备用配置", tone: "default" }
          }
          defaultExpanded={legacyKey}
        >
          {legacyKey && (
            <ConsoleStatusBanner severity="warning">
              原来保存的 Site Key 格式无效。可在自动配置中重新创建组件，或在这里填入正确的两把密钥。
            </ConsoleStatusBanner>
          )}
          <div className="console-form-grid">
            <TextField
              label="Turnstile Site Key"
              disabled={locked}
              value={siteKey}
              onChange={(e) => setSiteKey(e.target.value)}
            />
            <PasswordField
              label="Turnstile Secret"
              purpose="new"
              disabled={locked}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <div className="console-actions">
            <Action
              disabled={!editingKeys || dirty || automaticBusy}
              loading={busy && editingKeys}
              onPress={() => void saveKeys()}
            >
              保存 Turnstile 密钥
            </Action>
            {editingKeys && (
              <Action
                variant="quiet"
                disabled={locked}
                onPress={() => {
                  setSiteKey("");
                  setSecret("");
                  setManualMessage("");
                }}
              >
                清除输入
              </Action>
            )}
          </div>
          {manualMessage && (
            <ConsoleStatusBanner severity="info">
              {manualMessage}
            </ConsoleStatusBanner>
          )}
        </ConsoleAccordionSection>
      )}

      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!leave.href}
        onOpenChange={(open) => {
          if (!open) leave.cancel();
        }}
        title="离开未保存的配置？"
        description="当前修改尚未保存。"
        cancelLabel="继续编辑"
        confirmLabel="离开"
        onConfirm={leave.leave}
      />
    </>
  );
}
