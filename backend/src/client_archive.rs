//! Bulwark account-archive envelope, scoped to a verified local mailbox.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
const MAX_BYTES: usize = 64 * 1024;
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Envelope {
    version: u8,
    iterations: u32,
    salt: String,
    iv: String,
    ciphertext: String,
}
#[derive(Deserialize, ToSchema)]
pub(super) struct ArchiveInput {
    envelope: Envelope,
}
fn validate(value: &Envelope) -> bool {
    value.version == 1
        && value.iterations == 600_000
        && STANDARD.decode(&value.salt).is_ok_and(|v| v.len() == 16)
        && STANDARD.decode(&value.iv).is_ok_and(|v| v.len() == 12)
        && value.ciphertext.len() <= MAX_BYTES
        && STANDARD
            .decode(&value.ciphertext)
            .is_ok_and(|v| v.len() > 16)
}
async fn owner(app: &App, headers: &HeaderMap, write: bool) -> Result<Identity> {
    let me = identity(app, headers, write).await?;
    if headers
        .get("x-archive-username")
        .and_then(|h| h.to_str().ok())
        .map(str::to_lowercase)
        .as_deref()
        != Some(&me.email)
    {
        return Err(Error(StatusCode::FORBIDDEN, "archive_owner_required"));
    }
    let site = format!("{}/api/v1/native", access::request(app, headers)?.origin);
    if headers
        .get("x-archive-server")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.trim_end_matches('/'))
        != Some(site.as_str())
    {
        return Err(Error(StatusCode::FORBIDDEN, "archive_owner_required"));
    }
    let scoped = connections::for_user(app, me.user).await?;
    // Stored ciphertext is not returned using an independently revoked upstream credential.
    scoped.upstream.session(&me.key).await?;
    Ok(me)
}
#[utoipa::path(operation_id="load_account_archive",get,path="/api/v1/client/account-archive",responses((status=200,body=Value)))]
pub(super) async fn load(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let me = owner(&app, &headers, false).await?;
    let encrypted: Option<Vec<u8>> = db::scalar(db::Statement::ClientArchiveGet)
        .bind(me.user)
        .fetch_optional(&app.db)
        .await?;
    let envelope = encrypted
        .map(|bytes| app.vault.open(&bytes).map_err(internal))
        .transpose()?
        .map(|bytes| serde_json::from_slice::<Value>(&bytes).map_err(|_| internal("archive_json")))
        .transpose()?;
    Ok(Json(json!({"envelope":envelope})))
}
#[utoipa::path(operation_id="save_account_archive",put,path="/api/v1/client/account-archive",request_body=ArchiveInput,responses((status=200,body=Value)))]
pub(super) async fn save(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(input): Json<ArchiveInput>,
) -> Result<Json<Value>> {
    let me = owner(&app, &headers, true).await?;
    if !validate(&input.envelope) {
        return Err(Error(StatusCode::BAD_REQUEST, "invalid_archive"));
    }
    let bytes = serde_json::to_vec(&input.envelope).map_err(|_| internal("archive_json"))?;
    if bytes.len() > MAX_BYTES {
        return Err(Error(StatusCode::PAYLOAD_TOO_LARGE, "archive_too_large"));
    }
    let encrypted = app.vault.seal(&bytes).map_err(internal)?;
    db::query(db::Statement::ClientArchivePut)
        .bind(me.user)
        .bind(encrypted)
        .bind(db::now())
        .execute(&app.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
#[utoipa::path(operation_id="delete_account_archive",delete,path="/api/v1/client/account-archive",responses((status=200,body=Value)))]
pub(super) async fn remove(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let me = owner(&app, &headers, true).await?;
    db::query(db::Statement::ClientArchiveDelete)
        .bind(me.user)
        .execute(&app.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route(
            "/client/account-archive",
            get(load).put(save).delete(remove),
        )
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BYTES))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bulwark_encryption_parameters_are_accepted() {
        let mut value = Envelope {
            version: 1,
            iterations: 600_000,
            salt: STANDARD.encode([0u8; 16]),
            iv: STANDARD.encode([0u8; 12]),
            ciphertext: STANDARD.encode([0u8; 32]),
        };
        assert!(validate(&value));
        value.iterations = 1;
        assert!(!validate(&value));
        value.iterations = 600_000;
        value.iv = STANDARD.encode([0u8; 16]);
        assert!(!validate(&value));
    }
}
