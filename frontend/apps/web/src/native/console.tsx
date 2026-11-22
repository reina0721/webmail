"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Action,
  Avatar,
  Box,
  BuildOutlined,
  CheckboxField,
  Chip,
  ConfirmDialog,
  ConsoleCopyAction,
  ConsoleEmptyState,
  ConsolePageTabs,
  ConsoleSaveBar,
  ConsoleSectionCard,
  ConsoleShell,
  ConsoleSkeleton,
  ConsoleStatCard,
  ConsoleStatusBanner,
  ConsoleStatusChip,
  ContentSwapTransition,
  DnsOutlined,
  DrawerSurface,
  FactCheckOutlined,
  ForwardToInboxOutlined,
  GroupOutlined,
  HistoryOutlined,
  MarkEmailReadOutlined,
  MonitorHeartOutlined,
  PaletteOutlined,
  PublicOutlined,
  SearchBox,
  SelectField,
  ShieldOutlined,
  SpaceDashboardOutlined,
  SystemUpdateAltOutlined,
  TaskAltOutlined,
  TextField,
  TravelExploreOutlined,
  TuneOutlined,
  VerifiedUserOutlined,
  type ConsoleBreadcrumb,
  type ConsoleNavGroup,
  type ConsoleRenderLink,
} from "@mail-web/ui";
import {
  api,
  ApiError,
  errorMessage,
  isTransientConnectionError,
} from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import { useSiteSettings } from "@platform/host/site-settings";
import { useAuthStore } from "@/stores/auth-store";
import {
  useAppearanceStore,
  useConsoleDomain,
  useConsoleSidebar,
} from "@/stores/native-host-store";
import { useThemeStore } from "@/stores/theme-store";
import { Auth, type Session } from "./auth";
import { AutomaticMailRecords } from "./automatic-mail";
import { copyText } from "./clipboard";
import { ClientDefaults } from "./client-defaults";
import {
  ACTIVITY_TABS,
  CONSOLE_SECTIONS,
  resolveActivityTab,
  resolveSiteTab,
  SITE_TABS,
  type ActivitySubTab,
  type ConsoleSection,
  type SiteSubTab,
} from "./console-nav";
import { RegistrationReadiness } from "./readiness";
import { ConsoleServices as ConnectionsPanel } from "./services";
import { ConsoleSetup } from "./setup";
import { SiteMetadataSettings } from "./site-metadata-settings";
import { SiteSettings } from "./site-settings";
import { TurnstileSetup } from "./turnstile-setup";
import { Versions } from "./versions";
import type { components } from "@platform/lib/generated-api";

type User = {
  id: string;
  email: string;
  status: string;
  operator: boolean;
  quotaBytes: number;
  hourlyRecipients: number;
  dailyRecipients: number;
};
type Audit = {
  id: string;
  actorId: string | null;
  subjectId: string | null;
  action: string;
  outcome: string;
  createdAt: number;
};
type Policy = {
  enabled: boolean;
  maximumAccounts: number;
  quotaBytes: number;
  attachmentBytes: number;
  hourlyRecipients: number;
  dailyRecipients: number;
};
type Connection = {
  services: {
    id: string;
    name: string;
    origin: string;
    configured: boolean;
  }[];
  domains: {
    id: string;
    serviceId: string;
    name: string;
    serviceName: string;
  }[];
};
type Tasks = {
  accountPolicyJobs: number;
  credentialRevocations: number;
  registrationReconciliation: number;
};
type Settings = components["schemas"]["ConfigurationInput"];
type UserFilter = "all" | "active" | "disabled" | "operator";

const policyFields = [
  ["maximumAccounts", "普通邮箱名额", 1, "1–100 个普通邮箱"],
  ["quotaBytes", "默认容量（MiB）", 1048576, "必须大于 0"],
  ["attachmentBytes", "单封附件（MiB）", 1048576, "大于 0，最大 20 MiB"],
  ["hourlyRecipients", "每小时外部收件人", 1, "1–10000 位收件人"],
  [
    "dailyRecipients",
    "每天外部收件人",
    1,
    "1–100000，且不得低于小时限额",
  ],
] as const;

const siteTabIcons: Record<SiteSubTab, React.ReactNode> = {
  general: <PublicOutlined fontSize="small" />,
  branding: <PaletteOutlined fontSize="small" />,
  seo: <TravelExploreOutlined fontSize="small" />,
  turnstile: <ShieldOutlined fontSize="small" />,
  defaults: <TuneOutlined fontSize="small" />,
};

const activityTabIcons: Record<ActivitySubTab, React.ReactNode> = {
  tasks: <TaskAltOutlined fontSize="small" />,
  readiness: <FactCheckOutlined fontSize="small" />,
  "automatic-mail": <ForwardToInboxOutlined fontSize="small" />,
  audit: <HistoryOutlined fontSize="small" />,
};

export function Console({ section = "overview" }: { section?: ConsoleSection }) {
  const [registrationReady, setRegistrationReady] = useState(false);
  const [savedRegistrationEnabled, setSavedRegistrationEnabled] =
    useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<Connection>({
    services: [],
    domains: [],
  });
  const [users, setUsers] = useState<User[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saved, setSaved] = useState("");
  const [tasks, setTasks] = useState<Tasks | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [directAccessUrl, setDirectAccessUrl] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    version: string;
    revision: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [editing, setEditing] = useState<User | null>(null);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [closingEditor, setClosingEditor] = useState(false);

  const [siteTab, setSiteTab] = useState<SiteSubTab>(() =>
    typeof window !== "undefined"
      ? resolveSiteTab(window.location.search, window.location.hash)
      : "general",
  );
  const [activityTab, setActivityTab] = useState<ActivitySubTab>(() =>
    typeof window !== "undefined"
      ? resolveActivityTab(window.location.search)
      : "tasks",
  );

  const domain = useConsoleDomain((s) => s.domain);
  const setDomain = useConsoleDomain((s) => s.setDomain);
  const sidebarCollapsed = useConsoleSidebar((s) => s.collapsed);
  const setSidebarCollapsed = useConsoleSidebar((s) => s.setCollapsed);
  const expandedGroups = useConsoleSidebar((s) => s.expandedGroups);
  const toggleGroup = useConsoleSidebar((s) => s.toggleGroup);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const siteMetadata = useSiteSettings((s) => s.metadata);

  const generation = useRef(0);
  const editorDirty =
    !!editing &&
    JSON.stringify(editing) !==
      JSON.stringify(users.find((u) => u.id === editing.id));

  function closeEditor() {
    if (editorDirty) setClosingEditor(true);
    else setEditing(null);
  }

  const dirty =
    editorDirty ||
    connectionDirty ||
    (!!policy && saved !== JSON.stringify(policy));
  const leave = useInstallationLeave(dirty);
  const q = "?domainId=" + encodeURIComponent(domain);

  function changeDomain(id: string) {
    const url = new URL(location.href);
    url.searchParams.delete("connection");
    history.replaceState(history.state, "", url);
    setDomain(id);
  }

  const syncSubTabsFromLocation = useCallback(() => {
    if (typeof window === "undefined") return;
    if (section === "site") {
      setSiteTab(resolveSiteTab(window.location.search, window.location.hash));
    } else if (section === "activity") {
      setActivityTab(resolveActivityTab(window.location.search));
    }
  }, [section]);

  useEffect(() => {
    syncSubTabsFromLocation();
    window.addEventListener("popstate", syncSubTabsFromLocation);
    window.addEventListener("hashchange", syncSubTabsFromLocation);
    return () => {
      window.removeEventListener("popstate", syncSubTabsFromLocation);
      window.removeEventListener("hashchange", syncSubTabsFromLocation);
    };
  }, [syncSubTabsFromLocation]);

  function selectSiteTab(next: string) {
    const tab = resolveSiteTab(`?tab=${next}`, "");
    setSiteTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      url.hash = "";
      history.replaceState(history.state, "", url);
    }
  }

  function selectActivityTab(next: string) {
    const tab = resolveActivityTab(`?tab=${next}`);
    setActivityTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      history.replaceState(history.state, "", url);
    }
  }

  async function load(retries = 4) {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const active = await api<Session>("/auth/session", {
        signal: AbortSignal.timeout(10000),
      });
      if (request !== generation.current) return;
      setSession(active);
      if (!active.operator) return;
      const overview = section === "overview";
      const scoped =
        section === "users" ||
        section === "registration" ||
        section === "services" ||
        section === "activity";
      const activity = section === "activity";
      const [c, u, p, t, a, config] = await Promise.all([
        overview || scoped ? api<Connection>("/installation/connections") : null,
        overview || section === "users"
          ? api<{ items: User[] }>("/admin/users" + q)
          : null,
        overview || section === "registration"
          ? api<{ policy: Policy }>("/admin/registration" + q)
          : null,
        overview || activity ? api<Tasks>("/admin/tasks" + q) : null,
        overview || activity
          ? api<{ items: Audit[] }>("/admin/audit" + q)
          : null,
        section === "site" || section === "services"
          ? api<{ settings: Settings; directAccessUrl?: string | null }>(
              "/installation/config",
            )
          : null,
      ]);
      if (request !== generation.current) return;
      if (c) setConnections(c);
      if (u) setUsers(u.items);
      if (p) {
        setPolicy(p.policy);
        setSaved(JSON.stringify(p.policy));
        setSavedRegistrationEnabled(p.policy.enabled);
      }
      if (t) setTasks(t);
      if (a) setAudit(a.items);
      if (config) {
        setSettings(config.settings);
        setDirectAccessUrl(config.directAccessUrl ?? null);
      }
    } catch (e) {
      if (request !== generation.current) return;
      if (retries && isTransientConnectionError(e)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 800));
        if (request === generation.current) void load(retries - 1);
        return;
      }
      if (e instanceof ApiError && e.status === 401) setSession(null);
      else setError(errorMessage(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    setRegistrationReady(false);
    if (section !== "setup") void load();
    return () => {
      generation.current++;
    };
  }, [domain, section]);

  useEffect(() => {
    let active = true;
    void api<{ version: string; revision: string }>("/health/ready")
      .then((value) => {
        if (active) setHealth(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice("已保存");
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const pendingTasksCount = tasks
    ? Object.values(tasks).reduce((a, b) => a + b, 0)
    : undefined;

  const navGroups: readonly ConsoleNavGroup[] = useMemo(
    () => [
      {
        id: "workspace",
        label: "工作台",
        items: [
          {
            id: "overview",
            label: "概览",
            href: "/console/",
            icon: <SpaceDashboardOutlined fontSize="small" />,
            active: section === "overview",
          },
        ],
      },
      {
        id: "accounts",
        label: "账号与邮件服务",
        items: [
          {
            id: "users",
            label: "账号与配额",
            href: "/console/users/",
            icon: <GroupOutlined fontSize="small" />,
            active: section === "users",
          },
          {
            id: "services",
            label: "邮件服务与域名",
            href: "/console/services/",
            icon: <DnsOutlined fontSize="small" />,
            active: section === "services",
          },
          {
            id: "registration",
            label: "注册与验证",
            href: "/console/registration/",
            icon: <VerifiedUserOutlined fontSize="small" />,
            active: section === "registration",
          },
        ],
      },
      {
        id: "site",
        label: "站点与外观设置",
        items: [
          {
            id: "site",
            label: "站点与默认设置",
            href: "/console/site/",
            icon: <TuneOutlined fontSize="small" />,
            active: section === "site",
            children: SITE_TABS.map((tab) => ({
              id: tab.id,
              label: tab.label,
              href: `/console/site/?tab=${tab.id}`,
              icon: siteTabIcons[tab.id],
              active: section === "site" && siteTab === tab.id,
            })),
          },
        ],
      },
      {
        id: "ops",
        label: "运维与系统",
        items: [
          {
            id: "activity",
            label: "任务、审计与诊断",
            href: "/console/activity/",
            icon: <MonitorHeartOutlined fontSize="small" />,
            active: section === "activity",
            badge: pendingTasksCount,
            badgeTone:
              pendingTasksCount && pendingTasksCount > 0 ? "warning" : "default",
            children: ACTIVITY_TABS.map((tab) => ({
              id: tab.id,
              label: tab.label,
              href: `/console/activity/?tab=${tab.id}`,
              icon: activityTabIcons[tab.id],
              active: section === "activity" && activityTab === tab.id,
            })),
          },
          {
            id: "versions",
            label: "版本管理",
            href: "/console/versions/",
            icon: <SystemUpdateAltOutlined fontSize="small" />,
            active: section === "versions",
          },
          {
            id: "setup",
            label: "安装与修复",
            href: "/console/setup/",
            icon: <BuildOutlined fontSize="small" />,
            active: section === "setup",
          },
        ],
      },
    ],
    [section, siteTab, activityTab, pendingTasksCount],
  );

  const sectionMeta = CONSOLE_SECTIONS[section];
  const breadcrumbs: ConsoleBreadcrumb[] = useMemo(() => {
    const items: ConsoleBreadcrumb[] = [
      { label: "管理控制台", href: "/console/" },
      { label: sectionMeta.title, href: sectionMeta.href },
    ];
    if (section === "site") {
      const currentTab = SITE_TABS.find((t) => t.id === siteTab);
      if (currentTab) items.push({ label: currentTab.label });
    } else if (section === "activity") {
      const currentTab = ACTIVITY_TABS.find((t) => t.id === activityTab);
      if (currentTab) items.push({ label: currentTab.label });
    }
    return items;
  }, [section, sectionMeta, siteTab, activityTab]);

  const renderNavLink: ConsoleRenderLink = ({
    href,
    className,
    ariaCurrent,
    ariaLabel,
    onClick,
    children,
  }) => (
    <Link
      href={href}
      className={className}
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (section === "site" && href.startsWith("/console/site/")) {
          e.preventDefault();
          const parsed = new URL(href, "http://localhost");
          const nextTab = resolveSiteTab(parsed.search, parsed.hash);
          setSiteTab(nextTab);
          if (typeof window !== "undefined") {
            history.replaceState(history.state, "", href);
          }
        } else if (
          section === "activity" &&
          href.startsWith("/console/activity/")
        ) {
          e.preventDefault();
          const parsed = new URL(href, "http://localhost");
          const nextTab = resolveActivityTab(parsed.search);
          setActivityTab(nextTab);
          if (typeof window !== "undefined") {
            history.replaceState(history.state, "", href);
          }
        }
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );

  const brandName = settings?.brand || siteMetadata.brand || "Mail Web";
  const isDark = resolvedTheme === "dark";
  const logoUrl = isDark
    ? siteMetadata.appLogoDarkUrl
    : siteMetadata.appLogoLightUrl;

  const activeUsersCount = users.filter((u) => u.status === "active").length;
  const disabledUsersCount = users.filter(
    (u) => u.status === "disabled",
  ).length;
  const operatorUsersCount = users.filter((u) => u.operator).length;

  const filteredUsers = users.filter((u) => {
    const matchesSearch = u.email
      .toLowerCase()
      .includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (userFilter === "active") return u.status === "active";
    if (userFilter === "disabled") return u.status === "disabled";
    if (userFilter === "operator") return u.operator;
    return true;
  });

  const headerActions =
    session?.operator &&
    connections.domains.length > 0 &&
    section !== "site" &&
    section !== "versions" ? (
      <SelectField
        label="管理域名"
        value={domain}
        disabled={dirty || busy || !!editing}
        options={connections.domains.map((d) => ({
          value: d.id,
          label: `${d.name} · ${d.serviceName}`,
        }))}
        onValueChange={changeDomain}
      />
    ) : undefined;

  return (
    <>
      <ConsoleShell
        brand={brandName}
        brandHref="/"
        logoUrl={logoUrl}
        eyebrow="管理控制台"
        groups={navGroups}
        pageTitle={sectionMeta.title}
        pageSubtitle={sectionMeta.subtitle}
        breadcrumbs={breadcrumbs}
        headerActions={headerActions}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={setSidebarCollapsed}
        expandedItems={expandedGroups}
        onToggleExpandedItem={toggleGroup}
        operatorEmail={session?.operator ? session.email : undefined}
        dark={isDark}
        onToggleDark={() => setTheme(isDark ? "light" : "dark")}
        accent={accent}
        onChangeAccent={setAccent}
        backHref="/"
        backLabel="返回邮箱"
        versionText={
          health
            ? `${health.version} · ${health.revision.slice(0, 12)}`
            : undefined
        }
        renderLink={renderNavLink}
      >
        {section === "setup" ? (
          <ConsoleSetup />
        ) : loading ? (
          <ConsoleSkeleton
            variant={
              section === "overview"
                ? "overview"
                : section === "users"
                  ? "table"
                  : section === "site"
                    ? "form"
                    : "panel"
            }
            label="正在读取控制台…"
          />
        ) : error ? (
          <ConsoleStatusBanner
            severity="error"
            action={
              <Action size="sm" onPress={() => void load()}>
                重新连接
              </Action>
            }
          >
            {error}
          </ConsoleStatusBanner>
        ) : !session ? (
          <Auth
            onLogin={(s) => {
              setLoading(true);
              void useAuthStore
                .getState()
                .login(
                  location.origin + "/api/v1/native",
                  s.email,
                  "cookie-session",
                  undefined,
                  false,
                )
                .then(() => {
                  setSession(s);
                  void load();
                });
            }}
          />
        ) : !session.operator ? (
          <ConsoleSectionCard
            title="需要控制台权限"
            icon={<ShieldOutlined fontSize="small" />}
            badge={{ label: "权限不足", tone: "warning" }}
          >
            <p>当前邮箱无管理员权限。</p>
            <div>
              <Link className="console-link" href="/">
                返回邮箱 →
              </Link>
            </div>
          </ConsoleSectionCard>
        ) : (
          <>
            {notice && (
              <ConsoleStatusBanner severity="info" role="status">
                {notice}
              </ConsoleStatusBanner>
            )}

            {section === "overview" && (
              <>
                <div className="console-stats">
                  <ConsoleStatCard
                    label="邮箱账号"
                    value={users.length}
                    hint="当前绑定域名下账号总数"
                    icon={<GroupOutlined fontSize="small" />}
                    tone="primary"
                    staggerIndex={0}
                  />
                  <ConsoleStatCard
                    label="已启用"
                    value={activeUsersCount}
                    hint={
                      disabledUsersCount > 0
                        ? `${disabledUsersCount} 个已停用`
                        : "全部账号状态正常"
                    }
                    icon={<MarkEmailReadOutlined fontSize="small" />}
                    tone="success"
                    staggerIndex={1}
                  />
                  <ConsoleStatCard
                    label="邮件服务"
                    value={connections.services.length}
                    hint={`${connections.domains.length} 个绑定域名`}
                    icon={<DnsOutlined fontSize="small" />}
                    tone="info"
                    staggerIndex={2}
                  />
                  <ConsoleStatCard
                    label="待处理任务"
                    value={pendingTasksCount ?? "—"}
                    hint="队列同步与核对作业"
                    icon={<TaskAltOutlined fontSize="small" />}
                    tone={
                      pendingTasksCount && pendingTasksCount > 0
                        ? "warning"
                        : "default"
                    }
                    staggerIndex={3}
                  />
                </div>

                <div className="console-columns">
                  <ConsoleSectionCard
                    title="注册开放策略"
                    icon={<VerifiedUserOutlined fontSize="small" />}
                    badge={{
                      label: policy?.enabled ? "已开启" : "已关闭",
                      tone: policy?.enabled ? "success" : "default",
                    }}
                  >
                    <p className="console-large">
                      {policy?.enabled ? "公开注册已开启" : "公开注册已关闭"}
                    </p>
                    {policy && (
                      <div className="console-policy-summary">
                        <div className="console-policy-metric">
                          <span>名额上限</span>
                          <strong>{policy.maximumAccounts}</strong>
                        </div>
                        <div className="console-policy-metric">
                          <span>默认容量</span>
                          <strong>{Math.round(policy.quotaBytes / 1048576)} MiB</strong>
                        </div>
                        <div className="console-policy-metric">
                          <span>小时/日限额</span>
                          <strong>
                            {policy.hourlyRecipients}/{policy.dailyRecipients}
                          </strong>
                        </div>
                      </div>
                    )}
                    <p className="console-hint">
                      健康探测告警不会更改管理员设置的开放策略。
                    </p>
                    <div>
                      <Link
                        className="console-link"
                        href="/console/registration/"
                      >
                        管理注册与验证 →
                      </Link>
                    </div>
                  </ConsoleSectionCard>

                  <ConsoleSectionCard
                    title="运行版本"
                    icon={<SystemUpdateAltOutlined fontSize="small" />}
                    badge={
                      health
                        ? { label: "运行中", tone: "success" }
                        : undefined
                    }
                  >
                    <p className="console-large">{health?.version ?? "—"}</p>
                    {health?.revision && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                        <code>{health.revision}</code>
                        <ConsoleCopyAction
                          label="复制提交哈希"
                          onCopy={() => copyText(health.revision)}
                        />
                      </Box>
                    )}
                    <div>
                      <Link className="console-link" href="/console/versions/">
                        查看与切换版本 →
                      </Link>
                    </div>
                  </ConsoleSectionCard>
                </div>

                <ConsoleSectionCard
                  title="最近活动"
                  description="当前域名的最新控制台操作审计记录。"
                  icon={<HistoryOutlined fontSize="small" />}
                  headerAction={
                    <Link
                      className="console-link"
                      href="/console/activity/?tab=audit"
                    >
                      查看全部 →
                    </Link>
                  }
                >
                  <AuditRows items={audit.slice(0, 6)} />
                </ConsoleSectionCard>
              </>
            )}

            {section === "users" && (
              <ConsoleSectionCard
                title="邮箱账号"
                description="按当前域名管理状态、容量与发信限额。"
                icon={<GroupOutlined fontSize="small" />}
                badge={{
                  label: `${users.length} 个账号`,
                  tone: "primary",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", md: "row" },
                    alignItems: { xs: "stretch", md: "center" },
                    justifyContent: "space-between",
                    gap: 1.5,
                  }}
                >
                  <Box sx={{ flex: 1, maxWidth: { md: 360 } }}>
                    <SearchBox
                      label="搜索邮箱"
                      placeholder="按邮箱地址筛选…"
                      value={search}
                      onValueChange={setSearch}
                    />
                  </Box>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}
                    role="group"
                    aria-label="账号状态筛选"
                  >
                    {(
                      [
                        ["all", `全部 (${users.length})`],
                        ["active", `正常 (${activeUsersCount})`],
                        ["disabled", `已停用 (${disabledUsersCount})`],
                        ["operator", `管理员 (${operatorUsersCount})`],
                      ] as const
                    ).map(([key, label]) => (
                      <Chip
                        key={key}
                        clickable
                        size="small"
                        label={label}
                        color={userFilter === key ? "primary" : "default"}
                        variant={userFilter === key ? "filled" : "outlined"}
                        onClick={() => setUserFilter(key)}
                      />
                    ))}
                  </Box>
                </Box>

                <div className="console-table-scroll">
                  <table className="console-table">
                    <thead>
                      <tr>
                        <th>邮箱账号</th>
                        <th>状态</th>
                        <th>容量</th>
                        <th>发信限额</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                flexWrap: "wrap",
                              }}
                            >
                              <Avatar
                                aria-hidden="true"
                                sx={{
                                  width: 26,
                                  height: 26,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  bgcolor: u.operator
                                    ? "var(--accent-15)"
                                    : "var(--surface-inset)",
                                  color: u.operator
                                    ? "var(--accent-70)"
                                    : "var(--ink)",
                                  border: "1px solid var(--line)",
                                }}
                              >
                                {(u.email[0] || "?").toUpperCase()}
                              </Avatar>
                              <strong>{u.email}</strong>
                              <ConsoleStatusChip
                                label={u.operator ? "管理员" : "普通邮箱"}
                                tone={u.operator ? "primary" : "default"}
                              />
                            </Box>
                          </td>
                          <td>
                            <ConsoleStatusChip
                              label={
                                u.status === "active"
                                  ? "正常"
                                  : u.status === "disabled"
                                    ? "已停用"
                                    : "待恢复"
                              }
                              tone={
                                u.status === "active"
                                  ? "success"
                                  : u.status === "disabled"
                                    ? "default"
                                    : "warning"
                              }
                            />
                          </td>
                          <td>{u.quotaBytes / 1048576} MiB</td>
                          <td>
                            {u.hourlyRecipients}/小时 · {u.dailyRecipients}/天
                          </td>
                          <td>
                            <Action
                              variant="quiet"
                              size="sm"
                              onPress={() => setEditing({ ...u })}
                            >
                              管理
                            </Action>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!filteredUsers.length && (
                  <ConsoleEmptyState
                    icon={<GroupOutlined fontSize="small" />}
                    title="没有匹配的账号"
                    description="尝试清空搜索关键词或切换到全部状态筛选。"
                  />
                )}
              </ConsoleSectionCard>
            )}

            {section === "services" && settings && (
              <ConnectionsPanel
                key={domain}
                token=""
                origin={settings.publicOrigin}
                brand={settings.brand}
                initialServiceId={
                  connections.domains.find((d) => d.id === domain)?.serviceId
                }
                onSelectDomain={setDomain}
                onDirtyChange={setConnectionDirty}
              />
            )}

            {section === "registration" && policy && (
              <>
                <RegistrationReadiness
                  domainId={domain}
                  requestedEnabled={savedRegistrationEnabled}
                  onReadyChange={setRegistrationReady}
                />
                <ConsoleSectionCard
                  title="公开注册策略"
                  description={
                    registrationReady || policy.enabled
                      ? "开启后，访客可以申请该域名的邮箱。"
                      : "完成上方收信验证后，即可开启公开注册。"
                  }
                  icon={<VerifiedUserOutlined fontSize="small" />}
                  badge={
                    dirty
                      ? { label: "有未保存更改", tone: "warning" }
                      : {
                          label: policy.enabled ? "已开放注册" : "未开放",
                          tone: policy.enabled ? "success" : "default",
                        }
                  }
                >
                  <CheckboxField
                    checked={policy.enabled}
                    disabled={!registrationReady && !policy.enabled}
                    onCheckedChange={(enabled) =>
                      setPolicy({ ...policy, enabled })
                    }
                    label="允许公开注册"
                  />
                  <div className="console-form-grid">
                    {policyFields.map(([key, label, scale, hint]) => (
                      <TextField
                        key={key}
                        label={label}
                        hint={hint}
                        type="number"
                        value={policy[key] / scale}
                        onChange={(e) =>
                          setPolicy({
                            ...policy,
                            [key]: Number(e.target.value) * scale,
                          })
                        }
                      />
                    ))}
                  </div>
                  {!dirty && (
                    <div className="console-actions">
                      <Action loading={busy} disabled={!dirty} onPress={() => {}}>
                        保存注册策略
                      </Action>
                    </div>
                  )}
                </ConsoleSectionCard>
                <ConsoleSaveBar
                  dirty={dirty}
                  saving={busy}
                  summary="公开注册策略存在未保存更改"
                  saveLabel="保存注册策略"
                  onSave={() =>
                    void run(async () => {
                      await api("/admin/registration" + q, {
                        method: "PATCH",
                        body: JSON.stringify(policy),
                      });
                      setSaved(JSON.stringify(policy));
                      setSavedRegistrationEnabled(policy.enabled);
                    })
                  }
                  onReset={() => {
                    if (saved) setPolicy(JSON.parse(saved) as Policy);
                  }}
                />
              </>
            )}

            {section === "versions" && <Versions />}

            {section === "site" && settings && (
              <>
                <ConsolePageTabs
                  value={siteTab}
                  onChange={selectSiteTab}
                  ariaLabel="站点与默认设置分区"
                  items={SITE_TABS.map((t) => ({
                    id: t.id,
                    label: t.label,
                    icon: siteTabIcons[t.id],
                  }))}
                />

                <ContentSwapTransition contentKey={siteTab}>
                  {siteTab === "general" && (
                    <SiteSettings
                      initial={settings}
                      directAccessUrl={directAccessUrl}
                      mode="general"
                      onSave={async (value) => {
                        await api("/installation/config", {
                          method: "PATCH",
                          body: JSON.stringify(value),
                        });
                        setSettings(
                          (current) =>
                            current && {
                              ...current,
                              brand: value.brand ?? current.brand,
                              publicOrigin:
                                value.publicOrigin ?? current.publicOrigin,
                            },
                        );
                      }}
                    />
                  )}

                  {siteTab === "turnstile" && (
                    <>
                      <TurnstileSetup publicOrigin={settings.publicOrigin} />
                      <SiteSettings
                        initial={settings}
                        directAccessUrl={directAccessUrl}
                        mode="turnstile-manual"
                        onSave={async (value) => {
                          await api("/installation/config", {
                            method: "PATCH",
                            body: JSON.stringify(value),
                          });
                        }}
                      />
                    </>
                  )}

                  {siteTab === "defaults" && <ClientDefaults />}
                </ContentSwapTransition>

                <SiteMetadataSettings
                  section={
                    siteTab === "general"
                      ? "general"
                      : siteTab === "branding"
                        ? "branding"
                        : siteTab === "seo"
                          ? "seo"
                          : "none"
                  }
                  hideBrandField
                  syncedBrand={settings.brand}
                  onBrandSaved={(brand) =>
                    setSettings(
                      (current) => current && { ...current, brand },
                    )
                  }
                />
              </>
            )}

            {section === "activity" && (
              <>
                <ConsolePageTabs
                  value={activityTab}
                  onChange={selectActivityTab}
                  ariaLabel="任务、审计与诊断分区"
                  items={ACTIVITY_TABS.map((t) => ({
                    id: t.id,
                    label: t.label,
                    icon: activityTabIcons[t.id],
                    badge:
                      t.id === "tasks" && pendingTasksCount
                        ? pendingTasksCount
                        : undefined,
                  }))}
                />

                <ContentSwapTransition contentKey={activityTab}>
                  {activityTab === "tasks" && (
                    <ConsoleSectionCard
                      title="后台任务"
                      description="监控账号权限同步、凭据撤销与开户核对队列，必要时重试失败任务。"
                      icon={<TaskAltOutlined fontSize="small" />}
                      badge={{
                        label:
                          pendingTasksCount && pendingTasksCount > 0
                            ? `${pendingTasksCount} 项待处理`
                            : "队列空闲",
                        tone:
                          pendingTasksCount && pendingTasksCount > 0
                            ? "warning"
                            : "success",
                      }}
                      headerAction={
                        <Action
                          loading={busy}
                          onPress={() =>
                            void run(async () => {
                              await api("/admin/tasks/retry" + q, {
                                method: "POST",
                              });
                              await load();
                            })
                          }
                        >
                          重试失败任务
                        </Action>
                      }
                    >
                      <div className="console-stats">
                        {Object.entries(tasks ?? {}).map(([key, value], index) => (
                          <ConsoleStatCard
                            key={key}
                            staggerIndex={index}
                            label={
                              {
                                accountPolicyJobs: "账号权限同步",
                                credentialRevocations: "会话凭据撤销",
                                registrationReconciliation: "开户结果核对",
                              }[key] ?? key
                            }
                            value={value}
                            tone={value > 0 ? "warning" : "success"}
                          />
                        ))}
                      </div>
                    </ConsoleSectionCard>
                  )}

                  {activityTab === "readiness" && (
                    <RegistrationReadiness domainId={domain} embedded />
                  )}

                  {activityTab === "automatic-mail" && (
                    <ConsoleSectionCard
                      title="自动回复与规则发送"
                      description="当前邮件服务的自动邮件队列、恢复情况与未知提交。"
                      icon={<ForwardToInboxOutlined fontSize="small" />}
                    >
                      <AutomaticMailRecords key={domain} domainId={domain} />
                    </ConsoleSectionCard>
                  )}

                  {activityTab === "audit" && (
                    <>
                      <ConsoleSectionCard
                        title="审计记录"
                        description="管理员对账号、策略与域名配置的关键变更记录。"
                        icon={<HistoryOutlined fontSize="small" />}
                      >
                        <AuditRows items={audit} />
                      </ConsoleSectionCard>
                      <ConsoleSectionCard
                        title="部署信息"
                        description="当前运行版本信息与命令行原地更新指引。"
                        icon={<BuildOutlined fontSize="small" />}
                      >
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                          <span>{health?.version}</span>
                          {health?.revision && (
                            <>
                              <code>{health.revision}</code>
                              <ConsoleCopyAction
                                label="复制提交哈希"
                                onCopy={() => copyText(health.revision)}
                              />
                            </>
                          )}
                        </Box>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                            <span className="console-hint">检查版本：</span>
                            <code>./mailweb check-update</code>
                            <ConsoleCopyAction
                              label="复制检查版本命令"
                              onCopy={() => copyText("./mailweb check-update")}
                            />
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                            <span className="console-hint">原地升级：</span>
                            <code>./mailweb update --version latest --yes</code>
                            <ConsoleCopyAction
                              label="复制原地升级命令"
                              onCopy={() =>
                                copyText("./mailweb update --version latest --yes")
                              }
                            />
                          </Box>
                        </Box>
                        <div className="console-actions">
                          <a
                            className="console-link"
                            href="https://github.com/reina0721/webmail/blob/main/docs/cli.md#更新与恢复"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            升级与备份恢复说明 →
                          </a>
                          <a
                            className="console-link"
                            href="https://github.com/reina0721/webmail"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            对应源码与许可证 ↗
                          </a>
                        </div>
                      </ConsoleSectionCard>
                    </>
                  )}
                </ContentSwapTransition>
              </>
            )}
          </>
        )}
      </ConsoleShell>

      <DrawerSurface
        triggerLabel="管理账号"
        isOpen={!!editing}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        closeLabel="关闭账号编辑"
        placement="right"
        title="账号与配额"
        description={editing?.email ?? ""}
        footer={
          <>
            <Action variant="quiet" disabled={busy} onPress={closeEditor}>
              取消
            </Action>
            <Action
              loading={busy}
              onPress={() =>
                void run(async () => {
                  if (!editing) return;
                  await api("/admin/users/" + editing.id, {
                    method: "PATCH",
                    body: JSON.stringify({
                      enabled: editing.status === "active",
                      quotaBytes: editing.quotaBytes,
                      hourlyRecipients: editing.hourlyRecipients,
                      dailyRecipients: editing.dailyRecipients,
                    }),
                  });
                  setEditing(null);
                  await load();
                })
              }
            >
              保存账号
            </Action>
          </>
        }
      >
        {editing && (
          <Box sx={{ display: "grid", gap: 2 }}>
            {editorDirty && (
              <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                <ConsoleStatusChip label="存在未保存修改" tone="warning" />
              </Box>
            )}
            <TextField label="邮箱账号" value={editing.email} disabled />
            <CheckboxField
              checked={editing.status === "active"}
              disabled={editing.id === session?.id}
              onCheckedChange={(enabled) =>
                setEditing({
                  ...editing,
                  status: enabled ? "active" : "disabled",
                })
              }
              label="启用邮箱"
            />
            <TextField
              label="容量（MiB）"
              type="number"
              value={editing.quotaBytes / 1048576}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  quotaBytes: Number(e.target.value) * 1048576,
                })
              }
            />
            <TextField
              label="每小时外部收件人"
              type="number"
              value={editing.hourlyRecipients}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  hourlyRecipients: Number(e.target.value),
                })
              }
            />
            <TextField
              label="每天外部收件人"
              type="number"
              value={editing.dailyRecipients}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  dailyRecipients: Number(e.target.value),
                })
              }
            />
          </Box>
        )}
      </DrawerSurface>

      <ConfirmDialog
        triggerLabel="关闭编辑"
        isOpen={closingEditor}
        onOpenChange={setClosingEditor}
        title="放弃未保存的账号修改？"
        description="此账号的状态与配额尚未保存。"
        cancelLabel="继续编辑"
        confirmLabel="放弃修改"
        onConfirm={() => {
          setClosingEditor(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        triggerLabel="离开"
        isOpen={!!leave.href}
        onOpenChange={(v) => {
          if (!v) leave.cancel();
        }}
        title="离开未保存的配置？"
        description="当前修改尚未保存。"
        cancelLabel="继续编辑"
        confirmLabel="离开"
        onConfirm={leave.leave}
      />
    </>
  );
}

function AuditRows({ items }: { items: Audit[] }) {
  return (
    <div className="console-audit">
      {items.length ? (
        items.map((e) => (
          <div key={e.id}>
            <ConsoleStatusChip
              label={e.outcome}
              tone={
                e.outcome === "success" || e.outcome === "ok"
                  ? "success"
                  : e.outcome === "error" || e.outcome === "failed"
                    ? "error"
                    : "default"
              }
            />
            <strong>{e.action}</strong>
            <time>{new Date(e.createdAt).toLocaleString()}</time>
          </div>
        ))
      ) : (
        <ConsoleEmptyState
          icon={<HistoryOutlined fontSize="small" />}
          title="暂无操作记录"
          description="管理员对当前域名的账号与策略操作会记录于此。"
        />
      )}
    </div>
  );
}
