use super::*;
use axum::{body::Body, http::Request};
use tower::ServiceExt;

#[tokio::test]
async fn session_isolation_csrf_revocation_and_operator_boundary() {
    let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
    let pool = db::connect(&root.join("test.sqlite")).await.unwrap();
    let vault = Vault::new(&[9; 32]).unwrap();
    for (name, sid) in [("alice", "session-a"), ("bob", "session-b")] {
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO platform_users(id,email,recovery_email,stalwart_id,status) VALUES (?,?,?,?,'active')").bind(user).bind(format!("{name}@mail.example")).bind(format!("{name}@example.net")).bind(name).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO sessions(id_hash,user_id,csrf_hash,upstream_key,upstream_key_id,expires_at) VALUES (?,?,?,?,?,?)").bind(hash(sid)).bind(user).bind(hash("csrf")).bind(vault.seal(name.as_bytes()).unwrap()).bind(name).bind(db::now()+3600000).execute(&pool).await.unwrap();
    }
    let app = Arc::new(App {
        root: None,
        revision: 0,
        service_id: "default".into(),
        domain_id: "default".into(),
        db: pool,
        upstream: Stalwart {
            http: reqwest::Client::new(),
            base: "https://unused.invalid".into(),
        },
        vault,
        origin: "https://mail.example.com".into(),
        direct_origin: None,
        services: config::Services {
            domain: "mail.example".into(),
            ..config::Services::default()
        },
    });
    let routes = Router::new()
        .merge(account::routes())
        .merge(deployment::routes())
        .route("/auth/session", get(session))
        .with_state(app.clone());
    let request = |method: &str, path: &str, origin: &str, csrf: &str| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("cookie", "__Host-mail_session=session-a")
            .header("host", "mail.example.com")
            .header("origin", origin)
            .header("x-csrf-token", csrf)
            .body(Body::empty())
            .unwrap()
    };
    let version_request = Request::builder()
        .method("POST")
        .uri("/admin/deployment/jobs")
        .header("host", "mail.example.com")
        .header("origin", "https://mail.example.com")
        .header("cookie", "__Host-mail_session=session-a")
        .header("x-csrf-token", "csrf")
        .header("content-type", "application/json")
        .body(Body::from(json!({"id":"a".repeat(32),"expectedVersion":"v0.4.0-alpha.4","operation":"update","target":"v0.5.0"}).to_string()))
        .unwrap();
    assert_eq!(
        routes
            .clone()
            .oneshot(version_request)
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        routes
            .clone()
            .oneshot(request(
                "GET",
                "/admin/users",
                "https://mail.example.com",
                "csrf"
            ))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        routes
            .clone()
            .oneshot(request(
                "POST",
                "/auth/sessions/revoke-others",
                "https://evil.example",
                "csrf"
            ))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        routes
            .clone()
            .oneshot(request(
                "POST",
                "/auth/sessions/revoke-others",
                "https://mail.example.com",
                "wrong"
            ))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        routes
            .clone()
            .oneshot(request(
                "DELETE",
                &format!("/auth/sessions/{}", hash("session-b")),
                "https://mail.example.com",
                "csrf"
            ))
            .await
            .unwrap()
            .status(),
        204
    );
    let revoked: Option<i64> =
        sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE id_hash=?")
            .bind(hash("session-b"))
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert!(revoked.is_none(), "Alice must not revoke Bob's session");
    let alice: Uuid =
        sqlx::query_scalar("SELECT id FROM platform_users WHERE email='alice@mail.example'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    sqlx::query("UPDATE platform_users SET operator=1 WHERE id=?")
        .bind(alice)
        .execute(&app.db)
        .await
        .unwrap();
    for (id, lease) in [("waiting", 0), ("running", db::now() + 60000)] {
        sqlx::query("INSERT INTO credential_jobs(id,kind,user_id,payload,attempts,next_attempt,lease_until) VALUES (?,'account-policy',?,'{}',1,?,?)")
            .bind(id).bind(alice).bind(db::now()+60000).bind(lease).execute(&app.db).await.unwrap();
    }
    let retried = routes
        .clone()
        .oneshot(request(
            "POST",
            "/admin/tasks/retry",
            "https://mail.example.com",
            "csrf",
        ))
        .await
        .unwrap();
    assert_eq!(retried.status(), 200);
    let waiting: i64 =
        sqlx::query_scalar("SELECT next_attempt FROM credential_jobs WHERE id='waiting'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    let running: i64 =
        sqlx::query_scalar("SELECT next_attempt FROM credential_jobs WHERE id='running'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(waiting, 0);
    assert!(
        running > db::now(),
        "Manual retries must not steal an active task lease"
    );
    let before_poll = db::now() - 1000;
    sqlx::query("UPDATE sessions SET last_seen=? WHERE id_hash=?")
        .bind(before_poll)
        .bind(hash("session-a"))
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(
        routes
            .clone()
            .oneshot(request(
                "GET",
                "/auth/session",
                "https://mail.example.com",
                "csrf"
            ))
            .await
            .unwrap()
            .status(),
        200
    );
    let after_poll: i64 = sqlx::query_scalar("SELECT last_seen FROM sessions WHERE id_hash=?")
        .bind(hash("session-a"))
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(
        before_poll, after_poll,
        "Passive session probes must not extend idle expiry"
    );
    sqlx::query("UPDATE sessions SET last_seen=? WHERE id_hash=?")
        .bind(db::now() - 1800001)
        .bind(hash("session-a"))
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(
        routes
            .oneshot(request(
                "GET",
                "/auth/session",
                "https://mail.example.com",
                "csrf"
            ))
            .await
            .unwrap()
            .status(),
        401
    );
    app.db.close().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn hostile_html_has_no_active_or_remote_content() {
    let cleaned = safe_html(
        "<script>alert(1)</script><img src='https://track.example/a'><iframe src='https://evil.example'></iframe><a href='javascript:alert(1)' onclick='evil()'>open</a><form action='https://evil.example'>form</form><p>hello</p>",
    );
    for forbidden in [
        "<script",
        "<img",
        "<iframe",
        "javascript:",
        "onclick",
        "<form",
    ] {
        assert!(!cleaned.contains(forbidden), "{cleaned}");
    }
    assert!(cleaned.contains("hello"));
    let link = safe_html("<a href='https://example.com'>safe link</a>");
    assert!(link.contains("target=\"_blank\""));
    assert!(link.contains("noopener noreferrer"));
    let quote = html_to_plain(&safe_html(
        "<p>Hello &amp; friends</p><p>Next paragraph</p>",
    ));
    assert!(quote.contains("Hello & friends"));
    assert!(quote.contains("Next paragraph"));
}

#[test]
fn contract_covers_every_business_group() {
    use utoipa::OpenApi;
    let document = serde_json::to_value(ApiDoc::openapi()).unwrap();
    for path in [
        "/auth/login",
        "/auth/register",
        "/auth/recovery",
        "/mailboxes",
        "/messages",
        "/drafts",
        "/submissions",
        "/attachments",
        "/events",
        "/account",
        "/admin/users",
        "/admin/registration",
    ] {
        assert!(
            document["paths"][format!("/api/v1{path}")].is_object(),
            "missing {path}"
        );
    }
}

#[tokio::test]
async fn backup_entry_checks_host_origin_and_session_independently() {
    let dir = std::env::temp_dir().join(Uuid::new_v4().to_string());
    let pool = db::connect(&dir.join("test.sqlite")).await.unwrap();
    let vault = Vault::new(&[7; 32]).unwrap();
    let user = Uuid::new_v4();
    sqlx::query("INSERT INTO platform_users(id,email,recovery_email,stalwart_id,status,operator) VALUES (?,'operator@example.com','test@example.net','local','active',1)")
        .bind(user).execute(&pool).await.unwrap();
    let app = App {
        root: None,
        revision: 0,
        service_id: "default".into(),
        domain_id: "default".into(),
        db: pool,
        upstream: Stalwart {
            http: reqwest::Client::new(),
            base: "https://unused.invalid".into(),
        },
        vault,
        origin: "https://mail.example.com".into(),
        direct_origin: Some("http://[2001:db8::2]:8088".into()),
        services: config::Services::default(),
    };
    let origin = app.direct_origin.as_deref().unwrap();
    let h = |host: &str, origin: &str, cookie: &str| {
        let mut h = HeaderMap::new();
        for (key, value) in [
            ("host", host),
            ("origin", origin),
            ("cookie", cookie),
            ("x-csrf-token", "csrf"),
        ] {
            h.insert(key, HeaderValue::from_str(value).unwrap());
        }
        h
    };
    let ip = h("[2001:db8::2]:8088", origin, "mail_session=direct");
    let domain = h("mail.example.com", &app.origin, "__Host-mail_session=web");
    for (headers, token) in [(&ip, "direct"), (&domain, "web")] {
        let access = access::request(&app, headers).unwrap();
        sqlx::query("INSERT INTO sessions(id_hash,user_id,csrf_hash,upstream_key,upstream_key_id,expires_at) VALUES (?,?,?,?,?,?)")
            .bind(access.session_digest(token)).bind(user).bind(hash("csrf"))
            .bind(app.vault.seal(b"test-key").unwrap()).bind(token).bind(db::now()+60000)
            .execute(&app.db).await.unwrap();
        assert_eq!(
            access.cookie_security(),
            if token == "web" { "; Secure" } else { "" }
        );
        assert!(identity(&app, headers, true).await.unwrap().operator);
    }
    let cross = h("[2001:db8::2]:8088", &app.origin, "mail_session=direct");
    assert!(matches!(
        identity(&app, &cross, true).await,
        Err(Error(_, "origin_invalid"))
    ));
    let replay = h("[2001:db8::2]:8088", origin, "mail_session=web");
    assert!(matches!(
        identify(&app, &replay, false, false).await,
        Err(Error(_, "session_expired"))
    ));
    let replay = h(
        "mail.example.com",
        &app.origin,
        "__Host-mail_session=direct",
    );
    assert!(matches!(
        identify(&app, &replay, false, false).await,
        Err(Error(_, "session_expired"))
    ));
    let mut foreign = h("foreign.example", origin, "mail_session=direct");
    foreign.insert(
        "x-forwarded-host",
        HeaderValue::from_static("[2001:db8::2]:8088"),
    );
    foreign.insert("x-forwarded-proto", HeaderValue::from_static("http"));
    assert!(matches!(
        identity(&app, &foreign, true).await,
        Err(Error(_, "origin_invalid"))
    ));
    assert!(matches!(
        access::require_primary(&app, &ip),
        Err(Error(_, "primary_origin_required"))
    ));
    let mut conflicting = ip.clone();
    conflicting.append(
        "origin",
        HeaderValue::from_static("https://foreign.example"),
    );
    assert!(same_origin(&app, &conflicting).is_err());
    assert_eq!(app.hook_url(), "https://mail.example.com/internal/mta-hook");
    app.db.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}
