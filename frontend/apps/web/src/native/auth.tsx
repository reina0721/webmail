"use client";
import { useEffect } from "react";
import Script from "next/script";
import {
  Action,
  TextField,
  PasswordField,
  SelectField,
  Tabs,
  Tab,
} from "@mail-web/ui";
import { api } from "@platform/lib/api";
import { useSiteSettings } from "@platform/host/site-settings";
import { useAuthFlow, type Session } from "./auth-controller";
import { AuthShell } from "./auth-shell";

export type { Session } from "./auth-controller";

export function Auth({ onLogin }: { onLogin: (session: Session) => void }) {
  const c = useAuthFlow({ onLogin });
  const site = useSiteSettings((s) => s.metadata);

  useEffect(() => {
    document.title = site.seoTitle || site.brand;
  }, [site.seoTitle, site.brand]);

  async function signIn() {
    await api("/auth/login", {
      account: "primary",
      method: "POST",
      body: JSON.stringify({ email: c.email, password: c.password }),
    });
    c.setPassword("");
    onLogin(await api<Session>("/auth/session", { account: "primary" }));
  }

  const heading =
    c.mode === "login"
      ? site.authLoginTitle
      : c.mode === "registration"
        ? site.authRegisterTitle
        : site.authRecoveryTitle;
  const subtitle =
    c.mode === "login"
      ? site.authLoginSubtitle
      : c.mode === "registration"
        ? site.authRegisterSubtitle
        : site.authRecoverySubtitle;

  return (
    <AuthShell>
      <a href={site.websiteUrl || "/"} className="auth-brand">
        <img
          src={site.loginLogoLightUrl}
          alt=""
          className="auth-brand-logo dark:hidden"
        />
        <img
          src={site.loginLogoDarkUrl}
          alt=""
          className="auth-brand-logo hidden dark:block"
        />
        <span>{c.brand}</span>
      </a>
      <h1 className="auth-title">{heading}</h1>
      <p className="muted">{subtitle}</p>
      {c.policy.primaryOrigin ? (
        <p className="auth-status">
          <a className="console-link" href={c.policy.primaryOrigin}>
            前往主站注册或找回密码 →
          </a>
        </p>
      ) : (
        <Tabs
          className="auth-tabs"
          value={c.mode}
          onChange={(_, value) => c.change(value)}
          aria-label="账号入口"
          variant="fullWidth"
        >
          <Tab value="login" label="登录" />
          <Tab value="registration" label="注册" />
          <Tab value="recovery" label="找回密码" />
        </Tabs>
      )}
      {c.mode === "registration" && (
        <SelectField
          label="邮箱域名"
          value={c.domain}
          disabled={c.pending}
          options={c.domains.map((d) => ({
            value: d.id,
            label: d.domain + (d.enabled ? "" : " · 暂未开放"),
          }))}
          onValueChange={c.changeDomain}
        />
      )}
      {c.policyError && c.mode !== "login" && (
        <p role="alert">{c.policyError}</p>
      )}
      {c.mode === "registration" && !c.policy.enabled ? (
        <div className="auth-status">
          <h2>暂未开放公开注册</h2>
          <p>请稍后重试，或联系站点管理员。</p>
          <a className="console-link" href="/console/registration/">
            管理员控制台 →
          </a>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void c.run(c.mode === "login" ? signIn : c.submit);
          }}
        >
          {c.mode !== "login" && (
            <ol className="auth-steps" aria-label="验证进度">
              {["验证邮箱", "核对验证码", "设置密码"].map((label, index) => (
                <li
                  key={label}
                  aria-current={
                    index === (!c.challenge ? 0 : !c.claim ? 1 : 2)
                      ? "step"
                      : undefined
                  }
                >
                  <span>{index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
          )}
          {c.mode === "login" ? (
            <>
              <TextField
                label="邮箱地址"
                type="email"
                autoComplete="username"
                required
                disabled={c.pending}
                value={c.email}
                onChange={(e) => c.setEmail(e.target.value)}
              />
              <PasswordField
                label="密码"
                purpose="current"
                required
                disabled={c.pending}
                value={c.password}
                onChange={(e) => c.setPassword(e.target.value)}
              />
            </>
          ) : (
            <>
              {!c.claim && (
                <TextField
                  label="接收验证码的外部邮箱"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={c.pending || !!c.challenge}
                  value={c.email}
                  onChange={(e) => c.setEmail(e.target.value)}
                />
              )}
              {c.challenge && !c.claim && (
                <TextField
                  label="邮件中的六位验证码"
                  hint="十分钟内有效"
                  required
                  value={c.code}
                  onChange={(e) => c.setCode(e.target.value)}
                />
              )}
              {c.claim && (
                <>
                  {c.mode === "registration" && (
                    <TextField
                      label={"邮箱名称 · @" + c.policy.domain}
                      required
                      value={c.name}
                      onChange={(e) => c.setName(e.target.value.toLowerCase())}
                    />
                  )}
                  <PasswordField
                    label="设置新密码"
                    purpose="new"
                    hint="12–128 个字符"
                    required
                    value={c.password}
                    onChange={(e) => c.setPassword(e.target.value)}
                  />
                </>
              )}
              {!c.challenge && (
                <>
                  <Script
                    src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                    onReady={() => c.setReady(true)}
                  />
                  <div ref={c.target} />
                </>
              )}
            </>
          )}
          <Action
            type="submit"
            loading={c.pending}
            disabled={c.mode !== "login" && !c.challenge && !c.captcha}
          >
            {c.mode === "login"
              ? "打开邮箱"
              : !c.challenge
                ? "发送验证码"
                : !c.claim
                  ? "核对验证码"
                  : c.mode === "registration"
                    ? "创建邮箱"
                    : "重置密码"}
          </Action>
          {c.challenge && (
            <Action
              variant="quiet"
              disabled={c.pending}
              onPress={() => c.change(c.mode)}
            >
              重新验证
            </Action>
          )}
        </form>
      )}
      {c.notice && (
        <p className="auth-notice" role="status" aria-live="polite">
          {c.notice}
        </p>
      )}
      <footer className="auth-footer">
        <div className="auth-footer-row">
          <span>{site.footerText}</span>
          <a href={site.sourceCodeUrl} target="_blank" rel="noopener noreferrer">
            开源代码 · AGPL
          </a>
        </div>
        {site.showAuthFooterLinks && (
          <nav aria-label="站点链接" className="auth-footer-links">
            <a href={site.helpUrl} target="_blank" rel="noopener noreferrer">
              使用帮助
            </a>
            <a href={site.supportUrl}>联系支持</a>
            <a
              href={site.privacyPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              隐私政策
            </a>
            <a
              href={site.imprintUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              法律声明
            </a>
          </nav>
        )}
      </footer>
    </AuthShell>
  );
}
