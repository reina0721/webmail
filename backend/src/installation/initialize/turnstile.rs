//! Repair Turnstile independently of mail-server administrative authorization.
use super::*;
use sha2::{Digest, Sha256};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnstileInput {
    #[schema(write_only)]
    cloudflare_token: String,
    #[serde(default)]
    cloudflare_account: String,
    #[serde(default)]
    repair: bool,
    #[serde(default)]
    replace_missing: bool,
    public_origin: Option<String>,
    site_key: Option<String>,
}
impl Drop for TurnstileInput {
    fn drop(&mut self) {
        self.cloudflare_token.zeroize();
    }
}
impl TurnstileInput {
    fn validate(&mut self) -> Result<()> {
        if self.cloudflare_token.trim().is_empty() || self.cloudflare_token.len() > 4096 {
            return Err(Error(StatusCode::BAD_REQUEST, "cloudflare_token_required"));
        }
        self.cloudflare_account = self.cloudflare_account.trim().to_owned();
        Ok(())
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnstileResult {
    configured: bool,
    restart_required: bool,
    action: &'static str,
    site_key: String,
    turnstile_binding: Option<config::TurnstileBinding>,
}
async fn permitted(app: &App, headers: &HeaderMap, require_configured: bool) -> Result<String> {
    let who = owner(app, headers, true).await?;
    if require_configured && !configured(app) {
        return Err(Error(StatusCode::BAD_REQUEST, "setup_required"));
    }
    policy::rate(app, &format!("turnstile:{who}"), 20, 60_000).await?;
    Ok(who)
}
#[utoipa::path(post,tag="installation",path="/api/v1/installation/turnstile/accounts",request_body=TurnstileInput,responses((status=200,body=Value)))]
pub(crate) async fn accounts(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(mut input): Json<TurnstileInput>,
) -> Result<Json<Value>> {
    permitted(&app, &headers, false).await?;
    input.validate()?;
    let accounts = cloudflare::accounts(&app, input.cloudflare_token.trim()).await?;
    Ok(Json(
        json!({"accounts":accounts,"accountIdRequired":accounts.as_array().is_none_or(Vec::is_empty)}),
    ))
}

/// The encrypted journal preserves ownership across lost replies without storing the API token.
async fn complete(
    app: &App,
    saved: &mut RuntimeConfig,
    input: &TurnstileInput,
    who: String,
    path: &std::path::Path,
    api: &str,
) -> Result<&'static str> {
    if input
        .public_origin
        .as_ref()
        .is_some_and(|origin| origin != &saved.origin)
    {
        return Err(Error(StatusCode::CONFLICT, "turnstile_origin_changed"));
    }
    if input
        .site_key
        .as_ref()
        .is_some_and(|site| site != &saved.services.turnstile_site_key)
    {
        return Err(Error(StatusCode::CONFLICT, "turnstile_keys_changed"));
    }
    let host = cloudflare::hostname(&saved.origin)?;
    let token = input.cloudflare_token.trim();
    if !cloudflare::account_id(&input.cloudflare_account) || token.is_empty() {
        return Err(Error(
            StatusCode::BAD_REQUEST,
            "cloudflare_account_and_token_required",
        ));
    }
    let replacing = input.repair && saved.services.turnstile_ready();
    if replacing {
        match cloudflare::repair_at(app, saved, token, &input.cloudflare_account, &host, api).await
        {
            Ok((binding, changed)) => {
                saved.services.turnstile_binding = Some(binding);
                return Ok(if changed { "repaired" } else { "verified" });
            }
            Err(Error(_, "turnstile_widget_missing")) if input.replace_missing => {}
            Err(error) => return Err(error),
        }
    }
    let contextual_path;
    let path = if replacing
        || journal::read_at(app, path)?.is_some_and(|job| {
            !saved.services.turnstile_ready()
                && (job.spec.cloudflare_account != input.cloudflare_account
                    || job.spec.public_origin != saved.origin)
        }) {
        let scope = (
            &input.cloudflare_account,
            &saved.origin,
            &saved.services.turnstile_site_key,
        );
        let hash = Sha256::digest(
            serde_json::to_vec(&scope).map_err(|_| internal("turnstile_configuration_invalid"))?,
        );
        contextual_path = path.with_file_name(format!("turnstile-setup-{hash:x}.enc"));
        contextual_path.as_path()
    } else {
        path
    };
    let mut job = match journal::read_at(app, path)? {
        Some(job) => {
            if job.spec.cloudflare_account != input.cloudflare_account
                || job.spec.public_origin != saved.origin
            {
                return Err(Error(
                    StatusCode::CONFLICT,
                    "turnstile_configuration_conflict",
                ));
            }
            job
        }
        None => {
            if saved.services.turnstile_ready() && !replacing {
                return Err(Error(StatusCode::CONFLICT, "turnstile_already_configured"));
            }
            let spec: Spec = serde_json::from_value(json!({"brand":saved.services.brand,"domain":saved.services.domain,"publicOrigin":saved.origin,"cloudflareAccount":input.cloudflare_account}))
                .map_err(|_| internal("turnstile_configuration_invalid"))?;
            Job::new(who, saved.stalwart_url.clone(), spec)
        }
    };
    if !replacing
        && saved.services.turnstile_ready()
        && (saved.services.turnstile_site_key != job.resource("turnstile")
            || saved.services.turnstile_secret != job.secret("turnstile"))
    {
        return Err(Error(StatusCode::CONFLICT, "turnstile_already_configured"));
    }
    if !job.resource("turnstile").is_empty() {
        // A restored snapshot can reference a replacement that was later deleted.
        let mut staged = saved.clone();
        staged.services.turnstile_site_key = job.resource("turnstile");
        staged.services.turnstile_secret = job.secret("turnstile");
        match cloudflare::repair_at(app, &staged, token, &input.cloudflare_account, &host, api)
            .await
        {
            Ok((binding, _)) => job.turnstile_binding = Some(binding),
            Err(Error(_, "turnstile_widget_missing"))
                if replacing || !saved.services.turnstile_ready() =>
            {
                job = Job::new(job.owner, job.base, job.spec);
            }
            Err(error) => return Err(error),
        }
    }
    cloudflare::create_at(app, &mut job, token, api, &|job| {
        journal::write_at(app, job, path)
    })
    .await?;
    let site = job.resource("turnstile");
    let secret = job.secret("turnstile");
    if site.is_empty() || secret.is_empty() {
        return Err(Error(
            StatusCode::BAD_GATEWAY,
            "turnstile_secret_unavailable",
        ));
    }
    validate_turnstile(&site, Some(&secret))?;
    saved.services.turnstile_site_key = site;
    saved.services.turnstile_secret = secret;
    saved.services.turnstile_binding = job.turnstile_binding;
    Ok(if replacing { "replaced" } else { "created" })
}
#[utoipa::path(post,tag="installation",path="/api/v1/installation/turnstile",request_body=TurnstileInput,responses((status=200,body=TurnstileResult),(status=409,description="The current widget or website needs attention")))]
pub(crate) async fn configure(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(mut input): Json<TurnstileInput>,
) -> Result<Json<TurnstileResult>> {
    let who = permitted(&app, &headers, true).await?;
    input.validate()?;
    let _lock = CONFIG_LOCK.lock().await;
    if super::active(&app).await? {
        return Err(Error(StatusCode::CONFLICT, "initialization_running"));
    }
    let mut saved = load(&app.vault)
        .map_err(|_| internal("configuration_read"))?
        .or_else(|| {
            configured(&app).then(|| RuntimeConfig {
                version: 1,
                origin: app.origin.clone(),
                stalwart_url: app.upstream.base.clone(),
                services: app.services.clone(),
            })
        })
        .ok_or(Error(StatusCode::BAD_REQUEST, "setup_required"))?;
    let path = config_path().with_file_name("turnstile-setup.enc");
    let action = complete(&app, &mut saved, &input, who, &path, cloudflare::API).await?;
    persist(&app.vault, &saved)?;
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        RELOAD.notify_one();
    });
    Ok(Json(TurnstileResult {
        configured: true,
        restart_required: true,
        action,
        site_key: saved.services.turnstile_site_key,
        turnstile_binding: saved.services.turnstile_binding,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    async fn fixture(root: &std::path::Path) -> App {
        App {
            root: None,
            revision: 0,
            service_id: "default".into(),
            domain_id: "default".into(),
            db: db::connect(&root.join("test.sqlite")).await.unwrap(),
            upstream: Stalwart {
                http: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
                base: "https://unused.invalid".into(),
            },
            vault: Vault::new(&[9; 32]).unwrap(),
            origin: "https://webmail.example.com".into(),
            direct_origin: None,
            services: config::Services {
                domain: "example.com".into(),
                brand: "Mail".into(),
                provisioning_key: "directory-key".into(),
                notification_key: "notification-key".into(),
                notification_account: "sender".into(),
                notification_email: "sender@example.com".into(),
                domain_id: "domain".into(),
                hook_id: "owned-hook".into(),
                hook_secret: "hook-key".into(),
                ..Default::default()
            },
        }
    }
    #[tokio::test]
    async fn token_only_repair_preserves_mail_configuration_and_reconciles_lost_reply() {
        let root = std::env::temp_dir().join(format!("turnstile-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let app = fixture(&root).await;
        assert!(app.services.mail_ready());
        assert!(!app.services.ready());
        let calls = Arc::new(AtomicUsize::new(0));
        let created = Arc::new(tokio::sync::Mutex::new(None::<Value>));
        let requests = calls.clone();
        let widgets = created.clone();
        let router=Router::new().fallback(move |method:reqwest::Method,uri:axum::http::Uri,headers:HeaderMap,body:axum::body::Bytes|{
            let requests=requests.clone();let widgets=widgets.clone();async move {
                assert_eq!(headers.get("authorization").unwrap(),"Bearer isolated-turnstile-token");
                if uri.path()=="/accounts" {return (StatusCode::FORBIDDEN,Json(json!({"success":false})));}
                assert!(uri.path().starts_with("/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/challenges/widgets"));
                if method==reqwest::Method::POST {
                    requests.fetch_add(1,Ordering::SeqCst);
                    let spec:Value=serde_json::from_slice(&body).unwrap();
                    assert_eq!(spec["domains"],json!(["webmail.example.com"]));
                    assert_eq!(spec["mode"],"managed");
                    *widgets.lock().await=Some(json!({"name":spec["name"],"domains":spec["domains"],"sitekey":"owned-site-key","secret":"owned-turnstile-secret"}));
                    // The provider accepted creation, but the response was lost.
                    return (StatusCode::BAD_GATEWAY,Json(json!({"success":false})));
                }
                let widget=widgets.lock().await.clone();
                let result=if uri.path().ends_with("/owned-site-key") {widget.unwrap()}else{json!(widget.into_iter().collect::<Vec<_>>())};
                (StatusCode::OK,Json(json!({"success":true,"result":result})))
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let base = format!("http://{address}");
        assert_eq!(
            cloudflare::accounts_at(&app, "isolated-turnstile-token", &base)
                .await
                .unwrap(),
            json!([])
        );
        let mut saved = RuntimeConfig {
            version: 1,
            origin: app.origin.clone(),
            stalwart_url: app.upstream.base.clone(),
            services: app.services.clone(),
        };
        // Previously accepted URL values must remain repairable.
        saved.services.turnstile_site_key = "http://85.155.115.98:8088".into();
        saved.services.turnstile_secret = "wrong-but-nonempty".into();
        let before = serde_json::to_value(&saved).unwrap();
        let path = root.join("turnstile-setup.enc");
        let input = TurnstileInput {
            cloudflare_token: "isolated-turnstile-token".into(),
            cloudflare_account: "a".repeat(32),
            repair: false,
            replace_missing: false,
            public_origin: None,
            site_key: None,
        };
        assert!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .is_err()
        );
        assert_eq!(serde_json::to_value(&saved).unwrap(), before);
        complete(&app, &mut saved, &input, "operator".into(), &path, &base)
            .await
            .unwrap();
        complete(&app, &mut saved, &input, "operator".into(), &path, &base)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(saved.services.ready());
        let mut after = serde_json::to_value(&saved).unwrap();
        after["services"]["turnstile_site_key"] = before["services"]["turnstile_site_key"].clone();
        after["services"]["turnstile_secret"] = before["services"]["turnstile_secret"].clone();
        after["services"]
            .as_object_mut()
            .unwrap()
            .remove("turnstile_binding");
        assert_eq!(after, before);
        let bytes = app.vault.open(&std::fs::read(&path).unwrap()).unwrap();
        assert!(
            !String::from_utf8(bytes)
                .unwrap()
                .contains("isolated-turnstile-token")
        );
        let other = TurnstileInput {
            cloudflare_token: "isolated-turnstile-token".into(),
            cloudflare_account: "a".repeat(32),
            repair: false,
            replace_missing: false,
            public_origin: None,
            site_key: None,
        };
        saved.services.turnstile_site_key = "manually-configured-site".into();
        assert_eq!(
            complete(&app, &mut saved, &other, "operator".into(), &path, &base)
                .await
                .unwrap_err()
                .1,
            "turnstile_already_configured"
        );
        server.abort();
        app.db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn migrated_site_checks_ownership_repairs_binding_and_replaces_only_on_request() {
        let root = std::env::temp_dir().join(format!("turnstile-migration-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let app = fixture(&root).await;
        let old = json!({
            "sitekey":"old-site-key","secret":"original-secret","name":"original-widget",
            "domains":["old.example.com","other.example.org"],"mode":"invisible",
            "clearance_level":"no_clearance","region":"world"
        });
        let widget = Arc::new(tokio::sync::Mutex::new(Some(old.clone())));
        let (updates, creates) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let (provider, put, post) = (widget.clone(), updates.clone(), creates.clone());
        let router = Router::new().fallback(
            move |method: reqwest::Method, uri: axum::http::Uri, body: axum::body::Bytes| {
                let (provider, put, post) = (provider.clone(), put.clone(), post.clone());
                async move {
                    let mut widget = provider.lock().await;
                    let result = if method == reqwest::Method::PUT {
                        assert!(uri.path().ends_with("/old-site-key"));
                        put.fetch_add(1, Ordering::SeqCst);
                        let payload: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(payload["mode"], "invisible");
                        assert_eq!(payload["clearance_level"], "no_clearance");
                        assert_eq!(payload["region"], "world");
                        assert_eq!(payload["name"], "original-widget");
                        assert!(payload.get("secret").is_none());
                        let value = widget.as_mut().unwrap();
                        value["domains"] = payload["domains"].clone();
                        value.clone()
                    } else if method == reqwest::Method::POST {
                        let number = post.fetch_add(1, Ordering::SeqCst) + 1;
                        let payload: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(payload["domains"], json!(["webmail.example.com"]));
                        let mut created = payload;
                        created["sitekey"] = json!(format!("replacement-key-{number}"));
                        created["secret"] = json!("replacement-secret");
                        *widget = Some(created.clone());
                        created
                    } else if uri.path().ends_with("/challenges/widgets") {
                        json!(widget.iter().collect::<Vec<_>>())
                    } else {
                        widget.clone().unwrap()
                    };
                    Json(json!({"success":true,"result":result}))
                }
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let mut saved = RuntimeConfig {
            version: 1,
            origin: app.origin.clone(),
            stalwart_url: app.upstream.base.clone(),
            services: app.services.clone(),
        };
        saved.services.turnstile_site_key = "old-site-key".into();
        saved.services.turnstile_secret = "wrong-secret".into();
        let path = root.join("turnstile-setup.enc");
        let mut input = TurnstileInput {
            cloudflare_token: "isolated-token".into(),
            cloudflare_account: "a".repeat(32),
            repair: true,
            replace_missing: false,
            public_origin: Some("https://previous.example.com".into()),
            site_key: Some("old-site-key".into()),
        };
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap_err()
                .1,
            "turnstile_origin_changed"
        );
        input.public_origin = Some(saved.origin.clone());
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap_err()
                .1,
            "turnstile_widget_secret_mismatch"
        );
        assert_eq!(updates.load(Ordering::SeqCst), 0);
        saved.services.turnstile_secret = "original-secret".into();
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap(),
            "repaired"
        );
        assert_eq!(saved.services.turnstile_site_key, "old-site-key");
        assert_eq!(saved.services.turnstile_secret, "original-secret");
        assert_eq!(
            saved.services.turnstile_binding.as_ref().unwrap().hostnames,
            [
                "old.example.com",
                "other.example.org",
                "webmail.example.com"
            ]
        );
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap(),
            "verified"
        );
        assert_eq!(updates.load(Ordering::SeqCst), 1);

        *widget.lock().await = None;
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap_err()
                .1,
            "turnstile_widget_missing"
        );
        assert_eq!(creates.load(Ordering::SeqCst), 0);
        input.replace_missing = true;
        let snapshot = saved.clone();
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap(),
            "replaced"
        );
        assert_eq!(saved.services.turnstile_site_key, "replacement-key-1");
        assert_eq!(
            saved.services.turnstile_binding.as_ref().unwrap().hostnames,
            ["webmail.example.com"]
        );
        input.site_key = Some(saved.services.turnstile_site_key.clone());
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap(),
            "verified"
        );
        assert_eq!(creates.load(Ordering::SeqCst), 1);
        // Both widgets can be deleted while the old key is restored from a snapshot.
        *widget.lock().await = None;
        saved = snapshot;
        input.site_key = Some(saved.services.turnstile_site_key.clone());
        assert_eq!(
            complete(&app, &mut saved, &input, "operator".into(), &path, &base)
                .await
                .unwrap(),
            "replaced"
        );
        assert_eq!(saved.services.turnstile_site_key, "replacement-key-2");
        assert_eq!(creates.load(Ordering::SeqCst), 2);
        server.abort();
        app.db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn turnstile_repair_requires_operator_and_exact_origin() {
        let root = std::env::temp_dir().join(format!("turnstile-auth-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let app = Arc::new(fixture(&root).await);
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO platform_users(id,email,recovery_email,stalwart_id,status) VALUES (?,?,?,?,'active')").bind(user).bind("operator@example.com").bind("recover@example.net").bind("ordinary").execute(&app.db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id_hash,user_id,csrf_hash,upstream_key,upstream_key_id,expires_at) VALUES (?,?,?,?,?,?)").bind(hash("session")).bind(user).bind(hash("csrf")).bind(app.vault.seal(b"key").unwrap()).bind("key").bind(db::now()+60000).execute(&app.db).await.unwrap();
        let router = routes().with_state(app.clone());
        for path in [
            "/installation/turnstile/accounts",
            "/installation/turnstile",
        ] {
            let request = |cookie: bool, origin: &str| {
                let mut request = Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("host", "webmail.example.com")
                    .header("origin", origin)
                    .header("content-type", "application/json")
                    .header("x-csrf-token", "csrf");
                if cookie {
                    request = request.header("cookie", "__Host-mail_session=session");
                }
                request.body(Body::from(r#"{"cloudflareToken":"test-only","cloudflareAccount":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#)).unwrap()
            };
            assert_eq!(
                router
                    .clone()
                    .oneshot(request(false, "https://webmail.example.com"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::UNAUTHORIZED
            );
            assert_eq!(
                router
                    .clone()
                    .oneshot(request(true, "https://webmail.example.com"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN
            );
            sqlx::query("UPDATE platform_users SET operator=1 WHERE id=?")
                .bind(user)
                .execute(&app.db)
                .await
                .unwrap();
            assert_eq!(
                router
                    .clone()
                    .oneshot(request(true, "https://evil.example"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN
            );
            sqlx::query("UPDATE platform_users SET operator=0 WHERE id=?")
                .bind(user)
                .execute(&app.db)
                .await
                .unwrap();
        }
        sqlx::query("UPDATE platform_users SET operator=1 WHERE id=?")
            .bind(user)
            .execute(&app.db)
            .await
            .unwrap();
        for (site, secret) in [
            ("http://85.155.115.98:8088", "token"),
            ("valid-site", "https://example.com"),
        ] {
            let response = crate::installation::routes().with_state(app.clone()).oneshot(Request::builder().method("PUT")
                .uri("/installation/config").header("host", "webmail.example.com").header("origin", &app.origin)
                .header("content-type", "application/json").header("x-csrf-token", "csrf")
                .header("cookie", "__Host-mail_session=session")
                .body(Body::from(json!({"brand":"Mail","domain":"example.com","publicOrigin":app.origin,"stalwartUrl":app.upstream.base,"turnstileSiteKey":site,"turnstileSecret":secret}).to_string())).unwrap()).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let bytes = axum::body::to_bytes(response.into_body(), 65536)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["code"], "turnstile_configuration_invalid");
        }
        app.db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
