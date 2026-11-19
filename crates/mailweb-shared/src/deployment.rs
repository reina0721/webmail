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
    InstallHistorical,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Submit {
    pub id: String,
    pub expected_version: String,
    pub operation: Operation,
    /// Exact GitHub release tag, or the registered snapshot ID for a rollback.
    pub target: String,
    #[serde(default)]
    pub confirm_data_restore: bool,
    #[serde(default)]
    pub download_mirror: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DownloadConfig {
    #[serde(default)]
    pub download_mirror: Option<String>,
    #[serde(default)]
    pub release_proxy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Status,
    Catalog,
    Submit {
        job: Submit,
        actor: String,
    },
    Job {
        id: String,
    },
    Cancel {
        id: String,
    },
    SetDownloadConfig {
        download_mirror: Option<String>,
        release_proxy: Option<String>,
    },
}

pub fn normalize_download_mirror(raw: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(value) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 256
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
        || value.contains('@')
        || value.contains('?')
        || value.contains('#')
    {
        return Err("download_mirror_invalid");
    }
    let Some(rest) = value.strip_prefix("https://") else {
        return Err("download_mirror_invalid");
    };
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty() {
        return Err("download_mirror_invalid");
    }
    Ok(Some(value.trim_end_matches('/').to_owned()))
}

pub fn normalize_release_proxy(raw: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(value) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 256
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
        || value.contains('?')
        || value.contains('#')
    {
        return Err("release_proxy_invalid");
    }
    let rest = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .ok_or("release_proxy_invalid")?;
    let authority = rest.split('/').next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    if host.is_empty() {
        return Err("release_proxy_invalid");
    }
    Ok(Some(value.trim_end_matches('/').to_owned()))
}

pub fn valid_repository(value: &str) -> bool {
    value.split_once('/').is_some_and(|(owner, repo)| {
        [owner, repo].iter().all(|part| {
            !part.is_empty()
                && !matches!(*part, "." | "..")
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PublishedVersion {
    pub version: String,
    pub prerelease: bool,
    #[serde(default)]
    pub historical: bool,
    #[serde(default)]
    pub unavailable_reason: Option<String>,
}

#[derive(Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub draft: bool,
    pub prerelease: bool,
    pub assets: Vec<GithubAsset>,
}

pub fn exact_version(tag: &str) -> Option<semver::Version> {
    if tag.len() > 100 {
        return None;
    }
    let parsed = semver::Version::parse(tag.strip_prefix('v')?).ok()?;
    (parsed.build.is_empty() && tag == format!("v{parsed}")).then_some(parsed)
}

pub fn release_catalog(releases: Vec<GithubRelease>, app_asset: &str) -> Vec<PublishedVersion> {
    let mut items: Vec<_> = releases
        .into_iter()
        .filter(|release| !release.draft)
        .map(|release| {
            let parsed = exact_version(&release.tag_name);
            let has = |name: &str| release.assets.iter().any(|asset| asset.name == name);
            let unavailable_reason = if parsed.is_none() {
                Some("unsupported_tag")
            } else if !has(app_asset) {
                Some("missing_platform_bundle")
            } else if !has("SHA256SUMS") {
                Some("missing_checksums")
            } else {
                None
            };
            let prerelease =
                release.prerelease || parsed.as_ref().is_some_and(|v| !v.pre.is_empty());
            (
                parsed,
                PublishedVersion {
                    version: release.tag_name,
                    prerelease,
                    historical: false,
                    unavailable_reason: unavailable_reason.map(str::to_owned),
                },
            )
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.version.cmp(&a.1.version)));
    items.dedup_by(|a, b| a.1.version == b.1.version);
    items.into_iter().map(|(_, release)| release).collect()
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
    #[serde(default)]
    pub downloaded_bytes: Option<u64>,
    #[serde(default)]
    pub total_bytes: Option<u64>,
    #[serde(default)]
    pub speed_bytes_per_sec: Option<u64>,
    #[serde(default)]
    pub source_label: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Inventory {
    pub releases: Vec<PublishedVersion>,
    pub releases_status: String,
    pub snapshots: Vec<Snapshot>,
    pub job: Option<Job>,
    #[serde(default)]
    pub historical_switch: bool,
    #[serde(default)]
    pub download_mirror: Option<String>,
    #[serde(default)]
    pub release_proxy: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn github_release(tag: &str, assets: &[&str], draft: bool) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            prerelease: false,
            draft,
            assets: assets
                .iter()
                .map(|&name| GithubAsset {
                    name: name.into(),
                    browser_download_url: String::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn catalog_retains_older_and_unavailable_public_releases() {
        let amd64 = "mail-web-linux-amd64.tar.gz";
        let arm64 = "mail-web-linux-arm64.tar.gz";
        let result = release_catalog(
            vec![
                github_release("v0.4.0-alpha.4", &[amd64, arm64, "SHA256SUMS"], false),
                github_release("v0.4.0-alpha.15", &[amd64, arm64, "SHA256SUMS"], true),
                github_release("v0.4.0-alpha.13", &[arm64], false),
                github_release("v0.1.0-alpha.1", &[amd64, "SHA256SUMS"], false),
                github_release("experimental", &[arm64, "SHA256SUMS"], false),
            ],
            arm64,
        );
        assert_eq!(
            result
                .iter()
                .map(|item| (item.version.as_str(), item.unavailable_reason.as_deref()))
                .collect::<Vec<_>>(),
            [
                ("v0.4.0-alpha.13", Some("missing_checksums")),
                ("v0.4.0-alpha.4", None),
                ("v0.1.0-alpha.1", Some("missing_platform_bundle")),
                ("experimental", Some("unsupported_tag")),
            ]
        );
        assert!(result[1].prerelease);
    }
}
