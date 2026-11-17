//! Idempotent, ownership-checked official management API provisioning.
use super::*;
use crate::installation::initialize::Grant;
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{SigningKey, pkcs8::EncodePrivateKey};
pub(crate) const POLICY_VERSION: &str = "automatic-gateway-v2";
fn marker(app: &App) -> String {
    format!(
        "mail-web:gateway:{}:{}",
        &hash(&app.origin)[..16],
        app.service_id
    )
}

pub(crate) fn enabled() -> bool {
    std::env::var("MAIL_WEB_GATEWAY_HOST").is_ok_and(|s| !s.is_empty())
}
pub(crate) fn private_network() -> bool {
    std::env::var("MAIL_WEB_GATEWAY_PRIVATE").as_deref() == Ok("true")
}
async fn lock(app: &App) -> tokio::sync::OwnedMutexGuard<()> {
    static LOCKS: std::sync::LazyLock<
        std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    > = std::sync::LazyLock::new(Default::default);
    let mutex = LOCKS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(app.service_id.clone())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    mutex.lock_owned().await
}
async fn rpc(app: &App, access: Option<&Grant>, method: &str, args: Value) -> Result<Value> {
    if let Some(access) = access {
        access.call(app, method, args).await
    } else {
        Ok(app
            .upstream
            .call(&app.services.provisioning_key, method, args)
            .await?)
    }
}
async fn singleton(app: &App, access: Option<&Grant>, kind: &str) -> Result<Value> {
    rpc(
        app,
        access,
        &format!("{kind}/get"),
        json!({"ids":["singleton"]}),
    )
    .await?["list"]
        .as_array()
        .and_then(|v| v.first())
        .cloned()
        .ok_or(Error(StatusCode::BAD_GATEWAY, "gateway_settings_missing"))
}
async fn domain_rows(app: &App, access: Option<&Grant>) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    let mut position = 0;
    loop {
        let page = rpc(
            app,
            access,
            "x:Domain/query",
            json!({"position":position,"limit":100,"calculateTotal":true}),
        )
        .await?;
        let ids = page["ids"]
            .as_array()
            .ok_or(Error(StatusCode::BAD_GATEWAY, "gateway_domains_invalid"))?;
        if ids.is_empty() {
            break;
        }
        let found = rpc(
            app,
            access,
            "x:Domain/get",
            json!({"ids":ids,"properties":["id","name","description"]}),
        )
        .await?;
        rows.extend(found["list"].as_array().into_iter().flatten().cloned());
        position += ids.len();
        if page["total"]
            .as_u64()
            .is_some_and(|total| position as u64 >= total)
            || ids.len() < 100
        {
            break;
        }
    }
    Ok(rows)
}
fn created(value: &Value, key: &str) -> Result<String> {
    value["created"][key]["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or(Error(StatusCode::BAD_GATEWAY, "gateway_resource_rejected"))
}
pub(crate) async fn install(app: &App, access: &Grant) -> Result<()> {
    if !enabled() {
        return Ok(());
    }
    let _guard = lock(app).await;
    let mut config = if let Some(config) = configuration(app, false).await? {
        config
    } else {
        let routes = rpc(
            app,
            Some(access),
            "x:MtaRoute/get",
            json!({"properties":["description"]}),
        )
        .await?;
        if routes["list"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|r| super::internal_domain(r) && r["description"] != marker(app))
        {
            return Err(Error(
                StatusCode::CONFLICT,
                "gateway_owned_by_another_installation",
            ));
        }
        let url = reqwest::Url::parse(&app.upstream.base)
            .map_err(|_| internal("gateway_upstream_invalid"))?;
        Configuration {
            secret: token(),
            relay_email: format!(
                "mw-gateway-{}@{}",
                &hash(&format!("{}:{}", app.origin, app.service_id))[..16],
                app.services.domain
            ),
            relay_password: token(),
            relay_account: String::new(),
            smtp_host: url
                .host_str()
                .ok_or_else(|| internal("gateway_upstream_invalid"))?
                .into(),
            smtp_port: if private_network() { 25 } else { 465 },
            private_network: private_network(),
            proof_suffix: format!(
                "g{}.{}",
                &hash(&format!("{}:{}", app.origin, app.service_id))[..16],
                app.services.domain
            ),
            original_signing:
                singleton(app, Some(access), "x:SieveUserInterpreter").await?["dkimSignDomain"]
                    .clone(),
            original_route: singleton(app, Some(access), "x:MtaOutboundStrategy").await?["route"]
                .clone(),
            original_sender_match:
                singleton(app, Some(access), "x:MtaStageAuth").await?["mustMatchSender"].clone(),
            original_data_signing:
                singleton(app, Some(access), "x:MtaStageData").await?["dkimSignDomain"].clone(),
            original_sasl: singleton(app, Some(access), "x:MtaStageAuth").await?["saslMechanisms"]
                .clone(),
            applied: HashMap::new(),
            relay_source_ip: String::new(),
        }
    };
    if config.proof_suffix.ends_with(".gateway.mail-web.invalid") {
        let suffix = format!(
            "g{}.{}",
            &hash(&format!("{}:{}", app.origin, app.service_id))[..16],
            app.services.domain
        );
        let rows = db::query(db::Statement::GatewayProofs)
            .bind(&app.service_id)
            .fetch_all(&app.db)
            .await?;
        if rows
            .iter()
            .any(|r| r.get::<Option<String>, _>("upstream_domain").is_some())
        {
            return Err(Error(
                StatusCode::CONFLICT,
                "gateway_namespace_migration_requires_review",
            ));
        }
        db::query(db::Statement::GatewayProofRenameUnprovisioned)
            .bind(&config.proof_suffix)
            .bind(&suffix)
            .bind(&app.service_id)
            .execute(&app.db)
            .await?;
        config.proof_suffix = suffix;
    }
    save_configuration(app, &config, false).await?;
    let marker = format!(
        "mail-web:gateway:{}:{}",
        &hash(&app.origin)[..16],
        app.service_id
    );
    let accounts = rpc(
        app,
        Some(access),
        "x:Account/get",
        json!({"properties":["id","name","domainId","description"]}),
    )
    .await?;
    let name = config.relay_email.split('@').next().unwrap();
    let candidates = accounts["list"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["name"] == name && r["domainId"] == app.services.domain_id)
        .collect::<Vec<_>>();
    if let Some(account) = candidates.first() {
        if candidates.len() != 1
            || (account["description"] != marker
                && !(account["id"] == config.relay_account
                    && account["description"] == format!("mail-web:gateway:{}", app.service_id)))
            || (!config.relay_account.is_empty() && account["id"] != config.relay_account)
        {
            return Err(Error(StatusCode::CONFLICT, "gateway_resource_conflict"));
        }
        if config.relay_account.is_empty() {
            app.upstream
                .password_session(&config.relay_email, &config.relay_password)
                .await
                .map_err(|_| Error(StatusCode::CONFLICT, "gateway_resource_conflict"))?;
        }
        config.relay_account = account["id"].as_str().unwrap().into();
    } else if config.relay_account.is_empty() {
        config.relay_account=created(&rpc(app,Some(access),"x:Account/set",json!({"create":{"relay":{"@type":"User","name":name,"domainId":app.services.domain_id,"description":marker,"roles":{"@type":"User"},"credentials":{"0":{"@type":"Password","secret":config.relay_password}},"permissions":{"@type":"Replace","enabledPermissions":{"authenticate":true,"emailSend":true}}}}})).await?,"relay")?;
    } else {
        return Err(Error(StatusCode::CONFLICT, "gateway_relay_missing"));
    }
    save_configuration(app, &config, false).await?;
    sync(app, &mut config, Some(access)).await?;
    save_configuration(app, &config, true).await
}

async fn ensure_proof(
    app: &App,
    access: Option<&Grant>,
    domain: &str,
    user: Option<Uuid>,
    owner: &str,
) -> Result<()> {
    // Persist the key before contacting the server, so an interrupted create resumes.
    let key = SigningKey::generate(&mut rand::rngs::OsRng);
    let pem = zeroize::Zeroizing::new(
        key.to_pkcs8_pem(Default::default())
            .map_err(|_| internal("gateway_key_generation_failed"))?
            .to_string(),
    );
    db::query(db::Statement::GatewayProofPut)
        .bind(&app.service_id)
        .bind(domain)
        .bind(user)
        .bind(owner)
        .bind(STANDARD.encode(key.verifying_key().as_bytes()))
        .bind(app.vault.seal(pem.as_bytes()).map_err(internal)?)
        .execute(&app.db)
        .await?;
    let rows = db::query(db::Statement::GatewayProofs)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    let row = rows
        .iter()
        .find(|r| r.get::<String, _>("domain") == domain)
        .ok_or_else(|| internal("gateway_proof_missing"))?;
    if row.get::<Option<Uuid>, _>("user_id") != user
        || row.get::<Option<String>, _>("owner_email").as_deref() != Some(owner)
    {
        return Err(Error(StatusCode::CONFLICT, "gateway_owner_conflict"));
    }
    if row.get::<Option<String>, _>("upstream_signer").is_some() {
        return Ok(());
    }
    let marker = format!(
        "mail-web:gateway:{}:{}",
        &hash(&app.origin)[..16],
        app.service_id
    );
    let domain_ids = rpc(
        app,
        access,
        "x:Domain/query",
        json!({"filter":{"name":domain},"limit":10}),
    )
    .await?;
    let domains = rpc(
        app,
        access,
        "x:Domain/get",
        json!({"ids":domain_ids["ids"],"properties":["id","name","description"]}),
    )
    .await?;
    let existing = domains["list"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|r| r["name"] == domain);
    let domain_id = if let Some(existing) = existing {
        if existing["description"] != marker {
            return Err(Error(StatusCode::CONFLICT, "gateway_domain_conflict"));
        }
        existing["id"].as_str().unwrap().to_owned()
    } else {
        created(&rpc(app,access,"x:Domain/set",json!({"create":{"proof":{"name":domain,"description":marker,"certificateManagement":{"@type":"Manual"},"dkimManagement":{"@type":"Manual"},"dnsManagement":{"@type":"Manual"}}}})).await?,"proof")?
    };
    let signer_ids = rpc(
        app,
        access,
        "x:DkimSignature/query",
        json!({"filter":{"domainId":domain_id},"limit":10}),
    )
    .await?;
    let signers = rpc(
        app,
        access,
        "x:DkimSignature/get",
        json!({"ids":signer_ids["ids"],"properties":["id","domainId","selector","publicKey"]}),
    )
    .await?;
    let candidates = signers["list"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["domainId"] == domain_id)
        .collect::<Vec<_>>();
    let signer = if let Some(existing) = candidates.first() {
        if candidates.len() != 1
            || existing["selector"] != "mw-proof"
            || existing["publicKey"] != row.get::<String, _>("public_key")
        {
            return Err(Error(StatusCode::CONFLICT, "gateway_signer_conflict"));
        }
        existing["id"].as_str().unwrap().to_owned()
    } else {
        let pem = zeroize::Zeroizing::new(
            app.vault
                .open(&row.get::<Vec<u8>, _>("private_key"))
                .map_err(internal)?,
        );
        let pem = std::str::from_utf8(&pem).map_err(|_| internal("gateway_key_invalid"))?;
        created(&rpc(app,access,"x:DkimSignature/set",json!({"create":{"signer":{"@type":"Dkim1Ed25519Sha256","domainId":domain_id,"selector":"mw-proof","privateKey":{"@type":"Text","secret":pem},"headers":{"From":true,"To":true,"Subject":true,"Date":true,"Message-ID":true,"MIME-Version":true,"Content-Type":true}}}})).await?,"signer")?
    };
    db::query(db::Statement::GatewayProofUpstream)
        .bind(domain_id)
        .bind(signer)
        .bind(&app.service_id)
        .bind(domain)
        .execute(&app.db)
        .await?;
    Ok(())
}
fn quoted(value: &str) -> Result<String> {
    if value.contains(['\'', '\\', '\r', '\n']) {
        return Err(Error(
            StatusCode::BAD_REQUEST,
            "gateway_expression_value_invalid",
        ));
    }
    Ok(format!("'{value}'"))
}
fn prepend(original: &Value, conditions: Vec<Value>) -> Value {
    let mut values = conditions;
    let mut old = original["match"]
        .as_object()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    old.sort_by_key(|(k, _)| k.parse::<u64>().unwrap_or(u64::MAX));
    values.extend(old.into_iter().map(|(_, v)| v.clone()));
    let matches = values
        .into_iter()
        .enumerate()
        .map(|(i, v)| (i.to_string(), v))
        .collect::<serde_json::Map<_, _>>();
    json!({"match":matches,"else":original["else"]})
}
async fn apply_expression(
    app: &App,
    access: Option<&Grant>,
    config: &mut Configuration,
    kind: &str,
    field: &str,
    original: &Value,
    value: Value,
) -> Result<()> {
    let current = singleton(app, access, kind).await?[field].clone();
    let name = format!("{kind}:{field}");
    if current != *original && config.applied.get(&name) != Some(&current) && current != value {
        return Err(Error(
            StatusCode::CONFLICT,
            "gateway_settings_changed_externally",
        ));
    }
    if current != value {
        let mut patch = serde_json::Map::new();
        for key in current["match"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, _)| k)
        {
            patch.insert(format!("{field}/match/{key}"), Value::Null);
        }
        for (key, condition) in value["match"].as_object().into_iter().flatten() {
            patch.insert(format!("{field}/match/{key}"), condition.clone());
        }
        patch.insert(format!("{field}/else"), value["else"].clone());
        // Journal both possible results before a request whose response can be lost.
        config.applied.insert(name.clone(), value.clone());
        save_configuration(app, config, false).await?;
        rpc(
            app,
            access,
            &format!("{kind}/set"),
            json!({"update":{"singleton":patch}}),
        )
        .await?;
        if singleton(app, access, kind).await?[field] != value {
            return Err(Error(
                StatusCode::BAD_GATEWAY,
                "gateway_expression_verification_failed",
            ));
        }
    }
    config.applied.insert(name, value);
    Ok(())
}
pub(crate) async fn sync(
    app: &App,
    config: &mut Configuration,
    access: Option<&Grant>,
) -> Result<()> {
    verify_resources(app, access).await?;
    let users = db::query(db::Statement::GatewayUsers)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    for user in &users {
        let id: Uuid = user.get("id");
        let domain = format!("u{}.{}", id.simple(), config.proof_suffix);
        ensure_proof(
            app,
            access,
            &domain,
            Some(id),
            &user.get::<String, _>("email"),
        )
        .await?;
    }
    let domains = domain_rows(app, access).await?;
    for row in &domains {
        let Some(name) = row["name"].as_str() else {
            continue;
        };
        if name.ends_with(&format!(".{}", config.proof_suffix)) {
            continue;
        }
        ensure_proof(
            app,
            access,
            &format!("d{}.{}", &hash(name)[..24], config.proof_suffix),
            None,
            &format!("@{name}"),
        )
        .await?;
    }
    let proofs = db::query(db::Statement::GatewayProofs)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    let mut conditions = Vec::new();
    // User-specific ownership must precede the unmanaged-domain fallback.
    for managed in [true, false] {
        for row in &proofs {
            let owner = row
                .get::<Option<String>, _>("owner_email")
                .unwrap_or_default();
            if row.get::<Option<Uuid>, _>("user_id").is_some() != managed {
                continue;
            }
            let condition = if managed {
                format!("sender == {}", quoted(&owner)?)
            } else {
                format!(
                    "sender_domain == {}",
                    quoted(owner.trim_start_matches('@'))?
                )
            };
            conditions.push(json!({"if":condition,"then":quoted(&row.get::<String,_>("domain"))?}));
        }
    }
    let original = config.original_signing.clone();
    let signing = prepend(&original, conditions);
    apply_expression(
        app,
        access,
        config,
        "x:SieveUserInterpreter",
        "dkimSignDomain",
        &original,
        signing,
    )
    .await?;
    let marker = format!(
        "mail-web:gateway:{}:{}",
        &hash(&app.origin)[..16],
        app.service_id
    );
    let route_name = format!(
        "mw-gateway-{}",
        &hash(&format!("{}:{}", app.origin, app.service_id))[..16]
    );
    let routes = rpc(app, access, "x:MtaRoute/get", json!({})).await?;
    let route = routes["list"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|r| r["name"] == route_name);
    let host =
        std::env::var("MAIL_WEB_GATEWAY_HOST").map_err(|_| internal("gateway_host_missing"))?;
    let port = std::env::var("MAIL_WEB_GATEWAY_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(2526);
    let value = json!({"@type":"Relay","name":route_name,"description":marker,"host":host,"port":port,"protocol":"smtp","implicitTls":!config.private_network,"allowInvalidCerts":false,"authUsername":app.service_id,"authSecret":{"@type":"Value","secret":config.secret}});
    if let Some(route) = route {
        if route["description"] != marker {
            return Err(Error(StatusCode::CONFLICT, "gateway_route_conflict"));
        }
        let mut update = json!({});
        // Registry route names are immutable after creation. Updating a full
        // create object would reject every restart/recovery synchronization.
        let mut patch = value;
        patch.as_object_mut().unwrap().remove("name");
        patch.as_object_mut().unwrap().remove("@type");
        update[route["id"].as_str().unwrap()] = patch;
        rpc(app, access, "x:MtaRoute/set", json!({"update":update})).await?;
    } else {
        rpc(
            app,
            access,
            "x:MtaRoute/set",
            json!({"create":{"gateway":value}}),
        )
        .await?;
    }
    let original = config.original_route.clone();
    let routing = prepend(
        &original,
        vec![json!({"if":"source == 'autogenerated'","then":quoted(&route_name)?})],
    );
    apply_expression(
        app,
        access,
        config,
        "x:MtaOutboundStrategy",
        "route",
        &original,
        routing,
    )
    .await?;
    let identity = format!("authenticated_as == {}", quoted(&config.relay_email)?);
    let original = config.original_sender_match.clone();
    let matching = prepend(&original, vec![json!({"if":identity,"then":"false"})]);
    apply_expression(
        app,
        access,
        config,
        "x:MtaStageAuth",
        "mustMatchSender",
        &original,
        matching,
    )
    .await?;
    let original = config.original_data_signing.clone();
    let signing = prepend(
        &original,
        vec![
            json!({"if":format!("{identity} && is_local_domain(helo_domain)"),"then":"helo_domain"}),
        ],
    );
    apply_expression(
        app,
        access,
        config,
        "x:MtaStageData",
        "dkimSignDomain",
        &original,
        signing,
    )
    .await?;
    if config.private_network {
        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::net::TcpStream::connect((config.smtp_host.as_str(), config.smtp_port)),
        )
        .await
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "gateway_smtp_unreachable"))?
        .map_err(|_| Error(StatusCode::BAD_GATEWAY, "gateway_smtp_unreachable"))?;
        config.relay_source_ip = stream
            .local_addr()
            .map_err(|_| internal("gateway_local_address_missing"))?
            .ip()
            .to_string();
        let original = config.original_sasl.clone();
        let mechanisms = prepend(
            &original,
            vec![
                json!({"if":format!("remote_ip == {} && local_port == {}",quoted(&config.relay_source_ip)?,config.smtp_port),"then":"[plain]"}),
            ],
        );
        apply_expression(
            app,
            access,
            config,
            "x:MtaStageAuth",
            "saslMechanisms",
            &original,
            mechanisms,
        )
        .await?;
    }
    rpc(
        app,
        access,
        "x:Action/set",
        json!({"create":{"reload":{"@type":"ReloadSettings"}}}),
    )
    .await?;
    Ok(())
}

async fn verify_resources(app: &App, access: Option<&Grant>) -> Result<()> {
    let rows = db::query(db::Statement::GatewayProofs)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    let mut domains = HashMap::new();
    let mut signers = HashMap::new();
    for (kind, column, fields, output) in [
        (
            "x:Domain/get",
            "upstream_domain",
            json!(["id", "name", "description"]),
            &mut domains,
        ),
        (
            "x:DkimSignature/get",
            "upstream_signer",
            json!(["id", "domainId", "selector", "publicKey", "stage"]),
            &mut signers,
        ),
    ] {
        let ids = rows
            .iter()
            .filter_map(|r| r.get::<Option<String>, _>(column))
            .collect::<Vec<_>>();
        for ids in ids.chunks(100) {
            let result = rpc(app, access, kind, json!({"ids":ids,"properties":fields})).await?;
            for item in result["list"].as_array().into_iter().flatten() {
                if let Some(id) = item["id"].as_str() {
                    output.insert(id.to_owned(), item.clone());
                }
            }
        }
    }
    for row in rows {
        let (Some(domain), Some(signer)) = (
            row.get::<Option<String>, _>("upstream_domain"),
            row.get::<Option<String>, _>("upstream_signer"),
        ) else {
            continue;
        };
        if let (Some(remote_domain), Some(remote_signer)) =
            (domains.get(&domain), signers.get(&signer))
        {
            if remote_domain["description"] != marker(app)
                || remote_domain["name"] != row.get::<String, _>("domain")
                || remote_signer["publicKey"] != row.get::<String, _>("public_key")
                || remote_signer["selector"] != "mw-proof"
                || remote_signer["domainId"] != domain
                || remote_signer["stage"] != "active"
            {
                return Err(Error(
                    StatusCode::CONFLICT,
                    "gateway_signer_changed_externally",
                ));
            }
        } else {
            // A missing owned resource is recreated from its encrypted local key.
            db::query(db::Statement::GatewayProofReset)
                .bind(&app.service_id)
                .bind(row.get::<String, _>("domain"))
                .execute(&app.db)
                .await?;
        }
    }
    Ok(())
}

pub(crate) async fn ensure_user(app: &App, user: Uuid) -> Result<()> {
    let _guard = lock(app).await;
    let Some(mut config) = configuration(app, false).await? else {
        return Err(Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "automatic_gateway_not_configured",
        ));
    };
    let rows = db::query(db::Statement::GatewayProofs)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    if configuration(app, true).await?.is_some()
        && rows.iter().any(|r| {
            r.get::<Option<Uuid>, _>("user_id") == Some(user)
                && r.get::<Option<String>, _>("upstream_signer").is_some()
        })
    {
        return Ok(());
    }
    sync(app, &mut config, None).await?;
    save_configuration(app, &config, true).await
}
pub(crate) async fn refresh(app: &App) -> Result<()> {
    let _guard = lock(app).await;
    let Some(mut config) = configuration(app, false).await? else {
        return Ok(());
    };
    if config.relay_account.is_empty() {
        return Ok(());
    }
    if let Err(error) = sync(app, &mut config, None).await {
        // Transient health failures leave the last verified SMTP path usable.
        // Only a confirmed ownership/configuration conflict suspends it.
        if error.0 == StatusCode::CONFLICT {
            save_configuration(app, &config, false).await?;
        }
        return Err(error);
    }
    save_configuration(app, &config, true).await
}
