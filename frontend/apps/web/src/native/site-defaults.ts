export interface SiteMetadata {
  brand: string;
  shortName: string;
  tagline: string;
  organizationName: string;
  footerText: string;
  websiteUrl: string;

  faviconUrl: string;
  appleTouchIconUrl: string;
  appLogoLightUrl: string;
  appLogoDarkUrl: string;
  loginLogoLightUrl: string;
  loginLogoDarkUrl: string;

  authBackgroundUrl: string;
  authBackgroundDim: number;
  authBackgroundBlur: number;
  authLayout: "centered" | "split";
  authLoginTitle: string;
  authLoginSubtitle: string;
  authRegisterTitle: string;
  authRegisterSubtitle: string;
  authRecoveryTitle: string;
  authRecoverySubtitle: string;
  showAuthFooterLinks: boolean;

  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  ogImageUrl: string;
  allowIndexing: boolean;
  themeColorLight: string;
  themeColorDark: string;
  pwaDisplay: "standalone" | "minimal-ui" | "browser";

  helpUrl: string;
  supportUrl: string;
  privacyPolicyUrl: string;
  imprintUrl: string;
  sourceCodeUrl: string;
  accountManagementUrl: string;
  accountManagementLabel: string;

  announcementEnabled: boolean;
  announcementTone: "info" | "warning";
  announcementText: string;

  uploadedAssets: string[];
}

export const DEFAULT_SITE_METADATA: SiteMetadata = {
  brand: "Mail Web",
  shortName: "Mail Web",
  tagline: "现代、私密、安全的一体化邮箱工作台",
  organizationName: "Mail Web",
  footerText: "© 2026 Mail Web · Private Mail Workspace",
  websiteUrl: "/",

  faviconUrl: "/mark.svg",
  appleTouchIconUrl: "/apple-touch-icon.png",
  appLogoLightUrl: "/mark.svg",
  appLogoDarkUrl: "/mark.svg",
  loginLogoLightUrl: "/mark.svg",
  loginLogoDarkUrl: "/mark.svg",

  authBackgroundUrl: "/branding/auth-bg-default.svg",
  authBackgroundDim: 15,
  authBackgroundBlur: 0,
  authLayout: "centered",
  authLoginTitle: "欢迎回来",
  authLoginSubtitle: "邮件、日历、联系人与文件，在同一个工作区。",
  authRegisterTitle: "让邮件，与你相遇",
  authRegisterSubtitle: "验证外部邮箱后，即可创建你的专属邮箱。",
  authRecoveryTitle: "找回你的邮箱",
  authRecoverySubtitle: "通过已绑定的外部邮箱重置密码。",
  showAuthFooterLinks: true,

  seoTitle: "Mail Web - 现代安全邮箱工作台",
  seoDescription: "支持多账户管理、日历、通讯录与云盘的一体化现代 Webmail 邮箱工作台。",
  seoKeywords: "webmail,邮箱,邮件客户端,日历,通讯录,云盘",
  ogImageUrl: "/screenshot-1280x720.png",
  allowIndexing: false,
  themeColorLight: "#e36389",
  themeColorDark: "#211c26",
  pwaDisplay: "standalone",

  helpUrl: "https://github.com/reina0721/webmail/blob/main/README_ZH.md",
  supportUrl: "https://github.com/reina0721/webmail/issues",
  privacyPolicyUrl: "https://github.com/reina0721/webmail/blob/main/SECURITY.md",
  imprintUrl: "https://github.com/reina0721/webmail/blob/main/LICENSE",
  sourceCodeUrl: "https://github.com/reina0721/webmail",
  accountManagementUrl: "/settings/",
  accountManagementLabel: "账号与安全设置",

  announcementEnabled: false,
  announcementTone: "info",
  announcementText: "欢迎使用邮箱工作台，如需帮助请查看页面底部帮助链接或联系管理员。",

  uploadedAssets: [],
};

export function mergeSiteMetadata(raw: unknown): SiteMetadata {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<SiteMetadata>;
  const pick = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  const brand = pick(input.brand, DEFAULT_SITE_METADATA.brand);
  return {
    brand,
    shortName: pick(input.shortName, brand.slice(0, 16)),
    tagline: pick(input.tagline, DEFAULT_SITE_METADATA.tagline),
    organizationName: pick(input.organizationName, brand),
    footerText: pick(input.footerText, `© 2026 ${brand} · Private Mail Workspace`),
    websiteUrl: pick(input.websiteUrl, DEFAULT_SITE_METADATA.websiteUrl),
    faviconUrl: pick(input.faviconUrl, DEFAULT_SITE_METADATA.faviconUrl),
    appleTouchIconUrl: pick(input.appleTouchIconUrl, DEFAULT_SITE_METADATA.appleTouchIconUrl),
    appLogoLightUrl: pick(input.appLogoLightUrl, DEFAULT_SITE_METADATA.appLogoLightUrl),
    appLogoDarkUrl: pick(input.appLogoDarkUrl, DEFAULT_SITE_METADATA.appLogoDarkUrl),
    loginLogoLightUrl: pick(input.loginLogoLightUrl, DEFAULT_SITE_METADATA.loginLogoLightUrl),
    loginLogoDarkUrl: pick(input.loginLogoDarkUrl, DEFAULT_SITE_METADATA.loginLogoDarkUrl),
    authBackgroundUrl: pick(input.authBackgroundUrl, DEFAULT_SITE_METADATA.authBackgroundUrl),
    authBackgroundDim:
      typeof input.authBackgroundDim === "number" && Number.isFinite(input.authBackgroundDim)
        ? Math.max(0, Math.min(80, Math.round(input.authBackgroundDim)))
        : DEFAULT_SITE_METADATA.authBackgroundDim,
    authBackgroundBlur:
      typeof input.authBackgroundBlur === "number" && Number.isFinite(input.authBackgroundBlur)
        ? Math.max(0, Math.min(24, Math.round(input.authBackgroundBlur)))
        : DEFAULT_SITE_METADATA.authBackgroundBlur,
    authLayout: input.authLayout === "split" ? "split" : "centered",
    authLoginTitle: pick(input.authLoginTitle, DEFAULT_SITE_METADATA.authLoginTitle),
    authLoginSubtitle: pick(input.authLoginSubtitle, DEFAULT_SITE_METADATA.authLoginSubtitle),
    authRegisterTitle: pick(input.authRegisterTitle, DEFAULT_SITE_METADATA.authRegisterTitle),
    authRegisterSubtitle: pick(input.authRegisterSubtitle, DEFAULT_SITE_METADATA.authRegisterSubtitle),
    authRecoveryTitle: pick(input.authRecoveryTitle, DEFAULT_SITE_METADATA.authRecoveryTitle),
    authRecoverySubtitle: pick(input.authRecoverySubtitle, DEFAULT_SITE_METADATA.authRecoverySubtitle),
    showAuthFooterLinks:
      typeof input.showAuthFooterLinks === "boolean"
        ? input.showAuthFooterLinks
        : DEFAULT_SITE_METADATA.showAuthFooterLinks,
    seoTitle: pick(input.seoTitle, `${brand} - 现代安全邮箱工作台`),
    seoDescription: pick(input.seoDescription, DEFAULT_SITE_METADATA.seoDescription),
    seoKeywords: pick(input.seoKeywords, DEFAULT_SITE_METADATA.seoKeywords),
    ogImageUrl: pick(input.ogImageUrl, DEFAULT_SITE_METADATA.ogImageUrl),
    allowIndexing:
      typeof input.allowIndexing === "boolean"
        ? input.allowIndexing
        : DEFAULT_SITE_METADATA.allowIndexing,
    themeColorLight: pick(input.themeColorLight, DEFAULT_SITE_METADATA.themeColorLight),
    themeColorDark: pick(input.themeColorDark, DEFAULT_SITE_METADATA.themeColorDark),
    pwaDisplay:
      input.pwaDisplay === "minimal-ui" || input.pwaDisplay === "browser"
        ? input.pwaDisplay
        : "standalone",
    helpUrl: pick(input.helpUrl, DEFAULT_SITE_METADATA.helpUrl),
    supportUrl: pick(input.supportUrl, DEFAULT_SITE_METADATA.supportUrl),
    privacyPolicyUrl: pick(input.privacyPolicyUrl, DEFAULT_SITE_METADATA.privacyPolicyUrl),
    imprintUrl: pick(input.imprintUrl, DEFAULT_SITE_METADATA.imprintUrl),
    sourceCodeUrl: pick(input.sourceCodeUrl, DEFAULT_SITE_METADATA.sourceCodeUrl),
    accountManagementUrl: pick(input.accountManagementUrl, DEFAULT_SITE_METADATA.accountManagementUrl),
    accountManagementLabel: pick(input.accountManagementLabel, DEFAULT_SITE_METADATA.accountManagementLabel),
    announcementEnabled:
      typeof input.announcementEnabled === "boolean"
        ? input.announcementEnabled
        : DEFAULT_SITE_METADATA.announcementEnabled,
    announcementTone: input.announcementTone === "warning" ? "warning" : "info",
    announcementText: pick(input.announcementText, DEFAULT_SITE_METADATA.announcementText),
    uploadedAssets: Array.isArray(input.uploadedAssets)
      ? input.uploadedAssets.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export const SITE_METADATA_CACHE_KEY = "mail-web-site-metadata";

export function readCachedSiteMetadata(): SiteMetadata {
  try {
    const raw = localStorage.getItem(SITE_METADATA_CACHE_KEY);
    if (raw) return mergeSiteMetadata(JSON.parse(raw));
    const statusRaw = localStorage.getItem("mail-web-site-status");
    if (statusRaw) {
      const status = JSON.parse(statusRaw);
      if (typeof status?.brand === "string" && status.brand.trim()) {
        return mergeSiteMetadata({ brand: status.brand });
      }
    }
  } catch {
    /* Offline cache may be missing or unreadable during SSR. */
  }
  return DEFAULT_SITE_METADATA;
}

export function writeCachedSiteMetadata(metadata: SiteMetadata): void {
  try {
    localStorage.setItem(SITE_METADATA_CACHE_KEY, JSON.stringify(metadata));
  } catch {
    /* Storage quota or private mode may reject persistence. */
  }
}

export function sanitizeCssUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /["'<>\\()\s]/.test(trimmed)) {
    return DEFAULT_SITE_METADATA.authBackgroundUrl;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return DEFAULT_SITE_METADATA.authBackgroundUrl;
}
