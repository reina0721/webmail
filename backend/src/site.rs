use super::*;
use axum::body::Body;
use axum::extract::Multipart;
use axum::http::header;
use sha2::{Digest, Sha256};

const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES: usize = 5 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteMetadata {
    pub brand: String,
    pub short_name: String,
    pub tagline: String,
    pub organization_name: String,
    pub footer_text: String,
    pub website_url: String,

    pub favicon_url: String,
    pub apple_touch_icon_url: String,
    pub app_logo_light_url: String,
    pub app_logo_dark_url: String,
    pub login_logo_light_url: String,
    pub login_logo_dark_url: String,

    pub auth_background_url: String,
    pub auth_background_dim: u8,
    pub auth_background_blur: u8,
    pub auth_layout: String,
    pub auth_login_title: String,
    pub auth_login_subtitle: String,
    pub auth_register_title: String,
    pub auth_register_subtitle: String,
    pub auth_recovery_title: String,
    pub auth_recovery_subtitle: String,
    pub show_auth_footer_links: bool,

    pub seo_title: String,
    pub seo_description: String,
    pub seo_keywords: String,
    pub og_image_url: String,
    pub allow_indexing: bool,
    pub theme_color_light: String,
    pub theme_color_dark: String,
    pub pwa_display: String,

    pub help_url: String,
    pub support_url: String,
    pub privacy_policy_url: String,
    pub imprint_url: String,
    pub source_code_url: String,
    pub account_management_url: String,
    pub account_management_label: String,

    pub announcement_enabled: bool,
    pub announcement_tone: String,
    pub announcement_text: String,

    #[serde(default)]
    pub uploaded_assets: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct SiteMetadataInput {
    pub brand: String,
    pub short_name: String,
    pub tagline: String,
    pub organization_name: String,
    pub footer_text: String,
    pub website_url: String,

    pub favicon_url: String,
    pub apple_touch_icon_url: String,
    pub app_logo_light_url: String,
    pub app_logo_dark_url: String,
    pub login_logo_light_url: String,
    pub login_logo_dark_url: String,

    pub auth_background_url: String,
    pub auth_background_dim: u8,
    pub auth_background_blur: u8,
    pub auth_layout: String,
    pub auth_login_title: String,
    pub auth_login_subtitle: String,
    pub auth_register_title: String,
    pub auth_register_subtitle: String,
    pub auth_recovery_title: String,
    pub auth_recovery_subtitle: String,
    pub show_auth_footer_links: bool,

    pub seo_title: String,
    pub seo_description: String,
    pub seo_keywords: String,
    pub og_image_url: String,
    pub allow_indexing: bool,
    pub theme_color_light: String,
    pub theme_color_dark: String,
    pub pwa_display: String,

    pub help_url: String,
    pub support_url: String,
    pub privacy_policy_url: String,
    pub imprint_url: String,
    pub source_code_url: String,
    pub account_management_url: String,
    pub account_management_label: String,

    pub announcement_enabled: bool,
    pub announcement_tone: String,
    pub announcement_text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredSiteMetadata {
    brand: Option<String>,
    short_name: Option<String>,
    tagline: Option<String>,
    organization_name: Option<String>,
    footer_text: Option<String>,
    website_url: Option<String>,
    favicon_url: Option<String>,
    apple_touch_icon_url: Option<String>,
    app_logo_light_url: Option<String>,
    app_logo_dark_url: Option<String>,
    login_logo_light_url: Option<String>,
    login_logo_dark_url: Option<String>,
    auth_background_url: Option<String>,
    auth_background_dim: Option<u8>,
    auth_background_blur: Option<u8>,
    auth_layout: Option<String>,
    auth_login_title: Option<String>,
    auth_login_subtitle: Option<String>,
    auth_register_title: Option<String>,
    auth_register_subtitle: Option<String>,
    auth_recovery_title: Option<String>,
    auth_recovery_subtitle: Option<String>,
    show_auth_footer_links: Option<bool>,
    seo_title: Option<String>,
    seo_description: Option<String>,
    seo_keywords: Option<String>,
    og_image_url: Option<String>,
    allow_indexing: Option<bool>,
    theme_color_light: Option<String>,
    theme_color_dark: Option<String>,
    pwa_display: Option<String>,
    help_url: Option<String>,
    support_url: Option<String>,
    privacy_policy_url: Option<String>,
    imprint_url: Option<String>,
    source_code_url: Option<String>,
    account_management_url: Option<String>,
    account_management_label: Option<String>,
    announcement_enabled: Option<bool>,
    announcement_tone: Option<String>,
    announcement_text: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct SiteAssetUploadResponse {
    kind: String,
    url: String,
    content_type: String,
}

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/site", get(public_site))
        .route("/site/assets/{kind}", get(public_asset))
        .route("/admin/site", get(admin_site).put(save_admin_site))
        .route(
            "/admin/site/assets/{kind}",
            post(upload_asset).delete(delete_asset),
        )
}

pub fn defaults(app: &App) -> SiteMetadata {
    let brand = if app.services.brand.trim().is_empty() {
        "Mail Web".to_owned()
    } else {
        app.services.brand.trim().to_owned()
    };
    let short_name: String = brand.chars().take(16).collect();
    let website_url = if app.origin.trim().is_empty() {
        "/".to_owned()
    } else {
        app.origin.trim().to_owned()
    };
    let support_url = if !app.services.notification_email.trim().is_empty() {
        format!("mailto:{}", app.services.notification_email.trim())
    } else if !app.services.domain.trim().is_empty() {
        format!("mailto:postmaster@{}", app.services.domain.trim())
    } else {
        "https://github.com/reina0721/webmail/issues".to_owned()
    };
    SiteMetadata {
        short_name,
        tagline: "现代、私密、安全的一体化邮箱工作台".into(),
        organization_name: brand.clone(),
        footer_text: format!("© 2026 {brand} · Private Mail Workspace"),
        website_url,

        favicon_url: "/mark.svg".into(),
        apple_touch_icon_url: "/apple-touch-icon.png".into(),
        app_logo_light_url: "/mark.svg".into(),
        app_logo_dark_url: "/mark.svg".into(),
        login_logo_light_url: "/mark.svg".into(),
        login_logo_dark_url: "/mark.svg".into(),

        auth_background_url: "/branding/auth-bg-default.svg".into(),
        auth_background_dim: 15,
        auth_background_blur: 0,
        auth_layout: "centered".into(),
        auth_login_title: "欢迎回来".into(),
        auth_login_subtitle: "邮件、日历、联系人与文件，在同一个工作区。".into(),
        auth_register_title: "让邮件，与你相遇".into(),
        auth_register_subtitle: "验证外部邮箱后，即可创建你的专属邮箱。".into(),
        auth_recovery_title: "找回你的邮箱".into(),
        auth_recovery_subtitle: "通过已绑定的外部邮箱重置密码。".into(),
        show_auth_footer_links: true,

        seo_title: format!("{brand} - 现代安全邮箱工作台"),
        seo_description: "支持多账户管理、日历、通讯录与云盘的一体化现代 Webmail 邮箱工作台。"
            .into(),
        seo_keywords: "webmail,邮箱,邮件客户端,日历,通讯录,云盘".into(),
        og_image_url: "/screenshot-1280x720.png".into(),
        allow_indexing: false,
        theme_color_light: "#e36389".into(),
        theme_color_dark: "#211c26".into(),
        pwa_display: "standalone".into(),

        help_url: "https://github.com/reina0721/webmail/blob/main/README_ZH.md".into(),
        support_url,
        privacy_policy_url: "https://github.com/reina0721/webmail/blob/main/SECURITY.md".into(),
        imprint_url: "https://github.com/reina0721/webmail/blob/main/LICENSE".into(),
        source_code_url: "https://github.com/reina0721/webmail".into(),
        account_management_url: "/settings/".into(),
        account_management_label: "账号与安全设置".into(),

        announcement_enabled: false,
        announcement_tone: "info".into(),
        announcement_text: "欢迎使用邮箱工作台，如需帮助请查看页面底部帮助链接或联系管理员。"
            .into(),

        brand,
        uploaded_assets: Vec::new(),
    }
}

fn non_empty(value: Option<String>, fallback: String) -> String {
    value
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback)
}

pub async fn load_metadata(app: &App) -> Result<SiteMetadata> {
    let app = app.root.as_deref().unwrap_or(app);
    let base = defaults(app);
    let raw: Option<String> = db::scalar(db::Statement::SiteConfigGet)
        .fetch_optional(&app.db)
        .await?;
    let stored: StoredSiteMetadata = match raw {
        Some(text) => serde_json::from_str(&text).unwrap_or_default(),
        None => StoredSiteMetadata::default(),
    };
    let rows = db::query(db::Statement::SiteAssetVersions)
        .fetch_all(&app.db)
        .await?;
    let mut uploaded_assets = Vec::new();
    let mut asset_urls = HashMap::<String, String>::new();
    for row in rows {
        let kind: String = row.get("kind");
        let sha: String = row.get("sha256");
        let tag: String = sha.chars().take(12).collect();
        asset_urls.insert(kind.clone(), format!("/api/v1/site/assets/{kind}?v={tag}"));
        uploaded_assets.push(kind);
    }
    uploaded_assets.sort();

    let brand = non_empty(stored.brand, base.brand);
    let short_name = non_empty(stored.short_name, brand.chars().take(16).collect());
    let organization_name = non_empty(stored.organization_name, brand.clone());
    let default_footer = format!("© 2026 {organization_name} · Private Mail Workspace");
    let default_seo_title = format!("{brand} - 现代安全邮箱工作台");

    let pick_asset = |stored_val: Option<String>, kind: &str, fallback: String| {
        if let Some(val) = stored_val
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
        {
            val
        } else if let Some(uploaded) = asset_urls.get(kind) {
            uploaded.clone()
        } else {
            fallback
        }
    };

    Ok(SiteMetadata {
        brand,
        short_name,
        tagline: non_empty(stored.tagline, base.tagline),
        organization_name,
        footer_text: non_empty(stored.footer_text, default_footer),
        website_url: non_empty(stored.website_url, base.website_url),
        favicon_url: pick_asset(stored.favicon_url, "favicon", base.favicon_url),
        apple_touch_icon_url: pick_asset(
            stored.apple_touch_icon_url,
            "apple-touch-icon",
            base.apple_touch_icon_url,
        ),
        app_logo_light_url: pick_asset(
            stored.app_logo_light_url,
            "app-logo-light",
            base.app_logo_light_url,
        ),
        app_logo_dark_url: pick_asset(
            stored.app_logo_dark_url,
            "app-logo-dark",
            base.app_logo_dark_url,
        ),
        login_logo_light_url: pick_asset(
            stored.login_logo_light_url,
            "login-logo-light",
            base.login_logo_light_url,
        ),
        login_logo_dark_url: pick_asset(
            stored.login_logo_dark_url,
            "login-logo-dark",
            base.login_logo_dark_url,
        ),
        auth_background_url: pick_asset(
            stored.auth_background_url,
            "auth-background",
            base.auth_background_url,
        ),
        auth_background_dim: stored
            .auth_background_dim
            .unwrap_or(base.auth_background_dim)
            .min(80),
        auth_background_blur: stored
            .auth_background_blur
            .unwrap_or(base.auth_background_blur)
            .min(24),
        auth_layout: match stored.auth_layout.as_deref() {
            Some("split") => "split".into(),
            _ => "centered".into(),
        },
        auth_login_title: non_empty(stored.auth_login_title, base.auth_login_title),
        auth_login_subtitle: non_empty(stored.auth_login_subtitle, base.auth_login_subtitle),
        auth_register_title: non_empty(stored.auth_register_title, base.auth_register_title),
        auth_register_subtitle: non_empty(
            stored.auth_register_subtitle,
            base.auth_register_subtitle,
        ),
        auth_recovery_title: non_empty(stored.auth_recovery_title, base.auth_recovery_title),
        auth_recovery_subtitle: non_empty(
            stored.auth_recovery_subtitle,
            base.auth_recovery_subtitle,
        ),
        show_auth_footer_links: stored
            .show_auth_footer_links
            .unwrap_or(base.show_auth_footer_links),
        seo_title: non_empty(stored.seo_title, default_seo_title),
        seo_description: non_empty(stored.seo_description, base.seo_description),
        seo_keywords: non_empty(stored.seo_keywords, base.seo_keywords),
        og_image_url: pick_asset(stored.og_image_url, "og-image", base.og_image_url),
        allow_indexing: stored.allow_indexing.unwrap_or(base.allow_indexing),
        theme_color_light: valid_hex_color(stored.theme_color_light.as_deref())
            .unwrap_or(base.theme_color_light),
        theme_color_dark: valid_hex_color(stored.theme_color_dark.as_deref())
            .unwrap_or(base.theme_color_dark),
        pwa_display: match stored.pwa_display.as_deref() {
            Some("minimal-ui") => "minimal-ui".into(),
            Some("browser") => "browser".into(),
            _ => "standalone".into(),
        },
        help_url: non_empty(stored.help_url, base.help_url),
        support_url: non_empty(stored.support_url, base.support_url),
        privacy_policy_url: non_empty(stored.privacy_policy_url, base.privacy_policy_url),
        imprint_url: non_empty(stored.imprint_url, base.imprint_url),
        source_code_url: non_empty(stored.source_code_url, base.source_code_url),
        account_management_url: non_empty(
            stored.account_management_url,
            base.account_management_url,
        ),
        account_management_label: non_empty(
            stored.account_management_label,
            base.account_management_label,
        ),
        announcement_enabled: stored
            .announcement_enabled
            .unwrap_or(base.announcement_enabled),
        announcement_tone: match stored.announcement_tone.as_deref() {
            Some("warning") => "warning".into(),
            _ => "info".into(),
        },
        announcement_text: non_empty(stored.announcement_text, base.announcement_text),
        uploaded_assets,
    })
}

pub async fn resolved_brand(app: &App) -> String {
    match load_metadata(app).await {
        Ok(site) => site.brand,
        Err(_) => defaults(app).brand,
    }
}

pub async fn sync_brand_override(app: &App, brand: &str) -> Result<()> {
    let brand = brand.trim();
    if brand.is_empty() {
        return Ok(());
    }
    let raw: Option<String> = db::scalar(db::Statement::SiteConfigGet)
        .fetch_optional(&app.db)
        .await?;
    let mut stored: StoredSiteMetadata = raw
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    stored.brand = Some(brand.to_owned());
    db::query(db::Statement::SiteConfigPut)
        .bind(serde_json::to_string(&stored).map_err(|_| internal("site_config_serialize"))?)
        .execute(&app.db)
        .await?;
    Ok(())
}

fn valid_hex_color(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        Some(trimmed.to_ascii_lowercase())
    } else {
        None
    }
}

fn valid_text(value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_len
        || trimmed.chars().any(char::is_control)
    {
        return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid"));
    }
    Ok(trimmed.to_owned())
}

fn valid_multiline_text(value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_len
        || trimmed
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid"));
    }
    Ok(trimmed.to_owned())
}

fn valid_url(value: &str, allow_mailto: bool, strict_css_safe: bool) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 512 || trimmed.chars().any(char::is_control) {
        return Err(Error(StatusCode::BAD_REQUEST, "site_url_invalid"));
    }
    if strict_css_safe
        && (trimmed.contains('"')
            || trimmed.contains('\'')
            || trimmed.contains('<')
            || trimmed.contains('>')
            || trimmed.contains('\\')
            || trimmed.contains('(')
            || trimmed.contains(')')
            || trimmed.chars().any(char::is_whitespace))
    {
        return Err(Error(StatusCode::BAD_REQUEST, "site_url_invalid"));
    }
    if trimmed.starts_with('/') {
        if trimmed.starts_with("//") {
            return Err(Error(StatusCode::BAD_REQUEST, "site_url_invalid"));
        }
        return Ok(trimmed.to_owned());
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "site_url_invalid"))?;
    let allowed_scheme = matches!(parsed.scheme(), "https" | "http")
        || (allow_mailto && parsed.scheme() == "mailto");
    if !allowed_scheme {
        return Err(Error(StatusCode::BAD_REQUEST, "site_url_invalid"));
    }
    Ok(trimmed.to_owned())
}

fn validate_kind(kind: &str) -> Result<&'static str> {
    match kind {
        "favicon" => Ok("favicon"),
        "apple-touch-icon" => Ok("apple-touch-icon"),
        "app-logo-light" => Ok("app-logo-light"),
        "app-logo-dark" => Ok("app-logo-dark"),
        "login-logo-light" => Ok("login-logo-light"),
        "login-logo-dark" => Ok("login-logo-dark"),
        "auth-background" => Ok("auth-background"),
        "og-image" => Ok("og-image"),
        _ => Err(Error(StatusCode::BAD_REQUEST, "site_asset_kind_invalid")),
    }
}

fn asset_field_for_kind<'a>(
    stored: &'a mut StoredSiteMetadata,
    kind: &str,
) -> Option<&'a mut Option<String>> {
    match kind {
        "favicon" => Some(&mut stored.favicon_url),
        "apple-touch-icon" => Some(&mut stored.apple_touch_icon_url),
        "app-logo-light" => Some(&mut stored.app_logo_light_url),
        "app-logo-dark" => Some(&mut stored.app_logo_dark_url),
        "login-logo-light" => Some(&mut stored.login_logo_light_url),
        "login-logo-dark" => Some(&mut stored.login_logo_dark_url),
        "auth-background" => Some(&mut stored.auth_background_url),
        "og-image" => Some(&mut stored.og_image_url),
        _ => None,
    }
}

fn detect_image_mime(kind: &str, bytes: &[u8]) -> Result<&'static str> {
    if bytes.is_empty() {
        return Err(Error(StatusCode::BAD_REQUEST, "site_asset_empty"));
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Ok("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok("image/webp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) && kind == "favicon" {
        return Ok("image/x-icon");
    }
    if kind != "og-image"
        && kind != "apple-touch-icon"
        && let Ok(text) = std::str::from_utf8(bytes)
    {
        let trimmed = text.trim_start_matches('\u{feff}').trim_start();
        let lower = trimmed.to_ascii_lowercase();
        if (lower.starts_with("<svg") || lower.starts_with("<?xml"))
            && lower.contains("<svg")
            && !lower.contains("<script")
            && !lower.contains("<foreignobject")
            && !lower.contains("javascript:")
            && !lower.contains("vbscript:")
            && !has_inline_event_handler(&lower)
        {
            return Ok("image/svg+xml");
        }
    }
    Err(Error(StatusCode::BAD_REQUEST, "site_asset_unsupported"))
}

fn has_inline_event_handler(lower_svg: &str) -> bool {
    let bytes = lower_svg.as_bytes();
    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] == b'o'
            && bytes[i + 1] == b'n'
            && bytes[i + 2].is_ascii_alphabetic()
            && (i == 0
                || bytes[i - 1].is_ascii_whitespace()
                || bytes[i - 1] == b'<'
                || bytes[i - 1] == b'/')
        {
            let rest = &lower_svg[i + 2..];
            if let Some(eq) = rest.find('=')
                && rest[..eq].bytes().all(|b| b.is_ascii_alphabetic())
            {
                return true;
            }
        }
    }
    false
}

#[utoipa::path(get,path="/api/v1/site",responses((status=200,body=SiteMetadata)))]
pub(super) async fn public_site(State(app): State<Arc<App>>) -> Result<Json<SiteMetadata>> {
    Ok(Json(load_metadata(&app).await?))
}

#[utoipa::path(get,path="/api/v1/admin/site",responses((status=200,body=SiteMetadata),(status=401,description="Operator required")))]
pub(super) async fn admin_site(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<SiteMetadata>> {
    account::operator(&app, &headers, false).await?;
    Ok(Json(load_metadata(&app).await?))
}

#[utoipa::path(put,path="/api/v1/admin/site",request_body=SiteMetadataInput,responses((status=200,body=SiteMetadata),(status=400,description="Invalid site configuration"),(status=401,description="Operator required")))]
pub(super) async fn save_admin_site(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<SiteMetadataInput>,
) -> Result<Json<SiteMetadata>> {
    let me = account::operator(&app, &headers, true).await?;
    let brand = valid_text(&input.brand, 80)?;
    let short_name = valid_text(&input.short_name, 32)?;
    let tagline = valid_text(&input.tagline, 160)?;
    let organization_name = valid_text(&input.organization_name, 80)?;
    let footer_text = valid_text(&input.footer_text, 200)?;
    let website_url = valid_url(&input.website_url, false, false)?;

    let favicon_url = valid_url(&input.favicon_url, false, true)?;
    let apple_touch_icon_url = valid_url(&input.apple_touch_icon_url, false, true)?;
    let app_logo_light_url = valid_url(&input.app_logo_light_url, false, true)?;
    let app_logo_dark_url = valid_url(&input.app_logo_dark_url, false, true)?;
    let login_logo_light_url = valid_url(&input.login_logo_light_url, false, true)?;
    let login_logo_dark_url = valid_url(&input.login_logo_dark_url, false, true)?;

    let auth_background_url = valid_url(&input.auth_background_url, false, true)?;
    if input.auth_background_dim > 80 || input.auth_background_blur > 24 {
        return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid"));
    }
    let auth_layout = match input.auth_layout.as_str() {
        "centered" | "split" => input.auth_layout.clone(),
        _ => return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid")),
    };
    let auth_login_title = valid_text(&input.auth_login_title, 80)?;
    let auth_login_subtitle = valid_text(&input.auth_login_subtitle, 200)?;
    let auth_register_title = valid_text(&input.auth_register_title, 80)?;
    let auth_register_subtitle = valid_text(&input.auth_register_subtitle, 200)?;
    let auth_recovery_title = valid_text(&input.auth_recovery_title, 80)?;
    let auth_recovery_subtitle = valid_text(&input.auth_recovery_subtitle, 200)?;

    let seo_title = valid_text(&input.seo_title, 120)?;
    let seo_description = valid_text(&input.seo_description, 300)?;
    let seo_keywords = valid_text(&input.seo_keywords, 200)?;
    let og_image_url = valid_url(&input.og_image_url, false, true)?;
    let theme_color_light = valid_hex_color(Some(&input.theme_color_light))
        .ok_or(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid"))?;
    let theme_color_dark = valid_hex_color(Some(&input.theme_color_dark))
        .ok_or(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid"))?;
    let pwa_display = match input.pwa_display.as_str() {
        "standalone" | "minimal-ui" | "browser" => input.pwa_display.clone(),
        _ => return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid")),
    };

    let help_url = valid_url(&input.help_url, false, false)?;
    let support_url = valid_url(&input.support_url, true, false)?;
    let privacy_policy_url = valid_url(&input.privacy_policy_url, false, false)?;
    let imprint_url = valid_url(&input.imprint_url, false, false)?;
    let source_code_url = valid_url(&input.source_code_url, false, false)?;
    let account_management_url = valid_url(&input.account_management_url, false, false)?;
    let account_management_label = valid_text(&input.account_management_label, 60)?;

    let announcement_tone = match input.announcement_tone.as_str() {
        "info" | "warning" => input.announcement_tone.clone(),
        _ => return Err(Error(StatusCode::BAD_REQUEST, "site_configuration_invalid")),
    };
    let announcement_text = valid_multiline_text(&input.announcement_text, 500)?;

    let stored = StoredSiteMetadata {
        brand: Some(brand.clone()),
        short_name: Some(short_name),
        tagline: Some(tagline),
        organization_name: Some(organization_name),
        footer_text: Some(footer_text),
        website_url: Some(website_url),
        favicon_url: Some(favicon_url),
        apple_touch_icon_url: Some(apple_touch_icon_url),
        app_logo_light_url: Some(app_logo_light_url),
        app_logo_dark_url: Some(app_logo_dark_url),
        login_logo_light_url: Some(login_logo_light_url),
        login_logo_dark_url: Some(login_logo_dark_url),
        auth_background_url: Some(auth_background_url),
        auth_background_dim: Some(input.auth_background_dim),
        auth_background_blur: Some(input.auth_background_blur),
        auth_layout: Some(auth_layout),
        auth_login_title: Some(auth_login_title),
        auth_login_subtitle: Some(auth_login_subtitle),
        auth_register_title: Some(auth_register_title),
        auth_register_subtitle: Some(auth_register_subtitle),
        auth_recovery_title: Some(auth_recovery_title),
        auth_recovery_subtitle: Some(auth_recovery_subtitle),
        show_auth_footer_links: Some(input.show_auth_footer_links),
        seo_title: Some(seo_title),
        seo_description: Some(seo_description),
        seo_keywords: Some(seo_keywords),
        og_image_url: Some(og_image_url),
        allow_indexing: Some(input.allow_indexing),
        theme_color_light: Some(theme_color_light),
        theme_color_dark: Some(theme_color_dark),
        pwa_display: Some(pwa_display),
        help_url: Some(help_url),
        support_url: Some(support_url),
        privacy_policy_url: Some(privacy_policy_url),
        imprint_url: Some(imprint_url),
        source_code_url: Some(source_code_url),
        account_management_url: Some(account_management_url),
        account_management_label: Some(account_management_label),
        announcement_enabled: Some(input.announcement_enabled),
        announcement_tone: Some(announcement_tone),
        announcement_text: Some(announcement_text),
    };

    db::query(db::Statement::SiteConfigPut)
        .bind(serde_json::to_string(&stored).map_err(|_| internal("site_config_serialize"))?)
        .execute(&app.db)
        .await?;
    let _ = installation::quietly_update_brand(&app, &brand).await;
    account::audit_event(&app, me.user, "site_metadata_update", me.user, "success").await?;
    Ok(Json(load_metadata(&app).await?))
}

#[utoipa::path(post,path="/api/v1/admin/site/assets/{kind}",params(("kind"=String,Path)),responses((status=200,body=SiteAssetUploadResponse),(status=400,description="Invalid asset"),(status=401,description="Operator required")))]
pub(super) async fn upload_asset(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(kind): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<SiteAssetUploadResponse>> {
    let me = account::operator(&app, &headers, true).await?;
    let kind = validate_kind(&kind)?;
    let max_bytes = if matches!(kind, "auth-background" | "og-image") {
        MAX_MEDIA_BYTES
    } else {
        MAX_ICON_BYTES
    };
    let mut payload: Option<Vec<u8>> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "site_asset_invalid"))?
    {
        if field.name() == Some("file") || payload.is_none() {
            let data = field
                .bytes()
                .await
                .map_err(|_| Error(StatusCode::BAD_REQUEST, "site_asset_invalid"))?;
            if data.len() > max_bytes {
                return Err(Error(StatusCode::PAYLOAD_TOO_LARGE, "site_asset_too_large"));
            }
            payload = Some(data.to_vec());
            break;
        }
    }
    let bytes = payload.ok_or(Error(StatusCode::BAD_REQUEST, "site_asset_empty"))?;
    let content_type = detect_image_mime(kind, &bytes)?;
    let sha = hex::encode(Sha256::digest(&bytes));
    let tag: String = sha.chars().take(12).collect();
    let url = format!("/api/v1/site/assets/{kind}?v={tag}");

    db::query(db::Statement::SiteAssetUpsert)
        .bind(kind)
        .bind(content_type)
        .bind(&sha)
        .bind(&bytes)
        .bind(db::now())
        .execute(&app.db)
        .await?;

    let raw: Option<String> = db::scalar(db::Statement::SiteConfigGet)
        .fetch_optional(&app.db)
        .await?;
    let mut stored: StoredSiteMetadata = raw
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if let Some(slot) = asset_field_for_kind(&mut stored, kind) {
        *slot = Some(url.clone());
    }
    db::query(db::Statement::SiteConfigPut)
        .bind(serde_json::to_string(&stored).map_err(|_| internal("site_config_serialize"))?)
        .execute(&app.db)
        .await?;
    account::audit_event(&app, me.user, "site_asset_upload", me.user, "success").await?;

    Ok(Json(SiteAssetUploadResponse {
        kind: kind.to_owned(),
        url,
        content_type: content_type.to_owned(),
    }))
}

#[utoipa::path(delete,path="/api/v1/admin/site/assets/{kind}",params(("kind"=String,Path)),responses((status=200,body=SiteMetadata),(status=401,description="Operator required")))]
pub(super) async fn delete_asset(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> Result<Json<SiteMetadata>> {
    let me = account::operator(&app, &headers, true).await?;
    let kind = validate_kind(&kind)?;
    db::query(db::Statement::SiteAssetDelete)
        .bind(kind)
        .execute(&app.db)
        .await?;
    let raw: Option<String> = db::scalar(db::Statement::SiteConfigGet)
        .fetch_optional(&app.db)
        .await?;
    let mut stored: StoredSiteMetadata = raw
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if let Some(slot) = asset_field_for_kind(&mut stored, kind) {
        *slot = None;
    }
    db::query(db::Statement::SiteConfigPut)
        .bind(serde_json::to_string(&stored).map_err(|_| internal("site_config_serialize"))?)
        .execute(&app.db)
        .await?;
    account::audit_event(&app, me.user, "site_asset_reset", me.user, "success").await?;
    Ok(Json(load_metadata(&app).await?))
}

fn default_static_path_for_kind(kind: &str) -> &'static str {
    match kind {
        "apple-touch-icon" => "apple-touch-icon.png",
        "auth-background" => "branding/auth-bg-default.svg",
        "og-image" => "screenshot-1280x720.png",
        _ => "mark.svg",
    }
}

fn static_content_type(path: &str) -> &'static str {
    if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}

fn build_asset_response(content_type: &str, bytes: Vec<u8>, etag: Option<&str>) -> Response {
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=3600");
    if let Some(tag) = etag {
        builder = builder.header(header::ETAG, format!("\"{tag}\""));
    }
    if content_type == "image/svg+xml" {
        builder = builder.header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
    }
    builder
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[utoipa::path(get,path="/api/v1/site/assets/{kind}",params(("kind"=String,Path)),responses((status=200,description="Site image asset")))]
pub(super) async fn public_asset(
    State(app): State<Arc<App>>,
    Path(kind): Path<String>,
) -> Result<Response> {
    let kind = validate_kind(&kind)?;
    let app = app.root.as_deref().unwrap_or(&app);
    if let Some(row) = db::query(db::Statement::SiteAssetGet)
        .bind(kind)
        .fetch_optional(&app.db)
        .await?
    {
        let content_type: String = row.get("content_type");
        let sha: String = row.get("sha256");
        let data: Vec<u8> = row.get("data");
        return Ok(build_asset_response(&content_type, data, Some(&sha)));
    }
    let rel = default_static_path_for_kind(kind);
    let root = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/apps/web/out".into());
    let path = std::path::Path::new(&root).join(rel);
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(build_asset_response(static_content_type(rel), bytes, None)),
        Err(_) => Err(Error(StatusCode::NOT_FOUND, "site_asset_not_found")),
    }
}

pub(super) async fn favicon_ico(State(app): State<Arc<App>>) -> Response {
    let app_ref = app.root.as_deref().unwrap_or(&app);
    if let Ok(Some(row)) = db::query(db::Statement::SiteAssetGet)
        .bind("favicon")
        .fetch_optional(&app_ref.db)
        .await
    {
        let content_type: String = row.get("content_type");
        let sha: String = row.get("sha256");
        let data: Vec<u8> = row.get("data");
        return build_asset_response(&content_type, data, Some(&sha));
    }
    let root = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/apps/web/out".into());
    for candidate in ["mark.svg", "icon-192x192.png"] {
        let path = std::path::Path::new(&root).join(candidate);
        if let Ok(bytes) = tokio::fs::read(path).await {
            return build_asset_response(static_content_type(candidate), bytes, None);
        }
    }
    StatusCode::NOT_FOUND.into_response()
}

pub(super) async fn apple_touch_icon(State(app): State<Arc<App>>) -> Response {
    let app_ref = app.root.as_deref().unwrap_or(&app);
    if let Ok(Some(row)) = db::query(db::Statement::SiteAssetGet)
        .bind("apple-touch-icon")
        .fetch_optional(&app_ref.db)
        .await
    {
        let content_type: String = row.get("content_type");
        let sha: String = row.get("sha256");
        let data: Vec<u8> = row.get("data");
        return build_asset_response(&content_type, data, Some(&sha));
    }
    let root = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/apps/web/out".into());
    let path = std::path::Path::new(&root).join("apple-touch-icon.png");
    match tokio::fs::read(path).await {
        Ok(bytes) => build_asset_response("image/png", bytes, None),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub(super) async fn manifest_webmanifest(State(app): State<Arc<App>>) -> Response {
    let site = load_metadata(&app).await.unwrap_or_else(|_| defaults(&app));
    let mut icons = vec![
        json!({"src": "/icon-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"}),
        json!({"src": "/icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"}),
        json!({"src": "/icon-maskable-light-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"}),
        json!({"src": "/icon-maskable-light-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}),
    ];
    if site.favicon_url.ends_with(".svg") || site.uploaded_assets.iter().any(|k| k == "favicon") {
        icons.insert(
            0,
            json!({"src": site.favicon_url, "sizes": "any", "type": if site.favicon_url.ends_with(".png") { "image/png" } else if site.favicon_url.ends_with(".ico") { "image/x-icon" } else { "image/svg+xml" }, "purpose": "any"}),
        );
    }
    let body = json!({
        "name": site.brand,
        "short_name": site.short_name,
        "description": site.seo_description,
        "start_url": "/",
        "scope": "/",
        "display": site.pwa_display,
        "theme_color": site.theme_color_light,
        "background_color": "#ffffff",
        "icons": icons,
        "screenshots": [
            {"src": "/screenshot-1280x720.png", "sizes": "1280x720", "type": "image/png", "form_factor": "wide"},
            {"src": "/screenshot-540x720.png", "sizes": "540x720", "type": "image/png", "form_factor": "narrow"}
        ]
    });
    (
        [
            (
                header::CONTENT_TYPE,
                "application/manifest+json; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
    )
        .into_response()
}

pub(super) async fn robots_txt(State(app): State<Arc<App>>) -> Response {
    let site = load_metadata(&app).await.unwrap_or_else(|_| defaults(&app));
    let origin = app.origin.trim().trim_end_matches('/');
    let content = if site.allow_indexing {
        if origin.is_empty() {
            "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /console/\nDisallow: /internal/\n"
                .to_owned()
        } else {
            format!(
                "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /console/\nDisallow: /internal/\nSitemap: {origin}/sitemap.xml\n"
            )
        }
    } else {
        "User-agent: *\nDisallow: /\n".to_owned()
    };
    (
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        content,
    )
        .into_response()
}

pub(super) async fn sitemap_xml(State(app): State<Arc<App>>) -> Response {
    let site = load_metadata(&app).await.unwrap_or_else(|_| defaults(&app));
    if !site.allow_indexing {
        return StatusCode::NOT_FOUND.into_response();
    }
    let origin = if app.origin.trim().is_empty() {
        site.website_url.trim().trim_end_matches('/').to_owned()
    } else {
        app.origin.trim().trim_end_matches('/').to_owned()
    };
    if !origin.starts_with("http://") && !origin.starts_with("https://") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let escaped = escape_html(&origin);
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{escaped}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>{escaped}/login/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
</urlset>
"#
    );
    (
        [
            (header::CONTENT_TYPE, "application/xml; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        xml,
    )
        .into_response()
}

fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn absolute_url(origin: &str, url: &str) -> String {
    let origin = origin.trim().trim_end_matches('/');
    if !origin.is_empty() && url.starts_with('/') {
        format!("{origin}{url}")
    } else {
        url.to_owned()
    }
}

fn strip_tag_block(html: &str, open: &str, close: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if let Some(start) = lower.find(open)
        && let Some(rel_end) = lower[start..].find(close)
    {
        let end = start + rel_end + close.len();
        let mut out = String::with_capacity(html.len());
        out.push_str(&html[..start]);
        out.push_str(&html[end..]);
        return out;
    }
    html.to_owned()
}

fn strip_meta_or_link(html: &str, needle: &str) -> String {
    let mut current = html.to_owned();
    loop {
        let lower = current.to_ascii_lowercase();
        let Some(pos) = lower.find(needle) else {
            break;
        };
        let Some(start) = current[..pos].rfind('<') else {
            break;
        };
        let Some(rel_end) = current[pos..].find('>') else {
            break;
        };
        let end = pos + rel_end + 1;
        let mut next = String::with_capacity(current.len());
        next.push_str(&current[..start]);
        next.push_str(&current[end..]);
        current = next;
    }
    current
}

pub fn inject_html_head(html: &str, site: &SiteMetadata, origin: &str, path: &str) -> String {
    let mut cleaned = strip_tag_block(html, "<title", "</title>");
    for needle in [
        "name=\"description\"",
        "name=\"keywords\"",
        "name=\"robots\"",
        "name=\"theme-color\"",
        "rel=\"canonical\"",
        "rel=\"icon\"",
        "rel=\"shortcut icon\"",
        "rel=\"apple-touch-icon\"",
        "rel=\"manifest\"",
        "property=\"og:",
        "name=\"twitter:",
        "id=\"mail-web-auth-backdrop\"",
    ] {
        cleaned = strip_meta_or_link(&cleaned, needle);
    }
    cleaned = strip_tag_block(&cleaned, "<style id=\"mail-web-auth-backdrop\"", "</style>");
    cleaned = strip_tag_block(&cleaned, "<script id=\"mail-web-site-boot\"", "</script>");

    let title = escape_html(&site.seo_title);
    let brand = escape_html(&site.brand);
    let description = escape_html(&site.seo_description);
    let keywords = escape_html(&site.seo_keywords);
    let robots = if site.allow_indexing {
        "index, follow"
    } else {
        "noindex, nofollow"
    };
    let favicon = escape_html(&site.favicon_url);
    let favicon_type = if site.favicon_url.to_ascii_lowercase().ends_with(".png") {
        "image/png"
    } else if site.favicon_url.to_ascii_lowercase().ends_with(".ico") {
        "image/x-icon"
    } else {
        "image/svg+xml"
    };
    let apple_icon = escape_html(&site.apple_touch_icon_url);
    let og_image = escape_html(&absolute_url(origin, &site.og_image_url));
    let canonical = if origin.trim().is_empty() {
        String::new()
    } else {
        let normalized_path = if path.is_empty() { "/" } else { path };
        let full = escape_html(&absolute_url(origin, normalized_path));
        format!(
            "<link rel=\"canonical\" href=\"{full}\"/><meta property=\"og:url\" content=\"{full}\"/>"
        )
    };
    let theme_light = escape_html(&site.theme_color_light);
    let theme_dark = escape_html(&site.theme_color_dark);
    let bg_url = valid_url(&site.auth_background_url, false, true)
        .unwrap_or_else(|_| "/branding/auth-bg-default.svg".into());
    let dim_alpha = format!("{:.2}", f32::from(site.auth_background_dim) / 100.0);
    let blur_px = site.auth_background_blur;
    let layout_json =
        serde_json::to_string(&site.auth_layout).unwrap_or_else(|_| "\"centered\"".into());

    let head_snippet = format!(
        "<title>{title}</title>\
<meta name=\"description\" content=\"{description}\"/>\
<meta name=\"keywords\" content=\"{keywords}\"/>\
<meta name=\"robots\" content=\"{robots}\"/>\
<meta name=\"theme-color\" media=\"(prefers-color-scheme: light)\" content=\"{theme_light}\"/>\
<meta name=\"theme-color\" media=\"(prefers-color-scheme: dark)\" content=\"{theme_dark}\"/>\
<link rel=\"icon\" type=\"{favicon_type}\" href=\"{favicon}\"/>\
<link rel=\"apple-touch-icon\" href=\"{apple_icon}\"/>\
<link rel=\"manifest\" href=\"/manifest.webmanifest\"/>\
{canonical}\
<meta property=\"og:type\" content=\"website\"/>\
<meta property=\"og:locale\" content=\"zh_CN\"/>\
<meta property=\"og:site_name\" content=\"{brand}\"/>\
<meta property=\"og:title\" content=\"{title}\"/>\
<meta property=\"og:description\" content=\"{description}\"/>\
<meta property=\"og:image\" content=\"{og_image}\"/>\
<meta name=\"twitter:card\" content=\"summary_large_image\"/>\
<meta name=\"twitter:title\" content=\"{title}\"/>\
<meta name=\"twitter:description\" content=\"{description}\"/>\
<meta name=\"twitter:image\" content=\"{og_image}\"/>\
<style id=\"mail-web-auth-backdrop\">:root{{--auth-bg-image:url(\"{bg_url}\");--auth-bg-dim:{dim_alpha};--auth-bg-blur:{blur_px}px}}</style>\
<script id=\"mail-web-site-boot\">document.documentElement.dataset.authLayout={layout_json};</script>"
    );

    if let Some(pos) = cleaned.to_ascii_lowercase().find("</head>") {
        let mut result = String::with_capacity(cleaned.len() + head_snippet.len());
        result.push_str(&cleaned[..pos]);
        result.push_str(&head_snippet);
        result.push_str(&cleaned[pos..]);
        result
    } else {
        cleaned
    }
}

pub async fn inject_html_middleware(
    State(app): State<Arc<App>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    if !response.status().is_success() {
        return response;
    }
    let is_html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.to_ascii_lowercase().starts_with("text/html"));
    if !is_html {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, 4 * 1024 * 1024).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let Ok(html) = String::from_utf8(bytes.to_vec()) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    let site = load_metadata(&app).await.unwrap_or_else(|_| defaults(&app));
    let injected = inject_html_head(&html, &site, &app.origin, &path);
    parts.headers.remove(header::CONTENT_LENGTH);
    parts
        .headers
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Response::from_parts(parts, Body::from(injected))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_app(root: &std::path::Path) -> Arc<App> {
        let pool = db::connect(&root.join("site.sqlite")).await.unwrap();
        Arc::new(App {
            root: None,
            revision: 0,
            service_id: "default".into(),
            domain_id: "default".into(),
            db: pool,
            upstream: Stalwart {
                http: reqwest::Client::new(),
                base: "https://mail.example.com".into(),
            },
            vault: Vault::new(&[4; 32]).unwrap(),
            origin: "https://webmail.example.com".into(),
            direct_origin: None,
            services: config::Services {
                domain: "example.com".into(),
                brand: "Aurora Mail".into(),
                notification_email: "support@example.com".into(),
                ..Default::default()
            },
        })
    }

    #[tokio::test]
    async fn defaults_are_non_empty_and_html_injection_rewrites_head() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        let app = test_app(&root).await;
        let site = load_metadata(&app).await.unwrap();
        assert_eq!(site.brand, "Aurora Mail");
        assert!(!site.tagline.is_empty());
        assert!(!site.favicon_url.is_empty());
        assert!(!site.apple_touch_icon_url.is_empty());
        assert!(!site.auth_background_url.is_empty());
        assert!(!site.seo_title.is_empty());
        assert!(!site.seo_description.is_empty());
        assert!(!site.seo_keywords.is_empty());
        assert!(!site.og_image_url.is_empty());
        assert_eq!(site.support_url, "mailto:support@example.com");

        let html = "<!DOCTYPE html><html><head><title>Old</title><meta name=\"description\" content=\"old\"/></head><body></body></html>";
        let out = inject_html_head(html, &site, &app.origin, "/login/");
        assert!(!out.contains("<title>Old</title>"));
        assert!(out.contains("<title>Aurora Mail - 现代安全邮箱工作台</title>"));
        assert!(out.contains(
            "property=\"og:image\" content=\"https://webmail.example.com/screenshot-1280x720.png\""
        ));
        assert!(out.contains("--auth-bg-image:url(\"/branding/auth-bg-default.svg\")"));
        assert!(out.contains("<link rel=\"manifest\" href=\"/manifest.webmanifest\"/>"));

        app.db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_svg_and_invalid_urls() {
        assert!(detect_image_mime("favicon", b"<svg onload=\"alert(1)\"></svg>").is_err());
        assert!(detect_image_mime("favicon", b"<svg><script>alert(1)</script></svg>").is_err());
        assert!(
            detect_image_mime(
                "favicon",
                b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
            )
            .is_ok()
        );
        assert!(valid_url("javascript:alert(1)", false, true).is_err());
        assert!(valid_url("//evil.example/bg.jpg", false, true).is_err());
        assert!(valid_url("/branding/bg.jpg", false, true).is_ok());
        assert!(valid_url("https://cdn.example.com/bg.webp", false, true).is_ok());
    }
}
