use super::*;

#[derive(Clone, Copy)]
pub(crate) struct Access<'a> {
    pub origin: &'a str,
    pub direct: bool,
}

impl Access<'_> {
    pub fn cookie_name(self, kind: &str) -> String {
        let prefix = if self.origin.starts_with("https://") {
            "__Host-"
        } else {
            ""
        };
        format!("{prefix}mail_{kind}")
    }

    pub fn cookie_security(self) -> &'static str {
        if self.origin.starts_with("https://") {
            "; Secure"
        } else {
            ""
        }
    }

    pub fn session_digest(self, token: &str) -> String {
        if self.direct {
            hash(&format!("direct-session:{}:{token}", self.origin))
        } else {
            hash(token)
        }
    }
}

/// Match an authority against configured origins. Forwarded headers are not
/// consulted. The HTTPS reverse proxy preserves Host and terminates TLS.
pub(crate) fn request<'a>(app: &'a App, headers: &HeaderMap) -> Result<Access<'a>> {
    let mut hosts = headers.get_all("host").iter();
    let host = hosts
        .next()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<axum::http::uri::Authority>().ok())
        .filter(|value| !value.as_str().contains(['@', '%']))
        .filter(|_| hosts.next().is_none())
        .ok_or(Error(StatusCode::FORBIDDEN, "origin_invalid"))?;
    if matches_authority(&app.origin, &host) {
        return Ok(Access {
            origin: &app.origin,
            direct: false,
        });
    }
    if let Some(origin) = backup_url(app)
        && matches_authority(origin, &host)
    {
        return Ok(Access {
            origin,
            direct: true,
        });
    }
    Err(Error(StatusCode::FORBIDDEN, "origin_invalid"))
}

fn matches_authority(origin: &str, host: &axum::http::uri::Authority) -> bool {
    reqwest::Url::parse(origin).is_ok_and(|origin| {
        let default_port = match origin.scheme() {
            "http" => 80,
            "https" => 443,
            _ => return false,
        };
        if host.port().is_some() && host.port_u16().is_none() {
            return false;
        }
        let hostname = host.host();
        let same_hostname = origin.host_str().is_some_and(|expected| {
            expected.eq_ignore_ascii_case(hostname)
                || expected
                    .trim_matches(['[', ']'])
                    .parse::<std::net::Ipv6Addr>()
                    .ok()
                    .zip(
                        hostname
                            .trim_matches(['[', ']'])
                            .parse::<std::net::Ipv6Addr>()
                            .ok(),
                    )
                    .is_some_and(|(a, b)| a == b)
        });
        same_hostname
            && origin.port_or_known_default() == Some(host.port_u16().unwrap_or(default_port))
    })
}

pub(crate) fn backup_url(app: &App) -> Option<&str> {
    let backup = app.direct_origin.as_deref()?;
    let authority = backup.strip_prefix("http://")?.parse().ok()?;
    (!matches_authority(&app.origin, &authority)).then_some(backup)
}

pub(crate) fn require_primary(app: &App, headers: &HeaderMap) -> Result<()> {
    if request(app, headers)?.direct {
        return Err(Error(StatusCode::FORBIDDEN, "primary_origin_required"));
    }
    Ok(())
}
