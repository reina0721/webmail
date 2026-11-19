"use client";
import { useEffect, useRef, useState } from "react";
import {
  Action,
  AutoAwesomeOutlined,
  CheckboxField,
  ConfirmDialog,
  ConsoleAccordionSection,
  ConsoleSaveBar,
  ConsoleSectionCard,
  ConsoleStatusBanner,
  PaletteOutlined,
  PublicOutlined,
  SelectField,
  SliderField,
  SwitchField,
  TextAreaField,
  TextField,
  TravelExploreOutlined,
} from "@mail-web/ui";
import { api, errorMessage } from "@platform/lib/api";
import { useInstallationLeave } from "@platform/host/use-installation-leave";
import { useSiteSettings } from "@platform/host/site-settings";
import {
  DEFAULT_SITE_METADATA,
  mergeSiteMetadata,
  sanitizeCssUrl,
  type SiteMetadata,
} from "./site-defaults";
import { SiteAssetField } from "./site-asset-field";

export type SiteMetadataSection =
  | "all"
  | "general"
  | "branding"
  | "seo"
  | "none";

export function SiteMetadataSettings({
  section = "all",
  hideBrandField = false,
  syncedBrand,
  onBrandSaved,
}: {
  section?: SiteMetadataSection;
  hideBrandField?: boolean;
  syncedBrand?: string;
  onBrandSaved?: (brand: string) => void;
}) {
  const setGlobalMetadata = useSiteSettings((s) => s.setMetadata);
  const [draft, setDraft] = useState<SiteMetadata | null>(null);
  const [saved, setSaved] = useState<SiteMetadata | null>(null);
  const [activeWrite, setActiveWrite] = useState<"settings" | "asset" | null>(
    null,
  );
  const siteWriteLock = useRef(false);
  const busy = activeWrite !== null;
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const dirty =
    !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const leave = useInstallationLeave(dirty);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = mergeSiteMetadata(await api<SiteMetadata>("/admin/site"));
      setDraft(data);
      setSaved(data);
      setGlobalMetadata(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Load initial site metadata once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!syncedBrand) return;
    setDraft((prev) =>
      prev && prev.brand === saved?.brand
        ? { ...prev, brand: syncedBrand }
        : prev,
    );
    setSaved((prev) => (prev ? { ...prev, brand: syncedBrand } : prev));
  }, [syncedBrand, saved?.brand]);

  async function runSiteWrite(
    operation: () => Promise<void>,
    kind: "settings" | "asset" = "asset",
  ) {
    if (siteWriteLock.current) return false;
    siteWriteLock.current = true;
    setActiveWrite(kind);
    try {
      await operation();
      return true;
    } finally {
      siteWriteLock.current = false;
      setActiveWrite(null);
    }
  }

  async function saveAll() {
    if (!draft || siteWriteLock.current) return;
    setNotice("");
    setError("");
    try {
      await runSiteWrite(async () => {
        const { uploadedAssets: _ignore, ...payload } = draft;
        const updated = mergeSiteMetadata(
          await api<SiteMetadata>("/admin/site", {
            method: "PUT",
            body: JSON.stringify(payload),
          }),
        );
        setDraft(updated);
        setSaved(updated);
        setGlobalMetadata(updated);
        onBrandSaved?.(updated.brand);
        setNotice(
          "站点信息、图标、SEO 与登录页外观已保存并即时生效，无需重启服务。",
        );
      }, "settings");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function updateField<K extends keyof SiteMetadata>(
    key: K,
    value: SiteMetadata[K],
  ) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleUploaded(
    field: keyof SiteMetadata,
    kind: string,
    url: string,
  ) {
    setNotice("图片已上传并生效。");
    setError("");
    setDraft((prev) => {
      if (!prev) return prev;
      const assets = prev.uploadedAssets.includes(kind)
        ? prev.uploadedAssets
        : [...prev.uploadedAssets, kind];
      return { ...prev, [field]: url, uploadedAssets: assets };
    });
    setSaved((prev) => {
      if (!prev) return prev;
      const assets = prev.uploadedAssets.includes(kind)
        ? prev.uploadedAssets
        : [...prev.uploadedAssets, kind];
      const next = { ...prev, [field]: url, uploadedAssets: assets };
      setGlobalMetadata(next);
      return next;
    });
  }

  async function handleResetAsset(field: keyof SiteMetadata, kind: string) {
    const updated = mergeSiteMetadata(
      await api<SiteMetadata>(`/admin/site/assets/${kind}`, {
        method: "DELETE",
      }),
    );
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            [field]: updated[field],
            uploadedAssets: updated.uploadedAssets,
          }
        : updated,
    );
    setSaved((prev) => {
      const next = prev
        ? {
            ...prev,
            [field]: updated[field],
            uploadedAssets: updated.uploadedAssets,
          }
        : updated;
      setGlobalMetadata(next);
      return next;
    });
    setNotice("已恢复默认图片资源。");
  }

  const leaveDialog = (
    <ConfirmDialog
      triggerLabel="离开"
      isOpen={!!leave.href}
      onOpenChange={(open) => {
        if (!open) leave.cancel();
      }}
      title="离开未保存的站点扩展配置？"
      description="当前修改尚未保存。"
      cancelLabel="继续编辑"
      confirmLabel="离开"
      onConfirm={leave.leave}
    />
  );

  if (section === "none") {
    return (
      <>
        {dirty && (
          <ConsoleSaveBar
            dirty={dirty}
            saving={activeWrite === "settings"}
            disabled={busy}
            summary="其他标签页中的站点信息、图标或 SEO 存在未保存更改"
            saveLabel="保存站点、图标与 SEO 配置"
            onSave={() => void saveAll()}
            onReset={() => {
              setDraft(saved);
              setError("");
              setNotice("");
            }}
          />
        )}
        {leaveDialog}
      </>
    );
  }

  if (loading) {
    return (
      <ConsoleSectionCard
        title="站点信息、品牌与扩展配置"
        icon={<PublicOutlined fontSize="small" />}
      >
        <p role="status">正在读取站点品牌、图标与 SEO 配置…</p>
      </ConsoleSectionCard>
    );
  }

  if (!draft) {
    return (
      <ConsoleSectionCard
        title="站点信息、图标、SEO 与认证页外观"
        description="无法读取站点扩展配置。"
        icon={<PublicOutlined fontSize="small" />}
        badge={{ label: "读取失败", tone: "error" }}
      >
        {error && (
          <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
        )}
        <div className="console-actions">
          <Action onPress={() => void load()}>重新读取</Action>
        </div>
      </ConsoleSectionCard>
    );
  }

  const previewBgUrl = sanitizeCssUrl(draft.authBackgroundUrl);
  const showGeneral = section === "all" || section === "general";
  const showBranding = section === "all" || section === "branding";
  const showSeo = section === "all" || section === "seo";
  const dirtyBadge = dirty
    ? { label: "有未保存更改", tone: "warning" as const }
    : undefined;

  return (
    <>
      {showGeneral && (
        <ConsoleSectionCard
          title="站点信息、品牌与公告"
          description="配置站点简称、组织名称、副标题、页脚版权以及登录页通知公告。所有配置均内置非空默认值，保存后即时生效。"
          icon={<PublicOutlined fontSize="small" />}
          badge={
            dirtyBadge ??
            (draft.announcementEnabled
              ? { label: "公告已开启", tone: "info" }
              : { label: "已生效", tone: "success" })
          }
        >
          <div className="console-form-grid">
            {!hideBrandField && (
              <TextField
                label="站点显示名称"
                value={draft.brand}
                disabled={busy}
                onChange={(e) => updateField("brand", e.target.value)}
              />
            )}
            <TextField
              label="PWA 短名称"
              hint="桌面或主屏幕安装时显示的简称。"
              value={draft.shortName}
              disabled={busy}
              onChange={(e) => updateField("shortName", e.target.value)}
            />
            <TextField
              label="组织 / 运营方名称"
              value={draft.organizationName}
              disabled={busy}
              onChange={(e) => updateField("organizationName", e.target.value)}
            />
            <TextField
              label="站点主页链接"
              value={draft.websiteUrl}
              disabled={busy}
              onChange={(e) => updateField("websiteUrl", e.target.value)}
            />
          </div>
          <TextField
            label="站点副标题 / 标语"
            value={draft.tagline}
            disabled={busy}
            onChange={(e) => updateField("tagline", e.target.value)}
          />
          <TextField
            label="页脚版权与备案文案"
            value={draft.footerText}
            disabled={busy}
            onChange={(e) => updateField("footerText", e.target.value)}
          />
          <div className="console-subsection">
            <h3>登录页通知公告</h3>
            <SwitchField
              label="在登录 / 注册 / 找回页展示顶部公告横幅"
              description="用于维护通知、新域名开户说明或系统提示。"
              checked={draft.announcementEnabled}
              disabled={busy}
              onCheckedChange={(v) => updateField("announcementEnabled", v)}
            />
            <div className="console-form-grid">
              <SelectField
                label="公告样式"
                value={draft.announcementTone}
                disabled={busy}
                options={[
                  { value: "info", label: "常规信息（Info）" },
                  { value: "warning", label: "重要提醒（Warning）" },
                ]}
                onValueChange={(v) =>
                  updateField(
                    "announcementTone",
                    v === "warning" ? "warning" : "info",
                  )
                }
              />
            </div>
            <TextAreaField
              label="公告正文"
              minRows={2}
              value={draft.announcementText}
              disabled={busy}
              onChange={(e) => updateField("announcementText", e.target.value)}
            />
          </div>
        </ConsoleSectionCard>
      )}

      {showBranding && (
        <>
          <ConsoleSectionCard
            title="站点图标与品牌徽标"
            description="支持直接上传 PNG、SVG、JPEG、WebP 或 ICO 图标（图标限 2 MiB），或填写外部资源 URL。浏览器标签页图标同时支持未读邮件角标提示。"
            icon={<PaletteOutlined fontSize="small" />}
            badge={
              draft.uploadedAssets.length > 0
                ? {
                    label: `已自定义 ${draft.uploadedAssets.length} 项`,
                    tone: "primary",
                  }
                : { label: "使用默认资源", tone: "default" }
            }
          >
            <div className="console-asset-grid">
              <SiteAssetField
                kind="favicon"
                label="浏览器标签页图标（Favicon）"
                hint="推荐 SVG 或 32×32/64×64 PNG/ICO。"
                value={draft.faviconUrl}
                defaultValue={DEFAULT_SITE_METADATA.faviconUrl}
                uploaded={draft.uploadedAssets.includes("favicon")}
                disabled={busy}
                onChangeUrl={(url) => updateField("faviconUrl", url)}
                onUploaded={(k, url) => handleUploaded("faviconUrl", k, url)}
                onReset={(k) => handleResetAsset("faviconUrl", k)}
              />
              <SiteAssetField
                kind="apple-touch-icon"
                label="Apple Touch Icon"
                hint="用于 iOS / iPadOS 主屏幕快捷方式，推荐 180×180 PNG。"
                value={draft.appleTouchIconUrl}
                defaultValue={DEFAULT_SITE_METADATA.appleTouchIconUrl}
                uploaded={draft.uploadedAssets.includes("apple-touch-icon")}
                disabled={busy}
                onChangeUrl={(url) => updateField("appleTouchIconUrl", url)}
                onUploaded={(k, url) =>
                  handleUploaded("appleTouchIconUrl", k, url)
                }
                onReset={(k) => handleResetAsset("appleTouchIconUrl", k)}
              />
              <SiteAssetField
                kind="app-logo-light"
                label="工作区导航栏 Logo（浅色模式）"
                hint="显示在邮件工作区左侧导航栏顶部。"
                value={draft.appLogoLightUrl}
                defaultValue={DEFAULT_SITE_METADATA.appLogoLightUrl}
                uploaded={draft.uploadedAssets.includes("app-logo-light")}
                disabled={busy}
                onChangeUrl={(url) => updateField("appLogoLightUrl", url)}
                onUploaded={(k, url) =>
                  handleUploaded("appLogoLightUrl", k, url)
                }
                onReset={(k) => handleResetAsset("appLogoLightUrl", k)}
              />
              <SiteAssetField
                kind="app-logo-dark"
                label="工作区导航栏 Logo（深色模式）"
                hint="深色主题下在工作区左侧导航栏展示。"
                value={draft.appLogoDarkUrl}
                defaultValue={DEFAULT_SITE_METADATA.appLogoDarkUrl}
                uploaded={draft.uploadedAssets.includes("app-logo-dark")}
                darkSurface
                disabled={busy}
                onChangeUrl={(url) => updateField("appLogoDarkUrl", url)}
                onUploaded={(k, url) =>
                  handleUploaded("appLogoDarkUrl", k, url)
                }
                onReset={(k) => handleResetAsset("appLogoDarkUrl", k)}
              />
              <SiteAssetField
                kind="login-logo-light"
                label="登录页品牌 Logo（浅色模式）"
                hint="显示在登录 / 注册 / 找回卡片顶部。"
                value={draft.loginLogoLightUrl}
                defaultValue={DEFAULT_SITE_METADATA.loginLogoLightUrl}
                uploaded={draft.uploadedAssets.includes("login-logo-light")}
                disabled={busy}
                onChangeUrl={(url) => updateField("loginLogoLightUrl", url)}
                onUploaded={(k, url) =>
                  handleUploaded("loginLogoLightUrl", k, url)
                }
                onReset={(k) => handleResetAsset("loginLogoLightUrl", k)}
              />
              <SiteAssetField
                kind="login-logo-dark"
                label="登录页品牌 Logo（深色模式）"
                hint="深色主题下在登录 / 注册 / 找回卡片顶部展示。"
                value={draft.loginLogoDarkUrl}
                defaultValue={DEFAULT_SITE_METADATA.loginLogoDarkUrl}
                uploaded={draft.uploadedAssets.includes("login-logo-dark")}
                darkSurface
                disabled={busy}
                onChangeUrl={(url) => updateField("loginLogoDarkUrl", url)}
                onUploaded={(k, url) =>
                  handleUploaded("loginLogoDarkUrl", k, url)
                }
                onReset={(k) => handleResetAsset("loginLogoDarkUrl", k)}
              />
            </div>
          </ConsoleSectionCard>

          <ConsoleSectionCard
            title="登录 / 注册 / 找回页面背景与外观"
            description="统一控制登录、公开注册与密码找回页面的背景图片、遮罩暗度、模糊度、布局模式与引导文案。"
            icon={<AutoAwesomeOutlined fontSize="small" />}
            badge={
              draft.authLayout === "split"
                ? { label: "分栏布局", tone: "primary" }
                : { label: "居中卡片", tone: "default" }
            }
          >
            <div
              className="console-auth-preview"
              data-layout={draft.authLayout}
              style={
                {
                  "--preview-bg-dim": String(draft.authBackgroundDim / 100),
                  "--preview-bg-blur": `${draft.authBackgroundBlur}px`,
                } as React.CSSProperties
              }
            >
              <div
                className="console-auth-preview-bg"
                style={{ backgroundImage: `url("${previewBgUrl}")` }}
              />
              <div className="console-auth-preview-dim" />
              <div className="console-auth-preview-card">
                <strong>{draft.brand}</strong>
                <span>{draft.authLoginTitle}</span>
                <small className="muted">{draft.authLoginSubtitle}</small>
              </div>
            </div>

            <SiteAssetField
              kind="auth-background"
              label="登录 / 注册 / 找回页面背景图片"
              hint="支持 JPG、PNG、WebP 或 SVG，也可填写图片 URL。上传文件最大为 5 MiB。"
              value={draft.authBackgroundUrl}
              defaultValue={DEFAULT_SITE_METADATA.authBackgroundUrl}
              uploaded={draft.uploadedAssets.includes("auth-background")}
              disabled={busy}
              runMutation={runSiteWrite}
              onChangeUrl={(url) => updateField("authBackgroundUrl", url)}
              onUploaded={(k, url) =>
                handleUploaded("authBackgroundUrl", k, url)
              }
              onReset={(k) => handleResetAsset("authBackgroundUrl", k)}
            />

            <div className="console-form-grid">
              <SliderField
                label="背景遮罩暗度"
                value={draft.authBackgroundDim}
                min={0}
                max={80}
                unit="%"
                hint="适当提高暗度可增强前景卡片对比度。"
                disabled={busy}
                onChange={(v) => updateField("authBackgroundDim", v)}
              />
              <SliderField
                label="背景模糊度"
                value={draft.authBackgroundBlur}
                min={0}
                max={24}
                unit=" px"
                hint="对高细节风景图增加适度高斯模糊。"
                disabled={busy}
                onChange={(v) => updateField("authBackgroundBlur", v)}
              />
            </div>

            <div className="console-form-grid">
              <SelectField
                label="页面布局模式"
                value={draft.authLayout}
                disabled={busy}
                options={[
                  { value: "centered", label: "居中悬浮卡片（Centered）" },
                  { value: "split", label: "左右分栏视图（Split）" },
                ]}
                onValueChange={(v) =>
                  updateField("authLayout", v === "split" ? "split" : "centered")
                }
              />
              <CheckboxField
                label="在认证页底部显示帮助、隐私、支持与法律链接"
                checked={draft.showAuthFooterLinks}
                disabled={busy}
                onCheckedChange={(v) => updateField("showAuthFooterLinks", v)}
              />
            </div>

            <ConsoleAccordionSection
              title="登录、注册与找回页面文案"
              description="自定义各认证视图的主标题与副标题提示。"
              defaultExpanded={section === "branding"}
            >
              <div className="console-form-grid">
                <TextField
                  label="登录页主标题"
                  value={draft.authLoginTitle}
                  disabled={busy}
                  onChange={(e) => updateField("authLoginTitle", e.target.value)}
                />
                <TextField
                  label="登录页副标题"
                  value={draft.authLoginSubtitle}
                  disabled={busy}
                  onChange={(e) =>
                    updateField("authLoginSubtitle", e.target.value)
                  }
                />
                <TextField
                  label="注册页主标题"
                  value={draft.authRegisterTitle}
                  disabled={busy}
                  onChange={(e) =>
                    updateField("authRegisterTitle", e.target.value)
                  }
                />
                <TextField
                  label="注册页副标题"
                  value={draft.authRegisterSubtitle}
                  disabled={busy}
                  onChange={(e) =>
                    updateField("authRegisterSubtitle", e.target.value)
                  }
                />
                <TextField
                  label="找回密码页主标题"
                  value={draft.authRecoveryTitle}
                  disabled={busy}
                  onChange={(e) =>
                    updateField("authRecoveryTitle", e.target.value)
                  }
                />
                <TextField
                  label="找回密码页副标题"
                  value={draft.authRecoverySubtitle}
                  disabled={busy}
                  onChange={(e) =>
                    updateField("authRecoverySubtitle", e.target.value)
                  }
                />
              </div>
            </ConsoleAccordionSection>
          </ConsoleSectionCard>
        </>
      )}

      {showSeo && (
        <ConsoleSectionCard
          title="SEO、社交分享预览、PWA 与服务链接"
          description="由后端动态注入 HTML Meta（OpenGraph / Twitter Card / Canonical）、/robots.txt、/sitemap.xml 与 /manifest.webmanifest。"
          icon={<TravelExploreOutlined fontSize="small" />}
          badge={
            dirtyBadge ??
            (draft.allowIndexing
              ? { label: "允许索引", tone: "success" }
              : { label: "禁止索引 (noindex)", tone: "default" })
          }
        >
          <div className="console-form-grid">
            <TextField
              label="SEO 页面标题（Title）"
              value={draft.seoTitle}
              disabled={busy}
              onChange={(e) => updateField("seoTitle", e.target.value)}
            />
            <TextField
              label="SEO 关键词（Keywords）"
              hint="使用英文逗号分隔。"
              value={draft.seoKeywords}
              disabled={busy}
              onChange={(e) => updateField("seoKeywords", e.target.value)}
            />
          </div>
          <TextAreaField
            label="SEO 站点描述（Description）"
            minRows={2}
            value={draft.seoDescription}
            disabled={busy}
            onChange={(e) => updateField("seoDescription", e.target.value)}
          />
          <SiteAssetField
            kind="og-image"
            label="社交链接预览封面图（OpenGraph / Twitter Image）"
            hint="建议 1200×630 PNG/JPEG/WebP（最大 5 MiB），用于微信、Telegram、Slack 等卡片预览。"
            value={draft.ogImageUrl}
            defaultValue={DEFAULT_SITE_METADATA.ogImageUrl}
            uploaded={draft.uploadedAssets.includes("og-image")}
            disabled={busy}
            onChangeUrl={(url) => updateField("ogImageUrl", url)}
            onUploaded={(k, url) => handleUploaded("ogImageUrl", k, url)}
            onReset={(k) => handleResetAsset("ogImageUrl", k)}
          />

          <div className="console-form-grid">
            <SwitchField
              label="允许搜索引擎索引收录"
              description="开启后输出 index, follow 并生成 /sitemap.xml；关闭时返回 noindex 与 Disallow: / 保护私有入口。"
              checked={draft.allowIndexing}
              disabled={busy}
              onCheckedChange={(v) => updateField("allowIndexing", v)}
            />
            <SelectField
              label="PWA 展示模式"
              value={draft.pwaDisplay}
              disabled={busy}
              options={[
                { value: "standalone", label: "独立应用窗口（standalone）" },
                { value: "minimal-ui", label: "精简浏览器栏（minimal-ui）" },
                { value: "browser", label: "普通标签页（browser）" },
              ]}
              onValueChange={(v) =>
                updateField(
                  "pwaDisplay",
                  v === "minimal-ui" || v === "browser" ? v : "standalone",
                )
              }
            />
            <TextField
              label="浅色主题色（Theme Color Light）"
              hint={`7 位十六进制颜色，例如 ${DEFAULT_SITE_METADATA.themeColorLight}。`}
              value={draft.themeColorLight}
              disabled={busy}
              onChange={(e) => updateField("themeColorLight", e.target.value)}
            />
            <TextField
              label="深色主题色（Theme Color Dark）"
              hint={`7 位十六进制颜色，例如 ${DEFAULT_SITE_METADATA.themeColorDark}。`}
              value={draft.themeColorDark}
              disabled={busy}
              onChange={(e) => updateField("themeColorDark", e.target.value)}
            />
          </div>

          <ConsoleAccordionSection
            title="帮助、支持与合规链接"
            description="配置登录页底栏与侧边菜单引用的支持文档、隐私政策、条款和账号管理链接。"
            badge={{ label: "7 项链接", tone: "default" }}
            defaultExpanded={section === "seo"}
          >
            <div className="console-form-grid">
              <TextField
                label="使用帮助文档 URL"
                value={draft.helpUrl}
                disabled={busy}
                onChange={(e) => updateField("helpUrl", e.target.value)}
              />
              <TextField
                label="客服 / 反馈联系地址"
                hint="支持 https:// 或 mailto: 地址。"
                value={draft.supportUrl}
                disabled={busy}
                onChange={(e) => updateField("supportUrl", e.target.value)}
              />
              <TextField
                label="隐私政策 URL"
                value={draft.privacyPolicyUrl}
                disabled={busy}
                onChange={(e) => updateField("privacyPolicyUrl", e.target.value)}
              />
              <TextField
                label="法律声明 / 服务条款 URL"
                value={draft.imprintUrl}
                disabled={busy}
                onChange={(e) => updateField("imprintUrl", e.target.value)}
              />
              <TextField
                label="开源仓库 URL"
                value={draft.sourceCodeUrl}
                disabled={busy}
                onChange={(e) => updateField("sourceCodeUrl", e.target.value)}
              />
              <TextField
                label="账号管理入口 URL"
                value={draft.accountManagementUrl}
                disabled={busy}
                onChange={(e) =>
                  updateField("accountManagementUrl", e.target.value)
                }
              />
              <TextField
                label="账号管理入口名称"
                value={draft.accountManagementLabel}
                disabled={busy}
                onChange={(e) =>
                  updateField("accountManagementLabel", e.target.value)
                }
              />
            </div>
          </ConsoleAccordionSection>
        </ConsoleSectionCard>
      )}

      {notice && (
        <ConsoleStatusBanner severity="success">{notice}</ConsoleStatusBanner>
      )}
      {error && (
        <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
      )}

      {!dirty && activeWrite !== "settings" && (
        <div className="console-actions">
          <Action disabled loading={false} onPress={() => void saveAll()}>
            保存站点、图标与 SEO 配置
          </Action>
        </div>
      )}

      <ConsoleSaveBar
        dirty={dirty}
        saving={activeWrite === "settings"}
        disabled={busy}
        summary="站点信息、图标、SEO 与外观存在未保存更改"
        saveLabel="保存站点、图标与 SEO 配置"
        onSave={() => void saveAll()}
        onReset={() => {
          setDraft(saved);
          setError("");
          setNotice("");
        }}
      />

      {leaveDialog}
    </>
  );
}
