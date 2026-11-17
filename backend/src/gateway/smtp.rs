//! SMTP transport reuses the official smtp-proto parser and mail-send client.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use mail_send::{SmtpClient, SmtpClientBuilder, smtp::message::Parameters};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use smtp_proto::{Request, request::receiver::DataReceiver};
use subtle::ConstantTimeEq;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    net::TcpListener,
};
use tokio_rustls::TlsAcceptor;
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const MAX_RECIPIENTS: usize = 256;
static INTAKE_BYTES: std::sync::LazyLock<Arc<tokio::sync::Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(128 * 1024 * 1024)));
type IoResult<T> = std::io::Result<T>;
pub(super) struct Listener {
    tcp: TcpListener,
    tls: Option<TlsAcceptor>,
}
pub(super) async fn listener() -> std::result::Result<Listener, Box<dyn std::error::Error>> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let tls = if provision::private_network() {
        None
    } else {
        let certificates =
            CertificateDer::pem_file_iter(std::env::var("MAIL_WEB_GATEWAY_CERTIFICATE_FILE")?)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
        let key =
            PrivateKeyDer::from_pem_file(std::env::var("MAIL_WEB_GATEWAY_PRIVATE_KEY_FILE")?)?;
        let config = tokio_rustls::rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certificates, key)?;
        Some(TlsAcceptor::from(Arc::new(config)))
    };
    Ok(Listener {
        tcp: TcpListener::bind(
            std::env::var("MAIL_WEB_GATEWAY_BIND").unwrap_or_else(|_| "0.0.0.0:2526".into()),
        )
        .await?,
        tls,
    })
}
pub(super) async fn serve(listener: Listener, app: Arc<App>) {
    let slots = Arc::new(tokio::sync::Semaphore::new(16));
    loop {
        let accepted = tokio::select! { _=SHUTDOWN.cancelled()=>break, r=listener.tcp.accept()=>r };
        let Ok((stream, _)) = accepted else {
            continue;
        };
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            continue;
        };
        let tls = listener.tls.clone();
        let app = app.clone();
        tokio::spawn(async move {
            let _permit = permit;
            if let Some(tls) = tls {
                if let Ok(Ok(stream)) =
                    tokio::time::timeout(std::time::Duration::from_secs(10), tls.accept(stream))
                        .await
                {
                    let _ = session(stream, &app).await;
                }
            } else {
                let _ = session(stream, &app).await;
            }
        });
    }
}
async fn line<S: AsyncRead + AsyncWrite + Unpin>(io: &mut BufReader<S>) -> IoResult<Vec<u8>> {
    let mut buf = Vec::new();
    let size = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        (&mut *io).take(4097).read_until(b'\n', &mut buf),
    )
    .await
    .map_err(|_| std::io::ErrorKind::TimedOut)??;
    if size == 0 || size > 4096 || !buf.ends_with(b"\r\n") {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(buf)
}
async fn reply<S: AsyncRead + AsyncWrite + Unpin>(
    io: &mut BufReader<S>,
    text: &str,
) -> IoResult<()> {
    io.get_mut().write_all(text.as_bytes()).await?;
    io.get_mut().flush().await
}
async fn session<S: AsyncRead + AsyncWrite + Unpin>(stream: S, root: &App) -> IoResult<()> {
    let mut io = BufReader::new(stream);
    reply(&mut io, "220 Mail Web automatic gateway\r\n").await?;
    let mut authenticated: Option<Arc<App>> = None;
    let mut hello = false;
    let mut from = None;
    let mut recipients = Vec::new();
    let mut failures = 0;
    loop {
        let raw = line(&mut io).await?;
        let request = match Request::parse(&mut raw.iter()) {
            Ok(r) => r.into_owned(),
            Err(_) => {
                reply(&mut io, "500 5.5.2 Invalid command\r\n").await?;
                continue;
            }
        };
        match request {
            Request::Ehlo { .. } | Request::Helo { .. } => {
                hello = true;
                from = None;
                recipients.clear();
                reply(&mut io,"250-mail-web\r\n250-SIZE 67108864\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250-DSN\r\n250 AUTH PLAIN\r\n").await?;
            }
            Request::Quit => {
                reply(&mut io, "221 2.0.0 Closing\r\n").await?;
                return Ok(());
            }
            Request::Noop { .. } => reply(&mut io, "250 2.0.0 OK\r\n").await?,
            Request::Rset => {
                from = None;
                recipients.clear();
                reply(&mut io, "250 2.0.0 Reset\r\n").await?;
            }
            Request::Auth {
                mechanism,
                initial_response,
            } if hello
                && authenticated.is_none()
                && from.is_none()
                && mechanism == smtp_proto::AUTH_PLAIN =>
            {
                let value = if initial_response.is_empty() {
                    reply(&mut io, "334 \r\n").await?;
                    line(&mut io).await?
                } else {
                    initial_response.into_bytes()
                };
                let value = STANDARD.decode(value.trim_ascii());
                let mut valid = None;
                if let Ok(value) = value {
                    let parts = value.split(|b| *b == 0).collect::<Vec<_>>();
                    if parts.len() == 3
                        && (parts[0].is_empty() || parts[0] == parts[1])
                        && let Ok(service) = std::str::from_utf8(parts[1])
                        && let Ok(app) = connections::for_service(root, service).await
                        && let Ok(Some(config)) = configuration(&app, true).await
                        && bool::from(config.secret.as_bytes().ct_eq(parts[2]))
                    {
                        valid = Some(app);
                    }
                }
                if let Some(app) = valid {
                    authenticated = Some(app);
                    reply(&mut io, "235 2.7.0 Authenticated\r\n").await?;
                } else {
                    failures += 1;
                    reply(&mut io, "535 5.7.8 Authentication failed\r\n").await?;
                    if failures >= 3 {
                        return Ok(());
                    }
                }
            }
            Request::Mail { from: sender } if hello && authenticated.is_some() => {
                recipients.clear();
                from = None;
                if sender.size > MAX_MESSAGE
                    || sender.flags
                        & (smtp_proto::MAIL_BODY_BINARYMIME | smtp_proto::MAIL_REQUIRETLS)
                        != 0
                {
                    reply(
                        &mut io,
                        "552 5.3.4 Unsupported size or transport requirement\r\n",
                    )
                    .await?;
                } else if sender.address.contains(['\r', '\n']) {
                    return Err(std::io::ErrorKind::InvalidData.into());
                } else {
                    from = Some(sender);
                    reply(&mut io, "250 2.1.0 Sender accepted\r\n").await?;
                }
            }
            Request::Rcpt { to } if from.is_some() => {
                if recipients.len() >= MAX_RECIPIENTS {
                    reply(&mut io, "452 4.5.3 Too many recipients\r\n").await?;
                } else if to.address.is_empty() || to.address.contains(['\r', '\n']) {
                    reply(&mut io, "501 5.1.3 Invalid recipient\r\n").await?;
                } else {
                    recipients.push(to);
                    reply(&mut io, "250 2.1.5 Recipient accepted\r\n").await?;
                }
            }
            Request::Data if from.is_some() && !recipients.is_empty() => {
                reply(&mut io, "354 End with CRLF.CRLF\r\n").await?;
                let mut receiver = DataReceiver::new();
                let mut body = Vec::new();
                let mut memory = INTAKE_BYTES
                    .clone()
                    .acquire_many_owned(0)
                    .await
                    .map_err(|_| std::io::ErrorKind::Interrupted)?;
                loop {
                    let chunk =
                        tokio::time::timeout(std::time::Duration::from_secs(60), io.fill_buf())
                            .await
                            .map_err(|_| std::io::ErrorKind::TimedOut)??;
                    if chunk.is_empty() {
                        return Err(std::io::ErrorKind::UnexpectedEof.into());
                    }
                    let Ok(permit) = INTAKE_BYTES
                        .clone()
                        .try_acquire_many_owned(chunk.len() as u32)
                    else {
                        reply(&mut io, "451 4.3.1 Gateway busy; retry later\r\n").await?;
                        return Ok(());
                    };
                    memory.merge(permit);
                    let mut bytes = chunk.iter();
                    let done = receiver.ingest(&mut bytes, &mut body);
                    let used = chunk.len() - bytes.len();
                    io.consume(used);
                    if body.len() > MAX_MESSAGE {
                        reply(&mut io, "552 5.3.4 Message too large\r\n").await?;
                        return Ok(());
                    }
                    if done {
                        break;
                    }
                }
                let result = enqueue(
                    authenticated.as_ref().unwrap(),
                    from.take().unwrap(),
                    std::mem::take(&mut recipients),
                    body,
                )
                .await;
                let response = match result {
                    Ok(()) => "250 2.0.0 Durably queued\r\n",
                    Err(Error(StatusCode::TOO_MANY_REQUESTS, _)) => {
                        "451 4.7.0 Account sending limit reached; retry later\r\n"
                    }
                    Err(Error(StatusCode::FORBIDDEN, _)) => {
                        "451 4.7.0 Automatic mail ownership proof required\r\n"
                    }
                    Err(_) => "451 4.3.0 Gateway temporarily unavailable\r\n",
                };
                reply(&mut io, response).await?;
            }
            _ => {
                reply(
                    &mut io,
                    "503 5.5.1 Command not available in current state\r\n",
                )
                .await?
            }
        }
    }
}
pub(super) enum DeliveryError {
    Retry(&'static str),
    Rejected(&'static str),
    Unknown,
}
fn known(error: mail_send::Error) -> DeliveryError {
    match error {
        mail_send::Error::UnexpectedReply(r) if r.code >= 500 => {
            DeliveryError::Rejected("smtp_permanent_rejection")
        }
        _ => DeliveryError::Retry("smtp_temporarily_unavailable"),
    }
}
pub(super) async fn deliver(
    config: &Configuration,
    envelope: &Envelope,
) -> std::result::Result<(), DeliveryError> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let builder = SmtpClientBuilder::new(config.smtp_host.clone(), config.smtp_port)
        .map_err(|_| DeliveryError::Retry("smtp_configuration_invalid"))?
        .helo_host(&envelope.signing_domain)
        .credentials((config.relay_email.clone(), config.relay_password.clone()))
        .timeout(std::time::Duration::from_secs(30));
    if config.private_network {
        send(builder.connect_plain().await.map_err(known)?, envelope).await
    } else {
        send(builder.connect().await.map_err(known)?, envelope).await
    }
}
fn xtext(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|b| {
            if *b < 33 || *b > 126 || b"+=".contains(b) {
                format!("+{b:02X}")
            } else {
                (*b as char).to_string()
            }
        })
        .collect()
}
async fn send<S: AsyncRead + AsyncWrite + Unpin>(
    mut client: SmtpClient<S>,
    envelope: &Envelope,
) -> std::result::Result<(), DeliveryError> {
    let mut params = Parameters::new();
    if envelope.from.flags & smtp_proto::MAIL_SMTPUTF8 != 0 {
        params.add("SMTPUTF8");
    }
    if envelope.from.flags & smtp_proto::MAIL_BODY_8BITMIME != 0 {
        params.add(("BODY", "8BITMIME"));
    }
    if envelope.from.flags & smtp_proto::MAIL_RET_FULL != 0 {
        params.add(("RET", "FULL"));
    } else if envelope.from.flags & smtp_proto::MAIL_RET_HDRS != 0 {
        params.add(("RET", "HDRS"));
    }
    if let Some(value) = &envelope.from.env_id {
        params.add(("ENVID".to_owned(), xtext(value)));
    }
    client
        .mail_from(&envelope.from.address, &params)
        .await
        .map_err(known)?;
    for recipient in &envelope.recipients {
        let mut params = Parameters::new();
        let mut notify = Vec::new();
        for (flag, name) in [
            (smtp_proto::RCPT_NOTIFY_SUCCESS, "SUCCESS"),
            (smtp_proto::RCPT_NOTIFY_FAILURE, "FAILURE"),
            (smtp_proto::RCPT_NOTIFY_DELAY, "DELAY"),
        ] {
            if recipient.flags & flag != 0 {
                notify.push(name);
            }
        }
        if recipient.flags & smtp_proto::RCPT_NOTIFY_NEVER != 0 {
            notify = vec!["NEVER"];
        }
        if !notify.is_empty() {
            params.add(("NOTIFY".to_owned(), notify.join(",")));
        }
        if let Some(value) = &recipient.orcpt {
            params.add(("ORCPT".to_owned(), xtext(value)));
        }
        client
            .rcpt_to(&recipient.address, &params)
            .await
            .map_err(known)?;
    }
    match client.data(&envelope.body).await {
        Ok(()) => Ok(()),
        Err(mail_send::Error::UnexpectedReply(r)) if r.code >= 500 => {
            Err(DeliveryError::Rejected("smtp_permanent_rejection"))
        }
        Err(mail_send::Error::UnexpectedReply(_)) => {
            Err(DeliveryError::Retry("smtp_temporary_rejection"))
        }
        Err(_) => Err(DeliveryError::Unknown),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mail_send::smtp::message::Message;
    fn config() -> Configuration {
        Configuration {
            secret: "gateway-test-secret".into(),
            relay_email: "relay@mail.example".into(),
            relay_password: "private-relay-password".into(),
            relay_account: "relay".into(),
            smtp_host: "localhost".into(),
            smtp_port: 25,
            private_network: true,
            proof_suffix: "proof.probe.example.com".into(),
            original_signing: json!({}),
            original_route: json!({}),
            original_sender_match: json!({}),
            original_data_signing: json!({}),
            original_sasl: json!({}),
            applied: HashMap::new(),
            relay_source_ip: String::new(),
        }
    }
    #[tokio::test]
    async fn real_smtp_gateway_requires_auth_and_proof_and_counts_owner_once() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let path = std::env::temp_dir().join(format!("gateway-{}.sqlite", Uuid::new_v4()));
        let pool = db::connect(&path).await.unwrap();
        let user = Uuid::new_v4();
        let configuration = config();
        let app = Arc::new(App {
            revision: 0,
            root: None,
            service_id: "default".into(),
            domain_id: "default".into(),
            db: pool.clone(),
            upstream: Stalwart {
                http: reqwest::Client::new(),
                base: "https://upstream.invalid".into(),
            },
            vault: Vault::new(&[9; 32]).unwrap(),
            origin: "https://mail.example".into(),
            services: config::Services {
                domain: "mail.example".into(),
                ..Default::default()
            },
        });
        connections::seed_default(&app).await.unwrap();
        sqlx::query("INSERT INTO platform_users(id,email,recovery_email,stalwart_id,status,hourly_recipients,daily_recipients) VALUES(?,'alice@mail.example','alice@recovery.example','own','active',2,2)").bind(user).execute(&pool).await.unwrap();
        db::query(db::Statement::GatewayProofPut)
            .bind("default")
            .bind("owner.proof.probe.example.com")
            .bind(user)
            .bind("alice@mail.example")
            .bind(include_str!("../../testdata/gateway/public-key.txt").trim())
            .bind(vec![0_u8])
            .execute(&pool)
            .await
            .unwrap();
        save_configuration(&app, &configuration, true)
            .await
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let root = app.clone();
        let server = tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let root = root.clone();
                tokio::spawn(async move {
                    let _ = session(stream, &root).await;
                });
            }
        });
        let raw = include_bytes!("../../testdata/gateway/vacation.eml").as_slice();
        let builder = SmtpClientBuilder::new("127.0.0.1", port)
            .unwrap()
            .credentials(("default", "wrong"));
        assert!(builder.connect_plain().await.is_err());
        let builder = SmtpClientBuilder::new("127.0.0.1", port)
            .unwrap()
            .credentials(("default", configuration.secret.as_str()));
        let mut client = builder.connect_plain().await.unwrap();
        client
            .send(Message::new("", ["one@outside.example"], raw))
            .await
            .unwrap();
        client
            .send(Message::new("", ["one@outside.example"], raw))
            .await
            .unwrap();
        let mut tampered = raw.to_vec();
        tampered.extend_from_slice(b"Changed body\r\n");
        assert!(
            client
                .send(Message::new(
                    "",
                    ["two@outside.example"],
                    tampered.as_slice()
                ))
                .await
                .is_err()
        );
        client.rset().await.unwrap();
        client
            .send(Message::new("", ["two@outside.example"], raw))
            .await
            .unwrap();
        assert!(
            client
                .send(Message::new("", ["three@outside.example"], raw))
                .await
                .is_err()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT sum(recipient_count) FROM outbound_reservations WHERE user_id=?"
            )
            .bind(user)
            .fetch_one(&pool)
            .await
            .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM automatic_gateway_spool")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        // Both accepted messages are durable and have their private proof removed.
        let records = sqlx::query("SELECT envelope,status FROM automatic_gateway_spool")
            .fetch_all(&pool)
            .await
            .unwrap();
        for record in records {
            assert_eq!(record.get::<String, _>("status"), "queued");
            let bytes = app
                .vault
                .open(&record.get::<Vec<u8>, _>("envelope"))
                .unwrap();
            let envelope: Envelope = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(envelope.from.address, "");
            assert_eq!(envelope.signing_domain, "mail.example");
            assert!(
                proof::verify(
                    &envelope.body,
                    &[(
                        "owner.proof.probe.example.com".into(),
                        include_str!("../../testdata/gateway/public-key.txt")
                            .trim()
                            .into()
                    )]
                    .into()
                )
                .await
                .is_none()
            );
        }
        // A process restart while DATA is outstanding changes a delivery into
        // an unknown result. Neither retry nor compaction may resend/discard it.
        sqlx::query("UPDATE automatic_gateway_spool SET status='delivering'")
            .execute(&pool)
            .await
            .unwrap();
        db::query(db::Statement::GatewaySpoolRecover)
            .bind(db::now())
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(crate::gateway::retry(&app).await.unwrap(), 0);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM automatic_gateway_spool WHERE status='unknown' AND length(envelope)>0").fetch_one(&pool).await.unwrap(),2);
        server.abort();
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }
    #[tokio::test]
    async fn smtp_lost_final_reply_is_unknown_and_explicit_refusals_are_not() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        for response in [
            None,
            Some("451 4.3.0 Retry later\r\n"),
            Some("550 5.7.0 Rejected\r\n"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut io = BufReader::new(stream);
                reply(&mut io, "220 Test\r\n").await.unwrap();
                line(&mut io).await.unwrap();
                reply(&mut io, "250 test\r\n").await.unwrap();
                line(&mut io).await.unwrap();
                reply(&mut io, "250 Sender\r\n").await.unwrap();
                line(&mut io).await.unwrap();
                reply(&mut io, "250 Recipient\r\n").await.unwrap();
                line(&mut io).await.unwrap();
                reply(&mut io, "354 Content\r\n").await.unwrap();
                let mut data = DataReceiver::new();
                let mut body = Vec::new();
                loop {
                    let chunk = io.fill_buf().await.unwrap();
                    let mut bytes = chunk.iter();
                    let done = data.ingest(&mut bytes, &mut body);
                    let used = chunk.len() - bytes.len();
                    io.consume(used);
                    if done {
                        break;
                    }
                }
                if let Some(response) = response {
                    reply(&mut io, response).await.unwrap();
                }
            });
            let client = SmtpClientBuilder::new("127.0.0.1", port)
                .unwrap()
                .connect_plain()
                .await
                .unwrap();
            let envelope = Envelope {
                from: MailFrom {
                    address: String::new(),
                    ..Default::default()
                },
                recipients: vec![RcptTo {
                    address: "test@example.net".into(),
                    ..Default::default()
                }],
                body: b"From: test@example.org\r\n\r\nDelivery probe\r\n".to_vec(),
                signing_domain: "example.org".into(),
            };
            let outcome = send(client, &envelope).await;
            assert!(match (response, outcome) {
                (None, Err(DeliveryError::Unknown)) => true,
                (Some(r), Err(DeliveryError::Retry(_))) => r.starts_with("451"),
                (Some(r), Err(DeliveryError::Rejected(_))) => r.starts_with("550"),
                _ => false,
            });
            server.await.unwrap();
        }
    }
}
