//! Independent automatic-mail gateway for unmodified official Stalwart servers.
mod proof;
pub(crate) mod provision;
mod smtp;
use super::*;
use sha2::{Digest, Sha256};
use smtp_proto::{MailFrom, RcptTo};
pub(crate) fn internal_domain(row: &Value) -> bool {
    row["description"]
        .as_str()
        .is_some_and(|description| description.starts_with("mail-web:gateway:"))
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Configuration {
    pub secret: String,
    pub relay_email: String,
    pub relay_password: String,
    pub relay_account: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub private_network: bool,
    pub proof_suffix: String,
    pub original_signing: Value,
    pub original_route: Value,
    pub original_sender_match: Value,
    pub original_data_signing: Value,
    pub original_sasl: Value,
    #[serde(default)]
    pub applied: HashMap<String, Value>,
    #[serde(default)]
    pub relay_source_ip: String,
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    from: MailFrom<String>,
    recipients: Vec<RcptTo<String>>,
    #[serde(with = "body_codec")]
    body: Vec<u8>,
    signing_domain: String,
}
mod body_codec {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(
        value: &[u8],
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(value))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Vec<u8>, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum StoredBody {
            Base64(String),
            Legacy(Vec<u8>),
        }
        match StoredBody::deserialize(deserializer)? {
            StoredBody::Base64(value) => STANDARD.decode(value).map_err(serde::de::Error::custom),
            StoredBody::Legacy(value) => Ok(value),
        }
    }
}
fn spool_id(
    service: &str,
    from: &MailFrom<String>,
    recipients: &[RcptTo<String>],
    body: &[u8],
) -> Result<String> {
    // Preserve the original idempotency hash byte-for-byte while avoiding a
    // temporary JSON byte array several times larger than a MIME attachment.
    struct HashWriter(Sha256);
    impl std::io::Write for HashWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.update(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut output = std::io::BufWriter::new(HashWriter(Sha256::new()));
    serde_json::to_writer(&mut output, &(service, from, recipients, body))
        .map_err(|_| internal("gateway_envelope_invalid"))?;
    let writer = output
        .into_inner()
        .map_err(|_| internal("gateway_envelope_invalid"))?;
    Ok(hex::encode(writer.0.finalize()))
}
pub(crate) async fn configuration(app: &App, ready: bool) -> Result<Option<Configuration>> {
    let Some(row) = db::query(db::Statement::GatewayServiceGet)
        .bind(&app.service_id)
        .fetch_optional(&app.db)
        .await?
    else {
        return Ok(None);
    };
    if ready && row.get::<String, _>("status") != "ready" {
        return Ok(None);
    }
    let bytes = zeroize::Zeroizing::new(
        app.vault
            .open(&row.get::<Vec<u8>, _>("configuration"))
            .map_err(internal)?,
    );
    Ok(Some(
        serde_json::from_slice(&bytes).map_err(|_| internal("gateway_configuration_invalid"))?,
    ))
}
pub(crate) async fn save_configuration(
    app: &App,
    config: &Configuration,
    ready: bool,
) -> Result<()> {
    let bytes = zeroize::Zeroizing::new(
        serde_json::to_vec(config).map_err(|_| internal("gateway_configuration_invalid"))?,
    );
    db::query(db::Statement::GatewayServicePut)
        .bind(&app.service_id)
        .bind(app.vault.seal(&bytes).map_err(internal)?)
        .bind(if ready { "ready" } else { "preparing" })
        .bind(db::now())
        .execute(&app.db)
        .await?;
    Ok(())
}
async fn enqueue(
    app: &App,
    from: MailFrom<String>,
    mut recipients: Vec<RcptTo<String>>,
    body: Vec<u8>,
) -> Result<()> {
    let rows = db::query(db::Statement::GatewayProofs)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    let keys = rows
        .iter()
        .map(|r| {
            (
                r.get::<String, _>("domain"),
                r.get::<String, _>("public_key"),
            )
        })
        .collect();
    let domain = proof::verify(&body, &keys)
        .await
        .ok_or(Error(StatusCode::FORBIDDEN, "automatic_mail_proof_invalid"))?;
    let owner = rows
        .iter()
        .find(|r| r.get::<String, _>("domain") == domain)
        .ok_or_else(|| internal("gateway_owner_missing"))?;
    let user: Option<Uuid> = owner.get("user_id");
    let email: Option<String> = owner.get("owner_email");
    recipients.sort_by(|a, b| a.address.cmp(&b.address));
    recipients.dedup_by(|a, b| a.address.eq_ignore_ascii_case(&b.address));
    let id = spool_id(&app.service_id, &from, &recipients, &body)?;
    if db::query(db::Statement::GatewaySpoolGet)
        .bind(&id)
        .fetch_optional(&app.db)
        .await?
        .is_some()
    {
        return Ok(());
    }
    let signing_domain = if let (Some(user), Some(email)) = (user, email.as_ref()) {
        let scoped = connections::for_user(app, user).await?;
        let count = recipients
            .iter()
            .filter(|r| !scoped.services.is_local_address(&r.address))
            .count() as i64;
        if !policy::reserve(&scoped, email, &format!("automatic:{id}"), count).await? {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "automatic_mail_limit_reached",
            ));
        }
        scoped.services.domain.clone()
    } else {
        // Unmanaged accounts use the shared proof; preserve their own real signing domain.
        email
            .as_deref()
            .and_then(|e| e.strip_prefix('@'))
            .map(str::to_owned)
            .unwrap_or_else(|| app.services.domain.clone())
    };
    let envelope = Envelope {
        from,
        recipients,
        body: proof::strip(&body).ok_or_else(|| internal("gateway_proof_strip_failed"))?,
        signing_domain,
    };
    let bytes = zeroize::Zeroizing::new(
        serde_json::to_vec(&envelope).map_err(|_| internal("gateway_envelope_invalid"))?,
    );
    let now = db::now();
    db::query(db::Statement::GatewaySpoolInsert)
        .bind(&id)
        .bind(&app.service_id)
        .bind(user)
        .bind(app.vault.seal(&bytes).map_err(internal)?)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(&app.db)
        .await?;
    NOTIFY.notify_one();
    Ok(())
}
static NOTIFY: std::sync::LazyLock<tokio::sync::Notify> =
    std::sync::LazyLock::new(tokio::sync::Notify::new);
pub(crate) async fn retry(app: &App) -> Result<u64> {
    let count = db::query(db::Statement::GatewaySpoolRetry)
        .bind(&app.service_id)
        .execute(&app.db)
        .await?
        .rows_affected();
    NOTIFY.notify_one();
    Ok(count)
}
pub(crate) async fn compact(app: &App) -> Result<()> {
    // Keep deduplication tombstones; only old, definite outcomes lose the payload.
    db::query(db::Statement::GatewaySpoolCompact)
        .bind(db::now() - 30 * 24 * 60 * 60 * 1000)
        .execute(&app.db)
        .await?;
    Ok(())
}

pub(crate) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/client/automatic-mail", get(personal_records))
        .route("/admin/automatic-mail", get(admin_records))
}
async fn records(app: &App, user: Option<Uuid>) -> Result<Value> {
    let config = db::query(db::Statement::GatewayServiceGet)
        .bind(&app.service_id)
        .fetch_optional(&app.db)
        .await?;
    let rows = db::query(db::Statement::GatewaySpoolList)
        .bind(&app.service_id)
        .fetch_all(&app.db)
        .await?;
    let items=rows.iter().filter(|r|user.is_none() || r.get::<Option<Uuid>,_>("user_id")==user).map(|r|json!({"id":r.get::<String,_>("id"),"status":r.get::<String,_>("status"),"attempts":r.get::<i64,_>("attempts"),"error":r.get::<Option<String>,_>("error"),"createdAt":r.get::<i64,_>("created_at"),"updatedAt":r.get::<i64,_>("updated_at")})).collect::<Vec<_>>();
    Ok(
        json!({"configured":config.is_some(),"status":config.map(|r|r.get::<String,_>("status")),"items":items}),
    )
}
#[utoipa::path(get,path="/api/v1/client/automatic-mail",responses((status=200,body=Value)))]
pub(crate) async fn personal_records(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let me = identity(&app, &headers, false).await?;
    let scoped = connections::for_user(&app, me.user).await?;
    Ok(Json(records(&scoped, Some(me.user)).await?))
}
#[utoipa::path(get,path="/api/v1/admin/automatic-mail",params(("domainId"=Option<String>,Query)),responses((status=200,body=Value)))]
pub(crate) async fn admin_records(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    account::operator(&app, &headers, false).await?;
    let scoped = connections::for_domain(
        &app,
        query
            .get("domainId")
            .map(String::as_str)
            .unwrap_or("default"),
    )
    .await?;
    Ok(Json(records(&scoped, None).await?))
}

pub(crate) async fn start(app: Arc<App>) -> std::result::Result<(), Box<dyn std::error::Error>> {
    if !provision::enabled() {
        return Ok(());
    }
    let listener = smtp::listener().await?;
    // A crash after DATA might have lost the final reply. Never blindly resend it.
    db::query(db::Statement::GatewaySpoolRecover)
        .bind(db::now())
        .execute(&app.db)
        .await?;
    tokio::spawn(smtp::serve(listener, app.clone()));
    let configuration_app = app.clone();
    tokio::spawn(async move {
        loop {
            if let Ok(rows) = db::query(db::Statement::GatewayServices)
                .fetch_all(&configuration_app.db)
                .await
            {
                for row in rows {
                    let service: String = row.get("service_id");
                    if let Ok(scoped) = connections::for_service(&configuration_app, &service).await
                        && let Err(error) = provision::refresh(&scoped).await
                    {
                        tracing::warn!(
                            service_id = service,
                            code = error.1,
                            "Automatic gateway configuration will retry"
                        );
                    }
                }
            }
            tokio::select! { _=SHUTDOWN.cancelled()=>break, _=tokio::time::sleep(std::time::Duration::from_secs(60))=>{} }
        }
    });
    tokio::spawn(async move {
        loop {
            if let Err(error) = deliver_due(&app).await {
                tracing::warn!(
                    code = error.1,
                    "Automatic mail queue temporarily unavailable"
                );
            }
            tokio::select! { _=SHUTDOWN.cancelled()=>break, _=NOTIFY.notified()=>{}, _=tokio::time::sleep(std::time::Duration::from_secs(10))=>{} }
        }
    });
    Ok(())
}
async fn deliver_due(app: &App) -> Result<()> {
    for row in db::query(db::Statement::GatewaySpoolDue)
        .bind(db::now())
        .fetch_all(&app.db)
        .await?
    {
        let id: String = row.get("id");
        let service: String = row.get("service_id");
        let scoped = connections::for_service(app, &service).await?;
        let Some(config) = configuration(&scoped, true).await? else {
            continue;
        };
        let bytes = zeroize::Zeroizing::new(
            app.vault
                .open(&row.get::<Vec<u8>, _>("envelope"))
                .map_err(internal)?,
        );
        let envelope: Envelope =
            serde_json::from_slice(&bytes).map_err(|_| internal("gateway_envelope_invalid"))?;
        if db::query(db::Statement::GatewaySpoolClaim)
            .bind(db::now())
            .bind(&id)
            .execute(&app.db)
            .await?
            .rows_affected()
            != 1
        {
            continue;
        }
        let outcome = smtp::deliver(&config, &envelope).await;
        let (status, error) = match outcome {
            Ok(()) => ("delivered", None),
            Err(smtp::DeliveryError::Retry(code)) => ("queued", Some(code)),
            Err(smtp::DeliveryError::Rejected(code)) => ("rejected", Some(code)),
            Err(smtp::DeliveryError::Unknown) => ("unknown", Some("smtp_result_unknown")),
        };
        let attempts: i64 = row.get("attempts");
        let retry = 30_000_i64.saturating_mul(1_i64 << attempts.min(8));
        db::query(db::Statement::GatewaySpoolFinish)
            .bind(status)
            .bind(error)
            .bind(db::now() + retry)
            .bind(db::now())
            .bind(&id)
            .execute(&app.db)
            .await?;
        tracing::info!(
            service_id = service,
            message_id = id,
            status,
            "Automatic mail delivery updated"
        );
    }
    Ok(())
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    #[test]
    fn compact_spool_encoding_reads_legacy_payloads_without_changing_deduplication_ids() {
        let from = MailFrom::<String> {
            address: String::new(),
            ..Default::default()
        };
        let recipients = vec![RcptTo::<String> {
            address: "one@example.net".into(),
            ..Default::default()
        }];
        let body = b"From: sender@example.org\r\n\r\nMIME body\r\n".to_vec();
        let legacy_id = hex::encode(Sha256::digest(
            serde_json::to_vec(&("default", &from, &recipients, &body)).unwrap(),
        ));
        assert_eq!(
            spool_id("default", &from, &recipients, &body).unwrap(),
            legacy_id
        );
        let legacy =
            json!({"from":from,"recipients":recipients,"body":body,"signing_domain":"example.org"});
        let envelope: Envelope = serde_json::from_value(legacy).unwrap();
        let compact = serde_json::to_value(&envelope).unwrap();
        assert!(compact["body"].is_string());
        assert_eq!(
            serde_json::from_value::<Envelope>(compact).unwrap().body,
            body
        );
    }
}
