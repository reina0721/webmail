//! Fixed vocabulary for the host socket and operator API.
use serde::{Deserialize, Serialize};

pub const MAX_REQUEST: u64 = 8192;
pub const MAX_RESPONSE: u64 = 1048576;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Operation {
    Update,
    Rollback,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Submit {
    pub id: String,
    pub expected_version: String,
    pub operation: Operation,
    /// Exact release tag for an update, registered snapshot ID for a rollback.
    pub target: String,
    #[serde(default)]
    pub confirm_data_restore: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Status,
    Submit { job: Submit, actor: String },
    Job { id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PublishedVersion {
    pub version: String,
    pub prerelease: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Snapshot {
    pub id: String,
    pub version: String,
    pub created_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Phase {
    Queued,
    Download,
    Verify,
    Backup,
    Switch,
    Health,
    Recovering,
    Succeeded,
    Recovered,
    Failed,
}
impl Phase {
    pub fn finished(self) -> bool {
        matches!(self, Self::Succeeded | Self::Recovered | Self::Failed)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Job {
    pub id: String,
    pub operation: Operation,
    pub target_version: String,
    pub phase: Phase,
    pub message: String,
    pub running_version: Option<String>,
    pub recovery_command: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Inventory {
    pub releases: Vec<PublishedVersion>,
    pub releases_status: String,
    pub snapshots: Vec<Snapshot>,
    pub job: Option<Job>,
}
