"use client";
import { useEffect, useRef } from "react";
import { Action } from "@mail-web/ui";
import { useReadiness } from "./readiness-controller";

export function RegistrationReadiness({
  domainId = "default",
  token = "",
  requestedEnabled,
  onReadyChange,
}: {
  domainId?: string;
  token?: string;
  embedded?: boolean;
  requestedEnabled?: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const c = useReadiness({
    domainId,
    token,
    requestedEnabled,
    onChange: onReadyChange,
  });
  const v = c.value;
  const openVerification = useRef<HTMLAnchorElement>(null);
  const format = (time?: number) =>
    time ? new Date(time).toLocaleString() : "尚无记录";
  const failed = v?.items.filter((item) => item.status !== "passed") ?? [];
  const missingTurnstile = failed.some(
    (item) => item.reason === "turnstile_missing",
  );
  const canVerify = !!v?.items.length && !failed.length;
  const canRepairHook =
    !!v &&
    !v.stale &&
    v.items.some((item) => item.id === "callback" && item.status === "passed");

  useEffect(() => {
    if (c.url) openVerification.current?.focus();
  }, [c.url]);

  return (
    <section className="console-panel">
      <header>
        <h2>注册条件与健康诊断</h2>
        <p>先通过自动检查，再完成人机与收信验证。通过后即可开启公开注册。</p>
      </header>
      <div className="console-actions">
        <Action
          loading={c.operation === "check"}
          disabled={!!c.operation}
          onPress={() => void c.run()}
        >
          检查注册条件
        </Action>
        <Action
          variant="secondary"
          loading={c.operation === "link"}
          disabled={!!c.operation || !canVerify}
          onPress={() => void c.run("link")}
        >
          生成收信验证链接
        </Action>
        <Action
          variant="quiet"
          disabled={!!c.operation}
          onPress={() => void c.load()}
        >
          刷新结果
        </Action>
        {c.url && (
          <a
            ref={openVerification}
            className="console-link"
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开人机与收信验证页面 →
          </a>
        )}
      </div>
      {c.operation === "check" && (
        <p role="status">正在检查运行配置与邮件服务，请稍候…</p>
      )}
      {c.operation === "hook" && (
        <p role="status">正在验证主地址并更新 Stalwart 回调…</p>
      )}
      {c.notice && <p role="status">{c.notice}</p>}
      {c.error && <p role="alert">{c.error}</p>}
      {!canVerify && v && (
        <p>
          收信验证入口将在所有自动检查通过后启用。
          {v.items.length
            ? `当前尚有 ${failed.length} 项待处理。`
            : "请先点击“检查注册条件”。"}
        </p>
      )}
      {missingTurnstile && (
        <a className="console-link" href="/console/site/#turnstile-setup">
          使用 Cloudflare API Token 自动配置 Turnstile →
        </a>
      )}
      <div className="console-checklist">
        {v?.items.map((item) => (
          <div key={item.id}>
            <span
              className={
                "console-badge " + (item.status === "passed" ? "good" : "")
              }
            >
              {item.status === "passed" ? "通过" : "需处理"}
            </span>
            <strong>{item.label}</strong>
            {item.status !== "passed" && (
              <>
                <p>
                  {c.reasons[item.reason ?? ""] ??
                    item.reason ??
                    "请检查连接与权限。"}
                </p>
                {item.reason === "turnstile_missing" ? (
                  <a
                    className="console-link"
                    href="/console/site/#turnstile-setup"
                  >
                    配置 Turnstile →
                  </a>
                ) : item.reason === "hook_callback_mismatch" ? (
                  <Action
                    variant="secondary"
                    loading={c.operation === "hook"}
                    disabled={!!c.operation || !canRepairHook}
                    onPress={() => void c.run("hook")}
                  >
                    更新 Stalwart 回调地址
                  </Action>
                ) : item.id === "callback" ||
                  item.reason === "hook_configuration_mismatch" ? (
                  <a
                    className="console-link"
                    href="https://github.com/reina0721/webmail/blob/main/docs/stalwart-setup.md#callback-repair"
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看回调排查步骤 ↗
                  </a>
                ) : (
                  <a className="console-link" href="/console/setup/">
                    安装与修复 →
                  </a>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <details>
        <summary>探测记录</summary>
        <dl className="console-health-times">
          <div>
            <dt>注册开放策略</dt>
            <dd>{v ? (v.requestedEnabled ? "开启" : "关闭") : "—"}</dd>
          </div>
          <div>
            <dt>当前健康状态</dt>
            <dd>{!v ? "—" : v.healthy && !v.stale ? "正常" : "告警"}</dd>
          </div>
          <div>
            <dt>连续未通过检查</dt>
            <dd>{v?.consecutiveFailures ?? 0}</dd>
          </div>
          <div>
            <dt>最后探测</dt>
            <dd>{format(v?.checkedAt)}</dd>
          </div>
          <div>
            <dt>最后成功</dt>
            <dd>{format(v?.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt>首次收信验证</dt>
            <dd>{format(v?.humanVerifiedAt)}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
