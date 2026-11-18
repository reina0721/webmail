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
  { operation: "update"; target: string } | { operation: "rollback"; target: Snapshot }
);

const endpoint = "/admin/deployment";
const finished = (job: Job) => ["succeeded", "recovered", "failed"].includes(job.phase);
const date = (value: number) => new Date(value).toLocaleString();
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
  const [update, setUpdate] = useState("");
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
          const result = await api<Job>(endpoint + "/jobs/" + jobId, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setJob(result);
          setNotice("");
        } else {
          const result = await api<View>(endpoint, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setView(result);
          if (result.inventory.job) setJob(result.inventory.job);
          setNotice("");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (jobId && active) {
          if (error instanceof ApiError && error.status === 404) {
            const health = await api<{ version: string; revision: string }>("/health/ready", {
              signal: controller.signal,
            }).catch(() => null);
            if (controller.signal.aborted) return;
            if (health && job && "v" + health.version === job.targetVersion) {
              setView((old) => old && { ...old, version: job.targetVersion, revision: health.revision, managerOnline: false });
              setJob({ ...job, phase: "succeeded", runningVersion: job.targetVersion,
                message: "目标版本已上线。该版本的控制台不提供此任务详情，请从服务器 CLI 管理后续升级。" });
              return;
            }
          }
          setNotice(error instanceof ApiError && error.status === 401
            ? "会话已结束。重新登录后可查看宿主机任务结果。"
            : "正在等待服务恢复连接，版本任务继续在宿主机执行。");
        } else {
          setNotice(errorMessage(error));
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(read, active ? 2000 : 5000);
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
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const body: Submit = {
      id,
      expectedVersion: action.expectedVersion,
      operation: action.operation,
      target: action.operation === "update" ? action.target : action.target.id,
      confirmDataRestore: action.operation === "rollback",
    };
    try {
      setJob(await api<Job>(endpoint + "/jobs", { method: "POST", body: JSON.stringify(body) }));
      setUpdate("");
      setRollback("");
    } catch (error) {
      // A lost response can follow successful submission. Reading the known ID
      // reconciles the operation without issuing another request to switch.
      const accepted = await api<Job>(endpoint + "/jobs/" + id).catch(() => null);
      if (accepted) setJob(accepted);
      else setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const snapshot = view?.inventory.snapshots.find((item) => item.id === rollback);
  const blocked = active || busy || !view?.managerOnline;
  return (
    <>
      <section className="console-panel">
        <h2>运行版本</h2>
        {view ? (
          <dl>
            <dt>版本</dt><dd>{view.version}</dd>
            <dt>源码提交</dt><dd><code>{view.revision}</code></dd>
            <dt>平台</dt><dd>{view.architecture}</dd>
            <dt>宿主机版本管理</dt><dd>{view.managerOnline ? "在线" : "未连接"}</dd>
          </dl>
        ) : <p role="status">正在读取运行版本…</p>}
        {view && !view.managerOnline && (
          <p>在宿主机安装目录执行 <code>sudo ./mailweb version-manager enable</code>，然后刷新。</p>
        )}
        <Action variant="quiet" onPress={() => setRefresh((value) => value + 1)}>刷新版本状态</Action>
      </section>
      {view?.managerOnline && (
        <section className="console-panel">
          <h2>切换版本</h2>
          {view.inventory.releasesStatus !== "ready" && (
            <p role="status">{view.inventory.releasesStatus === "loading" ? "正在读取 GitHub 发布版本…" : "暂时无法刷新 GitHub 发布版本。"}</p>
          )}
          {view.inventory.releases.length > 0 ? (
            <div className="console-form-grid">
              <SelectField label="升级到" value={update} disabled={blocked} onValueChange={setUpdate}
                options={view.inventory.releases.map((item) => ({
                  value: item.version, label: item.version + (item.prerelease ? " · 预发布" : ""),
                }))} />
              <Action disabled={blocked || !update} onPress={() => setConfirm({ operation: "update", target: update, expectedVersion: view.version })}>准备升级</Action>
            </div>
          ) : view.inventory.releasesStatus === "ready" && <p>当前没有更高的可用版本。</p>}
          {view.inventory.snapshots.length > 0 ? (
            <div className="console-form-grid">
              <SelectField label="回退快照" value={rollback} disabled={blocked} onValueChange={setRollback}
                options={view.inventory.snapshots.map((item) => ({
                  value: item.id, label: item.version + " · " + date(item.createdAt),
                }))} />
              <Action variant="secondary" disabled={blocked || !snapshot}
                onPress={() => { if (snapshot) setConfirm({ operation: "rollback", target: snapshot, expectedVersion: view.version }); }}>准备回退</Action>
            </div>
          ) : <p>暂无可回退的旧版快照。可以从宿主机登记已有备份。</p>}
        </section>
      )}
      {job && (
        <section className="console-panel" aria-live="polite">
          <h2>最近的版本任务</h2>
          <p>{job.targetVersion} · {phases[job.phase]}</p>
          <p>{job.message}</p>
          {job.runningVersion && <p>实际运行版本 {job.runningVersion}</p>}
          {job.recoveryCommand && <p>宿主机恢复命令 <code>{job.recoveryCommand}</code></p>}
          <p>任务 ID <code>{job.id}</code></p>
        </section>
      )}
      {notice && <p className="console-alert" role="status">{notice}</p>}
      <ConfirmDialog triggerLabel="确认切换版本" isOpen={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.operation === "rollback" ? "恢复旧版快照" : "升级 Webmail"}
        description={confirm?.operation === "rollback"
          ? `将恢复 ${confirm.target.version} 于 ${date(confirm.target.createdAt)} 的数据库和配置，之后的 Webmail 本地变更会回退，登录会话会失效。公网邮件服务器里的邮件仍由 Stalwart 保存。旧版控制台和 IP 登录按旧版能力运行。升回当前版本：./bin/mailweb-version-manager update --version ${confirm.expectedVersion} --yes`
          : "升级会先验证发布包并备份，切换期间邮件网页会短暂断开。"}
        cancelLabel="取消" confirmLabel={confirm?.operation === "rollback" ? "确认恢复快照" : "确认升级"}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) void start(action);
        }} />
    </>
  );
}
