use super::*;
use mailweb_shared::deployment::{Inventory, Job, MAX_RESPONSE, Request, Submit};
use serde::de::DeserializeOwned;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeploymentView {
    version: String,
    revision: String,
    architecture: String,
    manager_online: bool,
    inventory: Inventory,
}

#[derive(Deserialize)]
struct Reply<T> {
    data: Option<T>,
    error: Option<String>,
}

pub(super) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/admin/deployment", get(status))
        .route("/admin/deployment/jobs", post(submit))
        .route("/admin/deployment/jobs/{id}", get(job))
        .layer(axum::extract::DefaultBodyLimit::max(
            mailweb_shared::deployment::MAX_REQUEST as usize,
        ))
}

async fn operator(app: &App, headers: &HeaderMap, write: bool) -> Result<Identity> {
    let actor = identity(app, headers, write).await?;
    if !actor.operator {
        return Err(Error(StatusCode::FORBIDDEN, "operator_required"));
    }
    Ok(actor)
}

async fn host<T: DeserializeOwned>(request: Request) -> Result<Reply<T>> {
    tokio::time::timeout(std::time::Duration::from_secs(6), async move {
        let mut stream =
            tokio::net::UnixStream::connect("/run/mailweb-manager/control.sock").await?;
        let mut bytes = serde_json::to_vec(&request)?;
        bytes.push(b'\n');
        stream.write_all(&bytes).await?;
        stream.shutdown().await?;
        let mut result = Vec::new();
        stream
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut result)
            .await?;
        if result.len() as u64 > MAX_RESPONSE {
            return Err(std::io::Error::other("host response too large").into());
        }
        Ok(serde_json::from_slice(&result)?)
    })
    .await
    .ok()
    .and_then(std::result::Result::<_, Box<dyn std::error::Error + Send + Sync>>::ok)
    .ok_or(Error(
        StatusCode::SERVICE_UNAVAILABLE,
        "version_manager_unavailable",
    ))
}

#[utoipa::path(get,path="/api/v1/admin/deployment",operation_id="deployment_status",responses((status=200,body=DeploymentView),(status=403,description="Operator required")))]
pub(super) async fn status(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<DeploymentView>> {
    operator(&app, &headers, false).await?;
    let inventory = host::<Inventory>(Request::Status)
        .await
        .ok()
        .and_then(|reply| reply.data);
    Ok(Json(DeploymentView {
        version: format!("v{}", env!("CARGO_PKG_VERSION")),
        revision: option_env!("MAIL_WEB_REVISION")
            .unwrap_or("development")
            .into(),
        architecture: match std::env::consts::ARCH {
            "x86_64" => "linux/amd64",
            "aarch64" => "linux/arm64",
            other => other,
        }
        .into(),
        manager_online: inventory.is_some(),
        inventory: inventory.unwrap_or_default(),
    }))
}

#[utoipa::path(post,path="/api/v1/admin/deployment/jobs",operation_id="submit_deployment_job",request_body=Submit,responses((status=202,body=Job),(status=403,description="Operator required"),(status=409,description="Host rejected the operation"),(status=503,description="Version manager unavailable")))]
pub(super) async fn submit(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(job): Json<Submit>,
) -> Result<Response> {
    let actor = operator(&app, &headers, true).await?;
    let result = host::<Job>(Request::Submit {
        job,
        actor: actor.user.to_string(),
    })
    .await?;
    if let Some(data) = result.data {
        return Ok((StatusCode::ACCEPTED, Json(data)).into_response());
    }
    Ok((
        StatusCode::CONFLICT,
        Json(json!({"code":"version_job_rejected","message":result.error.unwrap_or_default()})),
    )
        .into_response())
}

#[utoipa::path(get,path="/api/v1/admin/deployment/jobs/{id}",operation_id="read_deployment_job",params(("id"=String,Path)),responses((status=200,body=Job),(status=403,description="Operator required"),(status=404,description="Job not found"),(status=503,description="Version manager unavailable")))]
pub(super) async fn job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Job>> {
    operator(&app, &headers, false).await?;
    host::<Job>(Request::Job { id })
        .await?
        .data
        .map(Json)
        .ok_or(Error(StatusCode::NOT_FOUND, "version_job_not_found"))
}
