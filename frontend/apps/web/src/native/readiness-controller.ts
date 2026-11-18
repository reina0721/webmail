"use client";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@platform/lib/api";

type Check = { id: string; label: string; status: string; reason?: string };
type Report = {
  healthy: boolean;
  stale: boolean;
  lastSuccessAt: number;
  consecutiveFailures: number;
  requestedEnabled: boolean;
  effectiveEnabled: boolean;
  ready: boolean;
  items: Check[];
  checkedAt: number;
  humanVerifiedAt: number;
};

const reasons: Record<string, string> = {
  configuration_fields_missing:
    "邮件服务配置尚未齐全，请打开安装与修复查看缺项。",
  required_permissions_missing: "运行密钥缺少必要权限，请重新授权修复。",
  credential_rejected: "运行凭据已失效，请在配置页更新。",
  domain_mismatch: "域名名称与保存的 ID 不一致。",
  sender_mailbox_missing: "验证码发件账号没有可用的邮件文件夹。",
  sender_identity_missing: "未找到对应的验证码发件身份。",
  hook_identity_ambiguous: "同一服务的账号标识存在冲突，无法安全计算发信限额。",
  hook_configuration_mismatch:
    "请在 Stalwart 核对专用 Hook 的认证、处理阶段和账号范围。",
  hook_callback_mismatch:
    "Stalwart 专用 Hook 仍指向旧地址。主地址回调通过后可在此更新。",
  callback_certificate_untrusted:
    "主地址的 HTTPS 证书校验失败。请在反代部署匹配域名且有效的完整证书链（fullchain.pem），再重新检查。",
  callback_unreachable:
    "Webmail 服务器无法连接主地址。请检查反代、DNS 和 HTTPS 完整证书链，再重新检查。",
  callback_authentication_failed:
    "主地址已响应。请检查反代是否将回调路径及认证请求头转发到此 Webmail。",
  turnstile_missing:
    "尚未配置 Turnstile。请使用 Cloudflare API Token 自动创建并保存验证组件。",
};

export function useReadiness({
  token = "",
  domainId = "default",
  requestedEnabled,
  onChange,
}: {
  token?: string;
  domainId?: string;
  requestedEnabled?: boolean;
  onChange?: (ready: boolean) => void;
}) {
  const [value, setValue] = useState<Report | null>(null);
  const [operation, setOperation] = useState<"check" | "link" | "hook" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const query = "?domainId=" + encodeURIComponent(domainId);
  const headers = token ? { Authorization: "Bearer " + token } : undefined;

  function accept(report: Report) {
    setValue(report);
    setError("");
    onChange?.(report.ready);
  }

  async function load() {
    const request = generation.current;
    try {
      const report = await api<Report>("/installation/readiness" + query, {
        headers,
      });
      if (request === generation.current) accept(report);
    } catch (e) {
      if (request !== generation.current) return;
      setValue(null);
      setError(errorMessage(e));
      onChange?.(false);
    }
  }

  useEffect(() => {
    generation.current++;
    setOperation(null);
    setValue(null);
    setError("");
    setUrl("");
    setNotice("");
    void load();
    return () => {
      generation.current++;
    };
  }, [token, domainId, requestedEnabled]);

  async function run(action: "check" | "link" | "hook" = "check") {
    const request = ++generation.current;
    setOperation(action);
    setError("");
    setNotice("");
    setUrl("");
    try {
      const options = { method: "POST", headers };
      if (action === "link") {
        const result = await api<{ url: string }>(
          "/installation/readiness/link" + query,
          options,
        );
        if (request !== generation.current) return;
        setUrl(result.url);
        await load();
        return;
      }
      const path =
        action === "hook"
          ? "/installation/readiness/hook"
          : "/installation/readiness";
      const report = await api<Report>(path + query, options);
      if (request !== generation.current) return;
      accept(report);
      const failed = report.items.filter((item) => item.status !== "passed");
      const summary = failed.length
        ? `检查完成：${report.items.length - failed.length}/${report.items.length} 项通过。请处理：${failed.map((item) => item.label).join("、")}。`
        : "自动检查全部通过。";
      setNotice(
        action === "hook" ? "Stalwart 回调已更新。" + summary : summary,
      );
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    } finally {
      if (request === generation.current) setOperation(null);
    }
  }

  return { value, operation, error, url, notice, load, run, reasons };
}
