"use client";
import { useEffect, useRef, useState } from "react";
import {
  Action,
  PasswordField,
  SelectField,
  TextField,
  ConfirmDialog,
} from "@mail-web/ui";
import { api, ApiError, errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import type { components } from "@platform/lib/generated-api";

import { turnstileKeyValid } from "./turnstile-key";

type Account = { id: string; name: string };
type Configuration = components["schemas"]["ConfigurationView"];
type TurnstileResult = components["schemas"]["TurnstileResult"];
const outcomes: Record<string, string> = {
  created: "已创建 Turnstile 组件。",
  repaired: "已将当前域名加入原组件。",
  verified: "Cloudflare 已确认原组件的密钥和域名。",
  replaced: "已创建替代组件并切换到新密钥。",
};
export function TurnstileSetup({
  token = "",
  publicOrigin,
  disabled = false,
  onApplied,
  onBusyChange,
}: {
  token?: string;
  publicOrigin?: string;
  disabled?: boolean;
  onApplied?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [key, setKey] = useState(""),
    [account, setAccount] = useState(""),
    [accounts, setAccounts] = useState<Account[] | null>(null),
    [configuration, setConfiguration] = useState<Configuration | null>(null),
    [missing, setMissing] = useState(false),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<"accounts" | "configure" | "">(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(false),
    generation = useRef(0),
    panel = useRef<HTMLElement>(null);
  const hostname = publicOrigin ? new URL(publicOrigin).hostname : "";
  const usableHostname =
    publicOrigin === undefined ||
    (hostname.includes(".") && !/^[\d.]+$/.test(hostname));
  const blocked = disabled || !usableHostname;
  const siteKey = configuration?.settings.turnstileSiteKey ?? "";
  const secretSet = configuration?.turnstileSecretSet;
  const binding = configuration?.turnstileBinding;
  const configured = turnstileKeyValid(siteKey) && !!secretSet;
  const hostnameAllowed = binding?.hostnames.some((value) => {
    const allowed = value.toLowerCase();
    return hostname === allowed || hostname.endsWith("." + allowed);
  });
  const effectiveAccount =
    account.trim() || (accounts?.length === 1 ? accounts[0].id : "");
  const leave = useInstallationLeave(!!key && !busy);
  const headers = () =>
    token ? { Authorization: "Bearer " + token } : undefined;
  const request = { headers: headers(), account: "primary" as const };
  function pending(value: boolean, next: "accounts" | "configure" | "" = "") {
    setBusy(value);
    setPhase(value ? next : "");
    onBusyChange?.(value);
  }
  async function read() {
    return api<Configuration>("/installation/config", request);
  }
  useEffect(() => {
    alive.current = true;
    const at = ++generation.current;
    void read()
      .then((value) => {
        if (alive.current && generation.current === at) setConfiguration(value);
      })
      .catch((e) => {
        if (alive.current && generation.current === at)
          setError(errorMessage(e));
      });
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [token, publicOrigin]);
  useEffect(() => {
    if (location.hash === "#turnstile-setup")
      panel.current?.scrollIntoView?.({ block: "start" });
  }, []);
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => {
      setKey("");
      setNotice("临时 API Token 已清除，请重新填写后继续。");
    }, 600_000);
    return () => clearTimeout(timer);
  }, [key]);
  async function configure(replaceMissing = false) {
    const at = generation.current;
    const active = () => alive.current && at === generation.current;
    const cloudflareToken = key.trim();
    let cloudflareAccount = effectiveAccount;
    pending(true, cloudflareAccount ? "configure" : "accounts");
    setError("");
    setNotice("");
    setMissing(false);
    try {
      if (!cloudflareAccount) {
        const found = await api<{ accounts: Account[] }>(
          "/installation/turnstile/accounts",
          {
            ...request,
            method: "POST",
            body: JSON.stringify({ cloudflareToken }),
          },
        );
        if (!active()) return;
        setAccounts(found.accounts);
        if (found.accounts.length !== 1) {
          setNotice(
            found.accounts.length
              ? "请选择要安装 Turnstile 的 Cloudflare 账号。"
              : "此 Token 未能读取 Cloudflare 账号。要只用 Token 完成，请在目标账号授权 Account Settings: Read 和 Turnstile: Edit 后重试。",
          );
          return;
        }
        cloudflareAccount = found.accounts[0].id;
        pending(true, "configure");
      }
      const result = await api<TurnstileResult>("/installation/turnstile", {
        ...request,
        method: "POST",
        body: JSON.stringify({
          cloudflareToken,
          cloudflareAccount,
          ...(configured && { repair: true, siteKey }),
          ...(replaceMissing && { replaceMissing: true }),
          ...(publicOrigin && { publicOrigin }),
        }),
      });
      if (!alive.current || at !== generation.current) return;
      setKey("");
      setNotice("验证组件已保存，正在等待服务应用配置…");
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!alive.current || at !== generation.current) return;
        try {
          const applied = await read();
          if (!active()) return;
          if (
            applied.settings.turnstileSiteKey === result.siteKey &&
            applied.turnstileSecretSet &&
            applied.turnstileBinding?.checkedAt ===
              result.turnstileBinding?.checkedAt
          ) {
            setConfiguration(applied);
            setNotice(
              (outcomes[result.action] ?? "验证配置已应用。") +
                " 下一步完成人机验证与验证码收信。",
            );
            onApplied?.();
            return;
          }
        } catch {
          /* The service briefly restarts after applying its configuration. */
        }
      }
      setNotice("配置已保存，服务仍在应用。请点击“读取配置状态”确认。");
    } catch (e) {
      if (active()) {
        setError(errorMessage(e));
        setMissing(
          e instanceof ApiError && e.code === "turnstile_widget_missing",
        );
      }
    } finally {
      if (alive.current && at === generation.current) pending(false);
    }
  }
  return (
    <section className="console-panel" id="turnstile-setup" ref={panel}>
      <header>
        <h2>自动配置 Turnstile 人机验证</h2>
        <p>
          Webmail 在 Cloudflare 创建或修复验证组件，用于公开注册和找回密码。
          Cloudflare 生成 Site Key 和 Secret，Webmail 会自动保存。
        </p>
      </header>
      {!usableHostname && (
        <p>
          请先在上方保存 Webmail 的 HTTPS 域名。当前 IP 可用于直接使用邮箱。
        </p>
      )}
      <dl className="console-form-grid">
        <div>
          <dt className="console-hint">当前 Webmail 主机名</dt>
          <dd>{hostname || "请先设置主地址"}</dd>
        </div>
        <div>
          <dt className="console-hint">Cloudflare 账号 ID</dt>
          <dd>{binding ? <code>{binding.accountId}</code> : "尚无确认记录"}</dd>
        </div>
        <div>
          <dt className="console-hint">Cloudflare 组件名称</dt>
          <dd>
            {binding ? <code>{binding.widgetName}</code> : "尚无确认记录"}
          </dd>
        </div>
        <div>
          <dt className="console-hint">Cloudflare 上次确认的域名</dt>
          <dd>{binding?.hostnames.join("、") || "尚无确认记录"}</dd>
        </div>
        <div>
          <dt className="console-hint">Site Key · 浏览器使用的公开标识</dt>
          <dd>
            {turnstileKeyValid(siteKey) ? (
              <code>{siteKey}</code>
            ) : siteKey ? (
              "保存的值格式无效"
            ) : configuration ? (
              "未保存"
            ) : (
              "尚未读取"
            )}
          </dd>
        </div>
        <div>
          <dt className="console-hint">Secret · 服务端校验密钥</dt>
          <dd>
            {secretSet ? "已加密保存" : configuration ? "未保存" : "尚未读取"}
          </dd>
        </div>
      </dl>
      {binding && hostname && (
        <p role="status">
          {hostnameAllowed
            ? "上次核对时，组件已允许当前域名。"
            : "当前域名不在上次确认的绑定范围内，请核对并修复。"}{" "}
          核对时间 {new Date(binding.checkedAt).toLocaleString()}。
        </p>
      )}
      {!binding && configured && (
        <p role="status">
          密钥已保存。请用 Cloudflare API Token 核对组件和当前域名。
        </p>
      )}
      <p>
        API Token 用于本次创建或修复。多数情况下填写同一个 Token
        即可自动选中账号。
      </p>
      <div className="console-form-grid">
        <PasswordField
          label="Cloudflare API Token"
          purpose="current"
          value={key}
          disabled={busy || blocked}
          onChange={(e) => {
            setKey(e.target.value);
            setAccount("");
            setAccounts(null);
            setNotice("");
            setError("");
            setMissing(false);
          }}
        />
        {accounts && accounts.length > 1 ? (
          <SelectField
            label="Cloudflare 账号"
            value={account}
            disabled={busy || blocked}
            options={accounts.map((value) => ({
              value: value.id,
              label: value.name,
            }))}
            onValueChange={(value) => {
              setAccount(value);
              setMissing(false);
              setError("");
            }}
          />
        ) : (
          <TextField
            label="Cloudflare Account ID（通常可留空）"
            value={account || (accounts?.length === 1 ? accounts[0].id : "")}
            disabled={busy || blocked}
            onChange={(e) => {
              setAccount(e.target.value);
              setAccounts(null);
              setMissing(false);
              setError("");
            }}
            hint="如果 Token 无法读取账号，在这里填入 32 位 Account ID。"
          />
        )}
      </div>
      <a
        className="console-link"
        href="https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/"
        target="_blank"
        rel="noreferrer"
      >
        在 Cloudflare 找到 Account ID ↗
      </a>
      <div className="console-actions">
        <Action
          loading={busy}
          disabled={
            !key.trim() ||
            busy ||
            blocked ||
            (accounts !== null && accounts.length > 1 && !account) ||
            (!!effectiveAccount && !/^[a-fA-F0-9]{32}$/.test(effectiveAccount))
          }
          onPress={() => void configure()}
        >
          {phase === "accounts"
            ? "正在读取 Cloudflare 账号"
            : phase === "configure"
              ? configured
                ? "正在核对验证组件"
                : "正在创建验证组件"
              : configured
                ? "核对并修复现有组件"
                : "自动创建并保存验证配置"}
        </Action>
        {missing && (
          <Action
            variant="secondary"
            disabled={busy || blocked}
            onPress={() => void configure(true)}
          >
            在此账号创建替代组件
          </Action>
        )}
      </div>
      {disabled && <p>请先保存或清除本页正在编辑的其他配置。</p>}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {configured && (
        <p>
          <a className="console-link" href="/console/registration/">
            进入注册与收信验证 →
          </a>{" "}
          在该页完成真人验证和收信后即可开启注册。
        </p>
      )}
      <Action
        variant="quiet"
        disabled={busy}
        onPress={() => {
          void read()
            .then((value) => {
              setConfiguration(value);
              setError("");
              setNotice(
                value.turnstileSecretSet &&
                  turnstileKeyValid(value.settings.turnstileSiteKey ?? "")
                  ? "已重新读取 Webmail 保存的密钥与上次核对结果。需要检查 Cloudflare 上的当前状态时，请使用上方的核对按钮。"
                  : "已重新读取 Webmail 设置。请使用上方的 API Token 配置 Turnstile。",
              );
            })
            .catch((e) => setError(errorMessage(e)));
        }}
      >
        读取配置状态
      </Action>
      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!leave.href}
        onOpenChange={(open) => {
          if (!open) leave.cancel();
        }}
        title="离开验证配置？"
        description="尚未使用的 API Token 会从页面清除。"
        cancelLabel="继续配置"
        confirmLabel="离开"
        onConfirm={leave.leave}
      />
    </section>
  );
}
