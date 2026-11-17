"use client";
import { useState } from "react";
import { Action, TextField, ConfirmDialog } from "@mail-web/ui";
import { errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import type { components } from "@platform/lib/generated-api";
import { TurnstileSetup } from "./turnstile-setup";
import {
  turnstileKeyValid,
  turnstileConfigurationError,
} from "./turnstile-key";
type Settings = components["schemas"]["ConfigurationInput"];
export function SiteSettings({
  initial,
  onSave,
  onApplied,
}: {
  initial: Settings;
  onSave: (value: Settings) => Promise<void>;
  onApplied: () => void;
}) {
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [automaticBusy, setAutomaticBusy] = useState(false),
    [notice, setNotice] = useState("");
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const leave = useInstallationLeave(dirty);
  return (
    <>
      <section className="console-panel">
        <header>
          <h2>站点品牌与验证服务</h2>
          <p>保存后由服务自动应用运行配置。已有邮件服务凭据会保留。</p>
        </header>
        <div className="console-form-grid">
          {(
            [
              ["brand", "站点名称"],
              ["publicOrigin", "公开访问来源"],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              disabled={busy || automaticBusy}
              value={value[key] ?? ""}
              onChange={(e) => setValue({ ...value, [key]: e.target.value })}
            />
          ))}
        </div>
        <details>
          <summary>高级：手动填写已有 Turnstile 密钥</summary>
          <p>
            仅在已经持有同一组件的 Site Key 和 Secret 时使用。Site Key 是
            Cloudflare 生成的组件标识，不是网站地址；Secret 也不是 API
            Token。Cloudflare API Token 请填写到下方自动配置中。
          </p>
          <div className="console-form-grid">
            <TextField
              label="Turnstile Site Key"
              disabled={busy || automaticBusy}
              value={value.turnstileSiteKey ?? ""}
              onChange={(e) =>
                setValue({ ...value, turnstileSiteKey: e.target.value })
              }
            />
            <TextField
              label="新的 Turnstile Secret"
              type="password"
              disabled={busy || automaticBusy}
              value={value.turnstileSecret ?? ""}
              onChange={(e) =>
                setValue({ ...value, turnstileSecret: e.target.value })
              }
            />
          </div>
        </details>
        <Action
          disabled={!dirty || automaticBusy}
          loading={busy}
          onPress={() => {
            if (
              (value.turnstileSiteKey &&
                !turnstileKeyValid(value.turnstileSiteKey)) ||
              (value.turnstileSecret?.trim() &&
                !turnstileKeyValid(value.turnstileSecret.trim()))
            ) {
              setNotice(turnstileConfigurationError);
              return;
            }
            setBusy(true);
            void onSave(value)
              .then(() => setNotice("配置已保存，服务正在自动应用"))
              .catch((e) => setNotice(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          保存站点配置
        </Action>
        {notice && <p role="status">{notice}</p>}
      </section>
      <TurnstileSetup
        disabled={dirty || busy}
        onBusyChange={setAutomaticBusy}
        onApplied={onApplied}
      />
      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!leave.href}
        onOpenChange={(v) => {
          if (!v) leave.cancel();
        }}
        title="离开未保存的配置？"
        description="当前站点修改尚未保存。"
        cancelLabel="继续编辑"
        confirmLabel="离开"
        onConfirm={leave.leave}
      />
    </>
  );
}
