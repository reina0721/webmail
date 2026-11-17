//! Rust adaptation of Bulwark's pinned app/api/push/{preview,action}/route.ts.
//! SPDX-License-Identifier: AGPL-3.0-only
//! Original: Copyright 2026 Bulwark contributors. Local session/transport adaptation.
use super::*;
use chrono::Datelike;
use futures_util::StreamExt;
use std::collections::HashSet;

pub(crate) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/api/push/preview", get(preview))
        .route("/api/push/action", post(action))
        .route("/api/pwa-icon/{size}", get(icon))
        .layer(axum::extract::DefaultBodyLimit::max(4096))
}
fn fingerprint(app: &App, email: &str) -> String {
    hash(&format!(
        "{}/api/v1/native\n{}",
        app.origin,
        email.trim().to_lowercase()
    ))[..32]
        .into()
}
fn same_site(headers: &HeaderMap) -> Result<()> {
    if headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) != Some("same-origin") {
        return Err(Error(StatusCode::FORBIDDEN, "push_same_origin_required"));
    }
    Ok(())
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
async fn contexts(app: &App, headers: &HeaderMap) -> Vec<Identity> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    let mut primary = headers.clone();
    primary.remove("x-mail-account");
    if let Ok(me) = identify(app, &primary, false, false).await {
        seen.insert(me.user);
        output.push(me);
    }
    let prefix = app.cookie_name("session_");
    let names = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .filter_map(|c| c.trim().split_once('=').map(|(name, _)| name))
        .filter_map(|name| name.strip_prefix(&prefix))
        .take(50);
    for name in names {
        let Some(email) = hex::decode(name)
            .ok()
            .and_then(|v| String::from_utf8(v).ok())
            .filter(|s| s.len() <= 254)
        else {
            continue;
        };
        let Ok(value) = HeaderValue::from_str(&email) else {
            continue;
        };
        let mut selected = headers.clone();
        selected.insert("x-mail-account", value);
        if let Ok(me) = identify(app, &selected, false, false).await
            && seen.insert(me.user)
        {
            output.push(me);
        }
    }
    output
}
struct Target {
    identity: Identity,
    app: Arc<App>,
    account: String,
}
async fn target(
    app: &App,
    headers: &HeaderMap,
    account: Option<&str>,
    login: Option<&str>,
    action: bool,
) -> Result<Target> {
    if account.is_some_and(|v| !id(v)) {
        return Err(Error(StatusCode::BAD_REQUEST, "push_account_invalid"));
    }
    let mut candidates = Vec::new();
    for me in contexts(app, headers).await {
        if let Some(login) = login {
            let matches = if action {
                fingerprint(app, &me.email) == login
            } else {
                me.email.eq_ignore_ascii_case(login)
            };
            if !matches {
                continue;
            }
        }
        let scoped = connections::for_user(app, me.user).await?;
        let session = scoped.upstream.session(&me.key).await?;
        let requested = account.unwrap_or(&me.account);
        if session["accounts"].get(requested).is_some() {
            candidates.push(Target {
                account: requested.into(),
                identity: me,
                app: scoped,
            });
        }
        if account.is_none() {
            break;
        }
    }
    if candidates.len() > 1 {
        if candidates
            .iter()
            .map(|t| &t.app.service_id)
            .collect::<HashSet<_>>()
            .len()
            > 1
            && login.is_none()
        {
            return Err(Error(StatusCode::CONFLICT, "push_account_ambiguous"));
        }
        let owns = candidates
            .iter()
            .enumerate()
            .filter(|(_, t)| t.identity.account == t.account)
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        if owns.len() == 1 {
            return Ok(candidates.swap_remove(owns[0]));
        }
        return Err(Error(StatusCode::CONFLICT, "push_account_ambiguous"));
    }
    candidates
        .pop()
        .ok_or(Error(StatusCode::UNAUTHORIZED, "push_session_required"))
}
async fn call(target: &Target, method: &str, args: Value) -> Result<Value> {
    // Keep per-object failures: folder races can partially succeed and need
    // the same cleanup/retry behavior as the upstream notification handler.
    let response=target.app.upstream.http.post(format!("{}/jmap/",target.app.upstream.base)).bearer_auth(&target.identity.key).json(&json!({"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],"methodCalls":[[method,args,"push"]]})).send().await.map_err(|_|Error(StatusCode::BAD_GATEWAY,"push_upstream_unavailable"))?;
    if !response.status().is_success() {
        return Err(Error(StatusCode::BAD_GATEWAY, "push_upstream_unavailable"));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| Error(StatusCode::BAD_GATEWAY, "push_upstream_unavailable"))?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(Error(StatusCode::BAD_GATEWAY, "push_response_too_large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "push_response_invalid"))?;
    let result = value["methodResponses"]
        .as_array()
        .and_then(|v| v.first())
        .filter(|v| v[0] == method)
        .ok_or(Error(StatusCode::BAD_GATEWAY, "push_method_failed"))?;
    Ok(result[1].clone())
}
#[utoipa::path(get,path="/api/push/preview",params(("accountId"=Option<String>,Query),("emailId"=Option<String>,Query),("login"=Option<String>,Query)),responses((status=200,body=Value)))]
pub(crate) async fn preview(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    same_site(&headers)?;
    let requested_email = query.get("emailId").map(String::as_str);
    if requested_email.is_some_and(|v| !id(v)) {
        return Err(Error(StatusCode::BAD_REQUEST, "push_email_invalid"));
    }
    let target = target(
        &app,
        &headers,
        query.get("accountId").map(String::as_str),
        query.get("login").map(String::as_str),
        false,
    )
    .await?;
    policy::rate(
        &target.app,
        &format!("push-preview:{}", target.identity.user),
        120,
        60_000,
    )
    .await?;
    let inbox = call(
        &target,
        "Mailbox/query",
        json!({"accountId":target.account,"filter":{"role":"inbox"},"limit":1}),
    )
    .await?["ids"]
        .as_array()
        .and_then(|v| v.first())
        .cloned();
    let unread = if let Some(inbox) = inbox {
        call(&target,"Email/query",json!({"accountId":target.account,"filter":{"inMailbox":inbox,"notKeyword":"$seen"},"sort":[{"property":"receivedAt","isAscending":false}],"calculateTotal":true,"limit":1})).await?
    } else {
        json!({"ids":[],"total":0})
    };
    let ids = requested_email
        .map(|v| json!([v]))
        .unwrap_or_else(|| unread["ids"].clone());
    let found=call(&target,"Email/get",json!({"accountId":target.account,"ids":ids,"properties":["id","threadId","from","subject","preview","receivedAt"]})).await?;
    let email = found["list"]
        .as_array()
        .and_then(|v| v.first())
        .cloned()
        .unwrap_or(Value::Null);
    let total = unread["total"]
        .as_u64()
        .unwrap_or(0)
        .max(u64::from(!email.is_null()));
    let host = reqwest::Url::parse(&app.origin)
        .map_err(|_| internal("push_origin_invalid"))?
        .host_str()
        .unwrap_or("")
        .to_owned();
    Ok(Json(
        json!({"email":email,"unreadTotal":total,"login":fingerprint(&app,&target.identity.email),"nativeAccountId":format!("{}@{host}",target.identity.email)}),
    ))
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActionInput {
    action: String,
    account_id: String,
    email_id: String,
    login: String,
    #[serde(default)]
    archive_mode: String,
    #[serde(default)]
    time_zone: Option<String>,
}
fn archive_plan(
    mailboxes: &[Value],
    mode: &str,
    received: &str,
    zone: Option<&str>,
) -> Result<(String, Value)> {
    let archive = mailboxes
        .iter()
        .find(|m| m["role"] == "archive")
        .or_else(|| {
            mailboxes.iter().find(|m| {
                m["name"]
                    .as_str()
                    .is_some_and(|s| s.eq_ignore_ascii_case("archive"))
            })
        });
    let mut destination = archive
        .and_then(|m| m["id"].as_str())
        .unwrap_or("#archive")
        .to_owned();
    let mut create = json!({});
    if archive.is_none() {
        create["archive"] = json!({"name":"Archive","parentId":null,"role":"archive"});
    }
    if ["year", "month"].contains(&mode) {
        let date = chrono::DateTime::parse_from_rfc3339(received)
            .map_err(|_| Error(StatusCode::BAD_GATEWAY, "push_email_date_invalid"))?;
        let zone = zone
            .and_then(|z| z.parse::<chrono_tz::Tz>().ok())
            .unwrap_or(chrono_tz::UTC);
        let date = date.with_timezone(&zone);
        let parts = if mode == "month" {
            vec![
                (date.year().to_string(), "year"),
                (format!("{:02}", date.month()), "month"),
            ]
        } else {
            vec![(date.year().to_string(), "year")]
        };
        for (name, cid) in parts {
            let existing = if destination.starts_with('#') {
                None
            } else {
                mailboxes
                    .iter()
                    .find(|m| m["parentId"] == destination && m["name"] == name)
            };
            if let Some(existing) = existing {
                destination = existing["id"]
                    .as_str()
                    .ok_or_else(|| internal("push_folder_invalid"))?
                    .into();
            } else {
                create[cid] = json!({"name":name,"parentId":destination});
                destination = format!("#{cid}");
            }
        }
    }
    Ok((destination, create))
}
#[utoipa::path(post,path="/api/push/action",request_body=ActionInput,responses((status=200,body=Value)))]
pub(crate) async fn action(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<ActionInput>,
) -> Result<Json<Value>> {
    same_site(&headers)?;
    same_origin(&app, &headers)?;
    if !["mark-read", "archive"].contains(&input.action.as_str())
        || !id(&input.account_id)
        || !id(&input.email_id)
        || input.login.len() != 32
    {
        return Err(Error(StatusCode::BAD_REQUEST, "push_action_invalid"));
    }
    let target = target(
        &app,
        &headers,
        Some(&input.account_id),
        Some(&input.login),
        true,
    )
    .await?;
    policy::rate(
        &target.app,
        &format!("push-action:{}", target.identity.user),
        120,
        60_000,
    )
    .await?;
    let email=call(&target,"Email/get",json!({"accountId":target.account,"ids":[input.email_id],"properties":["id","receivedAt","mailboxIds"]})).await?["list"].as_array().and_then(|v|v.first()).cloned().ok_or(Error(StatusCode::NOT_FOUND,"push_email_not_found"))?;
    let folders = call(
        &target,
        "Mailbox/get",
        json!({"accountId":target.account,"properties":["id","name","parentId","role","myRights"]}),
    )
    .await?;
    let mut mailboxes = folders["list"]
        .as_array()
        .cloned()
        .ok_or_else(|| internal("push_folders_invalid"))?;
    if mailboxes.iter().any(|m| {
        ["trash", "junk"].contains(&m["role"].as_str().unwrap_or(""))
            && email["mailboxIds"]
                .get(m["id"].as_str().unwrap_or(""))
                .is_some()
    }) {
        return Err(Error(StatusCode::CONFLICT, "push_email_in_trash_or_junk"));
    }
    let mut created = Vec::new();
    let update = if input.action == "mark-read" {
        json!({"keywords/$seen":true})
    } else {
        let mut destination = String::new();
        for _ in 0..2 {
            let (planned, create) = archive_plan(
                &mailboxes,
                &input.archive_mode,
                email["receivedAt"].as_str().unwrap_or(""),
                input.time_zone.as_deref(),
            )?;
            if create.as_object().is_none_or(|m| m.is_empty()) {
                destination = planned;
                break;
            }
            let result = call(
                &target,
                "Mailbox/set",
                json!({"accountId":target.account,"create":create}),
            )
            .await?;
            for value in ["archive", "year", "month"]
                .iter()
                .filter_map(|key| result["created"].get(key))
            {
                if let Some(id) = value["id"].as_str() {
                    created.push(id.to_owned());
                }
            }
            mailboxes=call(&target,"Mailbox/get",json!({"accountId":target.account,"properties":["id","name","parentId","role","myRights"]})).await?["list"].as_array().cloned().ok_or_else(||internal("push_folders_invalid"))?;
            let (resolved, remaining) = archive_plan(
                &mailboxes,
                &input.archive_mode,
                email["receivedAt"].as_str().unwrap_or(""),
                input.time_zone.as_deref(),
            )?;
            if remaining.as_object().is_some_and(|m| m.is_empty()) {
                destination = resolved;
                break;
            }
        }
        if destination.is_empty() {
            return Err(Error(
                StatusCode::BAD_GATEWAY,
                "push_archive_folder_unavailable",
            ));
        }
        let mut ids = json!({});
        ids[&destination] = json!(true);
        json!({"mailboxIds":ids})
    };
    let mut updates = json!({});
    updates[&input.email_id] = update;
    let result = call(
        &target,
        "Email/set",
        json!({"accountId":target.account,"update":updates}),
    )
    .await?;
    if result["updated"].get(&input.email_id).is_none() {
        if !created.is_empty() {
            created.reverse();
            let _ = call(
                &target,
                "Mailbox/set",
                json!({"accountId":target.account,"destroy":created}),
            )
            .await;
        }
        return Err(Error(StatusCode::BAD_GATEWAY, "push_action_refused"));
    }
    Ok(Json(json!({"ok":true})))
}
async fn icon(Path(size): Path<String>) -> axum::response::Redirect {
    axum::response::Redirect::temporary(if size == "512" {
        "/icon-512x512.png"
    } else {
        "/icon-192x192.png"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_archive_uses_the_users_timezone_at_year_boundary() {
        let boxes = vec![
            json!({"id":"archive","name":"归档","role":"archive","parentId":null}),
            json!({"id":"previous-year","name":"2025","parentId":"archive"}),
        ];
        let (target, create) = archive_plan(
            &boxes,
            "month",
            "2026-01-01T00:30:00Z",
            Some("America/New_York"),
        )
        .unwrap();
        assert_eq!(target, "#month");
        assert_eq!(
            create,
            json!({"month":{"name":"12","parentId":"previous-year"}})
        );
        let (_, create) =
            archive_plan(&boxes, "year", "2026-01-01T00:30:00Z", Some("UTC")).unwrap();
        assert_eq!(create, json!({"year":{"name":"2026","parentId":"archive"}}));
        let (target, create) = archive_plan(&boxes, "single", "ignored", None).unwrap();
        assert_eq!(target, "archive");
        assert_eq!(create, json!({}));
    }
    #[test]
    fn worker_routes_require_real_same_origin_fetch_metadata() {
        let mut headers = HeaderMap::new();
        assert!(same_site(&headers).is_err());
        headers.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(same_site(&headers).is_err());
        headers.insert("sec-fetch-site", HeaderValue::from_static("same-origin"));
        assert!(same_site(&headers).is_ok());
        assert!(id("M_native-123"));
        assert!(!id("../other"));
        assert!(!id(""));
    }
}
