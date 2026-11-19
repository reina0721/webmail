use super::*;
#[cfg(unix)]
use mailweb_shared::deployment::MAX_RESPONSE;
use mailweb_shared::deployment::{
    GithubRelease, Inventory, Job, PublishedVersion, Request, Submit, exact_version,
    release_catalog, valid_repository,
};
use serde::de::DeserializeOwned;
use std::{
    io,
    sync::LazyLock,
    time::{Duration, Instant},
};
#[cfg(unix)]
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
    manager_issue: Option<ManagerIssue>,
    inventory: Inventory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum ManagerIssue {
    SocketMissing,
    PermissionDenied,
    Unavailable,
}

impl From<io::Error> for ManagerIssue {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::SocketMissing,
            io::ErrorKind::PermissionDenied => Self::PermissionDenied,
            _ => Self::Unavailable,
        }
    }
}

impl From<ManagerIssue> for Error {
    fn from(issue: ManagerIssue) -> Self {
        let code = match issue {
            ManagerIssue::PermissionDenied => "version_manager_permission_denied",
            _ => "version_manager_unavailable",
        };
        Error(StatusCode::SERVICE_UNAVAILABLE, code)
    }
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

async fn host<T: DeserializeOwned>(
    request: Request,
) -> std::result::Result<Reply<T>, ManagerIssue> {
    #[cfg(unix)]
    {
        tokio::time::timeout(Duration::from_secs(6), async move {
            let mut stream =
                tokio::net::UnixStream::connect("/run/mailweb-manager/control.sock").await?;
            let mut bytes = serde_json::to_vec(&request).map_err(|_| ManagerIssue::Unavailable)?;
            bytes.push(b'\n');
            stream.write_all(&bytes).await?;
            stream.shutdown().await?;
            let mut result = Vec::new();
            stream
                .take(MAX_RESPONSE + 1)
                .read_to_end(&mut result)
                .await?;
            if result.len() as u64 > MAX_RESPONSE {
                return Err(ManagerIssue::Unavailable);
            }
            serde_json::from_slice(&result).map_err(|_| ManagerIssue::Unavailable)
        })
        .await
        .unwrap_or(Err(ManagerIssue::Unavailable))
    }
    #[cfg(not(unix))]
    {
        let _ = request;
        Err(ManagerIssue::Unavailable)
    }
}

async fn host_inventory() -> std::result::Result<Inventory, ManagerIssue> {
    // Older host helpers understand Status but may reject Catalog.
    if let Some(inventory) = host::<Inventory>(Request::Catalog).await?.data {
        return Ok(inventory);
    }
    host::<Inventory>(Request::Status)
        .await?
        .data
        .ok_or(ManagerIssue::Unavailable)
}

pub(super) async fn check_manager() -> std::result::Result<(), String> {
    host_inventory()
        .await
        .map(|_| ())
        .map_err(|issue| Error::from(issue).1.to_owned())
}

#[utoipa::path(get,path="/api/v1/admin/deployment",operation_id="deployment_status",responses((status=200,body=DeploymentView),(status=403,description="Operator required")))]
pub(super) async fn status(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Result<Json<DeploymentView>> {
    operator(&app, &headers, false).await?;
    let inventory = host_inventory().await;
    let manager_online = inventory.is_ok();
    let manager_issue = inventory.as_ref().err().copied();
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
        manager_issue,
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
