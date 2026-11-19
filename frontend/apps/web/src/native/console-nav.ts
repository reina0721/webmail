export type ConsoleSection =
  | "overview"
  | "users"
  | "services"
  | "registration"
  | "site"
  | "activity"
  | "versions"
  | "setup";

export type SiteSubTab =
  | "general"
  | "branding"
  | "seo"
  | "turnstile"
  | "defaults";

export type ActivitySubTab =
  | "tasks"
  | "readiness"
  | "automatic-mail"
  | "audit";

export const SITE_TABS: readonly {
  id: SiteSubTab;
  label: string;
  description: string;
}[] = [
  {
    id: "general",
    label: "基础地址与品牌",
    description: "站点名称、主访问地址、组织信息与认证页公告",
  },
  {
    id: "branding",
    label: "图标与登录外观",
    description: "浏览器图标、浅深色徽标与登录/注册背景预览",
  },
  {
    id: "seo",
    label: "SEO、PWA 与链接",
    description: "搜索引擎 Meta、社交媒体封面、PWA 与合规链接",
  },
  {
    id: "turnstile",
    label: "Turnstile 人机验证",
    description: "Cloudflare 人机验证自动配置与手动密钥管理",
  },
  {
    id: "defaults",
    label: "邮件默认与共享",
    description: "新账号默认布局、撤回等待、外部内容与共享权限",
  },
];

export const ACTIVITY_TABS: readonly {
  id: ActivitySubTab;
  label: string;
  description: string;
}[] = [
  {
    id: "tasks",
    label: "后台任务",
    description: "账号策略同步、凭据撤销与开户核对队列",
  },
  {
    id: "readiness",
    label: "健康诊断",
    description: "邮件服务、回调与人机验证的就绪检查记录",
  },
  {
    id: "automatic-mail",
    label: "自动发送队列",
    description: "当前邮件服务的自动回复与规则转发投递记录",
  },
  {
    id: "audit",
    label: "审计与部署",
    description: "管理员操作审计日志与宿主升级指引",
  },
];

export const CONSOLE_SECTIONS: Record<
  ConsoleSection,
  { title: string; subtitle: string; groupLabel: string; href: string }
> = {
  overview: {
    title: "概览",
    subtitle: "查看当前域名服务规模、开放注册状态与最近运维活动。",
    groupLabel: "工作台",
    href: "/console/",
  },
  users: {
    title: "账号与配额",
    subtitle: "按当前域名管理邮箱状态、容量上限与外部发信额度。",
    groupLabel: "账号与邮件服务",
    href: "/console/users/",
  },
  services: {
    title: "邮件服务与域名",
    subtitle: "连接与初始化 Stalwart 服务实例，管理域名绑定与用户目录。",
    groupLabel: "账号与邮件服务",
    href: "/console/services/",
  },
  registration: {
    title: "注册与验证",
    subtitle: "检查公开注册前置条件，设置新账号名额与默认限额。",
    groupLabel: "账号与邮件服务",
    href: "/console/registration/",
  },
  site: {
    title: "站点与默认设置",
    subtitle: "按分区管理站点访问、品牌资产、SEO、人机验证与默认邮件策略。",
    groupLabel: "站点与外观设置",
    href: "/console/site/",
  },
  activity: {
    title: "任务、审计与诊断",
    subtitle: "集中查看后台任务队列、健康诊断、自动邮件投递与操作审计。",
    groupLabel: "运维与系统",
    href: "/console/activity/",
  },
  versions: {
    title: "版本管理",
    subtitle: "在线切换发布版本、恢复本地快照并配置下载加速。",
    groupLabel: "运维与系统",
    href: "/console/versions/",
  },
  setup: {
    title: "安装与修复",
    subtitle: "执行主邮件服务初始化、重新授权或修复底层服务资源。",
    groupLabel: "运维与系统",
    href: "/console/setup/",
  },
};

export function resolveSiteTab(search: string, hash: string): SiteSubTab {
  if (hash === "#turnstile-setup") return "turnstile";
  const tab = new URLSearchParams(search).get("tab");
  if (
    tab === "general" ||
    tab === "branding" ||
    tab === "seo" ||
    tab === "turnstile" ||
    tab === "defaults"
  ) {
    return tab;
  }
  return "general";
}

export function resolveActivityTab(search: string): ActivitySubTab {
  const tab = new URLSearchParams(search).get("tab");
  if (
    tab === "tasks" ||
    tab === "readiness" ||
    tab === "automatic-mail" ||
    tab === "audit"
  ) {
    return tab;
  }
  return "tasks";
}
