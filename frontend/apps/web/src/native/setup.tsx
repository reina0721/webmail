"use client";
import { useState } from "react";
import Link from "next/link";
import { errorCodeMessage } from "@platform/lib/api";
import {
  Action,
  TextField,
  PasswordField,
  SelectField,
  CheckboxField,
  ConfirmDialog,
} from "@mail-web/ui";
import {
  setupResourceNames,
  setupSteps,
  useAutomaticInstallation,
} from "./setup-controller";

const jobStates: Record<string, string> = {
  running: "正在配置邮件服务",
  applying: "正在应用配置",
  completed: "邮件服务配置已完成",
  failed: "配置未完成，可继续重试",
  cancelled: "配置已暂停",
  interrupted: "配置中断，可继续重试",
};

export function ConsoleSetup() {
  const c = useAutomaticInstallation({});
  const [repair, setRepair] = useState(false);
  const running = c.job?.status === "running" || c.job?.status === "applying";
  const installed = !!c.status?.configured && !c.status.needsOperator;
  const showForm =
    c.loaded &&
    !running &&
    (!installed || repair) &&
    (repair || c.job?.status !== "completed");
  const authorized = !!c.ticket;
  const hosts = c.domains.map((domain) => ({
    value: domain.name,
    label: domain.name,
  }));
  const locked = c.pending || running;
  const notes = c.job?.completed.map((step) => setupSteps[step] ?? step) ?? [];
  const resources = Object.entries(c.job?.resources ?? {}).filter(
    ([key]) => key in setupResourceNames,
  );
  const cloudflareAccounts = c.accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  return (
    <div className="console-setup">
      {c.pending && !c.status && <p role="status">正在读取安装状态…</p>}
      {installed && !repair && !running && (
        <section className="console-panel">
          <header>
            <h2>邮件服务已连接</h2>
            <p>
              {c.status?.domain} 已可使用邮箱。要改 Webmail
              地址或开启注册，从对应设置继续。
            </p>
          </header>
          <div className="console-actions">
            <Link
              className="console-link"
              href="/console/site/#turnstile-setup"
            >
              设置主地址与 Turnstile →
            </Link>
            <Link className="console-link" href="/console/registration/">
              检查并开放注册 →
            </Link>
            <Link className="console-link" href="/">
              返回邮箱 →
            </Link>
          </div>
          <details>
            <summary>修复 Stalwart 连接或权限</summary>
            <p>
              需要修复 Stalwart 连接或权限时，用它重新授权并检查邮件服务资源。
            </p>
            <Action
              variant="secondary"
              disabled={locked || !c.loaded}
              onPress={() => setRepair(true)}
            >
              开始邮件服务修复
            </Action>
          </details>
        </section>
      )}
      {(!installed || repair) && (
        <section className="console-panel">
          <header>
            <h2>{repair ? "修复邮件服务" : "安装访问"}</h2>
            <p>
              使用部署工具生成的安装链接，或粘贴安装令牌。已登录 Webmail
              运营管理员可直接继续。
            </p>
          </header>
          <PasswordField
            label="安装令牌"
            purpose="current"
            value={c.token}
            onChange={(e) => c.setToken(e.target.value)}
          />
          {c.pending && <p role="status">正在处理，请稍候…</p>}
        </section>
      )}
      {(!installed || repair || c.error) && (
        <div className="console-actions">
          <Action
            variant="quiet"
            disabled={locked}
            loading={c.pending}
            onPress={() => void c.load(true)}
          >
            重新读取配置
          </Action>
        </div>
      )}
      {c.reloadNotice && <p role="status">{c.reloadNotice}</p>}
      {c.error && (
        <div className="console-alert" role="alert">
          {c.error}
        </div>
      )}
      {c.job &&
        (!installed || running || (repair && c.job.status !== "completed")) && (
          <section className="console-panel">
            <h2>{jobStates[c.job.status] ?? "邮件服务配置状态"}</h2>
            {running && (
              <p role="status">
                {c.job.step
                  ? `当前步骤：${setupSteps[c.job.step] ?? c.job.step}`
                  : "正在准备配置…"}
              </p>
            )}
            {c.job.error && <p role="alert">{errorCodeMessage(c.job.error)}</p>}
            {showForm && !authorized && c.job.status !== "completed" && (
              <p>修复后请重新验证 Stalwart 权限，再检查并应用原来的配置。</p>
            )}
            {notes.length > 0 && (
              <div>
                <h3>已完成的操作</h3>
                <ul>
                  {notes.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
            {c.applied ? (
              <Link className="console-link" href="/console/">
                进入控制台 →
              </Link>
            ) : (
              c.job.status === "running" && (
                <Action
                  variant="secondary"
                  disabled={c.pending}
                  onPress={() => void c.cancel()}
                >
                  停止后续步骤
                </Action>
              )
            )}
          </section>
        )}
      {showForm && (
        <>
          <section className="console-panel">
            <header>
              <h2>连接 Stalwart</h2>
              <p>
                这里使用邮件服务器的管理员凭据。下一步再选择实际登录 Webmail
                的运营邮箱。
              </p>
            </header>
            <div className="console-form-grid">
              <TextField
                label="Stalwart HTTPS 地址"
                hint="例如 https://mail.example.com"
                value={c.base}
                disabled={locked}
                onChange={(e) => c.setBase(e.target.value)}
              />
              <SelectField
                label="授权方式"
                value={c.mode}
                disabled={locked}
                options={[
                  { value: "password", label: "管理员账号" },
                  { value: "key", label: "管理员 API Key" },
                ]}
                onValueChange={c.setMode}
              />
              {c.mode === "password" ? (
                <>
                  <TextField
                    label="Stalwart 管理员账号"
                    value={c.username}
                    disabled={locked}
                    onChange={(e) => c.setUsername(e.target.value)}
                  />
                  <PasswordField
                    purpose="current"
                    label="Stalwart 管理员密码"
                    value={c.password}
                    disabled={locked}
                    onChange={(e) => c.setPassword(e.target.value)}
                  />
                </>
              ) : (
                <PasswordField
                  purpose="current"
                  label="Stalwart 管理员 API Key"
                  value={c.apiKey}
                  disabled={locked}
                  onChange={(e) => c.setApiKey(e.target.value)}
                />
              )}
            </div>
            <Action
              loading={c.pending && !authorized}
              disabled={
                locked ||
                !c.base.trim() ||
                (c.mode === "key"
                  ? !c.apiKey.trim()
                  : !c.username.trim() || !c.password)
              }
              onPress={() => void c.authorize()}
            >
              验证 Stalwart 权限
            </Action>
            {authorized && (
              <p role="status">
                Stalwart 授权已取得。请继续填写站点与运营邮箱。
              </p>
            )}
          </section>
          <section className="console-panel" id="installation-turnstile">
            <header>
              <h2>Turnstile 人机验证（可选）</h2>
              <p>
                开启公开注册时使用。配置成功后，Cloudflare 会生成验证组件、Site
                Key 和 Secret。
              </p>
              {installed && (
                <Link
                  className="console-link"
                  href="/console/site/#turnstile-setup"
                >
                  只修复现有 Turnstile 组件 →
                </Link>
              )}
            </header>
            <div className="console-form-grid">
              <PasswordField
                purpose="current"
                label="Cloudflare API Token"
                hint={
                  c.cloudflareRequested
                    ? "本次 Stalwart 授权中已提供 Token。也可在这里输入新的 Token。"
                    : "需要目标 Cloudflare 账号的 Turnstile 编辑权限。"
                }
                value={c.cfToken}
                disabled={locked}
                onChange={(e) => c.setCfToken(e.target.value)}
              />
              <TextField
                label="Cloudflare Account ID"
                hint="32 位账号 ID。Token 能读取账号时，可以留空并自动选择。"
                value={c.spec.cloudflareAccount}
                onChange={(e) => c.change("cloudflareAccount", e.target.value)}
                disabled={locked}
              />
              {cloudflareAccounts.length > 1 && (
                <SelectField
                  label="从读取到的 Cloudflare 账号中选择"
                  value={c.spec.cloudflareAccount}
                  options={cloudflareAccounts}
                  onValueChange={(value) =>
                    c.change("cloudflareAccount", value)
                  }
                  disabled={locked}
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
          </section>
          {authorized && (
            <section className="console-panel">
              <header>
                <h2>站点与运营邮箱</h2>
                <p>
                  运营邮箱必须是所选域名下的普通邮箱。它可以登录 Webmail
                  管理控制台。
                </p>
              </header>
              <div className="console-form-grid">
                <TextField
                  label="站点名称"
                  value={c.spec.brand}
                  onChange={(e) => c.change("brand", e.target.value)}
                  disabled={locked}
                />
                <TextField
                  label="公开访问来源"
                  hint="填写浏览器打开 Webmail 用的完整地址。"
                  value={c.spec.publicOrigin}
                  onChange={(e) => c.change("publicOrigin", e.target.value)}
                  disabled={locked}
                />
                {hosts.length > 0 && !c.spec.createDomain ? (
                  <SelectField
                    label="邮箱域名"
                    value={c.spec.domain}
                    options={hosts}
                    onValueChange={(value) => c.change("domain", value)}
                    disabled={locked}
                  />
                ) : (
                  <TextField
                    label="邮箱域名"
                    hint="邮箱地址中 @ 后面的部分。"
                    value={c.spec.domain}
                    onChange={(e) => c.change("domain", e.target.value)}
                    disabled={locked}
                  />
                )}
                <SelectField
                  label="运营邮箱来源"
                  value={c.spec.operatorMode}
                  options={[
                    { value: "existing", label: "绑定已有普通邮箱" },
                    { value: "new", label: "创建普通邮箱" },
                  ]}
                  onValueChange={(value) => c.change("operatorMode", value)}
                  disabled={locked}
                />
                <TextField
                  label="运营邮箱"
                  value={c.spec.operatorEmail}
                  onChange={(e) => c.change("operatorEmail", e.target.value)}
                  disabled={locked}
                />
                <TextField
                  label="外部恢复邮箱"
                  hint="用于找回运营邮箱账号。"
                  value={c.spec.recoveryEmail}
                  onChange={(e) => c.change("recoveryEmail", e.target.value)}
                  disabled={locked}
                />
                <PasswordField
                  purpose="current"
                  label="运营邮箱密码"
                  value={c.operatorPassword}
                  onChange={(e) => c.setOperatorPassword(e.target.value)}
                  disabled={locked}
                />
              </div>
              <details>
                <summary>域名与用户目录选项</summary>
                <CheckboxField
                  checked={c.spec.createDomain}
                  onCheckedChange={(value) => c.change("createDomain", value)}
                  disabled={locked}
                  label="域名不存在时自动创建"
                />
                <CheckboxField
                  checked={c.spec.directoryQueries}
                  onCheckedChange={(value) =>
                    c.change("directoryQueries", value)
                  }
                  disabled={locked}
                  label="启用同服务器用户目录（影响该 Stalwart 的全部用户）"
                />
              </details>
              <Action
                loading={c.pending}
                disabled={locked}
                onPress={() => void c.preflight()}
              >
                检查安装配置
              </Action>
            </section>
          )}
          {authorized && c.preview && (
            <section className="console-panel">
              <h2>确认配置</h2>
              <p>
                Webmail 主地址 <code>{c.spec.publicOrigin}</code>
              </p>
              {c.spec.cloudflareAccount && (
                <p>
                  目标 Cloudflare Account ID{" "}
                  <code>{c.spec.cloudflareAccount}</code>
                </p>
              )}
              <ul>
                {c.preview.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Action
                loading={c.pending}
                disabled={locked}
                onPress={() => void c.start()}
              >
                应用配置
              </Action>
            </section>
          )}
        </>
      )}
      {resources.length > 0 && (
        <section className="console-panel">
          <header>
            <h2>安装任务生成的资源</h2>
            <p>
              以下标识来自本次或上次安装任务。站点设置显示当前使用的组件与绑定域名。
            </p>
          </header>
          <dl className="console-form-grid">
            {resources.map(([kind, value]) => (
              <div key={kind}>
                <dt className="console-hint">{setupResourceNames[kind]}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>
          {c.job?.spec?.cloudflareAccount && (
            <p>
              Cloudflare Account ID <code>{c.job.spec.cloudflareAccount}</code>
            </p>
          )}
        </section>
      )}
      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!c.leave.href}
        onOpenChange={(open) => {
          if (!open) c.leave.cancel();
        }}
        title="离开未保存的配置？"
        description="当前输入尚未提交。已创建的服务资源会保留。"
        cancelLabel="继续编辑"
        confirmLabel="离开"
        onConfirm={c.leave.leave}
      />
    </div>
  );
}
