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
import { setupSteps, useAutomaticInstallation } from "./setup-controller";

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
            <Link className="console-link" href="/console/site/">
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
            <p>用于重新授权 Stalwart，补齐此安装所需的权限与邮件服务资源。</p>
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
      {c.error && (
        <div className="console-alert" role="alert">
          {c.error}
          <Action
            variant="quiet"
            disabled={locked}
            onPress={() => void c.load()}
          >
            重新读取配置
          </Action>
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
              <details>
                <summary>已完成的操作</summary>
                <ul>
                  {notes.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </details>
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
            <details>
              <summary>同时配置公开注册的人机验证（可选）</summary>
              <p>
                只使用邮箱时可以跳过。以后可在「站点与默认设置」添加 Turnstile。
              </p>
              <PasswordField
                purpose="current"
                label="Cloudflare API Token"
                hint="需要目标 Cloudflare 账号的 Turnstile 编辑权限。"
                value={c.cfToken}
                disabled={locked}
                onChange={(e) => c.setCfToken(e.target.value)}
              />
            </details>
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
                {c.cloudflareRequested &&
                  (c.accounts.length ? (
                    <SelectField
                      label="Cloudflare 账号"
                      value={c.spec.cloudflareAccount}
                      options={c.accounts.map((account) => ({
                        value: account.id,
                        label: account.name,
                      }))}
                      onValueChange={(value) =>
                        c.change("cloudflareAccount", value)
                      }
                      disabled={locked}
                    />
                  ) : (
                    <TextField
                      label="Cloudflare Account ID"
                      hint="Token 未能列出账号。请从 Cloudflare 后台查找「Copy account ID」，填入 32 位账号 ID。"
                      value={c.spec.cloudflareAccount}
                      onChange={(e) =>
                        c.change("cloudflareAccount", e.target.value)
                      }
                      disabled={locked}
                    />
                  ))}
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
