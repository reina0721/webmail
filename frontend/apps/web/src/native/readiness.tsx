"use client";
import { useEffect, useRef, useState } from "react";
import {
  Action,
  Box,
  ConsoleAccordionSection,
  ConsoleSectionCard,
  ConsoleStatusBanner,
  ConsoleStatusChip,
  LinearProgress,
  Typography,
  VerifiedUserOutlined,
} from "@mail-web/ui";
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
  const [copyResult, setCopyResult] = useState<{
    url: string;
    message: string;
  } | null>(null);
  const format = (time?: number) =>
    time ? new Date(time).toLocaleString() : "尚无记录";
  const failed = v?.items.filter((item) => item.status !== "passed") ?? [];
  const totalCount = v?.items.length ?? 0;
  const passedCount = totalCount - failed.length;
  const passPercent = totalCount
    ? Math.round((passedCount / totalCount) * 100)
    : 0;
  const missingTurnstile = failed.some((item) => item.id === "turnstile");
  const canVerify = !!v?.items.length && !failed.length;
  const registrationStatus = v?.effectiveEnabled
    ? "公开注册已开启。"
    : v?.requestedEnabled
      ? "注册策略已开启，当前暂停接受注册。"
      : "公开注册未开启。";
  const verificationStatus = v?.ready
    ? v.effectiveEnabled
      ? "人机与收信验证已通过。"
      : "人机与收信验证已通过。勾选「允许公开注册」并保存注册策略即可开放。"
    : canVerify
      ? "自动检查已通过。请生成收信验证链接，完成人机验证和验证码收信。"
      : "先通过自动检查，再完成人机与收信验证。";
  const canRepairHook =
    !!v &&
    !v.stale &&
    v.items.some((item) => item.id === "callback" && item.status === "passed");

  useEffect(() => {
    if (c.url) openVerification.current?.focus();
  }, [c.url]);

  async function copyVerification() {
    const url = openVerification.current?.href;
    if (!url) return;
    let message: string;
    try {
      await navigator.clipboard.writeText(url);
      message = "验证链接已复制，可以在普通浏览器打开。";
    } catch {
      message =
        "浏览器无法写入剪贴板。请右键打开验证页的链接，选择复制链接地址。";
    }
    setCopyResult({ url: c.url, message });
  }

  const headerBadge = v
    ? v.effectiveEnabled
      ? { label: "开放注册中", tone: "success" as const }
      : v.ready
        ? { label: "验证已通过", tone: "info" as const }
        : failed.length > 0
          ? { label: `${failed.length} 项待处理`, tone: "warning" as const }
          : { label: "等待验证", tone: "primary" as const }
    : undefined;

  return (
    <ConsoleSectionCard
      title="注册条件与健康诊断"
      icon={<VerifiedUserOutlined fontSize="small" />}
      badge={headerBadge}
    >
      {v && (
        <p>
          <strong>{registrationStatus}</strong> {verificationStatus}
        </p>
      )}
      {v && totalCount > 0 && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: "var(--muted)", fontWeight: 600 }}>
              自动检查完成度
            </Typography>
            <ConsoleStatusChip
              label={`${passedCount}/${totalCount} 项通过`}
              tone={failed.length === 0 ? "success" : "warning"}
            />
          </Box>
          <LinearProgress
            variant="determinate"
            value={passPercent}
            aria-label="注册前提检查通过率"
          />
        </Box>
      )}
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
          <>
            <a
              ref={openVerification}
              className="console-link"
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开人机与收信验证页面 →
            </a>
            <Action variant="quiet" onPress={() => void copyVerification()}>
              复制验证链接
            </Action>
          </>
        )}
      </div>
      {c.operation === "check" && (
        <ConsoleStatusBanner severity="info" role="status">
          正在检查运行配置与邮件服务，请稍候…
        </ConsoleStatusBanner>
      )}
      {c.operation === "hook" && (
        <ConsoleStatusBanner severity="info" role="status">
          正在验证主地址并更新 Stalwart 回调…
        </ConsoleStatusBanner>
      )}
      {c.notice && (
        <ConsoleStatusBanner severity="info" role="status">
          {c.notice}
        </ConsoleStatusBanner>
      )}
      {c.url && (
        <ConsoleStatusBanner severity="success" role="status">
          {v?.ready
            ? "复验链接已生成。"
            : "验证链接已生成。请打开验证页，完成人机验证和验证码收信。"}
        </ConsoleStatusBanner>
      )}
      {c.url && copyResult?.url === c.url && (
        <ConsoleStatusBanner severity="info" role="status">
          {copyResult.message}
        </ConsoleStatusBanner>
      )}
      {c.error && (
        <ConsoleStatusBanner severity="error" role="alert">
          {c.error}
        </ConsoleStatusBanner>
      )}
      {!canVerify && v && !v.ready && (
        <p className="console-hint">
          收信验证入口将在所有自动检查通过后启用。
          {v.items.length
            ? `当前尚有 ${failed.length} 项待处理。`
            : "请先点击“检查注册条件”。"}
        </p>
      )}
      {missingTurnstile && (
        <div>
          <a className="console-link" href="/console/site/#turnstile-setup">
            配置或修复 Turnstile →
          </a>
        </div>
      )}
      <div className="console-checklist">
        {v?.items.map((item) => (
          <div key={item.id}>
            <ConsoleStatusChip
              label={item.status === "passed" ? "通过" : "需处理"}
              tone={item.status === "passed" ? "success" : "warning"}
            />
            <strong>{item.label}</strong>
            {item.status !== "passed" && (
              <>
                <p>
                  {c.reasons[item.reason ?? ""] ??
                    item.reason ??
                    "请检查连接与权限。"}
                </p>
                {item.id === "turnstile" ? (
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
      <ConsoleAccordionSection
        title="探测记录"
        description="查看最近健康检查时间、连续失败计数与首次验证时间。"
        badge={
          v
            ? {
                label: v.healthy && !v.stale ? "正常" : "告警",
                tone: v.healthy && !v.stale ? "success" : "warning",
              }
            : undefined
        }
      >
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
      </ConsoleAccordionSection>
    </ConsoleSectionCard>
  );
}
