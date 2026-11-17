"use client";
import Script from "next/script";
import { Action, TextField } from "@mail-web/ui";
import { useVerification } from "./verification-controller";
import { turnstileKeyValid } from "./turnstile-key";
export function ConsoleVerification() {
  const c = useVerification();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="console-eyebrow">REGISTRATION / VERIFICATION</p>
        <h1 style={{ fontSize: 24, marginBlock: 20 }}>验证人机与收信服务</h1>
        <p className="muted">
          完成后记录首次验证结果，注册开放策略由管理员单独控制。
        </p>
        {c.done ? (
          <div role="status">
            <h2>验证已通过</h2>
            <p>可以返回控制台查看健康报告。</p>
            <a className="console-link" href="/console/registration/">
              返回注册策略 →
            </a>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void c.submit();
            }}
            style={{ marginTop: 24 }}
          >
            {c.sent ? (
              <TextField
                label="邮件中的六位验证码"
                hint="十分钟内有效，最多尝试五次。"
                value={c.code}
                onChange={(e) => c.setCode(e.target.value)}
              />
            ) : (
              <>
                <TextField
                  type="email"
                  label="接收验证码的外部邮箱"
                  value={c.email}
                  onChange={(e) => c.setEmail(e.target.value)}
                />
                <>
                  {turnstileKeyValid(c.siteKey) && (
                    <Script
                      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                      onReady={() => c.setReady(true)}
                      onError={c.widgetError}
                    />
                  )}
                </>
                <div ref={c.target} />
              </>
            )}
            <Action
              type="submit"
              loading={c.pending}
              disabled={!c.ticket || (!c.sent && !c.captcha)}
            >
              {c.sent ? "核对验证码" : "发送检查邮件"}
            </Action>
          </form>
        )}
        {c.error && (
          <div role="alert">
            <p>{c.error}</p>
            <a className="console-link" href="/console/site/#turnstile-setup">
              返回站点设置修复人机验证 →
            </a>
            <p>
              <button type="button" onClick={() => location.reload()}>
                重新加载验证页
              </button>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
