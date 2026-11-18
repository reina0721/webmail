use super::*;
use mailweb_shared::deployment::{
    GithubRelease, Inventory, Job, MAX_RESPONSE, PublishedVersion, Request, Submit, exact_version,
    release_catalog, valid_repository,
};
use serde::de::DeserializeOwned;
use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Default)]
struct Catalog {
    expires: Option<Instant>,
    items: Vec<PublishedVersion>,
    status: String,
}

static CATALOG: LazyLock<tokio::sync::Mutex<Catalog>> =
    LazyLock::new(|| tokio::sync::Mutex::new(Catalog::default()));

async fn read_public_releases(
    arch: &str,
) -> std::result::Result<Vec<PublishedVersion>, Box<dyn std::error::Error + Send + Sync>> {
    let repository =
        std::env::var("RELEASE_REPOSITORY").unwrap_or_else(|_| "reina0721/webmail".into());
    if !valid_repository(&repository) {
        return Err("invalid release repository".into());
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("mail-web/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let mut releases = Vec::new();
    for page in 1..=100 {
        let batch: Vec<GithubRelease> = client
            .get(format!(
                "https://api.github.com/repos/{repository}/releases"
            ))
            .query(&[("per_page", 100), ("page", page)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let last = batch.len() < 100;
        releases.extend(batch);
        if last {
            return Ok(release_catalog(
                releases,
                &format!("mail-web-{arch}.tar.gz").replace('/', "-"),
            ));
        }
    }
    Err("release pagination limit reached".into())
}

async fn fill_public_catalog(inventory: &mut Inventory, arch: &str) {
    let mut cached = CATALOG.lock().await;
    if cached.expires.is_none_or(|expiry| expiry <= Instant::now()) {
        match tokio::time::timeout(Duration::from_secs(12), read_public_releases(arch)).await {
            Ok(Ok(items)) => {
                cached.items = items;
                cached.status = "ready".into();
                cached.expires = Some(Instant::now() + Duration::from_secs(300));
            }
            _ => {
                cached.status = "unavailable".into();
                cached.expires = Some(Instant::now() + Duration::from_secs(45));
            }
        }
    }
    if cached.status == "ready" || !cached.items.is_empty() {
        inventory.releases.clone_from(&cached.items);
    }
    inventory.releases_status.clone_from(&cached.status);
}

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
    let mut inventory = host::<Inventory>(Request::Catalog)
        .await
        .ok()
        .and_then(|reply| reply.data);
    if inventory.is_none() {
        inventory = host::<Inventory>(Request::Status)
            .await
            .ok()
            .and_then(|reply| reply.data);
    }
    let manager_online = inventory.is_some();
    let mut inventory = inventory.unwrap_or_default();
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "linux/amd64",
        "aarch64" => "linux/arm64",
        other => other,
    };
    if !inventory.historical_switch {
        fill_public_catalog(&mut inventory, architecture).await;
    }
    let version = format!("v{}", env!("CARGO_PKG_VERSION"));
    let current = exact_version(&version);
    for release in &mut inventory.releases {
        release.historical = exact_version(&release.version)
            .zip(current.as_ref())
            .is_some_and(|(selected, running)| &selected < running);
    }
    Ok(Json(DeploymentView {
        version,
        revision: option_env!("MAIL_WEB_REVISION")
            .unwrap_or("development")
            .into(),
        architecture: architecture.into(),
        manager_online,
        inventory,
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
