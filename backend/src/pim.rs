//! Session-bound JMAP transport for personal information and files.
//! Never exposes platform directory credentials or accepts a client-supplied upstream URL.
use super::*;
use axum::body::Body;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/jmap/session", get(session))
        .route("/jmap", post(call))
        .route("/client/account", post(personal_account))
        .route(
            "/admin/directory",
            get(directory_policy).put(save_directory_policy),
        )
        .route("/client/policy", get(client_policy))
        .route(
            "/admin/client-policy",
            get(admin_client_policy).put(save_client_policy),
        )
        .route("/client/submissions", get(submission_records))
        .route(
            "/client/submissions/{id}/reconcile",
            post(reconcile_submission),
        )
        .route("/jmap/upload/{account}", post(raw_upload))
        .route("/jmap/download/{account}/{blob}/{name}", get(raw_download))
        .route("/jmap/events", get(native_events))
        .route(
            "/client/preferences",
            get(preferences).put(save_preferences),
        )
        .route("/files/{account}/{id}/content", get(content))
        .layer(axum::extract::DefaultBodyLimit::max(21 * 1024 * 1024))
}
// Explicit personal-account methods only. Never forwards administrative x:* calls.
fn allowed(method: &str) -> bool {
    let Some((kind, action)) = method.split_once('/') else {
        return false;
    };
    match kind {
        "Core" => action == "echo",
        "PushSubscription" => ["get", "set"].contains(&action),
        // Personal deleted-item recovery is an upstream user capability. It
        // still runs with the mailbox's own key, never directory credentials.
        "x:ArchivedItem" => ["get", "query", "set"].contains(&action),
        "Calendar"
        | "CalendarEvent"
        | "CalendarEventNotification"
        | "AddressBook"
        | "ContactCard"
        | "FileNode"
        | "Mailbox"
        | "Email"
        | "EmailSubmission"
        | "Identity"
        | "ParticipantIdentity"
        | "ShareNotification"
        | "SieveScript"
        | "VacationResponse" => [
            "get",
            "query",
            "changes",
            "queryChanges",
            "set",
            "copy",
            "import",
            "parse",
            "validate",
        ]
        .contains(&action),
        "Blob" => ["get", "lookup", "copy", "upload"].contains(&action),
        "Principal" => ["get", "query", "getAvailability"].contains(&action),
        "Thread" | "SearchSnippet" | "Quota" | "Keyword" => {
            ["get", "query", "changes", "queryChanges"].contains(&action)
        }
        _ => false,
    }
}
fn validate_accounts(value: &Value, accounts: &Value) -> Result<()> {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if ["#create", "#update", "#shareWith"].contains(&key.as_str()) {
                    return Err(Error(StatusCode::FORBIDDEN, "mutation_reference_forbidden"));
                }
                if ["accountId", "fromAccountId", "toAccountId"].contains(&key.as_str())
                    && !value.as_str().is_some_and(|id| accounts.get(id).is_some())
                {
                    return Err(Error(StatusCode::FORBIDDEN, "account_not_accessible"));
                }
                if ["#accountId", "#fromAccountId", "#toAccountId"].contains(&key.as_str()) {
                    return Err(Error(StatusCode::FORBIDDEN, "account_reference_forbidden"));
                }
                validate_accounts(value, accounts)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_accounts(item, accounts)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn validate_archive_call(method: &Value, args: &Value, own: &str) -> Result<()> {
    validate_accounts(args, &json!({own:{}}))?;
    if method == "x:ArchivedItem/set" {
        let valid = args.as_object().is_some_and(|fields| {
            fields
                .keys()
                .all(|key| ["accountId", "ifInState", "update"].contains(&key.as_str()))
                && fields
                    .get("update")
                    .and_then(Value::as_object)
                    .is_some_and(|updates| {
                        !updates.is_empty()
                            && updates.values().all(|patch| {
                                patch.as_object().is_some_and(|p| {
                                    p.len() == 1
                                        && p.get("status") == Some(&json!("requestRestore"))
                                })
                            })
                    })
        });
        if !valid {
            return Err(Error(StatusCode::FORBIDDEN, "archive_restore_only"));
        }
    }
    Ok(())
}
fn advertises_capability(session: &Value, capability: &str) -> bool {
    session["capabilities"].get(capability).is_some()
        || session["accounts"].as_object().is_some_and(|accounts| {
            accounts
                .values()
                .any(|account| account["accountCapabilities"].get(capability).is_some())
        })
}
#[utoipa::path(get,path="/api/v1/jmap/session",operation_id="pim_session",responses((status=200,body=Value)))]
pub(super) async fn session(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let mut result = app.upstream.session(&me.key).await?;
    // Only relative local transports are advertised to the browser.
    result["apiUrl"] = json!("/api/v1/jmap");
    result["uploadUrl"] = json!("/api/v1/jmap/upload/{accountId}");
    result["downloadUrl"] = json!(format!(
        "/api/v1/jmap/download/{{accountId}}/{{blobId}}/{{name}}?type={{type}}&mailAccount={}",
        urlencoding::encode(&me.email)
    ));
    result["eventSourceUrl"] =
        json!("/api/v1/jmap/events?types={types}&closeafter={closeafter}&ping={ping}");
    // File storage keeps the server's upload ceiling; the separate mail policy applies to attachments.
    let attachment_limit = registration::settings(&app).await?["attachmentBytes"]
        .as_u64()
        .unwrap_or(20 * 1024 * 1024)
        .min(20 * 1024 * 1024);
    if let Some(accounts) = result["accounts"].as_object_mut() {
        for account in accounts.values_mut() {
            if let Some(mail) =
                account["accountCapabilities"]["urn:ietf:params:jmap:mail"].as_object_mut()
            {
                let upstream = mail
                    .get("maxSizeAttachmentsPerEmail")
                    .and_then(Value::as_u64)
                    .filter(|v| *v > 0)
                    .unwrap_or(attachment_limit);
                mail.insert(
                    "maxSizeAttachmentsPerEmail".into(),
                    json!(upstream.min(attachment_limit)),
                );
            }
        }
    }
    result["platformAccountId"] = json!(me.account);
    Ok(Json(result))
}
#[utoipa::path(post,path="/api/v1/jmap",request_body=Value,responses((status=200,body=Value),(status=429,description="Upstream rejected the request before execution; retry after backoff")))]
pub(super) async fn call(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(mut input): Json<Value>,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let session = app.upstream.session(&me.key).await?;
    let calls = input["methodCalls"]
        .as_array_mut()
        .ok_or(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"))?;
    if calls.is_empty() || calls.len() > 32 {
        return Err(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"));
    }
    let sharing_policy = read_client_policy(&app).await?;
    for method in calls {
        if !method.as_array().is_some_and(|m| m.len() == 3)
            || !method[0].as_str().is_some_and(allowed)
            || !method[1].is_object()
            || !method[2].is_string()
        {
            tracing::warn!(
                method = method[0].as_str().unwrap_or("invalid"),
                "native_jmap_method_rejected"
            );
            return Err(Error(StatusCode::FORBIDDEN, "jmap_method_forbidden"));
        }
        if method[1].get("accountId").is_none() {
            method[1]["accountId"] = json!(me.account);
        }
        validate_accounts(&method[1], &session["accounts"])?;
        if method[0]
            .as_str()
            .is_some_and(|m| m.starts_with("x:ArchivedItem/"))
        {
            validate_archive_call(&method[0], &method[1], &me.account)?;
        }
        validate_sharing_policy(&method[1], &sharing_policy)?;
    }
    let using = input["using"]
        .as_array()
        .ok_or(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"))?;
    if using.iter().any(|v| {
        v.as_str()
            .is_none_or(|s| !advertises_capability(&session, s))
    }) {
        return Err(Error(
            StatusCode::BAD_REQUEST,
            "jmap_capability_unsupported",
        ));
    }
    let automatic_write = input["methodCalls"].as_array().is_some_and(|calls| {
        calls.iter().any(|m| {
            ["SieveScript/set", "VacationResponse/set"].contains(&m[0].as_str().unwrap_or(""))
        })
    });
    if automatic_write {
        let methods = input["methodCalls"].as_array().unwrap();
        if methods.iter().any(|m| {
            !["SieveScript/set", "VacationResponse/set"].contains(&m[0].as_str().unwrap_or(""))
                || m[1]["accountId"] != me.account
        }) {
            return Err(Error(
                StatusCode::FORBIDDEN,
                "automatic_rule_account_mismatch",
            ));
        }
        gateway::provision::ensure_user(&app, me.user).await?;
        // Elevation must not let a caller read a foreign blob by installing it
        // as a script and downloading it through SieveScript/get afterwards.
        let mut blobs = HashMap::new();
        part_blobs(&input, &mut blobs);
        if !blobs.is_empty() {
            let found = app.upstream.call(&me.key,"Blob/get",json!({"accountId":me.account,"ids":blobs.keys().collect::<Vec<_>>(),"properties":["size"]})).await?;
            if found["list"]
                .as_array()
                .is_none_or(|list| list.len() != blobs.len())
            {
                return Err(Error(
                    StatusCode::FORBIDDEN,
                    "automatic_rule_blob_not_accessible",
                ));
            }
        }
    }
    let submission = input["methodCalls"].as_array().is_some_and(|calls| {
        calls
            .iter()
            .any(|m| m[0] == "EmailSubmission/set" && m[1].get("create").is_some())
    });
    let fingerprint = hex::encode(Sha256::digest(input.to_string().as_bytes()));
    let semantic_hash = submission_semantic_hash(&input);
    let mut submission_context = json!([]);
    let request_id = if submission {
        if app.services.hook_id.is_empty() {
            return Err(Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "submission_policy_missing",
            ));
        }
        let key = headers
            .get("idempotency-key")
            .and_then(|v| v.to_str().ok())
            .filter(|s| s.len() >= 16 && s.len() <= 128)
            .ok_or(Error(StatusCode::BAD_REQUEST, "idempotency_key_required"))?;
        if let Some(row) = db::query(db::Statement::NativeSubmissionGet)
            .bind(me.user)
            .bind(key)
            .fetch_optional(&app.db)
            .await?
        {
            if row.get::<String, _>("fingerprint") != fingerprint {
                return Err(Error(StatusCode::CONFLICT, "idempotency_conflict"));
            }
            if row.get::<String, _>("status") == "complete" {
                if row.get::<Option<String>, _>("response").is_none() {
                    return Err(Error(StatusCode::CONFLICT, "submission_record_archived"));
                }
                return Ok(Json(
                    serde_json::from_str(&row.get::<String, _>("response"))
                        .map_err(|_| internal("native_submission_result"))?,
                ));
            }
            return Err(Error(StatusCode::CONFLICT, "submission_check_required"));
        }
        if db::scalar::<String>(db::Statement::NativeSubmissionUnresolved)
            .bind(me.user)
            .bind(&semantic_hash)
            .fetch_optional(&app.db)
            .await?
            .is_some()
        {
            return Err(Error(StatusCode::CONFLICT, "submission_check_required"));
        }
        submission_context = check_submission_attachments(&app, &me, &input).await?;
        Some(key.to_string())
    } else {
        None
    };
    policy::rate(&app, &format!("jmap:{}", me.user), 600, 60000).await?;
    if let Some(key) = &request_id {
        let inserted = db::query(db::Statement::NativeSubmissionStart)
            .bind(me.user)
            .bind(key)
            .bind(fingerprint)
            .bind(db::now())
            .bind(submission_context.to_string())
            .bind(semantic_hash)
            .execute(&app.db)
            .await?
            .rows_affected();
        if inserted == 0 {
            return Err(Error(StatusCode::CONFLICT, "submission_check_required"));
        }
    }
    let response = app
        .upstream
        .http
        .post(format!("{}/jmap/", app.upstream.base))
        .bearer_auth(if automatic_write {
            &app.services.provisioning_key
        } else {
            &me.key
        })
        .json(&input)
        .send()
        .await;
    let result: Result<Value> = async {
        let response = response.map_err(|_| {
            Error(
                StatusCode::BAD_GATEWAY,
                if submission {
                    "submission_check_required"
                } else {
                    "mail_service_unavailable"
                },
            )
        })?;
        if response.status() == 401 {
            return Err(Error(StatusCode::UNAUTHORIZED, "credentials_invalid"));
        }
        if response.status() == 429 {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "upstream_rate_limited",
            ));
        }
        if !response.status().is_success() {
            return Err(Error(StatusCode::BAD_GATEWAY, "jmap_request_failed"));
        }
        response
            .json()
            .await
            .map_err(|_| Error(StatusCode::BAD_GATEWAY, "jmap_response_invalid"))
    }
    .await;
    match result {
        Ok(body) => {
            if let Some(key) = request_id {
                db::query(db::Statement::NativeSubmissionComplete)
                    .bind(body.to_string())
                    .bind(me.user)
                    .bind(key)
                    .execute(&app.db)
                    .await?;
            }
            Ok(Json(body))
        }
        Err(error) => {
            if let Some(key) = request_id {
                // An explicit HTTP 429 rejected the entire JMAP request
                // before execution; unlike a lost response it is safe to retry.
                let statement = if error.0 == StatusCode::TOO_MANY_REQUESTS {
                    db::Statement::NativeSubmissionRateLimited
                } else {
                    db::Statement::NativeSubmissionUnknown
                };
                db::query(statement)
                    .bind(me.user)
                    .bind(key)
                    .execute(&app.db)
                    .await?;
            }
            Err(error)
        }
    }
}
fn submission_semantic_hash(input: &Value) -> String {
    let mut content = Vec::new();
    for call in input["methodCalls"].as_array().into_iter().flatten() {
        let kind = call[0].as_str().unwrap_or("");
        if !["Email/set", "Email/import", "EmailSubmission/set"].contains(&kind) {
            continue;
        }
        let values = call[1][if kind == "Email/import" {
            "emails"
        } else {
            "create"
        }]
        .as_object();
        for value in values.into_iter().flat_map(|v| v.values()) {
            let mut value = value.clone();
            if let Some(fields) = value.as_object_mut() {
                fields.remove("messageId");
                fields.remove("sentAt");
                if fields
                    .get("emailId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id.starts_with('#'))
                {
                    fields.remove("emailId");
                }
            }
            content.push(json!({"method":kind,"accountId":call[1]["accountId"],"value":value}));
        }
    }
    hex::encode(Sha256::digest(json!(content).to_string().as_bytes()))
}
fn part_blobs(value: &Value, ids: &mut HashMap<String, i64>) {
    match value {
        Value::Object(fields) => {
            if let Some(id) = fields.get("blobId").and_then(Value::as_str) {
                *ids.entry(id.into()).or_default() += 1;
            }
            for value in fields.values() {
                part_blobs(value, ids);
            }
        }
        Value::Array(items) => {
            for value in items {
                part_blobs(value, ids);
            }
        }
        _ => {}
    }
}
async fn check_submission_attachments(app: &App, me: &Identity, input: &Value) -> Result<Value> {
    let mut context = Vec::new();
    let calls = input["methodCalls"]
        .as_array()
        .ok_or(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"))?;
    let limit = registration::settings(app).await?["attachmentBytes"]
        .as_i64()
        .unwrap_or(20971520)
        .min(20971520);
    for call in calls.iter().filter(|call| call[0] == "EmailSubmission/set") {
        let Some(created) = call[1]["create"].as_object() else {
            continue;
        };
        for (creation_id, submission) in created {
            let email_id = submission["emailId"]
                .as_str()
                .ok_or(Error(StatusCode::BAD_REQUEST, "submission_email_required"))?;
            let account = call[1]["accountId"].as_str().ok_or(Error(
                StatusCode::BAD_REQUEST,
                "submission_account_required",
            ))?;
            let email = if let Some(creation) = email_id.strip_prefix('#') {
                let source = calls
                    .iter()
                    .find(|m| {
                        (m[0] == "Email/set" || m[0] == "Email/import")
                            && m[1]["create"].get(creation).is_some()
                            || m[0] == "Email/import" && m[1]["emails"].get(creation).is_some()
                    })
                    .ok_or(Error(
                        StatusCode::BAD_REQUEST,
                        "submission_email_reference_invalid",
                    ))?;
                if source[0] == "Email/import" {
                    let source_email = source[1]["emails"]
                        .get(creation)
                        .or_else(|| source[1]["create"].get(creation))
                        .ok_or(Error(
                            StatusCode::BAD_REQUEST,
                            "submission_email_reference_invalid",
                        ))?;
                    let parsed=app.upstream.call(&me.key,"Email/parse",json!({"accountId":account,"blobIds":[source_email["blobId"]],"properties":["attachments","messageId"]})).await?;
                    parsed["parsed"][source_email["blobId"].as_str().unwrap_or("")].clone()
                } else {
                    source[1]["create"][creation].clone()
                }
            } else {
                let found = app
                    .upstream
                    .call(
                        &me.key,
                        "Email/get",
                        json!({"accountId":account,"ids":[email_id],"properties":["attachments","messageId"]}),
                    )
                    .await?;
                found["list"][0].clone()
            };
            if email.is_null() {
                return Err(Error(StatusCode::BAD_REQUEST, "submission_email_not_found"));
            }
            context.push(json!({"accountId":account,"emailId":if email_id.starts_with('#'){Value::Null}else{json!(email_id)},"messageId":email["messageId"],"creationId":creation_id}));
            let mut blobs = HashMap::new();
            part_blobs(&email, &mut blobs);
            if blobs.is_empty() {
                continue;
            }
            let found = app
                .upstream
                .call(
                    &me.key,
                    "Blob/get",
                    json!({"accountId":me.account,"ids":blobs.keys().collect::<Vec<_>>(),"properties":["size"]}),
                )
                .await?;
            let list = found["list"].as_array().ok_or(Error(
                StatusCode::BAD_GATEWAY,
                "attachment_metadata_unavailable",
            ))?;
            if list.len() != blobs.len() {
                return Err(Error(StatusCode::FORBIDDEN, "attachment_not_owned"));
            }
            let total = list
                .iter()
                .try_fold(0i64, |sum, blob| {
                    blob["size"]
                        .as_i64()
                        .filter(|n| *n >= 0)
                        .and_then(|n| n.checked_mul(*blobs.get(blob["id"].as_str()?).unwrap_or(&0)))
                        .and_then(|n| sum.checked_add(n))
                })
                .ok_or(Error(
                    StatusCode::BAD_GATEWAY,
                    "attachment_metadata_invalid",
                ))?;
            if total > limit {
                return Err(Error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "attachments_too_large",
                ));
            }
        }
    }
    Ok(json!(context))
}
#[utoipa::path(get,path="/api/v1/files/{account}/{id}/content",params(("account"=String,Path),("id"=String,Path)),responses((status=200,body=Value)))]
pub(super) async fn content(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((account, id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let session = app.upstream.session(&me.key).await?;
    if session["accounts"].get(&account).is_none() {
        return Err(Error(StatusCode::FORBIDDEN, "account_not_accessible"));
    }
    let node = query
        .get("node")
        .ok_or(Error(StatusCode::BAD_REQUEST, "file_node_required"))?;
    let body = json!({"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:filenode"],"methodCalls":[["FileNode/get",{"accountId":account,"ids":[node]},"file"]]});
    let r: Value = app
        .upstream
        .http
        .post(format!("{}/jmap/", app.upstream.base))
        .bearer_auth(&me.key)
        .json(&body)
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "mail_service_unavailable"))?
        .json()
        .await
        .map_err(|_| internal("file_metadata"))?;
    let file = &r["methodResponses"][0][1]["list"][0];
    if file["blobId"] != id {
        return Err(Error(StatusCode::NOT_FOUND, "file_not_found"));
    }
    let name = file["name"].as_str().unwrap_or("download");
    let kind = file["mediaType"]
        .as_str()
        .or(file["type"].as_str())
        .unwrap_or("application/octet-stream");
    let template = session["downloadUrl"]
        .as_str()
        .ok_or(Error(StatusCode::BAD_GATEWAY, "download_not_supported"))?;
    let target = template
        .replace("{accountId}", &urlencoding::encode(&account))
        .replace("{blobId}", &urlencoding::encode(&id))
        .replace("{name}", &urlencoding::encode(name))
        .replace("{type}", &urlencoding::encode(kind));
    let url = reqwest::Url::parse(&target).map_err(|_| internal("download_url"))?;
    let base = reqwest::Url::parse(&app.upstream.base).map_err(|_| internal("upstream_url"))?;
    if url.origin() != base.origin() {
        return Err(Error(StatusCode::BAD_GATEWAY, "download_origin_invalid"));
    }
    let r = app
        .upstream
        .http
        .get(url)
        .bearer_auth(&me.key)
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "download_failed"))?;
    if !r.status().is_success() {
        return Err(Error(StatusCode::NOT_FOUND, "file_not_found"));
    }
    let preview = query.get("preview").is_some_and(|v| v == "true")
        && matches!(
            kind,
            "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/webp"
                | "application/pdf"
                | "text/plain"
                | "audio/mpeg"
                | "video/mp4"
        );
    let mut response = Body::from_stream(r.bytes_stream()).into_response();
    for (k, v) in [
        (
            "content-type",
            if preview {
                kind
            } else {
                "application/octet-stream"
            }
            .to_string(),
        ),
        (
            "content-disposition",
            format!(
                "{}; filename*=UTF-8''{}",
                if preview { "inline" } else { "attachment" },
                urlencoding::encode(name)
            ),
        ),
        ("x-content-type-options", "nosniff".into()),
        ("cache-control", "no-store".into()),
        (
            "content-security-policy",
            "sandbox; default-src 'none'".into(),
        ),
    ] {
        response.headers_mut().insert(
            axum::http::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| internal("header"))?,
            HeaderValue::from_str(&v).map_err(|_| internal("header"))?,
        );
    }
    Ok(response)
}

async fn accessible(app: &App, me: &Identity, account: &str) -> Result<Value> {
    let session = app.upstream.session(&me.key).await?;
    if session["accounts"].get(account).is_none() {
        return Err(Error(StatusCode::FORBIDDEN, "account_not_accessible"));
    }
    Ok(session)
}
pub(crate) fn upload_response_error(response: &reqwest::Response) -> Option<Error> {
    if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
        return Some(Error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large"));
    }
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        let quota = response
            .headers()
            .get_all("ratelimit-policy")
            .iter()
            .any(|v| v.to_str().is_ok_and(|v| v.contains("blob-upload")));
        return Some(Error(
            StatusCode::TOO_MANY_REQUESTS,
            if quota {
                "upload_quota_exceeded"
            } else {
                "upstream_rate_limited"
            },
        ));
    }
    None
}
#[utoipa::path(post,path="/api/v1/jmap/upload/{account}",params(("account"=String,Path)),request_body=String,responses((status=200,body=Value),(status=413,description="Server upload size exceeded"),(status=429,description="Temporary upstream upload quota or request limit; retain the file for retry")))]
pub(super) async fn raw_upload(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(account): Path<String>,
    body: Body,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let session = accessible(&app, &me, &account).await?;
    let target = session["uploadUrl"]
        .as_str()
        .ok_or(Error(StatusCode::BAD_GATEWAY, "upload_not_supported"))?
        .replace("{accountId}", &urlencoding::encode(&account));
    let url = mail::checked_url(&app, &target)?;
    let limit = session["capabilities"]["urn:ietf:params:jmap:core"]["maxSizeUpload"]
        .as_u64()
        .filter(|n| *n > 0)
        .unwrap_or(20 * 1024 * 1024);
    if headers
        .get("content-length")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .is_some_and(|length| length > limit)
    {
        return Err(Error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large"));
    }
    let exceeded = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let exceeded_body = exceeded.clone();
    let mut chunks = body.into_data_stream();
    let stream = async_stream::try_stream! {
        let mut received=0u64;
        while let Some(chunk)=chunks.next().await {
            let chunk=chunk.map_err(std::io::Error::other)?;
            received=received.saturating_add(chunk.len() as u64);
            if received>limit {exceeded_body.store(true,std::sync::atomic::Ordering::Relaxed);Err(std::io::Error::other("upload limit exceeded"))?;}
            yield chunk;
        }
    };
    let stream = stream.map(|chunk: std::result::Result<axum::body::Bytes, std::io::Error>| chunk);
    let kind = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream");
    let response = app
        .upstream
        .http
        .post(url)
        .bearer_auth(&me.key)
        .header("content-type", kind)
        .timeout(std::time::Duration::from_secs(300))
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|_| {
            if exceeded.load(std::sync::atomic::Ordering::Relaxed) {
                Error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large")
            } else {
                Error(StatusCode::BAD_GATEWAY, "upload_failed")
            }
        })?;
    if let Some(error) = upload_response_error(&response) {
        return Err(error);
    }
    if !response.status().is_success() {
        return Err(Error(StatusCode::BAD_GATEWAY, "upload_failed"));
    }
    Ok(Json(response.json().await.map_err(|_| {
        Error(StatusCode::BAD_GATEWAY, "upload_result_invalid")
    })?))
}
#[utoipa::path(get,path="/api/v1/jmap/download/{account}/{blob}/{name}",params(("account"=String,Path),("blob"=String,Path),("name"=String,Path)),responses((status=200,body=String)))]
pub(super) async fn raw_download(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((account, blob, name)): Path<(String, String, String)>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response> {
    let mut headers = headers;
    if let Some(email) = q.get("mailAccount") {
        headers.insert(
            "x-mail-account",
            HeaderValue::from_str(email)
                .map_err(|_| Error(StatusCode::BAD_REQUEST, "account_selector_invalid"))?,
        );
    }
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let session = accessible(&app, &me, &account).await?;
    let kind = q
        .get("type")
        .map(String::as_str)
        .unwrap_or("application/octet-stream");
    let target = session["downloadUrl"]
        .as_str()
        .ok_or(Error(StatusCode::BAD_GATEWAY, "download_not_supported"))?
        .replace("{accountId}", &urlencoding::encode(&account))
        .replace("{blobId}", &urlencoding::encode(&blob))
        .replace("{name}", &urlencoding::encode(&name))
        .replace("{type}", &urlencoding::encode(kind));
    let response = app
        .upstream
        .http
        .get(mail::checked_url(&app, &target)?)
        // The ordinary 15-second RPC deadline would cut every SSE stream before its first heartbeat.
        // Connect remains bounded by the client; each streamed read is bounded below.
        .timeout(std::time::Duration::from_secs(86400))
        .bearer_auth(&me.key)
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "download_failed"))?;
    if !response.status().is_success() {
        return Err(Error(StatusCode::NOT_FOUND, "blob_not_found"));
    }
    Ok((
        [
            ("content-type", "application/octet-stream"),
            ("content-disposition", "attachment"),
            ("x-content-type-options", "nosniff"),
            ("cache-control", "private, no-store"),
        ],
        Body::from_stream(response.bytes_stream()),
    )
        .into_response())
}
#[utoipa::path(get,path="/api/v1/jmap/events",responses((status=200,body=String)))]
pub(super) async fn native_events(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Response> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let session = app.upstream.session(&me.key).await?;
    let target = session["eventSourceUrl"]
        .as_str()
        .ok_or(Error(StatusCode::BAD_GATEWAY, "events_not_supported"))?
        .replace(
            "{types}",
            "Email,Mailbox,EmailSubmission,Calendar,CalendarEvent,AddressBook,ContactCard,FileNode",
        )
        .replace("{closeafter}", "no")
        .replace("{ping}", "30");
    let request = app
        .upstream
        .http
        .get(mail::checked_url(&app, &target)?)
        // The ordinary 15-second RPC deadline would cut every SSE stream before its first heartbeat.
        // Connect remains bounded by the client; each streamed read is bounded below.
        .timeout(std::time::Duration::from_secs(86400))
        .bearer_auth(&me.key);
    let stream = async_stream::stream! {
        // Stalwart can wait until its first 30s heartbeat before flushing
        // response headers. Flush ours now so the browser's bounded header
        // deadline does not keep aborting an otherwise healthy event stream.
        yield Ok::<_,reqwest::Error>(axum::body::Bytes::from_static(b": connected\n\n"));
        let response = match tokio::time::timeout(std::time::Duration::from_secs(45),request.send()).await {
            Ok(Ok(response)) if response.status().is_success() => response,
            _ => {tracing::warn!("native_events_upstream_unavailable");return;}
        };
        let mut chunks=response.bytes_stream();while let Ok(Some(chunk))=tokio::time::timeout(std::time::Duration::from_secs(45),chunks.next()).await{
        let active:bool=db::scalar(db::Statement::MailEventsSelectSessions).bind(&me.session).bind(db::now()).bind(db::now()-1800000).fetch_one(&app.db).await.unwrap_or(false);
        if !active{break;}yield chunk;
    }};
    Ok((
        [
            ("content-type", "text/event-stream"),
            ("cache-control", "no-store"),
        ],
        Body::from_stream(stream.take_until(SHUTDOWN.clone().cancelled_owned())),
    )
        .into_response())
}
#[utoipa::path(get,path="/api/v1/client/preferences",operation_id="native_preferences",responses((status=200,body=Value)))]
pub(super) async fn preferences(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let saved: Option<String> = db::scalar(db::Statement::ClientPreferencesGet)
        .bind(me.user)
        .fetch_optional(&app.db)
        .await?;
    Ok(Json(
        saved
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(json!({})),
    ))
}
#[utoipa::path(put,path="/api/v1/client/preferences",operation_id="save_native_preferences",request_body=Value,responses((status=200,body=Value)))]
pub(super) async fn save_preferences(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    if !body.is_object() {
        return Err(Error(StatusCode::BAD_REQUEST, "preferences_invalid"));
    }
    db::query(db::Statement::ClientPreferencesPut)
        .bind(me.user)
        .bind(body.to_string())
        .bind(db::now())
        .execute(&app.db)
        .await?;
    Ok(Json(json!({"success":true})))
}
#[utoipa::path(post,path="/api/v1/client/account",request_body=Value,responses((status=200,body=Value)))]
pub(super) async fn personal_account(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(mut input): Json<Value>,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let calls = input["methodCalls"]
        .as_array_mut()
        .ok_or(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"))?;
    if calls.is_empty() || calls.len() > 16 {
        return Err(Error(StatusCode::BAD_REQUEST, "jmap_request_invalid"));
    }
    for call in calls {
        let method = call[0].as_str().unwrap_or("");
        if ![
            "x:AccountSettings/get",
            "x:AccountPassword/get",
            "x:AppPassword/get",
            "x:AppPassword/query",
            "x:AppPassword/set",
            "x:ApiKey/get",
            "x:ApiKey/query",
            "x:ApiKey/set",
        ]
        .contains(&method)
        {
            return Err(Error(
                StatusCode::FORBIDDEN,
                "personal_account_method_forbidden",
            ));
        }
        if call[1].get("accountId").is_some_and(|id| id != &me.account) {
            return Err(Error(StatusCode::FORBIDDEN, "account_not_accessible"));
        }
        if ["x:AppPassword/set", "x:ApiKey/set"].contains(&method) {
            restrict_personal_credentials(&mut call[1])?;
        }
        call[1]["accountId"] = json!(me.account);
        validate_accounts(&call[1], &json!({&me.account:{}}))?;
    }
    input["using"] = json!(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]);
    let response = app
        .upstream
        .http
        .post(format!("{}/jmap/", app.upstream.base))
        .bearer_auth(&me.key)
        .json(&input)
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "mail_service_unavailable"))?;
    if !response.status().is_success() {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            "personal_account_request_failed",
        ));
    }
    Ok(Json(response.json().await.map_err(|_| {
        Error(StatusCode::BAD_GATEWAY, "jmap_response_invalid")
    })?))
}
#[utoipa::path(get,path="/api/v1/client/submissions",responses((status=200,body=Value)))]
pub(super) async fn submission_records(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let rows = db::query(db::Statement::NativeSubmissionList)
        .bind(me.user)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<String,_>("request_id"),"status":r.get::<String,_>("status"),"createdAt":r.get::<i64,_>("created_at"),"checkedAt":r.get::<Option<i64>,_>("checked_at"),"outcome":r.get::<Option<String>,_>("outcome").and_then(|v|serde_json::from_str::<Value>(&v).ok())})).collect::<Vec<_>>()}),
    ))
}
#[utoipa::path(post,path="/api/v1/client/submissions/{id}/reconcile",params(("id"=String,Path)),responses((status=200,body=Value)))]
pub(super) async fn reconcile_submission(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let row = db::query(db::Statement::NativeSubmissionGet)
        .bind(me.user)
        .bind(&id)
        .fetch_optional(&app.db)
        .await?
        .ok_or(Error(StatusCode::NOT_FOUND, "submission_not_found"))?;
    let context: Value = serde_json::from_str(&row.get::<String, _>("context"))
        .map_err(|_| internal("submission_context"))?;
    let session = app.upstream.session(&me.key).await?;
    let mut matches = Vec::new();
    for entry in context.as_array().into_iter().flatten() {
        let account = entry["accountId"]
            .as_str()
            .ok_or(Error(StatusCode::BAD_GATEWAY, "submission_context_invalid"))?;
        if session["accounts"].get(account).is_none() {
            return Err(Error(StatusCode::FORBIDDEN, "account_not_accessible"));
        }
        let ids = if entry["emailId"].is_string() {
            json!([entry["emailId"]])
        } else if let Some(mid) = entry["messageId"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(Value::as_str)
        {
            app.upstream
                .call(
                    &me.key,
                    "Email/query",
                    json!({"accountId":account,"filter":{"header":["Message-ID",mid]},"limit":10}),
                )
                .await?["ids"]
                .clone()
        } else {
            json!([])
        };
        if ids.as_array().is_none_or(Vec::is_empty) {
            continue;
        }
        let submissions = app
            .upstream
            .call(
                &me.key,
                "EmailSubmission/query",
                json!({"accountId":account,"filter":{"emailIds":ids},"limit":20}),
            )
            .await?;
        if submissions["ids"].as_array().is_some_and(|a| !a.is_empty()) {
            let found = app
                .upstream
                .call(
                    &me.key,
                    "EmailSubmission/get",
                    json!({"accountId":account,"ids":submissions["ids"]}),
                )
                .await?;
            if let Some(list) = found["list"].as_array() {
                matches.extend(list.iter().cloned());
            }
        }
    }
    let outcome = json!({"state":if !matches.is_empty(){"accepted"}else if row.get::<String,_>("status")=="complete"{"recorded"}else{"unconfirmed"},"submissions":matches,"retrySafe":false});
    db::query(db::Statement::NativeSubmissionCheck)
        .bind(outcome.to_string())
        .bind(db::now())
        .bind(me.user)
        .bind(id)
        .execute(&app.db)
        .await?;
    Ok(Json(outcome))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_scopes_personal_methods_and_account_references() {
        for method in ["x:Account/set", "x:ApiKey/set", "x:MtaHook/get"] {
            assert!(!allowed(method));
        }
        for method in [
            "CalendarEvent/set",
            "ContactCard/get",
            "FileNode/copy",
            "Email/set",
            "EmailSubmission/set",
            "SieveScript/set",
            "Core/echo",
            "x:ArchivedItem/query",
            "x:ArchivedItem/get",
            "x:ArchivedItem/set",
        ] {
            assert!(allowed(method));
        }
        let accounts = json!({"own":{},"shared":{}});
        assert!(validate_accounts(&json!({"accountId":"shared"}), &accounts).is_ok());
        for value in [json!({"accountId":"other"}), json!({"#accountId":{}})] {
            assert!(validate_accounts(&value, &accounts).is_err());
        }
    }
    #[test]
    fn archive_recovery_cannot_access_another_account_or_destroy_history() {
        let session = json!({"capabilities":{"urn:ietf:params:jmap:core":{}},"accounts":{"own":{"accountCapabilities":{"urn:stalwart:jmap":{}}}}});
        assert!(advertises_capability(&session, "urn:stalwart:jmap"));
        assert!(advertises_capability(&session, "urn:ietf:params:jmap:core"));
        assert!(!advertises_capability(&session, "urn:invented:admin"));
        assert!(
            validate_archive_call(
                &json!("x:ArchivedItem/set"),
                &json!({"accountId":"own", "update":{"item":{"status":"requestRestore"}}}),
                "own"
            )
            .is_ok()
        );
        for args in [
            json!({"accountId":"shared", "update":{"item":{"status":"requestRestore"}}}),
            json!({"accountId":"own", "filter":{"accountId":"other"}}),
            json!({"accountId":"own", "destroy":["item"]}),
            json!({"accountId":"own", "update":{"item":{"status":"archived"}}}),
            json!({"accountId":"own", "update":{"item":{"status":"requestRestore", "accountId":"other"}}}),
        ] {
            assert!(validate_archive_call(&json!("x:ArchivedItem/set"), &args, "own").is_err());
        }
        assert!(!allowed("x:ArchivedItem/copy"));
    }
    #[tokio::test]
    async fn lost_native_submission_response_is_not_replayed_and_can_be_reconciled() {
        use axum::http::Request;
        use http_body_util::BodyExt;
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        use tower::ServiceExt;
        let sends = Arc::new(AtomicUsize::new(0));
        let observed = sends.clone();
        let throttle_once = Arc::new(AtomicBool::new(true));
        let upstream=Router::new().route("/jmap/session",get(||async{Json(json!({"capabilities":{"urn:ietf:params:jmap:core":{},"urn:ietf:params:jmap:mail":{},"urn:ietf:params:jmap:submission":{}},"accounts":{"own":{}},"primaryAccounts":{"urn:ietf:params:jmap:mail":"own"}}))}))
            .route("/jmap/",post(move|Json(body):Json<Value>|{let sends=observed.clone();let throttle=throttle_once.clone();async move{
                let calls=body["methodCalls"].as_array().unwrap();
                if calls.iter().any(|m|m[0]=="EmailSubmission/set") && throttle.swap(false,Ordering::SeqCst){return StatusCode::TOO_MANY_REQUESTS.into_response();}
                if calls.iter().any(|m|m[0]=="EmailSubmission/set") {sends.fetch_add(1,Ordering::SeqCst);return (StatusCode::OK,"response lost after acceptance").into_response();}
                let responses=calls.iter().map(|m|{let data=match m[0].as_str().unwrap(){
                    "Email/query"=>json!({"ids":if sends.load(Ordering::SeqCst)>0{vec!["e1"]}else{vec![]}}),
                    "EmailSubmission/query"=>json!({"ids":if sends.load(Ordering::SeqCst)>0{vec!["s1"]}else{vec![]}}),
                    "EmailSubmission/get"=>json!({"list":[{"id":"s1","emailId":"e1","undoStatus":"final"}]}),
                    _=>json!({"list":[]})};json!([m[0],data,m[2]])}).collect::<Vec<_>>();
                Json(json!({"methodResponses":responses})).into_response()
            }}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        let db = db::connect(&root.join("test.sqlite")).await.unwrap();
        let user = Uuid::new_v4();
        let vault = Vault::new(&[4; 32]).unwrap();
        sqlx::query("INSERT INTO platform_users(id,email,recovery_email,stalwart_id,status) VALUES(?,?,?,?,'active')").bind(user).bind("alice@mail.example").bind("alice@recovery.example").bind("own").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id_hash,user_id,csrf_hash,upstream_key,upstream_key_id,expires_at) VALUES(?,?,?,?,?,?)").bind(hash("session")).bind(user).bind(hash("csrf")).bind(vault.seal(b"test-user-key").unwrap()).bind("key").bind(db::now()+3600000).execute(&db).await.unwrap();
        let app = Arc::new(App {
            root: None,
            revision: 0,
            service_id: "default".into(),
            domain_id: "default".into(),
            db,
            upstream: Stalwart {
                http: reqwest::Client::new(),
                base: format!("http://{address}"),
            },
            vault,
            origin: "https://mail.example".into(),
            direct_origin: None,
            services: config::Services {
                domain: "mail.example".into(),
                hook_id: "dedicated-hook".into(),
                ..Default::default()
            },
        });
        connections::seed_default(&app).await.unwrap();
        let router = routes().with_state(app.clone());
        let body = json!({"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],"methodCalls":[["Email/set",{"accountId":"own","create":{"e":{"messageId":["stable@mail.example"],"subject":"test"}}},"mail"],["EmailSubmission/set",{"accountId":"own","create":{"s":{"emailId":"#e","identityId":"i"}}},"submit"]]});
        let request = |method: &str, path: &str, body: Value| {
            Request::builder()
                .method(method)
                .uri(path)
                .header("cookie", "__Host-mail_session=session")
                .header("host", "mail.example")
                .header("origin", "https://mail.example")
                .header("x-csrf-token", "csrf")
                .header("idempotency-key", "native-loss-1234567890")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };
        let throttled = router
            .clone()
            .oneshot(request("POST", "/jmap", body.clone()))
            .await
            .unwrap();
        assert_eq!(throttled.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(sends.load(Ordering::SeqCst), 0);
        let response = router
            .clone()
            .oneshot(request("POST", "/jmap", body.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body_for_retry = || body.clone();
        let response = router
            .clone()
            .oneshot(request("POST", "/jmap", body.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        let mut regenerated = body_for_retry();
        regenerated["methodCalls"][0][1]["create"]["e"]["messageId"] =
            json!(["regenerated@mail.example"]);
        let mut retry = request("POST", "/jmap", regenerated);
        retry.headers_mut().insert(
            "idempotency-key",
            HeaderValue::from_static("new-client-id-1234567890"),
        );
        assert_eq!(
            router.clone().oneshot(retry).await.unwrap().status(),
            StatusCode::CONFLICT
        );
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        let response = router
            .clone()
            .oneshot(request(
                "POST",
                "/client/submissions/native-loss-1234567890/reconcile",
                json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let result: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(result["state"], "accepted");
        assert_eq!(result["retrySafe"], false);
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        let mut forged = request("GET", "/client/submissions", json!({}));
        forged.headers_mut().insert(
            "x-mail-account",
            HeaderValue::from_static("bob@mail.example"),
        );
        assert_eq!(
            router.oneshot(forged).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        server.abort();
        app.db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[derive(Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ClientPolicy {
    #[serde(default = "default_mail_layout")]
    mail_layout: String,
    #[serde(default = "default_send_delay")]
    send_delay_seconds: u32,
    #[serde(default = "default_external_content")]
    external_content_policy: String,
    #[serde(default = "default_true")]
    sharing_enabled: bool,
    #[serde(default = "default_true")]
    sharing_write_enabled: bool,
}
fn default_mail_layout() -> String {
    "split".into()
}
fn default_send_delay() -> u32 {
    5
}
fn default_external_content() -> String {
    "ask".into()
}
fn default_true() -> bool {
    true
}
async fn read_client_policy(app: &App) -> Result<ClientPolicy> {
    let payload: Option<String> = db::scalar(db::Statement::ClientPolicyGet)
        .fetch_optional(&app.db)
        .await?;
    serde_json::from_str(payload.as_deref().unwrap_or("{}"))
        .map_err(|_| internal("client_policy_invalid"))
}
#[utoipa::path(get,path="/api/v1/client/policy",responses((status=200,body=Value)))]
pub(super) async fn client_policy(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    identity(&app, &headers, false).await?;
    let p = read_client_policy(&app).await?;
    let mut hidden = std::collections::BTreeSet::new();
    for row in db::query(db::Statement::ConnectionList)
        .fetch_all(&app.db)
        .await?
    {
        if let Ok(context) = connections::for_domain(&app, &row.get::<String, _>("id")).await {
            let local = context
                .services
                .notification_email
                .split('@')
                .next()
                .unwrap_or("");
            if let Ok(Some(gateway)) = gateway::configuration(&context, false).await
                && let Some(local) = gateway.relay_email.split('@').next()
            {
                hidden.insert(local.to_owned());
            }
            if local.starts_with("mw-") && local.ends_with("-notification") {
                hidden.insert(local.to_owned());
                hidden.insert(local.trim_end_matches("-notification").to_owned() + "-directory");
            }
        }
    }
    let levels = if !p.sharing_enabled {
        json!([])
    } else if p.sharing_write_enabled {
        json!(["read", "write"])
    } else {
        json!(["read"])
    };
    Ok(Json(
        json!({"directoryHiddenLocalparts":hidden,"defaults":{"mailLayout":p.mail_layout,"sendDelaySeconds":p.send_delay_seconds,"externalContentPolicy":p.external_content_policy},"restrictions":{"sharingRights":{"allowedValues":levels}}}),
    ))
}
#[utoipa::path(get,path="/api/v1/admin/client-policy",responses((status=200,body=ClientPolicy)))]
pub(super) async fn admin_client_policy(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<ClientPolicy>> {
    account::operator(&app, &headers, false).await?;
    Ok(Json(read_client_policy(&app).await?))
}
#[utoipa::path(put,path="/api/v1/admin/client-policy",request_body=ClientPolicy,responses((status=204)))]
pub(super) async fn save_client_policy(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(p): Json<ClientPolicy>,
) -> Result<StatusCode> {
    let me = account::operator(&app, &headers, true).await?;
    if !["split", "focus", "horizontal"].contains(&p.mail_layout.as_str())
        || ![0, 5, 10, 30, 60].contains(&p.send_delay_seconds)
        || !["ask", "block", "allow"].contains(&p.external_content_policy.as_str())
    {
        return Err(Error(StatusCode::BAD_REQUEST, "client_policy_invalid"));
    }
    db::query(db::Statement::ClientPolicyPut)
        .bind(serde_json::to_string(&p).map_err(|_| internal("client_policy_invalid"))?)
        .execute(&app.db)
        .await?;
    account::audit_event(&app, me.user, "client_policy_update", me.user, "success").await?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_sharing_policy(value: &Value, policy: &ClientPolicy) -> Result<()> {
    if let Value::Object(fields) = value {
        for (key, v) in fields {
            if key == "shareWith" || key.starts_with("shareWith/") {
                fn grants(v: &Value, write_only: bool) -> bool {
                    match v {
                        Value::Object(m) => m.iter().any(|(k, v)| {
                            if let Some(b) = v.as_bool() {
                                b && (!write_only
                                    || ![
                                        "mayRead",
                                        "mayReadItems",
                                        "mayReadFreeBusy",
                                        "mayGetItems",
                                        "mayGetMetadata",
                                        "maySetSeen",
                                    ]
                                    .contains(&k.as_str()))
                            } else {
                                grants(v, write_only)
                            }
                        }),
                        _ => false,
                    }
                }
                let direct_grant = v.as_bool() == Some(true);
                let direct_write = direct_grant
                    && ![
                        "mayRead",
                        "mayReadItems",
                        "mayReadFreeBusy",
                        "mayGetItems",
                        "mayGetMetadata",
                        "maySetSeen",
                    ]
                    .contains(&key.rsplit('/').next().unwrap_or(""));
                if (!policy.sharing_enabled && (direct_grant || grants(v, false)))
                    || (!policy.sharing_write_enabled && (direct_write || grants(v, true)))
                {
                    return Err(Error(StatusCode::FORBIDDEN, "sharing_policy_denied"));
                }
            } else {
                validate_sharing_policy(v, policy)?;
            }
        }
    } else if let Value::Array(items) = value {
        for v in items {
            validate_sharing_policy(v, policy)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod sharing_tests {
    use super::*;
    #[test]
    fn sharing_policy_blocks_nested_and_path_grants_but_keeps_revocation() {
        let p: ClientPolicy =
            serde_json::from_value(json!({"sharingEnabled":true,"sharingWriteEnabled":false}))
                .unwrap();
        for update in [
            json!({"update":{"f":{"shareWith":{"person":{"mayWrite":true}}}}}),
            json!({"update":{"f":{"shareWith/person/mayWrite":true}}}),
        ] {
            assert!(validate_sharing_policy(&update, &p).is_err());
        }
        assert!(
            validate_sharing_policy(
                &json!({"update":{"f":{"shareWith/person":{"mayRead":true,"mayWrite":false}}}}),
                &p
            )
            .is_ok()
        );
        let p: ClientPolicy = serde_json::from_value(json!({"sharingEnabled":false})).unwrap();
        assert!(
            validate_sharing_policy(&json!({"update":{"f":{"shareWith/person":null}}}), &p).is_ok()
        );
        assert!(
            validate_sharing_policy(
                &json!({"update":{"f":{"shareWith/person/mayRead":true}}}),
                &p
            )
            .is_err()
        );
    }
}

pub(super) async fn compact_submission_records(app: Arc<App>) {
    loop {
        if let Err(error) = gateway::compact(&app).await {
            tracing::warn!(code = error.1, "automatic_gateway_compaction_retry");
        }
        // Keep idempotency tombstones and every unknown result. Only old complete response bodies expire.
        if let Err(error) = db::query(db::Statement::NativeSubmissionCompact)
            .bind(db::now() - 30 * 86400000)
            .execute(&app.db)
            .await
        {
            tracing::warn!(%error,"submission_record_compaction_failed");
        }
        tokio::select! {_=SHUTDOWN.cancelled()=>break,_=tokio::time::sleep(std::time::Duration::from_secs(3600))=>{}}
    }
}

fn restrict_personal_credentials(args: &mut Value) -> Result<()> {
    const SENSITIVE: &[&str] = &[
        "sysApiKeyCreate",
        "sysApiKeyUpdate",
        "sysApiKeyDestroy",
        "sysAppPasswordCreate",
        "sysAppPasswordUpdate",
        "sysAppPasswordDestroy",
        "sysAccountPasswordUpdate",
    ];
    for field in ["create", "update"] {
        if let Some(entries) = args[field].as_object_mut() {
            for value in entries.values_mut() {
                let object = value
                    .as_object_mut()
                    .ok_or(Error(StatusCode::BAD_REQUEST, "credential_invalid"))?;
                if object.keys().any(|key| key.starts_with("permissions/")) {
                    return Err(Error(
                        StatusCode::FORBIDDEN,
                        "credential_scope_patch_forbidden",
                    ));
                }
                if field == "create" || object.contains_key("permissions") {
                    let permissions = object
                        .entry("permissions")
                        .or_insert(json!({"@type":"Inherit"}));
                    match permissions["@type"].as_str().unwrap_or("Inherit") {
                        "Inherit" => {
                            *permissions = json!({"@type":"Disable","permissions":{}});
                        }
                        "Disable" | "Replace" => {}
                        _ => {
                            return Err(Error(
                                StatusCode::BAD_REQUEST,
                                "credential_permissions_invalid",
                            ));
                        }
                    }
                    let replace = permissions["@type"] == "Replace";
                    let permissions = permissions
                        .as_object_mut()
                        .ok_or(Error(
                            StatusCode::BAD_REQUEST,
                            "credential_permissions_invalid",
                        ))?
                        .entry("permissions")
                        .or_insert(json!({}))
                        .as_object_mut()
                        .ok_or(Error(
                            StatusCode::BAD_REQUEST,
                            "credential_permissions_invalid",
                        ))?;
                    for name in SENSITIVE {
                        if replace {
                            permissions.remove(*name);
                        } else {
                            permissions.insert((*name).into(), json!(true));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod credential_tests {
    use super::*;
    #[test]
    fn personal_credentials_keep_mail_scopes_without_minting_more_credentials() {
        let mut inherited = json!({"create":{"c":{"description":"Mail app"}}});
        restrict_personal_credentials(&mut inherited).unwrap();
        assert_eq!(
            inherited["create"]["c"]["permissions"]["permissions"]["sysAccountPasswordUpdate"],
            true
        );
        let mut limited = json!({"create":{"c":{"permissions":{"@type":"Replace","permissions":{"emailSend":true,"sysApiKeyCreate":true}}}}});
        restrict_personal_credentials(&mut limited).unwrap();
        assert_eq!(
            limited["create"]["c"]["permissions"]["permissions"]["emailSend"],
            true
        );
        assert!(
            limited["create"]["c"]["permissions"]["permissions"]
                .get("sysApiKeyCreate")
                .is_none()
        );
        assert!(
            restrict_personal_credentials(
                &mut json!({"update":{"c":{"permissions/permissions/sysApiKeyCreate":false}}})
            )
            .is_err()
        );
    }
}

#[derive(Deserialize, ToSchema)]
pub(super) struct DirectoryPolicyInput {
    enabled: bool,
}
#[utoipa::path(get,path="/api/v1/admin/directory",params(("domainId"=Option<String>,Query)),responses((status=200,body=Value)))]
pub(super) async fn directory_policy(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    account::operator(&app, &headers, false).await?;
    let app = connections::for_domain(
        &app,
        q.get("domainId").map(String::as_str).unwrap_or("default"),
    )
    .await?;
    let response = app
        .upstream
        .call(
            &app.services.provisioning_key,
            "x:Sharing/get",
            json!({"ids":["singleton"]}),
        )
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "directory_settings_unavailable"))?;
    Ok(Json(
        json!({"enabled":response["list"][0]["allowDirectoryQueries"].as_bool().unwrap_or(false)}),
    ))
}
#[utoipa::path(put,path="/api/v1/admin/directory",params(("domainId"=Option<String>,Query)),request_body=DirectoryPolicyInput,responses((status=204)))]
pub(super) async fn save_directory_policy(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
    Json(input): Json<DirectoryPolicyInput>,
) -> Result<StatusCode> {
    let me = account::operator(&app, &headers, true).await?;
    let app = connections::for_domain(
        &app,
        q.get("domainId").map(String::as_str).unwrap_or("default"),
    )
    .await?;
    app.upstream
        .call(
            &app.services.provisioning_key,
            "x:Sharing/set",
            json!({"update":{"singleton":{"allowDirectoryQueries":input.enabled}}}),
        )
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "directory_settings_unavailable"))?;
    app.upstream
        .call(
            &app.services.provisioning_key,
            "x:Action/set",
            json!({"create":{"reload":{"@type":"ReloadSettings"}}}),
        )
        .await?;
    account::audit_event(&app, me.user, "directory_policy_update", me.user, "success").await?;
    Ok(StatusCode::NO_CONTENT)
}
