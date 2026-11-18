"use client";

import { useEffect, useState } from "react";
import { Action, ConfirmDialog, SelectField } from "@mail-web/ui";
import { api, ApiError, errorMessage } from "@platform/lib/api";
import type { components } from "@platform/lib/generated-api";

type View = components["schemas"]["DeploymentView"];
type Job = components["schemas"]["Job"];
type Submit = components["schemas"]["Submit"];
type Snapshot = components["schemas"]["Snapshot"];
type Selection = { expectedVersion: string } & (
  | { operation: "update" | "install_historical"; target: string }
  | { operation: "rollback"; target: Snapshot }
);

const endpoint = "/admin/deployment";
const finished = (job: Job) =>
  ["succeeded", "recovered", "failed"].includes(job.phase);
const date = (value: number) => new Date(value).toLocaleString();
const unavailable: Record<string, string> = {
  unsupported_tag: "标签格式不受支持",
  missing_platform_bundle: "缺少本机架构的安装包",
  missing_checksums: "缺少 SHA-256 校验清单",
};
const snapshotCommand =
  "sudo ./bin/mailweb-version-manager version-manager snapshots";
const phases: Record<Job["phase"], string> = {
  queued: "排队中",
  download: "下载中",
  verify: "校验中",
  backup: "备份中",
  switch: "切换中",
  health: "检查运行状态",
  recovering: "恢复中",
  succeeded: "完成",
  recovered: "已恢复",
  failed: "失败",
};

export function Versions() {
  const [view, setView] = useState<View | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [rollback, setRollback] = useState("");
  const [confirm, setConfirm] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const jobId = job?.id;
  const active = !!job && !finished(job);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        if (jobId && active) {
          const result = await api<Job>(endpoint + "/jobs/" + jobId, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setJob(result);
          setNotice("");
        } else {
          const result = await api<View>(endpoint, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setView(result);
          if (result.inventory.job) setJob(result.inventory.job);
          setNotice("");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (jobId && active) {
          if (error instanceof ApiError && [401, 404].includes(error.status)) {
            const health = await api<{
              version?: string;
              revision?: string;
              status?: string;
            }>("/health/ready", {
              signal: controller.signal,
            }).catch(() => null);
            if (controller.signal.aborted) return;
            if (health && job && "v" + health.version === job.targetVersion) {
              setView(
                (old) =>
                  old && {
                    ...old,
                    version: job.targetVersion,
                    revision: health.revision ?? old.revision,
                    managerOnline: false,
                  },
              );
              setJob({
                ...job,
                phase: "succeeded",
                runningVersion: job.targetVersion,
                message: "目标版本已上线。可从宿主机查看切换结果与恢复命令。",
              });
              return;
            }
            if (health?.status === "ok" && !health.version) {
              setNotice(
                `目标站点已响应。可从宿主机查看实际运行版本和恢复命令：sudo ./bin/mailweb-version-manager version-manager job ${jobId}`,
              );
              return;
            }
          }
          setNotice(
            error instanceof ApiError && error.status === 401
              ? "会话已结束。重新登录后可查看宿主机任务结果。"
              : "正在等待服务恢复连接，版本任务继续在宿主机执行。",
          );
        } else {
          setNotice(errorMessage(error));
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(read, active ? 2000 : 5000);
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, active, refresh]);

  async function start(action: Selection) {
    if (!view) return;
    setBusy(true);
    setNotice("");
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const body: Submit = {
      id,
      expectedVersion: action.expectedVersion,
      operation: action.operation,
      target:
        typeof action.target === "string" ? action.target : action.target.id,
      confirmDataRestore: action.operation !== "update",
    };
    try {
      setJob(
        await api<Job>(endpoint + "/jobs", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      setRollback("");
    } catch (error) {
      // A lost response can follow successful submission. Reading the known ID
      // reconciles the operation without issuing another request to switch.
      const accepted = await api<Job>(endpoint + "/jobs/" + id).catch(
        () => null,
      );
      if (accepted) setJob(accepted);
      else setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const snapshot = view?.inventory.snapshots.find(
    (item) => item.id === rollback,
  );
  const blocked = active || busy || !view?.managerOnline;
  const historicalEnabled = view?.inventory.historicalSwitch;
  return (
    <>
      <section className="console-panel">
        <h2>运行版本</h2>
        {view ? (
          <dl className="console-form-grid">
            <div>
              <dt className="console-hint">版本</dt>
              <dd>{view.version}</dd>
            </div>
            <div>
              <dt className="console-hint">平台</dt>
              <dd>{view.architecture}</dd>
            </div>
            <div>
              <dt className="console-hint">源码提交</dt>
              <dd>
                <code>{view.revision}</code>
              </dd>
            </div>
            <div>
              <dt className="console-hint">宿主机版本管理</dt>
              <dd>{view.managerOnline ? "在线" : "未连接"}</dd>
            </div>
          </dl>
        ) : (
          <p role="status">正在读取运行版本…</p>
        )}
        {view && !view.managerOnline && (
          <p>
            版本列表可以查看。要执行切换，请在宿主机安装目录运行{" "}
            <code>sudo ./mailweb version-manager enable</code>，然后刷新。
          </p>
        )}
        {view?.managerOnline && !historicalEnabled && (
          <p>
            宿主机管理服务需要更新才支持安装历史版本。先将本机 CLI
            更新到当前版本，再运行{" "}
            <code>sudo ./mailweb version-manager enable</code>。
          </p>
        )}
        <Action
          variant="quiet"
          onPress={() => setRefresh((value) => value + 1)}
        >
          刷新版本状态
        </Action>
      </section>
      {view && (
        <section className="console-panel">
          <header>
            <h2>GitHub 发布版本</h2>
            <p>
              共 {view.inventory.releases.length}{" "}
              个公开发行版。历史版本可以使用全新的本地数据启动。
            </p>
          </header>
          {view.inventory.releasesStatus !== "ready" && (
            <p role="status">
              {view.inventory.releasesStatus === "loading"
                ? "正在读取 GitHub 发布版本…"
                : view.inventory.releases.length
                  ? "GitHub 暂时不可用，正在显示上次读取的列表。"
                  : "暂时无法读取 GitHub 发布版本。"}
            </p>
          )}
          {view.inventory.releases.length > 0 && (
            <div className="console-table-scroll">
              <table className="console-table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>渠道</th>
                    <th>本机状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {view.inventory.releases.map((item) => {
                    const current = item.version === view.version;
                    const reason = item.unavailableReason;
                    const available = !current && !reason;
                    return (
                      <tr key={item.version}>
                        <td>
                          <code>{item.version}</code>
                        </td>
                        <td>{item.prerelease ? "预发布" : "稳定版"}</td>
                        <td>
                          {current
                            ? "正在运行"
                            : reason
                              ? (unavailable[reason] ?? "暂不可安装")
                              : item.historical
                                ? "可安装历史版本"
                                : "可升级"}
                        </td>
                        <td>
                          {available && (
                            <Action
                              variant="secondary"
                              disabled={
                                blocked ||
                                (item.historical && !historicalEnabled)
                              }
                              aria-label={
                                item.historical
                                  ? `准备安装历史版 ${item.version}`
                                  : `准备升级到 ${item.version}`
                              }
                              onPress={() =>
                                setConfirm({
                                  operation: item.historical
                                    ? "install_historical"
                                    : "update",
                                  target: item.version,
                                  expectedVersion: view.version,
                                })
                              }
                            >
                              {item.historical ? "准备安装" : "准备升级"}
                            </Action>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {view?.managerOnline && (
        <section className="console-panel">
          <header>
            <h2>本机版本快照</h2>
            <p>恢复对应版本的数据库与配置，也可用来升回切换前的版本。</p>
          </header>
          {view.inventory.snapshots.length > 0 ? (
            <div className="console-form-grid">
              <SelectField
                label="选择快照"
                value={rollback}
                disabled={blocked}
                onValueChange={setRollback}
                options={view.inventory.snapshots.map((item) => ({
                  value: item.id,
                  label: item.version + " · " + date(item.createdAt),
                }))}
              />
              <Action
                variant="secondary"
                disabled={blocked || !snapshot}
                onPress={() => {
                  if (snapshot)
                    setConfirm({
                      operation: "rollback",
                      target: snapshot,
                      expectedVersion: view.version,
                    });
                }}
              >
                准备恢复
              </Action>
            </div>
          ) : (
            <p>
              暂无本机快照。第一次切换前，Webmail
              会自动保留当前版本的数据库与配置。
            </p>
          )}
        </section>
      )}
      {job && (
        <section className="console-panel" aria-live="polite">
          <h2>最近的版本任务</h2>
          <p>
            {job.targetVersion} · {phases[job.phase]}
          </p>
          <p>{job.message}</p>
          {job.runningVersion && <p>实际运行版本 {job.runningVersion}</p>}
          {job.recoveryCommand && (
            <p>
              宿主机恢复命令 <code>{job.recoveryCommand}</code>
            </p>
          )}
          {!view?.managerOnline && (
            <p>
              宿主机任务详情{" "}
              <code>
                sudo ./bin/mailweb-version-manager version-manager job {job.id}
              </code>
            </p>
          )}
          <p>
            任务 ID <code>{job.id}</code>
          </p>
        </section>
      )}
      {notice && (
        <p className="console-alert" role="status">
          {notice}
        </p>
      )}
      <ConfirmDialog
        triggerLabel="确认切换版本"
        isOpen={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.operation === "rollback"
            ? "恢复版本快照"
            : confirm?.operation === "install_historical"
              ? "安装历史版本"
              : "升级 Webmail"
        }
        description={
          confirm?.operation === "rollback"
            ? `将恢复 ${confirm.target.version} 于 ${date(confirm.target.createdAt)} 的数据库和配置。登录会话会失效，之后的 Webmail 本地改动会回退。切换前也会保留当前快照。部分版本需从宿主机管理，快照列表命令为 ${snapshotCommand}。`
            : confirm?.operation === "install_historical"
              ? `先保留 ${confirm.expectedVersion} 的数据库和配置，然后让 ${confirm.target} 使用全新的本地数据启动。需要按旧版方式重新连接邮件服务。Stalwart 上的邮件与账号会保留。可随时用当前版本的快照恢复，宿主机快照列表命令为 ${snapshotCommand}。`
              : "升级会先验证发布包并备份，切换期间邮件网页会短暂断开。"
        }
        cancelLabel="取消"
        confirmLabel={
          confirm?.operation === "rollback"
            ? "确认恢复快照"
            : confirm?.operation === "install_historical"
              ? "确认用全新数据安装"
              : "确认升级"
        }
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) void start(action);
        }}
      />
    </>
  );
}
