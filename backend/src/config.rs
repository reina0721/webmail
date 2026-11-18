#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Services {
    pub domain: String,
    pub brand: String,
    pub provisioning_key: String,
    pub notification_key: String,
    pub notification_account: String,
    pub notification_email: String,
    pub domain_id: String,
    pub turnstile_secret: String,
    pub turnstile_site_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turnstile_binding: Option<TurnstileBinding>,
    pub hook_secret: String,
    pub hook_id: String,
    pub policy_verified: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TurnstileBinding {
    pub account_id: String,
    pub widget_name: String,
    pub hostnames: Vec<String>,
    pub checked_at: i64,
}
impl TurnstileBinding {
    pub fn permits(&self, host: &str) -> bool {
        self.hostnames.iter().any(|allowed| {
            let allowed = allowed.to_ascii_lowercase();
            host == allowed
                || host
                    .strip_suffix(&allowed)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        })
    }
}
fn secret(name: &str) -> String {
    std::env::var(name)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default()
        .trim()
        .to_string()
}
impl Services {
    pub fn load() -> Self {
        Self {
            domain: std::env::var("MAIL_DOMAIN")
                .unwrap_or_default()
                .trim()
                .to_lowercase(),
            brand: std::env::var("SITE_NAME").unwrap_or_else(|_| "Mail Web".into()),
            provisioning_key: secret("PROVISIONING_KEY_FILE"),
            notification_key: secret("NOTIFICATION_KEY_FILE"),
            notification_account: std::env::var("NOTIFICATION_ACCOUNT_ID").unwrap_or_default(),
            notification_email: std::env::var("NOTIFICATION_EMAIL").unwrap_or_default(),
            domain_id: std::env::var("STALWART_DOMAIN_ID").unwrap_or_default(),
            turnstile_secret: secret("TURNSTILE_SECRET_FILE"),
            turnstile_site_key: std::env::var("TURNSTILE_SITE_KEY").unwrap_or_default(),
            turnstile_binding: None,
            hook_secret: secret("MTA_HOOK_SECRET_FILE"),
            hook_id: std::env::var("STALWART_HOOK_ID").unwrap_or_default(),
            policy_verified: std::env::var("MTA_POLICY_VERIFIED").as_deref() == Ok("true"),
        }
    }
    pub fn ready(&self) -> bool {
        self.mail_ready() && self.turnstile_ready()
    }
    pub fn turnstile_ready(&self) -> bool {
        turnstile_key_valid(&self.turnstile_site_key) && turnstile_key_valid(&self.turnstile_secret)
    }
    pub fn mail_ready(&self) -> bool {
        !self.domain.is_empty()
            && !self.provisioning_key.is_empty()
            && !self.notification_key.is_empty()
            && !self.notification_account.is_empty()
            && self
                .notification_email
                .rsplit_once('@')
                .is_some_and(|(local, domain)| !local.is_empty() && !domain.is_empty())
            && !self.notification_email.chars().any(char::is_whitespace)
            && !self.domain_id.is_empty()
            && !self.hook_secret.is_empty()
            && !self.hook_id.is_empty()
    }
    pub fn address(&self, name: &str) -> String {
        format!("{name}@{}", self.domain)
    }
    pub fn is_local_address(&self, address: &str) -> bool {
        !self.domain.is_empty()
            && address
                .rsplit_once('@')
                .is_some_and(|(_, domain)| domain.eq_ignore_ascii_case(&self.domain))
    }
}

pub fn origin() -> Result<String, Box<dyn std::error::Error>> {
    let value = std::env::var("PUBLIC_ORIGIN")?;
    validate_origin(&value)
}
pub fn validate_origin(value: &str) -> Result<String, Box<dyn std::error::Error>> {
    let url = reqwest::Url::parse(value)?;
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    let allow_http = loopback || std::env::var("ALLOW_HTTP").as_deref() == Ok("true");
    if !(url.scheme() == "https" || (allow_http && url.scheme() == "http"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "PUBLIC_ORIGIN must be an HTTPS origin (HTTP is allowed only for loopback development)"
                .into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}
pub fn direct_access() -> Option<String> {
    let bind = std::env::var("LISTEN_ADDRESS").ok()?;
    let bind = bind.trim_matches(['[', ']']).parse().ok()?;
    let port = std::env::var("PORT").ok()?.parse().ok()?;
    let allow_http = std::env::var("ALLOW_HTTP").as_deref() == Ok("true");
    let configured = std::env::var("DIRECT_ACCESS_ORIGIN").unwrap_or_default();
    mailweb_shared::direct_origin(bind, port, allow_http, &configured).unwrap_or_else(|error| {
        tracing::warn!(error, "DIRECT_ACCESS_ORIGIN ignored");
        None
    })
}

pub fn upstream(origin: &str) -> Result<String, Box<dyn std::error::Error>> {
    let value = std::env::var("STALWART_URL")?;
    let url = reqwest::Url::parse(&value)?;
    let isolated = origin.starts_with("http://")
        && std::env::var("ALLOW_INSECURE_TEST_UPSTREAM").as_deref() == Ok("true");
    if !(url.scheme() == "https" || (isolated && url.scheme() == "http"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("STALWART_URL must be an HTTPS base origin; insecure upstream is restricted to explicit loopback tests".into());
    }
    Ok(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::Services;
    #[test]
    fn mail_identity_uses_only_the_configured_domain() {
        let first = Services {
            domain: "alpha.example".into(),
            ..Services::default()
        };
        let second = Services {
            domain: "beta.example".into(),
            ..Services::default()
        };
        assert_eq!(first.address("operator"), "operator@alpha.example");
        assert_eq!(second.address("operator"), "operator@beta.example");
        assert!(first.is_local_address("user@ALPHA.EXAMPLE"));
        assert!(!first.is_local_address("user@beta.example"));
        assert!(!first.is_local_address("user@not-alpha.example"));
        assert!(!Services::default().is_local_address("user@"));
    }
}

// Basic syntax only; successful Siteverify and mail delivery remain mandatory.
pub fn turnstile_key_valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
#[cfg(test)]
mod turnstile_tests {
    use super::*;
    #[test]
    fn rejects_urls_and_whitespace_as_widget_keys() {
        for invalid in [
            "",
            "http://85.155.115.98:8088",
            "https://example.com",
            "key with spaces",
            "key\n",
        ] {
            assert!(!turnstile_key_valid(invalid));
            let services = Services {
                turnstile_site_key: invalid.into(),
                turnstile_secret: "secret".into(),
                ..Default::default()
            };
            assert!(!services.turnstile_ready());
        }
        assert!(turnstile_key_valid("0x4AAAAAA_example-key"));
    }
}
