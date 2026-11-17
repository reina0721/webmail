use super::*;
pub(super) static JOB_NOTIFY: tokio::sync::Notify = tokio::sync::Notify::const_new();
// Provisioning markers prove ownership while account creation is unresolved.
// After a verified login, they must not become the user's public sender name.
fn is_generated_display_name(name: &str) -> bool {
    let Some(value) = name.strip_prefix("mail-web:") else {
        return false;
    };
    let value = value.strip_suffix(":operator").unwrap_or(value);
    Uuid::parse_str(value).is_ok()
}
pub(super) async fn repair_generated_display_name(app: &App, key: &str, email: &str) {
    let result = async {
        let settings = app.upstream.call(key, "x:AccountSettings/get", json!({"ids":["singleton"]})).await?;
        if settings["list"][0]["description"].as_str().is_some_and(is_generated_display_name) {
            app.upstream.call(key, "x:AccountSettings/set", json!({"update":{"singleton":{"description":email.split('@').next().unwrap_or(email)}}})).await?;
        }
        Ok::<(), stalwart::UpstreamError>(())
    }.await;
    if result.is_err() {
        tracing::warn!("generated_display_name_repair_pending_next_login");
    }
}

pub fn user_permissions(active: bool) -> Value {
    // Personal-account capabilities. Native mail and scheduling share the enforced MTA policy.
    const ALLOWED: &[&str] = &[
        "authenticate",
        "emailSend",
        "emailReceive",
        "imapAuthenticate",
        "imapAclGet",
        "imapAclSet",
        "imapMyRights",
        "imapListRights",
        "imapAppend",
        "imapCapability",
        "imapId",
        "imapCopy",
        "imapMove",
        "imapCreate",
        "imapDelete",
        "imapEnable",
        "imapExpunge",
        "imapFetch",
        "imapIdle",
        "imapList",
        "imapLsub",
        "imapNamespace",
        "imapRename",
        "imapSearch",
        "imapSort",
        "imapSelect",
        "imapExamine",
        "imapStatus",
        "imapStore",
        "imapSubscribe",
        "imapThread",
        "imapMetadataGet",
        "imapMetadataSet",
        "imapMetadataPrivate",
        "pop3Authenticate",
        "pop3List",
        "pop3Uidl",
        "pop3Stat",
        "pop3Retr",
        "pop3Dele",
        "jmapCalendarEventNotificationUpdate",
        "jmapCalendarEventNotificationCreate",
        "jmapCalendarEventNotificationQueryChanges",
        "jmapCalendarEventNotificationQuery",
        "jmapCalendarEventNotificationChanges",
        "jmapShareNotificationDestroy",
        "jmapShareNotificationUpdate",
        "jmapShareNotificationCreate",
        "jmapShareNotificationQueryChanges",
        "jmapShareNotificationQuery",
        "jmapShareNotificationChanges",
        "jmapShareNotificationGet",
        "jmapCalendarGet",
        "jmapCalendarChanges",
        "jmapCalendarCreate",
        "jmapCalendarUpdate",
        "jmapCalendarDestroy",
        "jmapCalendarEventGet",
        "jmapCalendarEventQuery",
        "jmapCalendarEventChanges",
        "jmapCalendarEventQueryChanges",
        "jmapCalendarEventCreate",
        "jmapCalendarEventUpdate",
        "jmapCalendarEventDestroy",
        "jmapCalendarEventParse",
        "jmapCalendarEventNotificationGet",
        "jmapCalendarEventNotificationDestroy",
        "jmapParticipantIdentityGet",
        "calendarSchedulingReceive",
        "calendarSchedulingSend",
        "jmapAddressBookGet",
        "jmapAddressBookChanges",
        "jmapAddressBookCreate",
        "jmapAddressBookUpdate",
        "jmapAddressBookDestroy",
        "jmapContactCardGet",
        "jmapContactCardQuery",
        "jmapContactCardChanges",
        "jmapContactCardQueryChanges",
        "jmapContactCardCreate",
        "jmapContactCardUpdate",
        "jmapContactCardDestroy",
        "jmapContactCardParse",
        "jmapFileNodeGet",
        "jmapFileNodeQuery",
        "jmapFileNodeChanges",
        "jmapFileNodeQueryChanges",
        "jmapFileNodeCreate",
        "jmapFileNodeUpdate",
        "jmapFileNodeDestroy",
        "jmapFileNodeCopy",
        "jmapPrincipalGet",
        "jmapPrincipalQuery",
        "jmapPrincipalGetAvailability",
        "jmapCoreEcho",
        "jmapPushSubscriptionGet",
        "jmapPushSubscriptionCreate",
        "jmapPushSubscriptionUpdate",
        "jmapPushSubscriptionDestroy",
        "jmapBlobGet",
        "jmapBlobCopy",
        "jmapBlobLookup",
        "jmapBlobUpload",
        "jmapEmailGet",
        "jmapEmailChanges",
        "jmapEmailQuery",
        "jmapEmailQueryChanges",
        "jmapEmailCreate",
        "jmapEmailUpdate",
        "jmapEmailDestroy",
        "jmapEmailCopy",
        "jmapEmailImport",
        "jmapEmailParse",
        "jmapEmailSubmissionGet",
        "jmapEmailSubmissionChanges",
        "jmapEmailSubmissionQuery",
        "jmapEmailSubmissionQueryChanges",
        "jmapEmailSubmissionCreate",
        "jmapEmailSubmissionUpdate",
        "jmapEmailSubmissionDestroy",
        "jmapIdentityGet",
        "jmapIdentityCreate",
        "jmapIdentityUpdate",
        "jmapIdentityDestroy",
        "jmapSieveScriptGet",
        "jmapSieveScriptQuery",
        "jmapSieveScriptValidate",
        "jmapVacationResponseGet",
        "jmapParticipantIdentityCreate",
        "jmapParticipantIdentityUpdate",
        "jmapParticipantIdentityDestroy",
        "jmapIdentityChanges",
        "jmapMailboxGet",
        "jmapMailboxChanges",
        "jmapMailboxQuery",
        "jmapMailboxQueryChanges",
        "jmapMailboxCreate",
        "jmapMailboxUpdate",
        "jmapMailboxDestroy",
        "jmapThreadGet",
        "jmapThreadChanges",
        "jmapSearchSnippetGet",
        "jmapQuotaGet",
        "jmapQuotaChanges",
        "jmapQuotaQuery",
        "jmapQuotaQueryChanges",
        "sysAccountSettingsGet",
        "sysAccountSettingsUpdate",
        "sysAccountPasswordGet",
        "sysAccountPasswordUpdate",
        "sysApiKeyGet",
        "sysApiKeyCreate",
        "sysApiKeyUpdate",
        "sysApiKeyDestroy",
        "sysApiKeyQuery",
        "sysAppPasswordGet",
        "sysAppPasswordCreate",
        "sysAppPasswordUpdate",
        "sysAppPasswordDestroy",
        "sysAppPasswordQuery",
    ];
    let enabled: serde_json::Map<String, Value> = ALLOWED
        .iter()
        .map(|name| ((*name).into(), json!(true)))
        .collect();
    json!({"@type":"Replace","enabledPermissions":enabled,"disabledPermissions":if active{json!({})}else{json!({"authenticate":true,"emailSend":true})}})
}
pub async fn initialize_permission_policy(app: &App) -> std::result::Result<(), sqlx::Error> {
    let mut tx = db::begin(&app.db).await?;
    let version: Option<String> = db::scalar(db::Statement::AccountInitializePolicyVersion)
        .fetch_optional(&mut *tx)
        .await?;
    let policy_version = format!("3:{}", hash(&user_permissions(true).to_string()));
    if version.as_deref() != Some(policy_version.as_str()) {
        let users = db::query(db::Statement::AccountInitializePolicyUsers)
            .fetch_all(&mut *tx)
            .await?;
        for user in users {
            let id: Uuid = user.get("id");
            let payload=json!({"account":user.get::<String,_>("stalwart_id"),"enabled":user.get::<String,_>("status")=="active","quota":user.get::<i64,_>("quota_bytes")}).to_string();
            db::query(db::Statement::AccountInitializePolicyJob)
                .bind(format!("account:{id}"))
                .bind(id)
                .bind(payload)
                .execute(&mut *tx)
                .await?;
        }
        db::query(db::Statement::AccountInitializePolicyCommit)
            .bind(&policy_version)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/account", get(profile).patch(update_profile))
        .route("/account/usage", get(usage))
        .route("/account/capabilities", get(capabilities))
        .route("/auth/password", post(password))
        .route("/auth/sessions", get(sessions))
        .route("/auth/sessions/{id}", axum::routing::delete(revoke_session))
        .route("/auth/sessions/revoke-others", post(revoke_others))
        .route(
            "/account/app-passwords",
            get(app_passwords).post(create_app_password),
        )
        .route(
            "/account/app-passwords/{id}",
            axum::routing::delete(delete_app_password),
        )
        .route("/admin/users", get(users))
        .route("/admin/users/{id}", axum::routing::patch(update_user))
        .route("/admin/registration", get(get_settings).patch(put_settings))
        .route("/admin/audit", get(audit))
        .route("/admin/tasks", get(tasks))
        .route("/admin/tasks/retry", post(retry_tasks))
}
pub async fn audit_event(
    app: &App,
    actor: Uuid,
    action: &str,
    subject: Uuid,
    outcome: &str,
) -> Result<()> {
    db::query(db::Statement::AccountAuditEventInsertAuditEvents)
        .bind(Uuid::new_v4())
        .bind(actor)
        .bind(action)
        .bind(subject)
        .bind(outcome)
        .bind(&app.domain_id)
        .execute(&app.db)
        .await?;
    Ok(())
}
pub(super) async fn operator(app: &App, headers: &HeaderMap, write: bool) -> Result<Identity> {
    let me = identity(app, headers, write).await?;
    if !me.operator {
        return Err(Error(StatusCode::FORBIDDEN, "operator_required"));
    }
    Ok(me)
}
#[utoipa::path(get,path="/api/v1/account",responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn profile(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let row = db::query(db::Statement::AccountProfileSelectPlatformUsers)
        .bind(me.user)
        .fetch_one(&app.db)
        .await?;
    Ok(Json(
        json!({"email":me.email,"displayName":row.get::<String,_>("display_name"),"preferences":serde_json::from_str::<Value>(&row.get::<String,_>("preferences")).unwrap_or(json!({})),"quotaBytes":row.get::<i64,_>("quota_bytes"),"usedBytes":Value::Null}),
    ))
}
#[utoipa::path(get,path="/api/v1/account/usage",responses((status=200,body=Value)))]
pub(crate) async fn usage(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let metadata = app
        .upstream
        .call(
            &app.services.provisioning_key,
            "x:Account/get",
            json!({"ids":[me.account],"properties":["id","quotas","usedDiskQuota"]}),
        )
        .await?;
    let limits = db::query(db::Statement::AccountUsageLimits)
        .bind(me.user)
        .fetch_one(&app.db)
        .await?;
    let hour: i64 = db::scalar(db::Statement::PolicyReserveSelectOutboundReservations)
        .bind(me.user)
        .bind(db::now() - 3600000)
        .fetch_one(&app.db)
        .await?;
    let day: i64 = db::scalar(db::Statement::PolicyReserveSelectOutboundReservations2)
        .bind(me.user)
        .bind(db::now() - 86400000)
        .fetch_one(&app.db)
        .await?;
    Ok(Json(
        json!({"usedBytes":metadata["list"][0]["usedDiskQuota"].as_u64(),"quotaBytes":metadata["list"][0]["quotas"]["maxDiskQuota"].as_u64(),"hourlyRecipientsUsed":hour,"dailyRecipientsUsed":day,"hourlyRecipientsLimit":limits.get::<i64,_>("hourly_recipients"),"dailyRecipientsLimit":limits.get::<i64,_>("daily_recipients")}),
    ))
}
#[utoipa::path(get,path="/api/v1/account/capabilities",responses((status=200,body=Value)))]
pub(crate) async fn capabilities(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let response = app
        .upstream
        .http
        .get(format!("{}/api/account", app.upstream.base))
        .bearer_auth(&me.key)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "mail_service_unavailable"))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(Error(StatusCode::UNAUTHORIZED, "credentials_invalid"));
    }
    if !response.status().is_success() {
        return Err(Error(StatusCode::BAD_GATEWAY, "capabilities_unavailable"));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| internal("capabilities_invalid"))?;
    let has = |permission: &str| {
        value["permissions"]
            .as_array()
            .is_some_and(|items| items.iter().any(|p| p == permission))
    };
    Ok(Json(
        json!({"changePassword":has("sysAccountPasswordUpdate"),"appPasswords":has("sysAppPasswordGet")&&has("sysAppPasswordCreate")&&has("sysAppPasswordDestroy")}),
    ))
}
#[derive(Deserialize, ToSchema)]
pub(super) struct ProfileInput {
    display_name: Option<String>,
    language: Option<String>,
    theme: Option<String>,
}
#[utoipa::path(patch,path="/api/v1/account",request_body=ProfileInput,responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn update_profile(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<ProfileInput>,
) -> Result<StatusCode> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    if input
        .display_name
        .as_ref()
        .is_some_and(|name| name.chars().count() > 100)
        || input
            .language
            .as_deref()
            .is_some_and(|value| !matches!(value, "zh-CN" | "en"))
        || input
            .theme
            .as_deref()
            .is_some_and(|value| !matches!(value, "system" | "light" | "dark"))
    {
        return Err(Error(StatusCode::BAD_REQUEST, "profile_invalid"));
    }
    if let Some(name) = &input.display_name {
        app.upstream
            .call(
                &me.key,
                "x:AccountSettings/set",
                json!({"update":{"singleton":{"description":name}}}),
            )
            .await?;
    }
    let mut tx = db::begin(&app.db).await?;
    let old = db::query(db::Statement::AccountProfileSelectPlatformUsers)
        .bind(me.user)
        .fetch_one(&mut *tx)
        .await?;
    let mut preferences: Value = serde_json::from_str(&old.get::<String, _>("preferences"))
        .map_err(|_| internal("profile_invalid"))?;
    if let Some(language) = input.language {
        preferences["language"] = json!(language);
    }
    if let Some(theme) = input.theme {
        preferences["theme"] = json!(theme);
    }
    db::query(db::Statement::AccountUpdateProfileUpdatePlatformUsers)
        .bind(
            input
                .display_name
                .unwrap_or_else(|| old.get("display_name")),
        )
        .bind(preferences.to_string())
        .bind(me.user)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, ToSchema)]
pub(super) struct PasswordInput {
    current_password: String,
    new_password: String,
}
#[utoipa::path(post,path="/api/v1/auth/password",request_body=PasswordInput,responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn password(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<PasswordInput>,
) -> Result<StatusCode> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    if !(12..=128).contains(&input.new_password.chars().count()) {
        return Err(Error(StatusCode::BAD_REQUEST, "password_invalid"));
    }
    let _account_guard = account_lock(&format!("{}:{}", app.service_id, me.account)).await;
    app.upstream
        .password_call(&me.email, &input.current_password, "Core/echo", json!({}))
        .await?;
    revoke_user(&app, me.user).await?;
    app.upstream.password_call(&me.email,&input.current_password,"x:AccountPassword/set",json!({"update":{"singleton":{"currentSecret":input.current_password,"secret":input.new_password}}})).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(get,path="/api/v1/auth/sessions",responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn sessions(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    let rows = db::query(db::Statement::AccountSessionsSelectSessions)
        .bind(me.user)
        .bind(db::now())
        .bind(db::now() - 1800000)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<String,_>("id_hash"),"current":r.get::<String,_>("id_hash")==me.session,"createdAt":r.get::<i64,_>("created_at"),"lastSeen":r.get::<i64,_>("last_seen"),"expiresAt":r.get::<i64,_>("expires_at")})).collect::<Vec<_>>()}),
    ))
}
#[utoipa::path(delete,path="/api/v1/auth/sessions/{id}",params(("id"=String,Path)),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn revoke_session(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let mut tx = db::begin(&app.db).await?;
    db::query(db::Statement::AccountRevokeSessionUpdateSessions)
        .bind(db::now())
        .bind(&id)
        .bind(me.user)
        .execute(&mut *tx)
        .await?;
    db::query(db::Statement::AccountRevokeSessionInsertCredentialRevocations)
        .bind(id)
        .bind(me.user)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    JOB_NOTIFY.notify_one();
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/api/v1/auth/sessions/revoke-others",responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn revoke_others(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let mut tx = db::begin(&app.db).await?;
    db::query(db::Statement::AccountRevokeOthersUpdateSessions)
        .bind(db::now())
        .bind(me.user)
        .bind(&me.session)
        .execute(&mut *tx)
        .await?;
    db::query(db::Statement::AccountRevokeOthersInsertCredentialRevocations)
        .bind(me.user)
        .bind(me.session)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    JOB_NOTIFY.notify_one();
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(get,path="/api/v1/account/app-passwords",responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn app_passwords(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let app = connections::for_user(&app, me.user).await?;
    Ok(Json(
        app.upstream
            .call(
                &me.key,
                "x:AppPassword/get",
                json!({"properties":["id","description","createdAt","expiresAt"]}),
            )
            .await?,
    ))
}
#[derive(Deserialize, ToSchema)]
pub(super) struct CredentialInput {
    description: String,
}
#[utoipa::path(post,path="/api/v1/account/app-passwords",request_body=CredentialInput,responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn create_app_password(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<CredentialInput>,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let _account_guard = account_lock(&format!("{}:{}", app.service_id, me.account)).await;
    if input.description.is_empty() || input.description.len() > 100 {
        return Err(Error(StatusCode::BAD_REQUEST, "description_invalid"));
    }
    Ok(Json(app.upstream.call(&me.key,"x:AppPassword/set",json!({"create":{"credential":{"description":input.description,"permissions":{"@type":"Disable","permissions":{"sysApiKeyCreate":true,"sysApiKeyUpdate":true,"sysApiKeyDestroy":true,"sysAppPasswordCreate":true,"sysAppPasswordUpdate":true,"sysAppPasswordDestroy":true,"sysAccountPasswordUpdate":true}}}}})).await?))
}
#[utoipa::path(delete,path="/api/v1/account/app-passwords/{id}",params(("id"=String,Path)),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn delete_app_password(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let me = identity(&app, &headers, true).await?;
    let app = connections::for_user(&app, me.user).await?;
    let _account_guard = account_lock(&format!("{}:{}", app.service_id, me.account)).await;
    app.upstream
        .call(&me.key, "x:AppPassword/set", json!({"destroy":[id]}))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(get,path="/api/v1/admin/users",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn users(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    operator(&app, &headers, false).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    let rows = db::query(db::Statement::AccountUsersSelectPlatformUsers)
        .bind(&app.domain_id)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<Uuid,_>("id"),"email":r.get::<String,_>("email"),"status":r.get::<String,_>("status"),"operator":r.get::<bool,_>("operator"),"quotaBytes":r.get::<i64,_>("quota_bytes"),"hourlyRecipients":r.get::<i64,_>("hourly_recipients"),"dailyRecipients":r.get::<i64,_>("daily_recipients")})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct UserInput {
    enabled: bool,
    #[serde(alias = "quota_bytes")]
    quota_bytes: i64,
    #[serde(alias = "hourly_recipients")]
    hourly_recipients: i64,
    #[serde(alias = "daily_recipients")]
    daily_recipients: i64,
}
#[utoipa::path(patch,path="/api/v1/admin/users/{id}",params(("id"=String,Path)),request_body=UserInput,responses((status=202,description="Policy queued for durable synchronization"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn update_user(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<UserInput>,
) -> Result<StatusCode> {
    let me = operator(&app, &headers, true).await?;
    if id == me.user && !input.enabled {
        return Err(Error(StatusCode::BAD_REQUEST, "cannot_disable_self"));
    }
    if input.quota_bytes <= 0
        || input.hourly_recipients <= 0
        || input.daily_recipients < input.hourly_recipients
    {
        return Err(Error(StatusCode::BAD_REQUEST, "limits_invalid"));
    }
    let row = db::query(db::Statement::AccountUpdateUserSelectPlatformUsers)
        .bind(id)
        .fetch_optional(&app.db)
        .await?
        .ok_or(Error(StatusCode::NOT_FOUND, "user_not_found"))?;
    let app = connections::for_user(&app, id).await?;
    let payload=json!({"account":row.get::<String,_>("stalwart_id"),"enabled":input.enabled,"quota":input.quota_bytes}).to_string();
    let mut tx = db::begin(&app.db).await?;
    db::query(db::Statement::AccountUpdateUserUpdatePlatformUsers)
        .bind(input.enabled)
        .bind(input.quota_bytes)
        .bind(input.hourly_recipients)
        .bind(input.daily_recipients)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    db::query(db::Statement::AccountUpdateUserInsertCredentialJobs)
        .bind(format!("account:{id}"))
        .bind(id)
        .bind(payload)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if !input.enabled {
        revoke_user(&app, id).await?;
    }
    JOB_NOTIFY.notify_one();
    audit_event(&app, me.user, "account.update", id, "queued").await?;
    Ok(StatusCode::ACCEPTED)
}

pub(super) async fn reconcile_job(app: &App) -> Result<bool> {
    let lease = db::now() + 60000;
    let row = db::query(db::Statement::AccountReconcileJobUpdateCredentialJobs)
        .bind(lease)
        .bind(db::now())
        .bind(db::now())
        .fetch_optional(&app.db)
        .await?;
    let Some(row) = row else { return Ok(false) };
    let id: String = row.get("id");
    let user: Uuid = row.get("user_id");
    let app = connections::for_user(app, user).await?;
    let payload: String = row.get("payload");
    let data: Value = serde_json::from_str(&payload).map_err(|_| internal("job_payload"))?;
    let _account_guard = account_lock(&format!(
        "{}:{}",
        app.service_id,
        data["account"].as_str().ok_or(internal("job_account"))?
    ))
    .await;
    let enabled = data["enabled"] == true;
    let mut revocation_ready = true;
    if enabled {
        let sessions = db::query(db::Statement::AccountReconcileJobSelectSessions)
            .bind(user)
            .fetch_all(&app.db)
            .await?;
        for session in sessions {
            let sid: String = session.get("id_hash");
            if super::revoke_upstream(
                &app,
                &sid,
                data["account"].as_str().ok_or(internal("job_account"))?,
                &session.get::<Vec<u8>, _>("upstream_key"),
                &session.get::<String, _>("upstream_key_id"),
            )
            .await
            {
                db::query(db::Statement::AccountReconcileJobDeleteCredentialRevocations)
                    .bind(sid)
                    .execute(&app.db)
                    .await?;
            } else {
                revocation_ready = false;
                break;
            }
        }
    }
    let mut update = json!({});
    update[data["account"].as_str().ok_or(internal("job_account"))?] =
        json!({"quotas/maxDiskQuota":data["quota"],"permissions":user_permissions(enabled)});
    let result = if revocation_ready && policy::sync_scope(&app).await.is_ok() {
        app.upstream
            .call(
                &app.services.provisioning_key,
                "x:Account/set",
                json!({"update":update}),
            )
            .await
    } else {
        Err(stalwart::UpstreamError::Rejected)
    };
    if result.is_ok() {
        let mut tx = db::begin(&app.db).await?;
        let current: bool = db::scalar(db::Statement::AccountReconcileJobSelectCredentialJobs)
            .bind(&id)
            .bind(lease)
            .bind(&payload)
            .fetch_one(&mut *tx)
            .await?;
        if current {
            db::query(db::Statement::AccountReconcileJobUpdatePlatformUsers)
                .bind(if enabled { "active" } else { "disabled" })
                .bind(user)
                .execute(&mut *tx)
                .await?;
            db::query(db::Statement::AccountReconcileJobDeleteCredentialJobs)
                .bind(&id)
                .bind(lease)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
    } else {
        db::query(db::Statement::AccountReconcileJobUpdateCredentialJobs2)
            .bind(db::now() + 60000)
            .bind(&id)
            .bind(lease)
            .execute(&app.db)
            .await?;
    }
    Ok(true)
}
#[utoipa::path(get,path="/api/v1/admin/registration",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn get_settings(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    operator(&app, &headers, false).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    Ok(Json(
        json!({"policy":registration::settings(&app).await?,"dependenciesReady":readiness::ready(&app).await?,"readiness":readiness::view(&app).await?}),
    ))
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct RegistrationPolicy {
    enabled: bool,
    maximum_accounts: i64,
    quota_bytes: i64,
    attachment_bytes: i64,
    hourly_recipients: i64,
    daily_recipients: i64,
}
#[utoipa::path(patch,path="/api/v1/admin/registration",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),request_body=RegistrationPolicy,responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn put_settings(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(input): Json<RegistrationPolicy>,
) -> Result<StatusCode> {
    let me = operator(&app, &headers, true).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    if !(1..=100).contains(&input.maximum_accounts)
        || input.quota_bytes <= 0
        || !(1..=20971520).contains(&input.attachment_bytes)
        || !(1..=10000).contains(&input.hourly_recipients)
        || !(1..=100000).contains(&input.daily_recipients)
        || input.daily_recipients < input.hourly_recipients
    {
        return Err(Error(StatusCode::BAD_REQUEST, "policy_invalid"));
    }
    if input.enabled {
        readiness::check(&app).await?;
    }
    if input.enabled && !readiness::ready(&app).await? {
        return Err(Error(
            StatusCode::CONFLICT,
            "registration_dependencies_missing",
        ));
    }
    if app.domain_id != "default" {
        db::query(db::Statement::ConnectionPolicySet)
            .bind(serde_json::to_string(&input).map_err(|_| internal("policy"))?)
            .bind(&app.domain_id)
            .execute(&app.db)
            .await?;
    } else {
        db::query(db::Statement::AccountPutSettingsUpdatePlatformSettings)
            .bind(serde_json::to_string(&input).map_err(|_| internal("policy"))?)
            .execute(&app.db)
            .await?;
    }
    audit_event(&app, me.user, "registration.update", me.user, "success").await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(get,path="/api/v1/admin/audit",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn audit(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    operator(&app, &headers, false).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    let rows = db::query(db::Statement::AccountAuditSelectAuditEvents)
        .bind(&app.domain_id)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<Uuid,_>("id"),"actorId":r.get::<Option<Uuid>,_>("actor_id"),"subjectId":r.get::<Option<Uuid>,_>("subject_id"),"action":r.get::<String,_>("action"),"outcome":r.get::<String,_>("outcome"),"createdAt":r.get::<i64,_>("created_at")})).collect::<Vec<_>>()}),
    ))
}
#[utoipa::path(get,path="/api/v1/admin/tasks",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),responses((status=200,body=Value),(status=204,description="Completed"),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn tasks(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    operator(&app, &headers, false).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    let pending: i64 = db::scalar(db::Statement::AccountTasksSelectCredentialRevocations)
        .bind(&app.domain_id)
        .fetch_one(&app.db)
        .await?;
    let policy_jobs: i64 = db::scalar(db::Statement::AccountTasksSelectCredentialJobs)
        .bind(&app.domain_id)
        .fetch_one(&app.db)
        .await?;
    let reconciliation: i64 = db::scalar(db::Statement::AccountTasksSelectPlatformUsers)
        .bind(&app.domain_id)
        .fetch_one(&app.db)
        .await?;
    Ok(Json(
        json!({"accountPolicyJobs":policy_jobs,"credentialRevocations":pending,"registrationReconciliation":reconciliation}),
    ))
}
#[utoipa::path(post,path="/api/v1/admin/tasks/retry",params(("domainId"=Option<String>,Query,description="Stable local domain ID; omitted uses the migrated default domain")),responses((status=200,body=Value),(status=401,description="Session required"),(status=403,description="Denied")))]
pub(super) async fn retry_tasks(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let me = operator(&app, &headers, true).await?;
    let app = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    let mut tx = db::begin(&app.db).await?;
    let policy = db::query(db::Statement::AccountRetryTasksUpdateCredentialJobs)
        .bind(db::now())
        .bind(&app.domain_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let credentials = db::query(db::Statement::AccountRetryTasksUpdateCredentialRevocations)
        .bind(db::now())
        .bind(&app.domain_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    JOB_NOTIFY.notify_one();
    let automatic = gateway::retry(&app).await?;
    audit_event(&app, me.user, "task.retry", me.user, "queued").await?;
    Ok(Json(json!({"queued":policy+credentials+automatic})))
}

#[cfg(test)]
mod generated_name_tests {
    use super::*;
    #[test]
    fn only_exact_provisioning_markers_are_repaired() {
        let id = Uuid::new_v4();
        assert!(is_generated_display_name(&format!("mail-web:{id}")));
        assert!(is_generated_display_name(&format!(
            "mail-web:{id}:operator"
        )));
        assert!(!is_generated_display_name("Sakura"));
        assert!(!is_generated_display_name("mail-web:custom name"));
        assert!(!is_generated_display_name(&format!(
            "mail-web:{id}:notification"
        )));
    }
}
