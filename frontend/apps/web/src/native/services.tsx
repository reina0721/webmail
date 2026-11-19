"use client";
import { useEffect, useState } from "react";
import {
  Action,
  CheckboxField,
  ConfirmDialog,
  ConsoleAccordionSection,
  ConsoleSectionCard,
  ConsoleStatusBanner,
  ConsoleStatusChip,
  DnsOutlined,
  PasswordField,
  SelectField,
  TextField,
  VerifiedUserOutlined,
} from "@mail-web/ui";
import { operationId } from "@platform/host/operation-id";
import { useConnections } from "./connections-controller";
import { ConsoleDirectory } from "./directory-policy";
import { RegistrationReadiness } from "./readiness";

export function ConsoleServices(props: {
  token: string;
  origin: string;
  brand: string;
  onDirtyChange: (dirty: boolean) => void;
  initialServiceId?: string;
  onSelectDomain?: (id: string) => void;
}) {
  const [configDirty, setConfigDirty] = useState(false);
  const [directoryDirty, setDirectoryDirty] = useState(false);

  useEffect(() => {
    props.onDirtyChange(configDirty || directoryDirty);
    return () => props.onDirtyChange(false);
  }, [configDirty, directoryDirty, props.onDirtyChange]);

  const c = useConnections({ ...props, onDirtyChange: setConfigDirty });
  const [repairing, setRepairing] = useState(false);
  useEffect(() => setRepairing(false), [c.selected]);

  const configuring =
    repairing ||
    c.fresh ||
    (c.selected !== "default" &&
      (!c.current?.configured ||
        ["failed", "interrupted", "cancelled"].includes(c.job?.status ?? "")));

  // A selected existing service owns the same domain context as the console.
  // Fresh/unsubmitted connections keep their form until initialization settles.
  const selectedBinding = c.bindings.find((d) => d.serviceId === c.selected);
  useEffect(() => {
    if (
      !c.fresh &&
      !c.busy &&
      !configDirty &&
      !directoryDirty &&
      selectedBinding &&
      c.selected !== props.initialServiceId
    ) {
      props.onSelectDomain?.(selectedBinding.id);
    }
  }, [
    c.selected,
    c.fresh,
    c.busy,
    configDirty,
    directoryDirty,
    selectedBinding?.id,
    props.initialServiceId,
    props.onSelectDomain,
  ]);

  const serviceBindings = c.bindings.filter((d) => d.serviceId === c.selected);

  return (
    <>
      <ConsoleSectionCard
        title="邮件服务与域名"
        description="每台 Stalwart 独立保存连接、域名、任务和健康状态。账号始终绑定其登记服务。"
        icon={<DnsOutlined fontSize="small" />}
        badge={
          c.current
            ? c.current.configured
              ? { label: "已连接", tone: "success" }
              : { label: "待初始化", tone: "warning" }
            : c.fresh
              ? { label: "新建连接", tone: "primary" }
              : undefined
        }
        headerAction={
          <Action
            variant="secondary"
            disabled={c.busy || directoryDirty}
            onPress={() =>
              c.guard(() => {
                c.clear();
                c.setSelected(operationId());
                c.setFresh(true);
                c.setPrepared(false);
                c.setName("");
                c.setBase("");
              })
            }
          >
            添加 Stalwart
          </Action>
        }
      >
        <div className="console-actions">
          <SelectField
            label="邮件服务"
            value={c.selected}
            disabled={c.busy || directoryDirty}
            options={[
              ...c.services.map((s) => ({
                value: s.id,
                label: `${s.name} · ${s.configured ? "已连接" : "待初始化"}`,
              })),
              ...(c.fresh && !c.current
                ? [{ value: c.selected, label: "新建连接" }]
                : []),
            ]}
            onValueChange={(id) => c.guard(() => c.choose(id))}
          />
        </div>

        {c.current && (
          <div className="console-service-summary">
            <strong>{c.current.name}</strong>
            <code>{c.current.origin}</code>
            <ConsoleStatusChip
              label={c.current.configured ? "配置已保存" : "等待初始化"}
              tone={c.current.configured ? "success" : "warning"}
            />
          </div>
        )}

        {c.selected === "default" && (
          <div>
            <a className="console-link" href="/console/setup/">
              自动修复主服务配置 →
            </a>
          </div>
        )}

        {configuring && (
          <>
            <div className="console-form-grid">
              <TextField
                label="连接名称"
                value={c.current?.name ?? c.name}
                disabled={c.busy || c.prepared || !c.fresh}
                onChange={(e) => c.setName(e.target.value)}
              />
              <TextField
                label="Stalwart 地址"
                value={c.current?.origin ?? c.base}
                disabled={c.busy || c.prepared}
                onChange={(e) => c.setBase(e.target.value)}
              />
              <SelectField
                label="临时授权"
                value={c.mode}
                options={[
                  { value: "password", label: "管理员账号" },
                  { value: "key", label: "管理员 API Key" },
                ]}
                onValueChange={c.setMode}
              />
              {c.mode === "password" ? (
                <>
                  <TextField
                    label="管理员账号"
                    value={c.username}
                    onChange={(e) => c.setUsername(e.target.value)}
                  />
                  <PasswordField
                    purpose="current"
                    label="管理员密码"
                    value={c.password}
                    onChange={(e) => c.setPassword(e.target.value)}
                  />
                </>
              ) : (
                <PasswordField
                  purpose="current"
                  label="管理员 API Key"
                  value={c.key}
                  onChange={(e) => c.setKey(e.target.value)}
                />
              )}
            </div>
            <div className="console-actions">
              <Action
                loading={c.busy}
                onPress={() => void c.run(c.authorize)}
              >
                验证授权并读取域名
              </Action>
            </div>
            {c.missing.length > 0 && (
              <ConsoleStatusBanner severity="error">
                缺少权限：{c.missing.join("、")}
              </ConsoleStatusBanner>
            )}
            {c.ticket && (
              <>
                <CheckboxField
                  label="域名不存在时创建"
                  checked={c.createDomain}
                  onCheckedChange={c.setCreateDomain}
                />
                {c.createDomain ? (
                  <TextField
                    label="新邮箱域名"
                    value={c.domain}
                    onChange={(e) => c.setDomain(e.target.value)}
                  />
                ) : (
                  <SelectField
                    label="邮箱域名"
                    value={c.domain}
                    options={c.available.map((d) => ({
                      value: d.name,
                      label: d.name,
                    }))}
                    onValueChange={c.setDomain}
                  />
                )}
                <div className="console-actions">
                  <Action
                    variant="secondary"
                    disabled={c.busy || !c.domain || !!c.missing.length}
                    onPress={() => void c.run(c.inspect)}
                  >
                    预检配置
                  </Action>
                </div>
                {c.preview && (
                  <>
                    <ul>
                      {c.preview.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="console-actions">
                      <Action
                        loading={c.busy}
                        onPress={() => void c.run(c.start)}
                      >
                        自动配置 / 继续任务
                      </Action>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {c.job && (
          <div className="console-task-progress" aria-live="polite">
            <h3>初始化任务 · {c.job.status}</h3>
            <p>当前步骤：{c.job.step}</p>
            {c.job.error && (
              <ConsoleStatusBanner severity="error">
                {c.job.error}
              </ConsoleStatusBanner>
            )}
            <dl>
              {Object.entries(c.job.resources).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {c.current?.configured && (
          <div className="console-actions">
            <Action
              variant="secondary"
              disabled={c.busy || c.selected === "default"}
              onPress={() => setRepairing(true)}
            >
              重新授权并升级此服务
            </Action>
            <Action
              variant="secondary"
              disabled={c.busy}
              onPress={() => void c.run(c.readDomains)}
            >
              发现可绑定域名
            </Action>
          </div>
        )}

        {c.current?.configured && c.available.length > 0 && !c.ticket && (
          <div className="console-actions">
            <SelectField
              label="追加域名"
              value={c.domain}
              options={c.available
                .filter((d) => !c.bindings.some((b) => b.name === d.name))
                .map((d) => ({ value: d.name, label: d.name }))}
              onValueChange={c.setDomain}
            />
            <Action
              disabled={c.busy || !c.domain}
              onPress={() => void c.run(c.addDomain)}
            >
              绑定域名
            </Action>
          </div>
        )}

        {c.error && (
          <ConsoleStatusBanner severity="error">{c.error}</ConsoleStatusBanner>
        )}
      </ConsoleSectionCard>

      {c.current?.configured && selectedBinding && (
        <ConsoleDirectory
          onDirtyChange={setDirectoryDirty}
          key={c.selected}
          domainId={selectedBinding.id}
        />
      )}

      {serviceBindings.map((d, idx) => (
        <ConsoleAccordionSection
          key={d.id}
          title={`${d.name} · 注册条件与健康诊断`}
          description="展开查看该绑定域名的注册就绪检查、回调诊断与验证链接生成。"
          icon={<VerifiedUserOutlined fontSize="small" />}
          badge={{ label: c.current?.name || "绑定域名", tone: "primary" }}
          defaultExpanded={idx === 0 || d.id === selectedBinding?.id}
        >
          <RegistrationReadiness token={props.token} domainId={d.id} />
        </ConsoleAccordionSection>
      ))}

      <ConfirmDialog
        triggerLabel="切换连接"
        isOpen={!!c.leave}
        onOpenChange={(open) => {
          if (!open) c.setLeave(null);
        }}
        title="放弃当前连接输入？"
        description="已创建的服务资源会保留；尚未提交的字段将清除。"
        cancelLabel="继续编辑"
        confirmLabel="放弃并继续"
        onConfirm={() => {
          const action = c.leave;
          c.setLeave(null);
          action?.();
        }}
      />
    </>
  );
}
