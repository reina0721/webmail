"use client";
import { useEffect, useState } from "react";
import {
  Action,
  CheckboxField,
  ConfirmDialog,
  ConsoleSaveBar,
  ConsoleSectionCard,
  ConsoleStatusBanner,
  SelectField,
  TuneOutlined,
} from "@mail-web/ui";
import { api, errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import { usePolicyStore } from "@/stores/policy-store";

type Defaults = {
  mailLayout: string;
  sendDelaySeconds: number;
  externalContentPolicy: string;
  sharingEnabled: boolean;
  sharingWriteEnabled: boolean;
};

export function ClientDefaults() {
  const [value, setValue] = useState<Defaults | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = !!value && JSON.stringify(value) !== saved;
  const leave = useInstallationLeave(dirty);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await api<Defaults>("/admin/client-policy");
      setValue(result);
      setSaved(JSON.stringify(result));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!value) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/admin/client-policy", {
        method: "PUT",
        body: JSON.stringify(value),
      });
      setSaved(JSON.stringify(value));
      await usePolicyStore.getState().fetchPolicy();
      setNotice("默认邮件设置与共享策略已保存。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConsoleSectionCard
        title="默认邮件设置与共享策略"
        description="默认值用于尚未选择偏好的账号；用户已保存的阅读和写信偏好继续保留。共享权限由后端同时校验。"
        icon={<TuneOutlined fontSize="small" />}
        badge={
          dirty
            ? { label: "有未保存更改", tone: "warning" }
            : value
              ? {
                  label: value.sharingEnabled ? "允许共享" : "禁止共享",
                  tone: value.sharingEnabled ? "success" : "default",
                }
              : undefined
        }
      >
        {error && (
          <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
        )}
        {notice && (
          <ConsoleStatusBanner severity="success">{notice}</ConsoleStatusBanner>
        )}
        {value ? (
          <>
            <div className="console-form-grid">
              <SelectField
                label="默认阅读布局"
                value={value.mailLayout}
                onValueChange={(mailLayout) =>
                  setValue({ ...value, mailLayout })
                }
                options={[
                  { value: "split", label: "三栏阅读" },
                  { value: "focus", label: "完整列表" },
                  { value: "horizontal", label: "底部阅读" },
                ]}
              />
              <SelectField
                label="撤销发送等待"
                value={String(value.sendDelaySeconds)}
                onValueChange={(delay) =>
                  setValue({ ...value, sendDelaySeconds: Number(delay) })
                }
                options={[0, 5, 10, 30, 60].map((n) => ({
                  value: String(n),
                  label: n === 0 ? "立即发送" : `${n} 秒`,
                }))}
              />
              <SelectField
                label="默认外部内容"
                value={value.externalContentPolicy}
                onValueChange={(externalContentPolicy) =>
                  setValue({ ...value, externalContentPolicy })
                }
                options={[
                  { value: "ask", label: "询问后加载" },
                  { value: "block", label: "阻止外部内容" },
                  { value: "allow", label: "允许外部内容" },
                ]}
              />
            </div>
            <div className="console-subsection">
              <h3>文件夹、日历与通讯录共享策略</h3>
              <CheckboxField
                label="允许用户共享邮箱文件夹、日历、通讯录与文件夹"
                checked={value.sharingEnabled}
                onCheckedChange={(sharingEnabled) =>
                  setValue({ ...value, sharingEnabled })
                }
              />
              <CheckboxField
                label="共享时允许授予写入权限"
                checked={value.sharingWriteEnabled}
                disabled={!value.sharingEnabled}
                onCheckedChange={(sharingWriteEnabled) =>
                  setValue({ ...value, sharingWriteEnabled })
                }
              />
            </div>
            {!dirty && (
              <div className="console-actions">
                <Action disabled loading={busy} onPress={() => void save()}>
                  保存默认值与共享策略
                </Action>
              </div>
            )}
          </>
        ) : (
          <div className="console-actions">
            <Action loading={busy} onPress={() => void load()}>
              重新读取设置
            </Action>
          </div>
        )}
      </ConsoleSectionCard>

      <ConsoleSaveBar
        dirty={dirty}
        saving={busy}
        summary="默认邮件与共享策略存在未保存更改"
        saveLabel="保存默认值与共享策略"
        onSave={() => void save()}
        onReset={() => {
          if (saved) setValue(JSON.parse(saved) as Defaults);
          setError("");
          setNotice("");
        }}
      />

      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!leave.href}
        onOpenChange={(v) => {
          if (!v) leave.cancel();
        }}
        title="离开未保存的默认设置？"
        description="当前修改尚未保存。"
        cancelLabel="继续编辑"
        confirmLabel="离开"
        onConfirm={leave.leave}
      />
    </>
  );
}
