use super::*;
use subtle::ConstantTimeEq;
pub(super) const API: &str = "https://api.cloudflare.com/client/v4";
pub(super) fn hostname(origin: &str) -> Result<String> {
    let url = reqwest::Url::parse(origin)
        .map_err(|_| Error(StatusCode::BAD_REQUEST, "public_origin_invalid"))?;
    let host = url
        .host_str()
        .filter(|host| domain_valid(host))
        .ok_or(Error(
            StatusCode::BAD_REQUEST,
            "turnstile_hostname_required",
        ))?;
    Ok(host.to_owned())
}
async fn request_at(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value> {
    let mut request = client
        .request(method, format!("{base}{path}"))
        .bearer_auth(key);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "cloudflare_unavailable"))?;
    if !response.status().is_success() {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            match response.status().as_u16() {
                401 | 403 => "cloudflare_permission_denied",
                429 => "cloudflare_rate_limited",
                _ => "cloudflare_request_failed",
            },
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "cloudflare_response_invalid"))?;
    if value["success"] != true {
        return Err(Error(StatusCode::BAD_GATEWAY, "cloudflare_request_failed"));
    }
    Ok(value["result"].clone())
}
async fn widgets(app: &App, key: &str, endpoint: &str, base: &str) -> Result<Vec<Value>> {
    let mut widgets = Vec::new();
    for page in 1..=100 {
        let result = request_at(
            &app.upstream.http,
            base,
            key,
            reqwest::Method::GET,
            &format!("{endpoint}?per_page=100&page={page}"),
            None,
        )
        .await?;
        let items = result.as_array().ok_or(Error(
            StatusCode::BAD_GATEWAY,
            "cloudflare_response_invalid",
        ))?;
        widgets.extend(items.iter().cloned());
        if items.len() < 100 {
            return Ok(widgets);
        }
    }
    Err(Error(
        StatusCode::BAD_GATEWAY,
        "cloudflare_pagination_limit",
    ))
}
pub(super) fn account_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
pub(super) async fn accounts(app: &App, key: &str) -> Result<Value> {
    accounts_at(app, key, API).await
}
pub(super) async fn accounts_at(app: &App, key: &str, base: &str) -> Result<Value> {
    match request_at(
        &app.upstream.http,
        base,
        key,
        reqwest::Method::GET,
        "/accounts?per_page=50",
        None,
    )
    .await
    {
        Ok(value) => Ok(json!(
            value
                .as_array()
                .into_iter()
                .flatten()
                .map(|a| json!({"id":a["id"],"name":a["name"]}))
                .collect::<Vec<_>>()
        )),
        Err(Error(_, "cloudflare_permission_denied")) => Ok(json!([])),
        Err(e) => Err(e),
    }
}
pub(super) async fn validate(app: &App, key: &str, id: &str) -> Result<()> {
    validate_at(app, key, id, API).await
}
pub(super) async fn validate_at(app: &App, key: &str, id: &str, base: &str) -> Result<()> {
    if !account_id(id) || key.is_empty() {
        return Err(Error(
            StatusCode::BAD_REQUEST,
            "cloudflare_account_and_token_required",
        ));
    }
    request_at(
        &app.upstream.http,
        base,
        key,
        reqwest::Method::GET,
        &format!("/accounts/{id}/challenges/widgets?per_page=1"),
        None,
    )
    .await?;
    Ok(())
}

fn binding(account: &str, widget: &Value) -> Result<config::TurnstileBinding> {
    let invalid = || Error(StatusCode::BAD_GATEWAY, "cloudflare_response_invalid");
    let name = widget["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or_else(invalid)?;
    let hostnames = serde_json::from_value(widget["domains"].clone()).map_err(|_| invalid())?;
    Ok(config::TurnstileBinding {
        account_id: account.into(),
        widget_name: name.into(),
        hostnames,
        checked_at: db::now(),
    })
}

pub(super) async fn repair_at(
    app: &App,
    saved: &RuntimeConfig,
    key: &str,
    account: &str,
    host: &str,
    base: &str,
) -> Result<(config::TurnstileBinding, bool)> {
    let site = &saved.services.turnstile_site_key;
    let secret_matches = |widget: &Value| {
        widget["secret"].as_str().is_some_and(|secret| {
            bool::from(
                secret
                    .as_bytes()
                    .ct_eq(saved.services.turnstile_secret.as_bytes()),
            )
        })
    };
    let endpoint = format!("/accounts/{account}/challenges/widgets");
    let items = widgets(app, key, &endpoint, base).await?;
    if !items.iter().any(|widget| widget["sitekey"] == *site) {
        return Err(Error(StatusCode::CONFLICT, "turnstile_widget_missing"));
    }
    let path = format!("{endpoint}/{site}");
    let client = &app.upstream.http;
    let widget = request_at(client, base, key, reqwest::Method::GET, &path, None).await?;
    if widget["sitekey"] != *site {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            "cloudflare_response_invalid",
        ));
    }
    if !secret_matches(&widget) {
        return Err(Error(
            StatusCode::CONFLICT,
            "turnstile_widget_secret_mismatch",
        ));
    }
    let current = binding(account, &widget)?;
    if current.permits(host) {
        return Ok((current, false));
    }
    if current.hostnames.is_empty() {
        return Err(Error(StatusCode::CONFLICT, "turnstile_widget_unrestricted"));
    }
    let mode = widget["mode"]
        .as_str()
        .filter(|mode| matches!(*mode, "non-interactive" | "invisible" | "managed"))
        .ok_or(Error(
            StatusCode::BAD_GATEWAY,
            "cloudflare_response_invalid",
        ))?;
    let mut domains = current.hostnames;
    domains.push(host.into());
    let mut payload = json!({"domains":domains,"mode":mode,"name":current.widget_name});
    for field in [
        "bot_fight_mode",
        "clearance_level",
        "ephemeral_id",
        "offlabel",
        "region",
    ] {
        if let Some(value) = widget.get(field).filter(|value| !value.is_null()) {
            payload[field] = value.clone();
        }
    }
    let updated = request_at(
        client,
        base,
        key,
        reqwest::Method::PUT,
        &path,
        Some(payload),
    )
    .await?;
    let confirmed = binding(account, &updated)?;
    if updated["sitekey"] != *site
        || !secret_matches(&updated)
        || !domains
            .iter()
            .all(|domain| confirmed.hostnames.contains(domain))
    {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            "cloudflare_response_invalid",
        ));
    }
    Ok((confirmed, true))
}
pub(super) async fn create(app: &App, job: &mut Job, key: &str) -> Result<()> {
    create_at(app, job, key, API, &|job| journal::write(app, job)).await
}
pub(super) async fn create_at(
    app: &App,
    job: &mut Job,
    key: &str,
    base: &str,
    save: &(dyn Fn(&Job) -> Result<()> + Sync),
) -> Result<()> {
    let account = &job.spec.cloudflare_account;
    if account.is_empty() || !job.resource("turnstile").is_empty() {
        return Ok(());
    }
    let endpoint = format!("/accounts/{account}/challenges/widgets");
    let host = hostname(&job.spec.public_origin)?;
    let name = job.name("turnstile");
    // Reconcile by a unique per-installation name, exact host and creation snapshot.
    let items = widgets(app, key, &endpoint, base).await?;
    let candidates: Vec<_> = items.iter().filter(|w| w["name"] == name).collect();
    let widget = if candidates.is_empty() {
        job.pending.entry("turnstile".into()).or_default();
        save(job)?;
        request_at(
            &app.upstream.http,
            base,
            key,
            reqwest::Method::POST,
            &endpoint,
            Some(json!({"name":name,"domains":[host],"mode":"managed"})),
        )
        .await?
    } else if candidates.len() == 1
        && job.pending.contains_key("turnstile")
        && candidates[0]["domains"] == json!([host])
    {
        let site = candidates[0]["sitekey"]
            .as_str()
            .filter(|site| config::turnstile_key_valid(site))
            .ok_or_else(|| internal("turnstile_result_missing"))?;
        request_at(
            &app.upstream.http,
            base,
            key,
            reqwest::Method::GET,
            &format!("{endpoint}/{site}"),
            None,
        )
        .await?
    } else {
        return Err(Error(StatusCode::CONFLICT, "turnstile_resource_conflict"));
    };
    let site = widget["sitekey"]
        .as_str()
        .filter(|site| config::turnstile_key_valid(site))
        .ok_or_else(|| internal("turnstile_result_missing"))?;
    let secret = widget["secret"]
        .as_str()
        .filter(|v| config::turnstile_key_valid(v))
        .ok_or(Error(StatusCode::CONFLICT, "turnstile_secret_unavailable"))?;
    let binding = binding(account, &widget)?;
    if binding.widget_name != name || binding.hostnames != [host] {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            "cloudflare_response_invalid",
        ));
    }
    job.turnstile_binding = Some(binding);
    job.resources.insert("turnstile".into(), site.into());
    job.secrets.insert("turnstile".into(), secret.into());
    save(job)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn widget_hostname_requires_a_domain_without_origin_port_or_path() {
        assert_eq!(
            hostname("https://webmail.example.com:8088").unwrap(),
            "webmail.example.com"
        );
        for origin in [
            "http://85.155.115.98:8088",
            "http://[::1]:8088",
            "http://localhost:8088",
        ] {
            assert_eq!(
                hostname(origin).unwrap_err().1,
                "turnstile_hostname_required"
            );
        }
    }

    #[tokio::test]
    async fn cloudflare_transport_handles_create_permission_limit_redirect_and_timeout() {
        use axum::{extract::OriginalUri, http::StatusCode, response::IntoResponse};
        let router=Router::new().fallback(|OriginalUri(uri):OriginalUri,headers:HeaderMap,Json(body):Json<Value>|async move{
            assert_eq!(headers.get("authorization").unwrap(),"Bearer isolated-cloudflare-token");
            match uri.path(){
                "/forbidden"=>(StatusCode::FORBIDDEN,Json(json!({"success":false}))).into_response(),
                "/limited"=>(StatusCode::TOO_MANY_REQUESTS,Json(json!({"success":false}))).into_response(),
                "/redirect"=>(StatusCode::FOUND,[("location","https://unrelated.invalid/steal")]).into_response(),
                "/slow"=>{tokio::time::sleep(std::time::Duration::from_secs(2)).await;Json(json!({"success":true,"result":{}})).into_response()},
                _=>{assert_eq!(body["mode"],"managed");assert_eq!(body["domains"],json!(["webmail.example.com"]));Json(json!({"success":true,"result":{"sitekey":"isolated-sitekey","secret":"isolated-widget-secret"}})).into_response()}
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .unwrap();
        let base = format!("http://{address}");
        for (path, code) in [
            ("/forbidden", "cloudflare_permission_denied"),
            ("/limited", "cloudflare_rate_limited"),
            ("/redirect", "cloudflare_request_failed"),
            ("/slow", "cloudflare_unavailable"),
        ] {
            let error = request_at(
                &client,
                &base,
                "isolated-cloudflare-token",
                reqwest::Method::POST,
                path,
                Some(json!({})),
            )
            .await
            .unwrap_err();
            assert_eq!(error.1, code);
        }
        let widget = request_at(
            &client,
            &base,
            "isolated-cloudflare-token",
            reqwest::Method::POST,
            "/widgets",
            Some(json!({"mode":"managed","domains":["webmail.example.com"]})),
        )
        .await
        .unwrap();
        assert_eq!(widget["sitekey"], "isolated-sitekey");
        assert_eq!(widget["secret"], "isolated-widget-secret");
        server.abort();
    }
    #[test]
    fn account_paths_reject_injection() {
        for value in [
            "../widgets",
            "account?token=secret",
            "",
            "https://example.com",
        ] {
            assert!(!super::account_id(value));
        }
        assert!(super::account_id("0123456789abcdef0123456789abcdef"));
    }
}
