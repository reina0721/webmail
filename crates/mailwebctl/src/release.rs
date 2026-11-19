//! Release download/checksum and archive staging adapted from DSH commands.rs
//! (self-update) and backup.rs, commit 86a6e10, MIT OR Apache-2.0.
use crate::config::{self, Settings};
use crate::platform::Architecture;
use anyhow::{Context, Result, bail, ensure};
use mailweb_shared::deployment::{
    GithubRelease as Release, PublishedVersion, normalize_download_mirror, normalize_release_proxy,
    release_catalog,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const METADATA_TIMEOUT: Duration = Duration::from_secs(30);
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(800);

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: u64,
    pub source_label: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub source_commit: String,
    pub architecture: String,
    pub image: String,
    pub image_id: String,
    #[serde(default)]
    pub cli_version: Option<String>,
}
impl Manifest {
    pub fn matches_runtime_version(&self, runtime: &str) -> bool {
        let tag = self.version.trim_start_matches('v');
        if runtime == tag {
            return true;
        }
        // The first published 0.1.0 alpha images used a shared Cargo version.
        // Their release identity is verified separately by the archive and image hashes.
        self.cli_version.is_none() && tag.starts_with("0.1.0-alpha.") && runtime == "0.1.0"
    }
}
pub struct Client {
    http: reqwest::blocking::Client,
    mirror: Option<String>,
    has_proxy: bool,
}
impl Client {
    pub fn new_with_options(mirror: Option<&str>, proxy: Option<&str>) -> Result<Self> {
        let normalized_mirror =
            normalize_download_mirror(mirror).map_err(|e| anyhow::anyhow!(e))?;
        let normalized_proxy = normalize_release_proxy(proxy).map_err(|e| anyhow::anyhow!(e))?;
        let mut builder = reqwest::blocking::Client::builder()
            .user_agent(concat!("mailwebctl/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(None)
            .tcp_keepalive(Some(Duration::from_secs(15)))
            .tcp_keepalive_interval(Some(Duration::from_secs(10)))
            .tcp_keepalive_retries(Some(3))
            .https_only(true);
        #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
        {
            builder = builder.tcp_user_timeout(Some(READ_IDLE_TIMEOUT));
        }
        let has_proxy = if let Some(ref p) = normalized_proxy {
            builder = builder.proxy(reqwest::Proxy::all(p).context("网络代理地址无效")?);
            true
        } else {
            false
        };
        Ok(Self {
            http: builder.build()?,
            mirror: normalized_mirror,
            has_proxy,
        })
    }
    fn get(&self, url: &str) -> Result<reqwest::blocking::Response> {
        self.http
            .get(url)
            .timeout(METADATA_TIMEOUT)
            .send()?
            .error_for_status()
            .context("下载/版本查询失败")
    }
    pub fn published(&self, repo: &str) -> Result<Vec<PublishedVersion>> {
        config::validate_repo(repo)?;
        let arch = Architecture::current()?;
        let mut versions = Vec::new();
        for page in 1..=100 {
            let batch: Vec<Release> = self
                .get(&format!(
                    "https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
                ))?
                .json()?;
            let done = batch.len() < 100;
            versions.extend(batch);
            if done {
                return Ok(release_catalog(versions, arch.app_asset()));
            }
        }
        bail!("Release 列表超过查询上限")
    }
    pub fn resolve(&self, repo: &str, version: &str, channel: &str) -> Result<(String, String)> {
        config::validate_repo(repo)?;
        let mut all = Vec::new();
        if version != "latest" {
            semver::Version::parse(version.strip_prefix('v').context("版本需要 v 前缀")?)?;
            let release: Release = self
                .get(&format!(
                    "https://api.github.com/repos/{repo}/releases/tags/{version}"
                ))?
                .json()?;
            all.push(release)
        } else {
            for page in 1..=100 {
                let batch: Vec<Release> = self
                    .get(&format!(
                        "https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
                    ))?
                    .json()?;
                let done = batch.len() < 100;
                all.extend(batch);
                if done {
                    break;
                }
                ensure!(page < 100, "Release 列表超过查询上限，需指定版本");
            }
        }
        let selected = select(all, channel, Architecture::current()?)?;
        ensure!(
            version == "latest" || version == selected.0,
            "返回的版本与所选标签不匹配"
        );
        Ok(selected)
    }
    pub fn download(&self, url: &str, to: &Path) -> Result<()> {
        self.download_with_progress(url, to, None, &mut |_| {})
    }
    pub fn download_with_progress(
        &self,
        url: &str,
        to: &Path,
        cancel: Option<&AtomicBool>,
        on_progress: &mut dyn FnMut(DownloadProgress),
    ) -> Result<()> {
        ensure!(url.starts_with("https://"), "下载必须使用 HTTPS");
        let candidates = self.download_candidates(url);
        let (part, meta) = part_paths(to)?;
        let mut last = None;
        for (candidate_url, source_label) in candidates {
            for attempt in 0..3 {
                if is_cancelled(cancel) {
                    bail!("下载已取消");
                }
                let result = self.download_attempt(
                    url,
                    &candidate_url,
                    &source_label,
                    to,
                    &part,
                    &meta,
                    cancel,
                    on_progress,
                );
                match result {
                    Ok(()) => return Ok(()),
                    Err(e) => {
                        if is_cancelled(cancel) {
                            return Err(e);
                        }
                        last = Some(e);
                        if attempt < 2 {
                            std::thread::sleep(Duration::from_secs(1));
                        }
                    }
                }
            }
        }
        Err(last.context("下载失败")?)
    }
    fn download_candidates(&self, url: &str) -> Vec<(String, String)> {
        let mut urls = Vec::new();
        if let Some(m) = &self.mirror {
            urls.push((format!("{m}/{url}"), self.source_label(Some(m))));
        }
        urls.push((url.to_owned(), self.source_label(None)));
        urls
    }
    fn source_label(&self, mirror_url: Option<&str>) -> String {
        let target = match mirror_url.and_then(|m| reqwest::Url::parse(m).ok()) {
            Some(parsed) => format!("镜像 ({})", parsed.host_str().unwrap_or("custom")),
            None => "GitHub 直连".to_owned(),
        };
        if self.has_proxy {
            format!("代理 -> {target}")
        } else {
            target
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn download_attempt(
        &self,
        canonical_url: &str,
        request_url: &str,
        source_label: &str,
        to: &Path,
        part: &Path,
        meta: &Path,
        cancel: Option<&AtomicBool>,
        on_progress: &mut dyn FnMut(DownloadProgress),
    ) -> Result<()> {
        let resume_offset = existing_resume_offset(part, meta, canonical_url);
        let mut request = self.http.get(request_url);
        if resume_offset > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_offset}-"));
        }
        let response = request.send()?;
        let status = response.status();
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            if let Some(total) = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_unsatisfied_total)
                && resume_offset == total
                && part.is_file()
            {
                let file = File::open(part)?;
                file.sync_all()?;
                drop(file);
                finalize_part(part, meta, to)?;
                on_progress(DownloadProgress {
                    downloaded_bytes: total,
                    total_bytes: Some(total),
                    speed_bytes_per_sec: 0,
                    source_label: source_label.to_owned(),
                });
                return Ok(());
            }
            clear_part(part, meta);
            bail!("断点续传偏移无效，将重新下载");
        }
        let response = response.error_for_status().context("下载请求失败")?;
        let (mut file, mut bytes, total) = if status == reqwest::StatusCode::PARTIAL_CONTENT {
            let parsed_range = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_content_range);
            let Some((start, total_from_range)) = parsed_range else {
                clear_part(part, meta);
                bail!("服务器返回的 206 Content-Range 无法解析");
            };
            if start != resume_offset {
                clear_part(part, meta);
                bail!("服务器返回的续传起始位置不匹配");
            }
            let total = total_from_range.or_else(|| response.content_length().map(|n| start + n));
            let file = OpenOptions::new().append(true).open(part)?;
            (file, start, total)
        } else {
            fs::write(meta, canonical_url.as_bytes())?;
            let file = File::create(part)?;
            (file, 0u64, response.content_length())
        };

        on_progress(DownloadProgress {
            downloaded_bytes: bytes,
            total_bytes: total,
            speed_bytes_per_sec: 0,
            source_label: source_label.to_owned(),
        });

        let (tx, rx) = mpsc::sync_channel::<std::result::Result<Vec<u8>, String>>(4);
        std::thread::spawn(move || {
            let mut reader = response;
            let mut buf = [0u8; 65536];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(Ok(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e.to_string()));
                        break;
                    }
                }
            }
        });

        let mut last_data = Instant::now();
        let mut last_report = Instant::now();
        let mut window_bytes = 0u64;
        let mut announced = bytes / 8_388_608;

        loop {
            if is_cancelled(cancel) {
                let _ = file.flush();
                bail!("下载已取消");
            }
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(chunk)) => {
                    file.write_all(&chunk)?;
                    let len = chunk.len() as u64;
                    bytes += len;
                    window_bytes += len;
                    last_data = Instant::now();
                    let elapsed = last_report.elapsed();
                    if elapsed >= PROGRESS_INTERVAL {
                        let secs = elapsed.as_secs_f64().max(0.001);
                        let speed = (window_bytes as f64 / secs) as u64;
                        on_progress(DownloadProgress {
                            downloaded_bytes: bytes,
                            total_bytes: total,
                            speed_bytes_per_sec: speed,
                            source_label: source_label.to_owned(),
                        });
                        last_report = Instant::now();
                        window_bytes = 0;
                    }
                    if bytes / 8_388_608 > announced {
                        announced = bytes / 8_388_608;
                        eprintln!(
                            "下载 {} MiB / {} ({source_label})",
                            bytes / 1_048_576,
                            total
                                .map(|n| format!("{} MiB", n / 1_048_576))
                                .unwrap_or_else(|| "未知大小".into())
                        );
                    }
                }
                Ok(Err(e)) => {
                    let _ = file.flush();
                    bail!("读取下载流失败: {e}");
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if last_data.elapsed() >= READ_IDLE_TIMEOUT {
                        let _ = file.flush();
                        bail!("下载读取超时（45 秒无新数据），将断点续传重试");
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        if let Some(n) = total {
            ensure!(n == bytes, "下载内容不完整 ({bytes}/{n})");
        }
        file.sync_all()?;
        drop(file);
        finalize_part(part, meta, to)?;
        let elapsed = last_report.elapsed().as_secs_f64().max(0.001);
        on_progress(DownloadProgress {
            downloaded_bytes: bytes,
            total_bytes: total.or(Some(bytes)),
            speed_bytes_per_sec: (window_bytes as f64 / elapsed) as u64,
            source_label: source_label.to_owned(),
        });
        Ok(())
    }
}

fn is_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|flag| flag.load(Ordering::Relaxed))
}

fn part_paths(to: &Path) -> Result<(PathBuf, PathBuf)> {
    let parent = to.parent().context("缺少下载目录")?;
    let name = to
        .file_name()
        .and_then(|s| s.to_str())
        .context("目标文件名无效")?;
    Ok((
        parent.join(format!("{name}.part")),
        parent.join(format!("{name}.part.meta")),
    ))
}

fn existing_resume_offset(part: &Path, meta: &Path, canonical_url: &str) -> u64 {
    let Ok(recorded) = fs::read_to_string(meta) else {
        return 0;
    };
    if recorded.trim() != canonical_url {
        clear_part(part, meta);
        return 0;
    }
    fs::metadata(part).map(|m| m.len()).unwrap_or(0)
}

fn clear_part(part: &Path, meta: &Path) {
    let _ = fs::remove_file(part);
    let _ = fs::remove_file(meta);
}

fn finalize_part(part: &Path, meta: &Path, to: &Path) -> Result<()> {
    fs::rename(part, to)?;
    let _ = fs::remove_file(meta);
    Ok(())
}

fn parse_content_range(value: &str) -> Option<(u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes ")?.trim();
    let (range_part, total_part) = rest.split_once('/')?;
    let (start_str, _end_str) = range_part.split_once('-')?;
    let start = start_str.trim().parse::<u64>().ok()?;
    let total = if total_part.trim() == "*" {
        None
    } else {
        Some(total_part.trim().parse::<u64>().ok()?)
    };
    Some((start, total))
}

fn parse_unsatisfied_total(value: &str) -> Option<u64> {
    let rest = value.trim().strip_prefix("bytes ")?.trim();
    let (range_part, total_part) = rest.split_once('/')?;
    if range_part.trim() != "*" {
        return None;
    }
    total_part.trim().parse::<u64>().ok()
}
fn select(all: Vec<Release>, channel: &str, arch: Architecture) -> Result<(String, String)> {
    let selected = all
        .into_iter()
        .filter(|r| !r.draft && (channel != "stable" || !r.prerelease))
        .filter_map(|r| {
            semver::Version::parse(r.tag_name.strip_prefix('v')?)
                .ok()
                .filter(|v| channel != "stable" || v.pre.is_empty())
                .map(|v| (v, r))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .context("未找到此渠道的已发布版本")?
        .1;
    let asset = selected
        .assets
        .iter()
        .find(|a| a.name == arch.app_asset())
        .context("最新所选版本缺少应用包，不自动回退旧版本")?;
    ensure!(
        selected.assets.iter().any(|a| a.name == "SHA256SUMS"),
        "所选版本缺少 SHA256SUMS"
    );
    Ok((selected.tag_name, asset.browser_download_url.clone()))
}
pub fn checksum(file: &Path) -> Result<String> {
    let mut f = File::open(file)?;
    let mut h = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n])
    }
    Ok(hex::encode(h.finalize()))
}
pub fn verify(file: &Path, sums: &Path, name: &str) -> Result<()> {
    let text = fs::read_to_string(sums)?;
    let hashes: Vec<_> = text
        .lines()
        .filter_map(|l| {
            let mut p = l.split_whitespace();
            let hash = p.next()?;
            let n = p.next()?.trim_start_matches('*');
            (n == name).then_some(hash)
        })
        .collect();
    ensure!(
        hashes.len() == 1 && hashes[0].len() == 64,
        "校验清单缺少唯一的 {name}"
    );
    ensure!(
        checksum(file)?.eq_ignore_ascii_case(hashes[0]),
        "{name} SHA-256 校验失败"
    );
    Ok(())
}
pub fn unpack(archive: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(File::open(archive)?));
    for item in tar.entries()? {
        let mut item = item?;
        let path = item.path()?.into_owned();
        validate_archive_path(&path)?;
        ensure!(
            item.header().entry_type().is_file() || item.header().entry_type().is_dir(),
            "拒绝归档链接或特殊文件"
        );
        ensure!(item.unpack_in(dest)?, "归档路径越界");
    }
    Ok(())
}
// From DSH backup.rs::validate_archive_path, adapted to forbid links in unpack.
fn validate_archive_path(path: &Path) -> Result<()> {
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => bail!("归档路径越界: {}", path.display()),
        }
    }
    Ok(())
}
#[cfg(test)]
pub fn prepare(
    s: &Settings,
    version: &str,
    channel: &str,
    mirror: Option<&str>,
    local: Option<&Path>,
) -> Result<(PathBuf, Manifest)> {
    prepare_with_options(s, version, channel, mirror, None, local, None, &mut |_| {})
}

#[allow(clippy::too_many_arguments)]
pub fn prepare_with_options(
    s: &Settings,
    version: &str,
    channel: &str,
    mirror: Option<&str>,
    proxy: Option<&str>,
    local: Option<&Path>,
    cancel: Option<&AtomicBool>,
    on_progress: &mut dyn FnMut(DownloadProgress),
) -> Result<(PathBuf, Manifest)> {
    let arch = Architecture::current()?;
    let cache = s.root.join("releases");
    fs::create_dir_all(&cache)?;
    let (dir, tag) = if let Some(local) = local {
        // Local bundle is the extracted, already SHA-verified release; verify its
        // outer tar too when --bundle names an archive. Used for draft release QA.
        if local.is_file() {
            let sums = local.parent().unwrap().join("SHA256SUMS");
            verify(local, &sums, arch.app_asset())?;
            let stage = cache.join(format!("package-{}", rand::random::<u64>()));
            unpack(local, &stage)?;
            (stage, None)
        } else {
            bail!("--bundle 必须是应用发布 tar.gz，旁边需有 SHA256SUMS")
        }
    } else {
        let client = Client::new_with_options(mirror, proxy)?;
        let (tag, url) = client.resolve(&s.repository, version, channel)?;
        let dir = cache.join(&tag);
        fs::create_dir_all(&dir)?;
        let sums = dir.join("SHA256SUMS");
        client.download_with_progress(
            &format!(
                "https://github.com/{}/releases/download/{tag}/SHA256SUMS",
                s.repository
            ),
            &sums,
            cancel,
            &mut |_| {},
        )?;
        let archive = dir.join(arch.app_asset());
        if archive.is_file() && verify(&archive, &sums, arch.app_asset()).is_ok() {
            let size = fs::metadata(&archive)?.len();
            on_progress(DownloadProgress {
                downloaded_bytes: size,
                total_bytes: Some(size),
                speed_bytes_per_sec: 0,
                source_label: "本地已校验缓存".to_owned(),
            });
        } else {
            client.download_with_progress(&url, &archive, cancel, on_progress)?;
            if let Err(e) = verify(&archive, &sums, arch.app_asset()) {
                let _ = fs::remove_file(&archive);
                return Err(e);
            }
        }
        let stage = dir.join(format!("package-{}", rand::random::<u64>()));
        unpack(&archive, &stage)?;
        (stage, Some(tag))
    };
    let manifest: Manifest = serde_json::from_slice(&fs::read(dir.join("release-manifest.json"))?)?;
    arch.validate(&manifest.architecture)?;
    let parsed = semver::Version::parse(
        manifest
            .version
            .strip_prefix('v')
            .context("发布版本格式错误")?,
    )?;
    ensure!(
        tag.as_ref().is_none_or(|t| t == &manifest.version)
            && (version == "latest" || version == manifest.version),
        "请求版本与发布包不符"
    );
    ensure!(
        channel != "stable" || parsed.pre.is_empty(),
        "stable 渠道不接受预发布"
    );
    ensure!(
        manifest.image == format!("mail-web:{}", parsed),
        "发布镜像名称不符"
    );
    ensure!(
        manifest.image_id.starts_with("sha256:")
            && manifest.image_id.len() == 71
            && manifest.image_id[7..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit()),
        "镜像 ID 格式无效"
    );
    ensure!(
        manifest.source_commit.len() == 40
            && manifest
                .source_commit
                .bytes()
                .all(|b| b.is_ascii_hexdigit()),
        "发布包缺少有效源码提交"
    );
    verify(
        &dir.join("image.tar"),
        &dir.join("image.sha256"),
        "image.tar",
    )?;
    Ok((dir, manifest))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_escape_rejected() {
        assert!(validate_archive_path(Path::new("../secrets")).is_err());
        assert!(validate_archive_path(Path::new("/etc/passwd")).is_err());
        assert!(validate_archive_path(Path::new("./bin/mailwebctl")).is_ok());
    }
    #[test]
    fn duplicate_checksum_rejected() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("file");
        fs::write(&f, "x").unwrap();
        let sums = d.path().join("SHA256SUMS");
        let h = checksum(&f).unwrap();
        fs::write(&sums, format!("{h} file\n{h} file\n")).unwrap();
        assert!(verify(&f, &sums, "file").is_err());
    }
    #[test]
    fn semver_prerelease_order() {
        assert!(
            semver::Version::parse("0.4.0-alpha.10").unwrap()
                > semver::Version::parse("0.4.0-alpha.9").unwrap()
        );
        assert!(
            semver::Version::parse("0.4.0").unwrap()
                > semver::Version::parse("0.4.0-alpha.10").unwrap()
        );
    }
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    use mailweb_shared::deployment::GithubAsset as Asset;
    fn release(tag: &str, draft: bool, prerelease: bool, assets: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft,
            prerelease,
            assets: if assets {
                vec![
                    Asset {
                        name: "mail-web-linux-amd64.tar.gz".into(),
                        browser_download_url: "https://github.com/example/asset".into(),
                    },
                    Asset {
                        name: "SHA256SUMS".into(),
                        browser_download_url: "https://github.com/example/sums".into(),
                    },
                ]
            } else {
                vec![]
            },
        }
    }
    #[test]
    fn latest_includes_preview_and_ignores_draft() {
        let r = vec![
            release("v1.0.0", false, false, true),
            release("v1.1.0-alpha.2", false, true, true),
            release("v2.0.0", true, false, true),
        ];
        assert_eq!(
            select(r, "latest", Architecture::Amd64).unwrap().0,
            "v1.1.0-alpha.2"
        );
    }
    #[test]
    fn stable_excludes_preview() {
        assert_eq!(
            select(
                vec![
                    release("v1.0.0", false, false, true),
                    release("v1.1.0-alpha.1", false, true, true)
                ],
                "stable",
                Architecture::Amd64
            )
            .unwrap()
            .0,
            "v1.0.0"
        );
    }
    #[test]
    fn missing_newest_asset_does_not_downgrade() {
        assert!(
            select(
                vec![
                    release("v1.0.0", false, false, true),
                    release("v1.1.0", false, false, false)
                ],
                "latest",
                Architecture::Amd64
            )
            .is_err()
        );
    }
    #[test]
    fn arm64_selects_its_asset_and_never_falls_back_to_amd64() {
        let amd = release("v1.0.0", false, false, true);
        assert!(select(vec![amd], "latest", Architecture::Arm64).is_err());
        let mut arm = release("v1.0.0", false, false, true);
        arm.assets[0].name = Architecture::Arm64.app_asset().into();
        assert!(select(vec![arm], "latest", Architecture::Arm64).is_ok());
        let mut missing_sums = release("v1.0.0", false, false, true);
        missing_sums.assets.retain(|a| a.name != "SHA256SUMS");
        assert!(select(vec![missing_sums], "latest", Architecture::Amd64).is_err());
    }
    #[test]
    fn corrupt_checksum_rejected() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("bundle");
        fs::write(&file, b"original").unwrap();
        let sums = d.path().join("SHA256SUMS");
        fs::write(&sums, format!("{}  bundle\n", checksum(&file).unwrap())).unwrap();
        fs::write(&file, b"corrupt").unwrap();
        assert!(verify(&file, &sums, "bundle").is_err());
    }
    #[test]
    fn offline_bundle_checks_platform_and_requested_version() {
        let root = tempfile::tempdir().unwrap();
        let settings = Settings::load(root.path()).unwrap();
        let arch = Architecture::current().unwrap();
        let other = match arch {
            Architecture::Amd64 => Architecture::Arm64,
            Architecture::Arm64 => Architecture::Amd64,
        };
        let bundle = root.path().join(arch.app_asset());
        for (platform, request, valid) in [
            (arch.platform(), "v1.0.0", true),
            (other.platform(), "v1.0.0", false),
            (arch.platform(), "v2.0.0", false),
        ] {
            let manifest = serde_json::json!({
                "version": "v1.0.0", "sourceCommit": "1".repeat(40),
                "architecture": platform, "image": "mail-web:1.0.0",
                "imageId": format!("sha256:{}", "a".repeat(64)), "cliVersion": "1.0.0"
            });
            let image = b"synthetic image";
            let encoder = flate2::write::GzEncoder::new(
                File::create(&bundle).unwrap(),
                flate2::Compression::default(),
            );
            let mut archive = tar::Builder::new(encoder);
            for (name, bytes) in [
                (
                    "release-manifest.json",
                    serde_json::to_vec(&manifest).unwrap(),
                ),
                ("image.tar", image.to_vec()),
                (
                    "image.sha256",
                    format!("{:x}  image.tar\n", Sha256::digest(image)).into_bytes(),
                ),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                archive
                    .append_data(&mut header, name, bytes.as_slice())
                    .unwrap();
            }
            archive.into_inner().unwrap().finish().unwrap();
            fs::write(
                root.path().join("SHA256SUMS"),
                format!("{}  {}\n", checksum(&bundle).unwrap(), arch.app_asset()),
            )
            .unwrap();
            let result = prepare(&settings, request, "latest", None, Some(&bundle));
            assert_eq!(result.is_ok(), valid, "{platform} / {request}: {result:?}");
        }
    }
    #[test]
    fn archive_symlink_refused() {
        let d = tempfile::tempdir().unwrap();
        let archive = d.path().join("bad.tar.gz");
        let encoder = flate2::write::GzEncoder::new(
            File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        let mut b = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_link_name("/etc/passwd").unwrap();
        header.set_cksum();
        b.append_data(&mut header, "link", std::io::empty())
            .unwrap();
        b.into_inner().unwrap().finish().unwrap();
        assert!(unpack(&archive, &d.path().join("output")).is_err());
    }
    #[test]
    fn content_range_and_resume_helpers_behave() {
        assert_eq!(
            parse_content_range("bytes 1024-2047/4096"),
            Some((1024, Some(4096)))
        );
        assert_eq!(parse_content_range("bytes 0-99/*"), Some((0, None)));
        assert_eq!(parse_content_range("items 0-99/100"), None);
        assert_eq!(parse_unsatisfied_total("bytes */4096"), Some(4096));
        assert_eq!(parse_unsatisfied_total("bytes 0-1/4096"), None);

        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("pkg.tar.gz");
        let (part, meta) = part_paths(&target).unwrap();
        fs::write(&part, b"12345").unwrap();
        fs::write(&meta, b"https://example.com/a.tar.gz").unwrap();
        assert_eq!(
            existing_resume_offset(&part, &meta, "https://example.com/a.tar.gz"),
            5
        );
        assert_eq!(
            existing_resume_offset(&part, &meta, "https://example.com/b.tar.gz"),
            0
        );
        assert!(!part.exists() && !meta.exists());
    }
    #[test]
    fn client_validates_mirror_and_proxy_options() {
        assert!(Client::new_with_options(Some("https://ghfast.top/"), None).is_ok());
        assert!(Client::new_with_options(Some("http://ghfast.top"), None).is_err());
        assert!(Client::new_with_options(None, Some("http://127.0.0.1:7890")).is_ok());
        assert!(Client::new_with_options(None, Some("socks5://127.0.0.1:1080")).is_err());
        let client =
            Client::new_with_options(Some("https://ghfast.top"), Some("http://127.0.0.1:7890"))
                .unwrap();
        assert_eq!(
            client.source_label(Some("https://ghfast.top")),
            "代理 -> 镜像 (ghfast.top)"
        );
        assert_eq!(client.source_label(None), "代理 -> GitHub 直连");
    }
}
