use super::*;
use subtle::ConstantTimeEq;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Spec {
    pub brand: String,
    pub domain: String,
    pub public_origin: String,
    #[serde(default)]
    pub create_domain: bool,
    #[serde(default)]
    pub directory_queries: bool,
    #[serde(default)]
    pub operator_mode: String,
    #[serde(default)]
    pub operator_email: String,
    #[serde(default)]
    pub recovery_email: String,
    #[serde(default)]
    pub cloudflare_account: String,
}
#[derive(Serialize, Deserialize)]
pub(super) struct Job {
    pub id: String,
    pub owner: String,
    pub base: String,
    pub spec: Spec,
    pub status: String,
    pub step: String,
    pub error: String,
    pub resources: HashMap<String, String>,
    pub secrets: HashMap<String, String>,
    pub completed: Vec<String>,
    pub pending: HashMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turnstile_binding: Option<config::TurnstileBinding>,
}
impl Job {
    pub fn new(owner: String, base: String, spec: Spec) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            owner,
            base,
            spec,
            status: "pending".into(),
            step: String::new(),
            error: String::new(),
            resources: HashMap::new(),
            secrets: HashMap::new(),
            completed: Vec::new(),
            pending: HashMap::new(),
            turnstile_binding: None,
        }
    }
    pub fn public(&self) -> Value {
        let skipped_turnstile =
            self.spec.cloudflare_account.is_empty() && self.resource("turnstile").is_empty();
        let completed: Vec<_> = self
            .completed
            .iter()
            .filter(|step| !(skipped_turnstile && step.as_str() == "turnstile"))
            .collect();
        json!({"base":self.base,"id":self.id,"status":self.status,"step":self.step,"error":self.error,"resources":self.resources,"completed":completed,"skipped":if skipped_turnstile{vec!["turnstile"]}else{vec![]},"spec":self.spec,"requiresAuthorization":matches!(self.status.as_str(),"failed"|"interrupted"|"cancelled"),"protocolVerified":false})
    }
    pub fn name(&self, kind: &str) -> String {
        format!("mw-{}-{kind}", self.id.replace('-', ""))
    }
    pub fn resource(&self, key: &str) -> String {
        self.resources.get(key).cloned().unwrap_or_default()
    }
    pub fn secret(&self, key: &str) -> String {
        self.secrets.get(key).cloned().unwrap_or_default()
    }

    pub fn matches_hook(&self, app: &App, previous_url: &str) -> bool {
        self.status == "completed"
            && self.base == app.upstream.base
            && !app.services.hook_id.is_empty()
            && self.resources.get("hook") == Some(&app.services.hook_id)
            && self.secrets.get("hook").is_some_and(|secret| {
                !secret.is_empty()
                    && bool::from(secret.as_bytes().ct_eq(app.services.hook_secret.as_bytes()))
            })
            && (previous_url == app.hook_url_at(&self.spec.public_origin)
                || previous_url == app.hook_url())
    }
}
fn path(app: &App) -> PathBuf {
    config_path().with_file_name(if app.service_id == "default" {
        "initialization.enc".into()
    } else {
        format!("initialization-{}.enc", app.service_id)
    })
}
pub(super) fn read(app: &App) -> Result<Option<Job>> {
    read_at(app, &path(app))
}
pub(super) fn read_at(app: &App, path: &std::path::Path) -> Result<Option<Job>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = zeroize::Zeroizing::new(
        app.vault
            .open(&std::fs::read(path).map_err(|_| internal("initialization_read"))?)
            .map_err(|_| internal("initialization_decrypt"))?,
    );
    Ok(Some(
        serde_json::from_slice(&bytes).map_err(|_| internal("initialization_journal_invalid"))?,
    ))
}
pub(super) fn write(app: &App, job: &Job) -> Result<()> {
    write_at(app, job, &path(app))
}
pub(super) fn write_at(app: &App, job: &Job, path: &std::path::Path) -> Result<()> {
    let data = zeroize::Zeroizing::new(
        serde_json::to_vec(job).map_err(|_| internal("initialization_encode"))?,
    );
    let encrypted = app
        .vault
        .seal(&data)
        .map_err(|_| internal("initialization_encrypt"))?;
    let parent = path
        .parent()
        .ok_or_else(|| internal("initialization_path"))?;
    std::fs::create_dir_all(parent).map_err(|_| internal("initialization_directory"))?;
    let temporary = parent.join(format!(".initialization-{}.tmp", token()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> std::io::Result<()> {
        let mut file = options.open(&temporary)?;
        file.write_all(&encrypted)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)?;
        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
        return Err(internal("initialization_write"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn masked_hook_ownership_is_bound_to_the_completed_installation() {
        let spec = serde_json::from_value(json!({
            "brand":"Mail", "domain":"example.com", "publicOrigin":"http://192.0.2.10:8088"
        }))
        .unwrap();
        let mut app = App {
            root: None,
            revision: 0,
            service_id: "second-service".into(),
            domain_id: "example.com".into(),
            db: sqlx::SqlitePool::connect_lazy("sqlite::memory:").unwrap(),
            upstream: Stalwart {
                http: reqwest::Client::new(),
                base: "https://mail.example.com".into(),
            },
            origin: "https://webmail.example.com".into(),
            direct_origin: None,
            vault: Vault::new(&[3; 32]).unwrap(),
            services: config::Services {
                hook_id: "dedicated".into(),
                hook_secret: "fixture-secret".into(),
                ..Default::default()
            },
        };
        let mut job = Job::new("owner".into(), app.upstream.base.clone(), spec);
        job.resources
            .insert("hook".into(), app.services.hook_id.clone());
        job.secrets
            .insert("hook".into(), app.services.hook_secret.clone());
        let previous = app.hook_url_at(&job.spec.public_origin);
        assert!(!job.matches_hook(&app, &previous));
        job.status = "completed".into();
        assert!(job.matches_hook(&app, &previous));
        assert!(job.matches_hook(&app, &app.hook_url()));
        assert!(!job.matches_hook(&app, "http://192.0.2.10:8088/internal/mta-hook"));
        assert!(!job.matches_hook(
            &app,
            "https://unrelated.example/internal/mta-hook/second-service"
        ));
        app.services.hook_secret = "replacement-secret".into();
        assert!(!job.matches_hook(&app, &previous));
        app.services.hook_secret = "fixture-secret".into();
        app.services.hook_id = "other-hook".into();
        assert!(!job.matches_hook(&app, &previous));
        app.services.hook_id = "dedicated".into();
        app.upstream.base = "https://another-service.example.com".into();
        assert!(!job.matches_hook(&app, &previous));
    }

    #[test]
    fn skipped_turnstile_is_not_reported_as_completed() {
        let spec:Spec=serde_json::from_value(json!({"brand":"Mail","domain":"example.com","publicOrigin":"https://webmail.example.com"})).unwrap();
        let mut job = Job::new("owner".into(), "https://mail.example.com".into(), spec);
        job.completed = vec!["domain".into(), "turnstile".into(), "apply".into()];
        assert_eq!(job.public()["skipped"], json!(["turnstile"]));
        assert_eq!(job.public()["completed"], json!(["domain", "apply"]));
        job.resources.insert("turnstile".into(), "real-site".into());
        assert_eq!(job.public()["skipped"], json!([]));
        assert_eq!(
            job.public()["completed"],
            json!(["domain", "turnstile", "apply"])
        );
    }
    #[test]
    fn public_progress_never_serializes_runtime_secrets_or_pending_snapshots() {
        let spec:Spec=serde_json::from_value(json!({"brand":"Mail","domain":"example.com","publicOrigin":"https://webmail.example.com"})).unwrap();
        let mut job = Job::new(
            "private-owner".into(),
            "https://mail.example.com".into(),
            spec,
        );
        job.secrets.insert("key".into(), "sensitive-value".into());
        job.pending
            .insert("hook".into(), vec!["unrelated-id".into()]);
        let output = job.public().to_string();
        for secret in ["sensitive-value", "private-owner", "unrelated-id"] {
            assert!(!output.contains(secret));
        }
    }
}
