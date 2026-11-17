//! Rust transport for Bulwark's fetch-ical contract.
//! Address policy ported from Bulwark lib/security/{url-guard,ip-ranges}.ts
//! at 7cdedb60cc157cfeaf19623732b1135da6d3dc28 (AGPL-3.0-only).
use super::*;
use futures_util::StreamExt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
const MAX_BYTES: usize = 25 * 1024 * 1024;
#[derive(Deserialize, ToSchema)]
pub(super) struct FeedInput {
    url: Option<String>,
    #[serde(rename = "feedId")]
    feed_id: Option<String>,
}
fn private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    matches!(a, 0 | 10 | 127)
        || a >= 224
        || a == 169 && b == 254
        || a == 172 && (16..=31).contains(&b)
        || a == 192 && (b == 168 || b == 0 && matches!(c, 0 | 2) || b == 88 && c == 99)
        || a == 198 && ((18..=19).contains(&b) || b == 51 && c == 100)
        || a == 203 && b == 0 && c == 113
        || a == 100 && (64..=127).contains(&b)
}
fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => private_v4(v),
        IpAddr::V6(v) => {
            let g = v.segments();
            if v.is_unspecified()
                || v.is_loopback()
                || (g[0] & 0xff00) == 0xff00
                || (g[0] & 0xffc0) == 0xfe80
                || (g[0] & 0xfe00) == 0xfc00
                || g[0] == 0x2001 && g[1] == 0
                || g[0] == 0x2001 && g[1] == 0xdb8
                || g[0] == 0x64 && g[1] == 0xff9b && g[2] == 1
            {
                return true;
            }
            let embedded = if g[..5] == [0; 5] && g[5] == 0xffff
                || g[..6] == [0; 6]
                || g[..6] == [0x64, 0xff9b, 0, 0, 0, 0]
            {
                Some((g[6], g[7]))
            } else if g[0] == 0x2002 {
                Some((g[1], g[2]))
            } else {
                None
            };
            embedded.is_some_and(|(a, b)| {
                private_v4(Ipv4Addr::new(
                    (a >> 8) as u8,
                    a as u8,
                    (b >> 8) as u8,
                    b as u8,
                ))
            })
        }
    }
}
fn allowed_url(url: &reqwest::Url) -> bool {
    let host = url
        .host_str()
        .unwrap_or("")
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    matches!(url.scheme(), "http" | "https")
        && !host.is_empty()
        && host != "localhost"
        && host.contains('.')
        || matches!(url.scheme(), "http" | "https") && host.parse::<IpAddr>().is_ok()
}
async fn addresses(url: &reqwest::Url) -> Result<(String, Vec<SocketAddr>)> {
    let host = url
        .host_str()
        .unwrap_or("")
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    if !allowed_url(url)
        || [".localhost", ".local", ".internal", ".arpa", ".localdomain"]
            .iter()
            .any(|s| host.ends_with(s))
    {
        return Err(Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"));
    }
    let port = url
        .port_or_known_default()
        .ok_or(Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        if private_ip(ip) {
            return Err(Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"));
        }
        return Ok((host, vec![SocketAddr::new(ip, port)]));
    }
    let doh = std::env::var("MAIL_WEB_CALENDAR_DOH").unwrap_or_default();
    let ips: Vec<SocketAddr> = if doh.is_empty() {
        tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"))?
            .collect()
    } else {
        // The resolver is installation-controlled; URL callers cannot select it.
        let resolver = reqwest::Url::parse(&doh).map_err(|_| internal("calendar_resolver"))?;
        if resolver.scheme() != "https"
            || !resolver.username().is_empty()
            || resolver.password().is_some()
        {
            return Err(internal("calendar_resolver"));
        }
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|_| internal("calendar_resolver"))?;
        let query = |kind: &'static str| {
            let mut url = resolver.clone();
            url.query_pairs_mut()
                .append_pair("name", &host)
                .append_pair("type", kind);
            let http = &http;
            async move {
                let response = http
                    .get(url)
                    .header("accept", "application/dns-json")
                    .send()
                    .await
                    .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"))?;
                if !response.status().is_success() {
                    return Err(Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"));
                }
                let mut bytes = Vec::new();
                let mut chunks = response.bytes_stream();
                while let Some(chunk) = chunks.next().await {
                    let chunk = chunk
                        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"))?;
                    if bytes.len() + chunk.len() > 65536 {
                        return Err(Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                let answer: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"))?;
                if answer["Status"] != 0 {
                    return Err(Error(StatusCode::BAD_GATEWAY, "calendar_lookup_failed"));
                }
                Ok::<Vec<SocketAddr>, Error>(
                    answer["Answer"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|r| r["type"] == 1 || r["type"] == 28)
                        .filter_map(|r| r["data"].as_str()?.parse::<IpAddr>().ok())
                        .map(|ip| SocketAddr::new(ip, port))
                        .collect(),
                )
            }
        };
        let (a, b) = futures_util::future::try_join(query("A"), query("AAAA")).await?;
        a.into_iter().chain(b).collect()
    };
    if ips.is_empty() || ips.iter().any(|v| private_ip(v.ip())) {
        return Err(Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"));
    }
    Ok((host, ips))
}
async fn fetch(mut url: reqwest::Url) -> Result<Response> {
    use base64::Engine;
    let original = url.origin();
    let auth = if !url.username().is_empty() || url.password().is_some() {
        let username = urlencoding::decode(url.username())
            .map_err(|_| Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
        let password = urlencoding::decode(url.password().unwrap_or(""))
            .map_err(|_| Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
        Some(format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
        ))
    } else {
        None
    };
    url.set_username("")
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
    url.set_password(None)
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
    for hop in 0..=5 {
        let (host, ips) = addresses(&url).await?;
        // Pin the checked DNS answer into the connection and ignore ambient proxies.
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(15))
            .resolve_to_addrs(&host, &ips)
            .build()
            .map_err(|_| internal("calendar_client"))?;
        let mut request = http
            .get(url.clone())
            .header("accept", "text/calendar, application/ics, text/plain")
            .header("user-agent", "Mail-Web-Calendar");
        if let Some(auth) = &auth
            && url.origin() == original
        {
            request = request.header("authorization", auth);
        }
        let response = request
            .send()
            .await
            .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_fetch_failed"))?;
        if response.status().is_redirection() {
            if hop == 5 {
                return Err(Error(StatusCode::BAD_GATEWAY, "calendar_redirect_limit"));
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or(Error(StatusCode::BAD_GATEWAY, "calendar_redirect_invalid"))?;
            url = url
                .join(location)
                .map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_redirect_invalid"))?;
            if !url.username().is_empty() || url.password().is_some() {
                return Err(Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"));
            }
            continue;
        }
        if !response.status().is_success() {
            return Err(Error(StatusCode::BAD_GATEWAY, "calendar_remote_rejected"));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err(Error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "calendar_feed_too_large",
            ));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| Error(StatusCode::BAD_GATEWAY, "calendar_fetch_failed"))?;
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(Error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "calendar_feed_too_large",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
        if !head
            .trim_start_matches('\u{feff}')
            .trim_start()
            .to_ascii_uppercase()
            .starts_with("BEGIN:VCALENDAR")
        {
            return Err(Error(StatusCode::BAD_GATEWAY, "calendar_content_invalid"));
        }
        return Ok((
            [
                ("content-type", "text/calendar; charset=utf-8"),
                ("cache-control", "private, no-store"),
            ],
            bytes,
        )
            .into_response());
    }
    Err(Error(StatusCode::BAD_GATEWAY, "calendar_fetch_failed"))
}
#[utoipa::path(post,path="/api/v1/client/calendar-feed",request_body=FeedInput,responses((status=200,description="iCalendar feed",content_type="text/calendar")))]
pub(super) async fn feed(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<FeedInput>,
) -> Result<Response> {
    let me = identity(&app, &headers, true).await?;
    policy::rate(&app, &format!("calendar-feed:{}", me.user), 60, 60000).await?;
    if input.feed_id.is_some() {
        return Err(Error(StatusCode::NOT_FOUND, "calendar_feed_unknown"));
    }
    let raw = input
        .url
        .filter(|u| u.len() <= 8192)
        .ok_or(Error(StatusCode::BAD_REQUEST, "calendar_url_required"))?;
    let url = reqwest::Url::parse(&raw)
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "calendar_url_disallowed"))?;
    static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
    let _permit = tokio::time::timeout(std::time::Duration::from_secs(5), SLOTS.acquire())
        .await
        .map_err(|_| Error(StatusCode::SERVICE_UNAVAILABLE, "calendar_fetch_busy"))?
        .map_err(|_| internal("calendar_slots"))?;
    tokio::time::timeout(std::time::Duration::from_secs(15), fetch(url))
        .await
        .map_err(|_| Error(StatusCode::GATEWAY_TIMEOUT, "calendar_fetch_timeout"))?
}
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/client/calendar-feed", post(feed))
        .layer(axum::extract::DefaultBodyLimit::max(16384))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ported_address_guard_covers_embedded_private_ranges() {
        for v in [
            "127.0.0.2",
            "10.1.2.3",
            "169.254.169.254",
            "100.127.0.1",
            "192.168.1.1",
            "198.19.0.1",
            "224.1.1.1",
            "::1",
            "::ffff:7f00:1",
            "2002:7f00:1::",
            "64:ff9b::a00:1",
            "2001:db8::1",
            "fd00:ec2::254",
        ] {
            assert!(private_ip(v.parse().unwrap()), "{v}");
        }
        for v in [
            "1.1.1.1",
            "8.8.8.8",
            "2606:4700:4700::1111",
            "64:ff9b::808:808",
        ] {
            assert!(!private_ip(v.parse().unwrap()), "{v}");
        }
    }
}
