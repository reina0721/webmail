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
  disabled = false,
  onApplied,
  onBusyChange,
}: {
  token?: string;
  disabled?: boolean;
  onApplied?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [key, setKey] = useState(""),
    [account, setAccount] = useState(""),
    [accounts, setAccounts] = useState<Account[]>([]),
    [discovered, setDiscovered] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<"accounts" | "configure" | "">(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(false),
    generation = useRef(0);
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
  }, [token]);
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => {
      setKey("");
      setNotice("临时 API Token 已清除，请重新填写后继续。");
    }, 600_000);
    return () => clearTimeout(timer);
  }, [key]);
  async function discover() {
    const at = generation.current;
    pending(true, "accounts");
    setError("");
    setNotice("");
    try {
      const value = await api<{ accounts: Account[] }>(
        "/installation/turnstile/accounts",
        {
          ...request,
          method: "POST",
          body: JSON.stringify({ cloudflareToken: key }),
        },
      );
      if (!alive.current || at !== generation.current) return;
      setAccounts(value.accounts);
      setDiscovered(true);
      if (value.accounts.length === 1) setAccount(value.accounts[0].id);
      setNotice(
        value.accounts.length
          ? "已读取 Cloudflare 账号，请创建并保存验证配置。"
          : "Token 未能列出账号。请填写目标 Cloudflare Account ID；无需重新登录 Cloudflare。",
      );
    } catch (e) {
      if (alive.current && at === generation.current) setError(errorMessage(e));
    } finally {
      if (alive.current && at === generation.current) pending(false);
    }
  }
  async function configure() {
    const at = generation.current;
    pending(true, "configure");
    setError("");
    setNotice("");
    try {
      await api("/installation/turnstile", {
        ...request,
        method: "POST",
        body: JSON.stringify({
          cloudflareToken: key,
          cloudflareAccount: account.trim(),
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
          填写有 Turnstile 编辑权限的 Cloudflare API
          Token，程序自动创建组件并保存 Site Key 和 Secret。无需再次授权
          Stalwart，也无需手工复制两把密钥。
        </p>
      </header>
      {configured === true ? (
        <>
          <p role="status">Turnstile 已配置。</p>
          <a className="console-link" href="/console/registration/">
            进入注册与收信验证 →
          </a>
        </>
      ) : (
        <>
          <p>API Token 仅临时用于配置；完成后清除，不长期保存。</p>
          <div className="console-form-grid">
            <PasswordField
              label="Cloudflare API Token"
              purpose="current"
              value={key}
              disabled={busy || disabled}
              onChange={(e) => {
                setKey(e.target.value);
                setDiscovered(false);
                setAccounts([]);
              }}
            />
            <TextField
              label="Cloudflare Account ID"
              value={account}
              disabled={busy || disabled}
              onChange={(e) => setAccount(e.target.value)}
              hint="账号的 32 位 ID；没有列账号权限时可从 Cloudflare 后台复制填写。"
            />
            {accounts.length > 0 && (
              <SelectField
                label="可访问的 Cloudflare 账号"
                value={account}
                disabled={busy || disabled}
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
              variant="secondary"
              loading={phase === "accounts"}
              disabled={!key.trim() || busy || disabled}
              onPress={() => void discover()}
            >
              读取 Cloudflare 账号
            </Action>
            <Action
              loading={phase === "configure"}
              disabled={
                !key.trim() ||
                !/^[a-fA-F0-9]{32}$/.test(account.trim()) ||
                busy || disabled
              }
              onPress={() => void configure()}
            >
              自动创建并保存验证配置
            </Action>
          </div>
          {discovered && !accounts.length && (
            <p>
              账号列表为空不会再被当作配置完成；填写 Account ID
              后可继续使用同一个 Token。
            </p>
          )}
          {disabled && <p>请先保存当前站点修改，再配置验证服务。</p>}
        </>
      )}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <Action
        variant="quiet"
        disabled={busy || disabled}
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
