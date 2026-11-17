"use client";
import { useEffect, useRef, useState } from "react";
import { Action } from "@mail-web/ui/action";
import {
  PasswordField,
  SelectField,
  TextField,
  CheckboxField,
} from "@mail-web/ui/form-field";
import { ConfirmDialog } from "@mail-web/ui/overlays";
import { useSetupAccess } from "@platform/host/use-setup-access";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import { api, errorMessage, ApiError } from "@platform/lib/api";
import {normalizeStalwart} from "@platform/host/stalwart-origin";

type Spec = {
  brand: string;
  domain: string;
  publicOrigin: string;
  createDomain: boolean;
  directoryQueries: boolean;
  operatorMode: string;
  operatorEmail: string;
  recoveryEmail: string;
  cloudflareAccount: string;
};
type Job = {
  base: string;
  id: string;
  status: string;
  step: string;
  error: string;
  spec: Spec;
  resources: Record<string, string>;
  completed: string[];
  skipped?: string[];
};
type Status = {
  brand: string;
  domain: string;
  version: string;
  configured: boolean;
  needsOperator: boolean;
  instanceId: string;
};
const resourceNames: Record<string, string> = {
  domain: "邮箱域名 ID",
  directory: "目录服务身份",
  directoryKey: "目录服务密钥 ID",
  notification: "验证邮件账号",
  notificationKey: "发件密钥 ID",
  hook: "本安装专用 Hook",
  turnstile: "Turnstile Site Key",
  operator: "运营邮箱",
};
const steps: Record<string, string> = {
  domain: "邮箱域名",
  directory: "专用服务身份与密钥",
  notification: "验证码发件邮箱与密钥",
  hook: "提交策略 Hook",
  turnstile: "Turnstile",
  operator: "运营邮箱",
  scope: "账号策略同步",
  verify: "连接检查",
  apply: "应用配置",
  completed: "配置完成",
};
export function useAutomaticInstallation({ initialStatus }: { initialStatus?: Status }) {
  const { token, setToken, origin } = useSetupAccess();
  const [connectionsDirty, setConnectionsDirty] = useState(false);
  const [site, setSite] = useState({ brand: "", origin: "" });
  const [repairPrimary, setRepairPrimary] = useState(false);
  const [advanced, setAdvanced] = useState(false),
    [status, setStatus] = useState<Status | null>(initialStatus ?? null),
    [loaded, setLoaded] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [base, setBase] = useState(""),
    [mode, setMode] = useState("password"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [cfToken, setCfToken] = useState(""),
    [operatorPassword, setOperatorPassword] = useState("");
  const [spec, setSpec] = useState<Spec>({
    brand: "Mail Web",
    domain: "",
    publicOrigin: "",
    createDomain: false,
    directoryQueries: true,
    operatorMode: "existing",
    operatorEmail: "",
    recoveryEmail: "",
    cloudflareAccount: "",
  });
  const [ticket, setTicket] = useState(""),
    [domains, setDomains] = useState<{ id: string; name: string }[]>([]),
    [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]),
    [preview, setPreview] = useState<string[] | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [dirty, setDirty] = useState(false),
    [applied, setApplied] = useState(false);
  const generation = useRef(0),
    alive = useRef(true),
    leave = useInstallationLeave(
      connectionsDirty || (dirty && !pending && !job),
    );
  const auth = () => (token ? { Authorization: "Bearer " + token } : undefined);
  const change = (key: keyof Spec, value: string | boolean) => {
    setSpec((s) => ({ ...s, [key]: value }));
    setDirty(true);
    setPreview(null);
  };
  const clearSecrets = () => {
    setPassword("");
    setApiKey("");
    setCfToken("");
    setOperatorPassword("");
    setTicket("");
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  async function load() {
    const at = ++generation.current,
      active = () => alive.current && at === generation.current;
    setPending(true);
    setError("");
    try {
      const current = initialStatus ?? (await api<Status>("/installation"));
      if (!active()) return;
      setStatus(current);
      if (!current.configured) setSpec((s) => ({ ...s, publicOrigin: s.publicOrigin || origin }));
      const prior = await api<{ job: Job | null }>(
        "/installation/initialize/job",
        { headers: auth() },
      );
      if (!active()) return;
      const value = current.configured
        ? await api<{
            settings: {
              brand: string;
              domain: string;
              publicOrigin: string;
              stalwartUrl: string;
            };
          }>("/installation/config", { headers: auth() })
        : null;
      if (!active()) return;
      setStatus(current);
      setJob(prior.job);
      if (prior.job) {
        setSpec({...prior.job.spec,directoryQueries:prior.job.spec.directoryQueries??false});
        setBase(prior.job.base);
      }
      if (value) {
        setBase(value.settings.stalwartUrl);
        setSite({
          brand: value.settings.brand,
          origin: value.settings.publicOrigin,
        });
        if (!prior.job)
          setSpec((s) => ({
            ...s,
            brand: value.settings.brand,
            domain: value.settings.domain,
            publicOrigin: value.settings.publicOrigin,
          }));
      } else setSpec((s) => ({ ...s, publicOrigin: s.publicOrigin || origin }));
      setError("");
      setLoaded(true);
    } catch (e) {
      if (active()) {
        setError(e instanceof ApiError && e.status === 401
          ? token ? "安装令牌无效或已轮换，请重新获取本安装的管理链接" : "请填写安装令牌，或使用安装工具提供的管理链接继续"
          : errorMessage(e));
        setLoaded(false);
      }
    } finally {
      if (active()) setPending(false);
    }
  }
  useEffect(() => {
    if (origin) void load();
  }, [origin, token]);
  useEffect(() => {
    if (!job || !["running", "applying"].includes(job.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api<{ job: Job }>("/installation/initialize/job", {
        headers: auth(),
      })
        .then((value) => {
          if (active) {
            setJob(value.job);
            if (!["running", "applying"].includes(value.job.status)) {
              clearSecrets();
              setDirty(false);
            }
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.status, token]);
  useEffect(() => {
    if (job?.status !== "completed" || applied) return;
    let active = true;
    const timer = setInterval(() => {
      void api<Status>("/installation")
        .then((current) => {
          if (active && current.configured) {
            setApplied(true);
            setStatus(current);
          }
        })
        .catch(() => {});
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.status, applied]);
  async function authorize() {
    const at = ++generation.current;
    setPending(true);
    setError("");
    setPreview(null);
    setTicket("");
    try {
      const value = await api<{
        ticket: string;
        domains: { id: string; name: string }[];
        cloudflareAccounts: { id: string; name: string }[];
        missingPermissions: string[];
      }>("/installation/initialize/authorize", {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          base: normalizeStalwart(base),
          username: mode === "password" ? username : "",
          password: mode === "password" ? password : "",
          apiKey: mode === "key" ? apiKey : "",
          cloudflareToken: cfToken,
          operatorPassword,
        }),
      });
      if (at !== generation.current || !alive.current) return;
      setTicket(value.ticket);
      if (value.missingPermissions.length)
        setError("缺少管理员权限：" + value.missingPermissions.join("、"));
      else if(cfToken.trim()&&!value.cloudflareAccounts.length)
        setError("Cloudflare Token 无法列出账号。请在下方填写 Account ID 后继续，Turnstile 尚未配置。");
      setDomains(value.domains);
      setAccounts(value.cloudflareAccounts);
      if (value.cloudflareAccounts.length === 1)
        change("cloudflareAccount", value.cloudflareAccounts[0].id);
      setPassword("");
      setApiKey("");
      setCfToken("");
    } catch (e) {
      if (at === generation.current) setError(errorMessage(e));
    } finally {
      if (at === generation.current) setPending(false);
    }
  }
  async function preflight() {
    setPending(true);
    setError("");
    try {
      const value = await api<{ resources: string[] }>(
        "/installation/initialize/preflight",
        {
          method: "POST",
          headers: auth(),
          body: JSON.stringify({ ticket, spec, operatorPassword }),
        },
      );
      setPreview(value.resources);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  async function start() {
    setPending(true);
    setError("");
    try {
      const result = await api<{ job: Job }>("/installation/initialize/job", {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ ticket, spec, operatorPassword }),
      });
      setJob(result.job);
      setDirty(false);
      setOperatorPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    setPending(true);
    try {
      await api("/installation/initialize/cancel", {
        method: "POST",
        headers: auth(),
      });
      clearSecrets();
      setPreview(null);
      if (job?.status !== "running") {
        setJob(null);
        setDirty(false);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return {token,setToken,origin,status,loaded,pending,error,base,setBase,mode,setMode,username,setUsername,password,setPassword,apiKey,setApiKey,cfToken,setCfToken,operatorPassword,setOperatorPassword,spec,change,ticket,domains,accounts,preview,job,applied,leave,authorize,preflight,start,cancel,load};
}
