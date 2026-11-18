"use client";
import { useState } from "react";
import { Action, TextField, PasswordField, ConfirmDialog } from "@mail-web/ui";
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
  onSave,
  onApplied,
}: {
  initial: Settings;
  directAccessUrl?: string | null;
  onSave: (value: SiteUpdate) => Promise<void>;
  onApplied: () => void;
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
        "站点地址已保存。请打开主地址确认邮箱能正常访问，再配置注册验证。",
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

  return (
    <>
      <section className="console-panel">
        <header>
          <h2>站点名称与访问地址</h2>
          <p>
            主地址用于公开注册、找回密码和验证链接。先把域名反代到
            Webmail，并确认 HTTPS 可以访问。
          </p>
        </header>
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
          <p>
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
          {initial.publicOrigin && (
            <a
              className="console-link"
              href={initial.publicOrigin}
              target="_blank"
              rel="noreferrer"
            >
              打开已保存的主地址 ↗
            </a>
          )}
        </div>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
      <TurnstileSetup
        publicOrigin={initial.publicOrigin}
        disabled={dirty || busy || editingKeys}
        onBusyChange={setAutomaticBusy}
        onApplied={onApplied}
      />
      <section className="console-panel">
        <details>
          <summary>手动配置已有的 Turnstile 组件</summary>
          <p>
            如果你已在 Cloudflare 创建组件，请填写同一个组件的 Site Key 和
            Secret。组件必须允许 Webmail 主地址的域名。
          </p>
          {legacyKey && (
            <p>
              原来保存的 Site Key
              格式无效。可在上方自动创建组件，或在这里填入正确的两把密钥。
            </p>
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
          {manualMessage && <p role="status">{manualMessage}</p>}
        </details>
      </section>
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
