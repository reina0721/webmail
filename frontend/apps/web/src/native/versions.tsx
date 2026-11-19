"use client";

import { useEffect, useState } from "react";
import {
  Action,
  Autocomplete,
  ConfirmDialog,
  LinearProgress,
  SelectField,
  TextField,
} from "@mail-web/ui";
import { api, ApiError, errorMessage } from "@platform/lib/api";
import type { components } from "@platform/lib/generated-api";
import styles from "./versions.module.css";

type View = components["schemas"]["DeploymentView"];
type Job = components["schemas"]["Job"];
type Submit = components["schemas"]["Submit"];
type Snapshot = components["schemas"]["Snapshot"];
type Release = components["schemas"]["PublishedVersion"];
type Selection = { expectedVersion: string } & (
  | { operation: "update" | "install_historical"; target: string }
  | { operation: "rollback"; target: Snapshot }
);

const endpoint = "/admin/deployment";
const finished = (job: Job) =>
  ["succeeded", "recovered", "failed"].includes(job.phase);
const date = (value: number) => new Date(value).toLocaleString();
const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
};
const slowSpeedBytes = 150 * 1024;
const defaultMirrorPreset = "https://ghfast.top";
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
  const [target, setTarget] = useState("");
  const [rollback, setRollback] = useState("");
  const [confirm, setConfirm] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [mirrorInput, setMirrorInput] = useState("");
  const [proxyInput, setProxyInput] = useState("");
  const [configDirty, setConfigDirty] = useState(false);
  const [configFeedback, setConfigFeedback] = useState("");
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
          if (!configDirty) {
            setMirrorInput(result.inventory.downloadMirror ?? "");
            setProxyInput(result.inventory.releaseProxy ?? "");
          }
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
                    managerIssue: null,
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
  }, [jobId, active, refresh, configDirty]);

  async function saveDownloadConfig() {
    if (!view) return;
    setSavingConfig(true);
    setConfigFeedback("");
    setNotice("");
    try {
      const saved = await api<components["schemas"]["DownloadConfig"]>(
        endpoint + "/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            downloadMirror: mirrorInput.trim() || null,
            releaseProxy: proxyInput.trim() || null,
          }),
        },
      );
      setMirrorInput(saved.downloadMirror ?? "");
      setProxyInput(saved.releaseProxy ?? "");
      setConfigDirty(false);
      setView((old) =>
        old
          ? {
              ...old,
              inventory: {
                ...old.inventory,
                downloadMirror: saved.downloadMirror ?? null,
                releaseProxy: saved.releaseProxy ?? null,
              },
            }
          : old,
      );
      setConfigFeedback("下载加速与代理设置已保存，正在刷新版本列表。");
      setRefresh((v) => v + 1);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSavingConfig(false);
    }
  }

  async function cancelActiveJob() {
    if (!job) return;
    setCancelling(true);
    setNotice("");
    try {
      const updated = await api<Job>(
        endpoint + "/jobs/" + job.id + "/cancel",
        { method: "POST" },
      );
      setJob(updated);
      setNotice("已发送取消请求，正在安全停止下载（已下载分片会保留）。");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

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
      downloadMirror: view.inventory.downloadMirror ?? null,
    };
    try {
      setJob(
        await api<Job>(endpoint + "/jobs", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      setTarget("");
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
  const release =
    view?.inventory.releases.find((item) => item.version === target) ?? null;
  const releaseUnavailable = (item: Release) =>
    item.version === view?.version
      ? "正在运行"
      : item.unavailableReason
        ? (unavailable[item.unavailableReason] ?? "暂不可安装")
        : "";
  const connectionMessage =
    view?.managerIssue === "permission_denied"
      ? "容器无法访问管理套接字。请在宿主机重新启用版本管理以修复权限。"
      : view?.managerIssue === "unavailable"
        ? "管理服务未响应。请检查宿主机服务状态后刷新。"
        : "宿主机管理服务未连接。请先在安装目录启用，再刷新。";
  return (
    <>
      <section className={`console-panel ${styles.panel}`}>
        <header className={styles.header}>
          <h2>运行版本</h2>
          <Action
            variant="quiet"
            size="sm"
            onPress={() => setRefresh((value) => value + 1)}
          >
            刷新版本状态
          </Action>
        </header>
        {view ? (
          <>
            <dl className={styles.summary}>
              <div>
                <dt>版本</dt>
                <dd>{view.version}</dd>
              </div>
              <div>
                <dt>平台</dt>
                <dd>{view.architecture}</dd>
              </div>
              <div>
                <dt>宿主机版本管理</dt>
                <dd>
                  <span
                    className={`console-badge${view.managerOnline ? " good" : ""}`}
                  >
                    {view.managerOnline ? "在线" : "未连接"}
                  </span>
                </dd>
              </div>
            </dl>
            <details className={styles.build}>
              <summary>构建信息</summary>
              <p>
                源码提交 <code>{view.revision}</code>
              </p>
            </details>
            <div className={styles.controls}>
              <div className={styles.row}>
                <Autocomplete
                  className={styles.field}
                  size="small"
                  openOnFocus
                  options={view.inventory.releases}
                  value={release?.version ?? null}
                  onChange={(_, version) =>
                    setTarget(typeof version === "string" ? version : "")
                  }
                  getOptionLabel={(item) => item.version}
                  getOptionValue={(item) => item.version}
                  getOptionDisabled={(item) =>
                    Boolean(releaseUnavailable(item))
                  }
                  filterOptions={(options, { inputValue }) => {
                    const query = inputValue.trim().toLowerCase();
                    const exact = options.find(
                      ({ version }) => version.toLowerCase() === query,
                    );
                    if (exact) return [exact];
                    return options.filter(({ version }) =>
                      /^\.\d+$/.test(query)
                        ? version.endsWith(query)
                        : version.toLowerCase().includes(query),
                    );
                  }}
                  renderOption={({ key, ...props }, item) => {
                    const reason = releaseUnavailable(item);
                    const detail =
                      (item.prerelease ? "预发布" : "稳定版") +
                      (reason ? ` · ${reason}` : "");
                    return (
                      <li
                        key={key}
                        {...props}
                        aria-label={`${item.version} ${detail}`}
                      >
                        <span className={styles.option}>
                          <span>{item.version}</span>
                          <span className={styles.optionDetail}>{detail}</span>
                        </span>
                      </li>
                    );
                  }}
                  slotProps={{
                    listbox: { sx: { maxHeight: "min(16rem, 45vh)" } },
                  }}
                  loading={view.inventory.releasesStatus === "loading"}
                  loadingText="正在读取 GitHub 发布版本…"
                  noOptionsText="没有匹配的版本"
                  openText="展开版本"
                  closeText="收起版本"
                  clearText="清除版本"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="选择版本"
                      placeholder="搜索版本号"
                    />
                  )}
                />
                {release && (
                  <Action
                    variant="secondary"
                    disabled={
                      blocked ||
                      !!releaseUnavailable(release) ||
                      (release.historical && !historicalEnabled)
                    }
                    onPress={() =>
                      setConfirm({
                        operation: release.historical
                          ? "install_historical"
                          : "update",
                        target: release.version,
                        expectedVersion: view.version,
                      })
                    }
                  >
                    {release.historical ? "准备安装旧版" : "准备升级"}
                  </Action>
                )}
              </div>
              {!view.managerOnline && (
                <p role="status">
                  {connectionMessage}{" "}
                  <code>sudo ./mailweb version-manager enable</code>
                </p>
              )}
              {release?.historical &&
                view.managerOnline &&
                !historicalEnabled && (
                  <p role="status">
                    宿主机管理服务需要更新。更新 CLI 后请运行{" "}
                    <code>sudo ./mailweb version-manager enable</code>。
                  </p>
                )}
              {view.inventory.releasesStatus === "unavailable" && (
                <p role="status">
                  {view.inventory.releases.length
                    ? "GitHub 暂时不可用，正在显示上次读取的版本。"
                    : "暂时无法读取 GitHub 发布版本。"}
                </p>
              )}
              {view.inventory.snapshots.length > 0 && (
                <div className={styles.row}>
                  <SelectField
                    label="选择本机快照"
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
                    恢复快照
                  </Action>
                </div>
              )}
              <div className={styles.networkConfig}>
                <h3>下载加速与代理设置</h3>
                <p className={styles.hint}>
                  用于加速 GitHub 发布清单查询与升级包下载；所有包仍会强制校验 SHA-256 与源码提交。
                </p>
                <div className={styles.networkFields}>
                  <TextField
                    label="GitHub 下载加速镜像 URL"
                    placeholder={`例如 ${defaultMirrorPreset}`}
                    value={mirrorInput}
                    disabled={blocked || savingConfig}
                    onChange={(event) => {
                      setMirrorInput(event.target.value);
                      setConfigDirty(true);
                      setConfigFeedback("");
                    }}
                  />
                  <TextField
                    label="网络代理 URL（HTTP/HTTPS）"
                    placeholder="例如 http://127.0.0.1:7890"
                    value={proxyInput}
                    disabled={blocked || savingConfig}
                    onChange={(event) => {
                      setProxyInput(event.target.value);
                      setConfigDirty(true);
                      setConfigFeedback("");
                    }}
                  />
                </div>
                <div className={styles.networkActions}>
                  <Action
                    variant="secondary"
                    size="sm"
                    disabled={blocked || savingConfig}
                    onPress={() => void saveDownloadConfig()}
                  >
                    {savingConfig ? "正在保存…" : "保存下载设置"}
                  </Action>
                  <Action
                    variant="quiet"
                    size="sm"
                    disabled={blocked || savingConfig}
                    onPress={() => {
                      setMirrorInput(defaultMirrorPreset);
                      setConfigDirty(true);
                      setConfigFeedback("");
                    }}
                  >
                    填入 ghfast.top
                  </Action>
                  <Action
                    variant="quiet"
                    size="sm"
                    disabled={blocked || savingConfig}
                    onPress={() => {
                      setMirrorInput("");
                      setProxyInput("");
                      setConfigDirty(true);
                      setConfigFeedback("");
                    }}
                  >
                    恢复直连
                  </Action>
                </div>
                {configFeedback && (
                  <p className={styles.hint}>{configFeedback}</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p role="status">正在读取运行版本…</p>
        )}
      </section>
      {job && (
        <section className="console-panel" aria-live="polite">
          <h2>最近的版本任务</h2>
          <p>
            {job.targetVersion} · {phases[job.phase]}
          </p>
          <p>{job.message}</p>
          {(job.phase === "download" || job.downloadedBytes != null) && (
            <div className={styles.progressBlock}>
              {(() => {
                const downloaded = job.downloadedBytes ?? 0;
                const total = job.totalBytes ?? null;
                const percent =
                  total && total > 0
                    ? Math.min(100, Math.round((downloaded / total) * 100))
                    : null;
                return (
                  <>
                    <LinearProgress
                      aria-label="下载进度"
                      variant={percent === null ? "indeterminate" : "determinate"}
                      value={percent ?? 0}
                    />
                    <p className={styles.progressMeta}>
                      已下载 {formatBytes(downloaded)}
                      {total != null ? ` / ${formatBytes(total)}` : ""}
                      {percent !== null ? ` (${percent}%)` : ""}
                      {job.phase === "download" && job.speedBytesPerSec != null
                        ? ` · ${formatBytes(job.speedBytesPerSec)}/s`
                        : ""}
                      {job.sourceLabel ? ` · 来源：${job.sourceLabel}` : ""}
                    </p>
                    {job.phase === "download" &&
                      job.speedBytesPerSec != null &&
                      job.speedBytesPerSec > 0 &&
                      job.speedBytesPerSec < slowSpeedBytes && (
                        <p className={styles.hint}>
                          当前下载较慢，可先取消下载并在上方配置加速镜像或代理；已下载分片会自动断点续传。
                        </p>
                      )}
                  </>
                );
              })()}
            </div>
          )}
          {(job.phase === "queued" || job.phase === "download") && (
            <div className={styles.progressActions}>
              <Action
                variant="quiet"
                size="sm"
                disabled={cancelling}
                onPress={() => void cancelActiveJob()}
              >
                {cancelling ? "正在取消…" : "取消下载"}
              </Action>
            </div>
          )}
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
