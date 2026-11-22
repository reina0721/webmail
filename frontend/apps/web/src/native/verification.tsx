"use client";
import Script from "next/script";
import { Action, Box, ConsoleStepBar, TextField } from "@mail-web/ui";
import { AuthShell } from "./auth-shell";
import { useVerification } from "./verification-controller";
import { turnstileKeyValid } from "./turnstile-key";

export function ConsoleVerification() {
  const c = useVerification();
  const activeStep = c.done ? 2 : c.sent ? 1 : 0;

  return (
    <AuthShell brand={<span className="console-eyebrow">VERIFICATION</span>}>
      <h1 className="auth-title">验证人机与收信服务</h1>
      <p className="muted">
        填写能收信的外部邮箱，完成页面上的人机验证，然后输入收到的六位验证码。
      </p>
      <Box sx={{ my: 2 }}>
        <ConsoleStepBar
          ariaLabel="验证进度"
          activeIndex={activeStep}
          steps={[
            { label: "发送验证码" },
            { label: "核对验证码" },
            { label: "完成验证" },
          ]}
        />
      </Box>
      {c.done ? (
        <div role="status" className="auth-status">
          <h2>验证已通过</h2>
          <p className="muted">返回「注册与验证」后，可以开启公开注册。</p>
          <a className="console-link" href="/console/registration/">
            返回注册与验证 →
          </a>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void c.submit();
          }}
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
              {turnstileKeyValid(c.siteKey) && (
                <Script
                  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                  onReady={() => c.setReady(true)}
                  onError={c.widgetError}
                />
              )}
              <div ref={c.target} />
            </>
          )}
          <Action
            type="submit"
            loading={c.pending}
            disabled={!c.ticket || (!c.sent && (!c.captcha || !c.email.trim()))}
          >
            {c.sent ? "核对验证码" : "发送验证码"}
          </Action>
        </form>
      )}
      {(c.error || c.widgetIssue) && (
        <div role="alert" className="console-alert">
          {c.error && <p>{c.error}</p>}
          {c.widgetIssue === "configuration" && (
            <>
              <p>人机验证配置错误。请核对 Turnstile Site Key 和组件允许的主机名。</p>
              <a className="console-link" href="/console/site/#turnstile-setup">
                返回站点设置修复人机验证 →
              </a>
            </>
          )}
          {c.widgetIssue === "connection" && (
            <p>
              人机验证组件加载失败。请检查网络连接。若在应用内浏览器中反复失败，请返回「注册与验证」复制链接，在普通浏览器打开。
            </p>
          )}
          <Action variant="secondary" onPress={() => location.reload()}>
            重新加载验证页
          </Action>
        </div>
      )}
    </AuthShell>
  );
}
