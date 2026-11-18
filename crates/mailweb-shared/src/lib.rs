//! Address rules shared by the server and host manager.
pub mod deployment;

use std::net::{IpAddr, SocketAddr};

/// The browser URL of the single allowed HTTP backup endpoint.
pub fn direct_origin(
    bind: IpAddr,
    port: u16,
    allow_http: bool,
    configured: &str,
) -> Result<Option<String>, &'static str> {
    let configured = configured.trim();
    if !allow_http && !bind.is_loopback() {
        return Ok(None);
    }
    let endpoint = if configured.is_empty() {
        if bind.is_unspecified() || port == 0 {
            return Ok(None);
        }
        SocketAddr::new(bind, port)
    } else {
        let authority = configured
            .strip_prefix("http://")
            .ok_or("expected an HTTP IP address and port")?;
        let authority = authority.strip_suffix('/').unwrap_or(authority);
        let endpoint = authority
            .parse::<SocketAddr>()
            .or_else(|_| {
                authority
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .parse::<IpAddr>()
                    .map(|ip| SocketAddr::new(ip, 80))
            })
            .map_err(|_| "expected an HTTP IP address and port")?;
        if endpoint.port() != port
            || port == 0
            || endpoint.ip().is_unspecified()
            || endpoint.ip().is_multicast()
            || (bind != endpoint.ip()
                && !(bind.is_unspecified() && bind.is_ipv4() == endpoint.is_ipv4()))
        {
            return Err("backup address must match the listener and published port");
        }
        endpoint
    };
    let authority = match (endpoint.ip(), endpoint.port()) {
        (IpAddr::V4(ip), 80) => ip.to_string(),
        (IpAddr::V6(ip), 80) => format!("[{ip}]"),
        _ => endpoint.to_string(),
    };
    Ok(Some(format!("http://{authority}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_only_the_configured_listener() {
        let direct = |bind: &str, allowed, configured| {
            direct_origin(bind.parse().unwrap(), 8088, allowed, configured)
        };
        assert_eq!(
            direct("192.0.2.1", true, "").unwrap().as_deref(),
            Some("http://192.0.2.1:8088")
        );
        assert_eq!(
            direct("::1", false, "").unwrap().as_deref(),
            Some("http://[::1]:8088")
        );
        assert_eq!(direct("192.0.2.1", false, "").unwrap(), None);
        assert_eq!(direct("0.0.0.0", true, "").unwrap(), None);
        assert_eq!(
            direct("::", true, "http://[2001:db8::5]:8088/")
                .unwrap()
                .as_deref(),
            Some("http://[2001:db8::5]:8088")
        );
        for bad in [
            "http://example.com:8088",
            "http://192.0.2.2:8089",
            "http://0.0.0.0:8088",
            "https://192.0.2.2:8088",
        ] {
            assert!(direct("0.0.0.0", true, bad).is_err(), "{bad}");
        }
        assert!(direct("192.0.2.1", true, "http://192.0.2.2:8088").is_err());
    }
}
