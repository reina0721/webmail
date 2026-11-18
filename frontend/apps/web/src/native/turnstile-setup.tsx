"use client";
import { useEffect, useRef, useState } from "react";
import {
  Action,
  PasswordField,
  SelectField,
  TextField,
  ConfirmDialog,
} from "@mail-web/ui";
import { api, errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";

import { turnstileKeyValid } from "./turnstile-key";

type Account = { id: string; name: string };
type Configuration = {
  settings: { turnstileSiteKey?: string };
  turnstileSecretSet: boolean;
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
    [configured, setConfigured] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<"accounts" | "configure" | "">(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(false),
    generation = useRef(0);
  const hostname = publicOrigin ? new URL(publicOrigin).hostname : "";
  const usableHostname =
    publicOrigin === undefined ||
    (hostname.includes(".") && !/^[\d.]+$/.test(hostname));
  const blocked = disabled || !usableHostname;
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
    const value = await api<Configuration>("/installation/config", request);
    return (
      turnstileKeyValid(value.settings.turnstileSiteKey ?? "") &&
      value.turnstileSecretSet
    );
  }
  useEffect(() => {
    alive.current = true;
    const at = ++generation.current;
    void read()
      .then((value) => {
        if (alive.current && generation.current === at) setConfigured(value);
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
    if (!key) return;
    const timer = setTimeout(() => {
      setKey("");
      setNotice("临时 API Token 已清除，请重新填写后继续。");
    }, 600_000);
    return () => clearTimeout(timer);
  }, [key]);
  async function configure() {
    const at = generation.current;
    const active = () => alive.current && at === generation.current;
    const cloudflareToken = key.trim();
    let cloudflareAccount = account.trim();
    pending(true, cloudflareAccount ? "configure" : "accounts");
    setError("");
    setNotice("");
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
        setAccount(cloudflareAccount);
        pending(true, "configure");
      }
      await api("/installation/turnstile", {
        ...request,
        method: "POST",
        body: JSON.stringify({
          cloudflareToken,
          cloudflareAccount,
        }),
      });
      if (!alive.current || at !== generation.current) return;
      setKey("");
      setNotice("验证组件已保存，正在等待服务应用配置…");
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!alive.current || at !== generation.current) return;
        try {
          if (await read()) {
            setConfigured(true);
            setNotice(
              "Turnstile 已自动创建并生效。下一步完成人机验证与验证码收信。",
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
      if (alive.current && at === generation.current) setError(errorMessage(e));
    } finally {
      if (alive.current && at === generation.current) pending(false);
    }
  }
  return (
    <section className="console-panel" id="turnstile-setup">
      <header>
        <h2>自动配置 Turnstile 人机验证</h2>
        <p>
          用于公开注册和找回密码。提供 Cloudflare API Token 后，Webmail
          会创建组件并保存密钥。
        </p>
      </header>
      {publicOrigin !== undefined && (
        <p role="status">
          {usableHostname ? (
            <>
              组件绑定域名 <strong>{hostname}</strong>。
            </>
          ) : (
            "请先在上方保存 Webmail 的 HTTPS 域名，然后回来配置 Turnstile。当前 IP 可用于直接访问 Webmail。"
          )}
        </p>
      )}
      {configured === true ? (
        <>
          <p role="status">Turnstile 已配置。</p>
          <a className="console-link" href="/console/registration/">
            进入注册与收信验证 →
          </a>
        </>
      ) : (
        <>
          <p>
            填写目标 Cloudflare 账号的 API
            Token，点击下方按钮。单一账号会自动选中并创建组件。Token
            只用于本次配置。
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
              }}
            />
            {accounts && accounts.length > 1 && (
              <SelectField
                label="Cloudflare 账号"
                value={account}
                disabled={busy || blocked}
                options={accounts.map((value) => ({
                  value: value.id,
                  label: value.name,
                }))}
                onValueChange={setAccount}
              />
            )}
          </div>
          <div className="console-actions">
            <Action
              loading={busy}
              disabled={
                !key.trim() ||
                busy ||
                blocked ||
                (accounts !== null && accounts.length > 1 && !account) ||
                (!!account.trim() && !/^[a-fA-F0-9]{32}$/.test(account.trim()))
              }
              onPress={() => void configure()}
            >
              {phase === "accounts"
                ? "正在读取 Cloudflare 账号"
                : phase === "configure"
                  ? "正在创建验证组件"
                  : "自动创建并保存验证配置"}
            </Action>
          </div>
          {(accounts === null || accounts.length <= 1) && (
            <details>
              <summary>使用已有的 Cloudflare Account ID</summary>
              <TextField
                label="Cloudflare Account ID"
                value={account}
                disabled={busy || blocked}
                onChange={(e) => setAccount(e.target.value)}
                hint="可填写已有的 32 位 Account ID，继续使用同一个 Token。"
              />
              <a
                className="console-link"
                href="https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/"
                target="_blank"
                rel="noreferrer"
              >
                在 Cloudflare 找到 Account ID ↗
              </a>
            </details>
          )}
          {disabled && <p>请先保存或清除本页正在编辑的其他配置。</p>}
        </>
      )}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <Action
        variant="quiet"
        disabled={busy || blocked}
        onPress={() => {
          void read()
            .then((value) => {
              setConfigured(value);
              if (value && configured !== true) onApplied?.();
              setError("");
              setNotice(
                value
                  ? "已确认 Turnstile 配置生效。"
                  : "尚未配置 Turnstile，请使用上方 API Token 自动配置。",
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
