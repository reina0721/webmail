"use client";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@platform/lib/api";
import {
  Action,
  ConsoleStatusBanner,
  ConsoleStatusChip,
} from "@mail-web/ui";
import { SettingsSection } from "@/components/settings/settings-section";

type Entry = {
  id: string;
  status: "queued" | "delivering" | "unknown" | "delivered" | "rejected";
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};
type Report = {
  configured: boolean;
  status: "preparing" | "ready" | null;
  items: Entry[];
};

const labels = {
  queued: "等待发送",
  delivering: "正在提交",
  unknown: "提交结果待核对",
  delivered: "邮件服务已接受",
  rejected: "邮件服务拒绝",
};

const reasons: Record<string, string> = {
  smtp_result_unknown: "连接在提交时中断。保留记录，避免重复发送。",
  gateway_restarted_during_delivery:
    "提交期间服务重启。保留记录，避免重复发送。",
  smtp_temporarily_unavailable: "邮件服务暂时不可用，将自动重试。",
  smtp_temporary_rejection: "邮件服务暂缓接收，将自动重试。",
  smtp_permanent_rejection: "邮件服务明确拒绝了此邮件，请检查规则和收件人。",
  smtp_configuration_invalid: "发送连接配置需要修复。",
};

export function AutomaticMailRecords({ domainId }: { domainId?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const path =
    domainId === undefined
      ? "/client/automatic-mail"
      : "/admin/automatic-mail?domainId=" + encodeURIComponent(domainId);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setReport(await api<Report>(path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let live = true;
    setReport(null);
    setError("");
    setLoading(true);
    void api<Report>(path)
      .then((value) => {
        if (live) setReport(value);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path]);

  const badgeLabel =
    loading && !report
      ? "正在读取…"
      : report?.status === "ready"
        ? "自动发送网关已就绪"
        : report?.configured
          ? "网关配置恢复中"
          : "尚未配置自动发送网关";
  const badgeTone =
    report?.status === "ready"
      ? "success"
      : report?.configured
        ? "warning"
        : "default";

  return (
    <div className="space-y-4">
      <div className="console-actions">
        <ConsoleStatusChip label={badgeLabel} tone={badgeTone} />
        <Action
          variant="secondary"
          loading={loading}
          onPress={() => void load()}
        >
          刷新自动发送记录
        </Action>
      </div>
      {error && (
        <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
      )}
      {report && !report.configured && (
        <ConsoleStatusBanner severity="info">
          请在控制台自动配置中升级邮件服务，再启用规则转发或自动回复。
        </ConsoleStatusBanner>
      )}
      {report?.items.length ? (
        <div className="console-table-scroll">
          <table className="console-table">
            <thead>
              <tr>
                <th>接收时间</th>
                <th>发送状态</th>
                <th>尝试次数</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <time>{new Date(entry.createdAt).toLocaleString()}</time>
                    <small>{entry.id.slice(0, 12)}</small>
                  </td>
                  <td>
                    <ConsoleStatusChip
                      label={labels[entry.status]}
                      tone={
                        entry.status === "delivered"
                          ? "success"
                          : entry.status === "rejected"
                            ? "error"
                            : entry.status === "unknown"
                              ? "warning"
                              : "info"
                      }
                    />
                  </td>
                  <td>{entry.attempts}</td>
                  <td>
                    {entry.error
                      ? reasons[entry.error] || "等待服务诊断"
                      : entry.status === "queued"
                        ? "队列已持久保存，服务恢复后自动继续。"
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        report?.configured && (
          <p className="console-hint">暂无自动发送记录。</p>
        )
      )}
    </div>
  );
}

export function AutomaticMailHistory() {
  return (
    <SettingsSection
      title="自动回复与规则发送"
      description="自动邮件与写信、SMTP、日历邀请共用发信额度。网关先保存再确认接收，结果未知的提交会保留供核对。"
    >
      <AutomaticMailRecords />
    </SettingsSection>
  );
}
