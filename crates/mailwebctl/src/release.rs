//! Release download/checksum and archive staging adapted from DSH commands.rs
//! (self-update) and backup.rs, commit 86a6e10, MIT OR Apache-2.0.
use crate::config::{self, Settings};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
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
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
pub struct Client {
    http: reqwest::blocking::Client,
    mirror: Option<String>,
}
impl Client {
    pub fn new(mirror: Option<&str>) -> Result<Self> {
        if let Some(m) = mirror {
            let u = reqwest::Url::parse(m)?;
            ensure!(
                u.scheme() == "https"
                    && u.username().is_empty()
                    && u.password().is_none()
                    && u.query().is_none()
                    && u.fragment().is_none(),
                "下载代理必须是无凭据 HTTPS 地址"
            )
        }
        Ok(Self {
            http: reqwest::blocking::Client::builder()
                .user_agent(concat!("mailwebctl/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(600))
                .https_only(true)
                .build()?,
            mirror: mirror.map(|s| s.trim_end_matches('/').to_owned()),
        })
    }
    fn get(&self, url: &str) -> Result<reqwest::blocking::Response> {
        let request = self.http.get(url);
        let request = if reqwest::Url::parse(url)?.host_str() == Some("api.github.com") {
            request.timeout(Duration::from_secs(30))
        } else {
            request
        };
        request
            .send()?
            .error_for_status()
            .context("下载/版本查询失败")
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
        select(all, channel)
    }
    pub fn download(&self, url: &str, to: &Path) -> Result<()> {
        ensure!(url.starts_with("https://"), "下载必须使用 HTTPS");
        let mut urls = Vec::new();
        if let Some(m) = &self.mirror {
            urls.push(format!("{m}/{url}"))
        }
        urls.push(url.into());
        let mut last = None;
        for u in urls {
            for attempt in 0..3 {
                let result = (|| -> Result<()> {
                    let mut response = self.get(&u)?;
                    let total = response.content_length();
                    let mut temp =
                        tempfile::NamedTempFile::new_in(to.parent().context("缺少下载目录")?)?;
                    let mut buffer = [0; 65536];
                    let mut bytes = 0u64;
                    let mut announced = 0;
                    loop {
                        let n = response.read(&mut buffer)?;
                        if n == 0 {
                            break;
                        }
                        temp.write_all(&buffer[..n])?;
                        bytes += n as u64;
                        if bytes / 8388608 > announced {
                            announced = bytes / 8388608;
                            eprintln!(
                                "下载 {} MiB / {}",
                                bytes / 1048576,
                                total
                                    .map(|n| format!("{} MiB", n / 1048576))
                                    .unwrap_or_else(|| "未知大小".into())
                            )
                        }
                    }
                    if let Some(n) = total {
                        ensure!(n == bytes, "下载内容不完整")
                    };
                    temp.as_file().sync_all()?;
                    temp.persist(to).map_err(|e| e.error)?;
                    Ok(())
                })();
                match result {
                    Ok(()) => return Ok(()),
                    Err(e) => {
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
}
fn select(all: Vec<Release>, channel: &str) -> Result<(String, String)> {
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
        .find(|a| a.name == "mail-web-linux-amd64.tar.gz")
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
pub fn prepare(
    s: &Settings,
    version: &str,
    channel: &str,
    mirror: Option<&str>,
    local: Option<&Path>,
) -> Result<(PathBuf, Manifest)> {
    let cache = s.root.join("releases");
    fs::create_dir_all(&cache)?;
    let (dir, tag) = if let Some(local) = local {
        // Local bundle is the extracted, already SHA-verified release; verify its
        // outer tar too when --bundle names an archive. Used for draft release QA.
        if local.is_file() {
            let sums = local.parent().unwrap().join("SHA256SUMS");
            verify(local, &sums, "mail-web-linux-amd64.tar.gz")?;
            let stage = cache.join(format!("package-{}", rand::random::<u64>()));
            unpack(local, &stage)?;
            (stage, None)
        } else {
            bail!("--bundle 必须是应用发布 tar.gz，旁边需有 SHA256SUMS")
        }
    } else {
        let client = Client::new(mirror)?;
        let (tag, url) = client.resolve(&s.repository, version, channel)?;
        let dir = cache.join(&tag);
        fs::create_dir_all(&dir)?;
        client.download(
            &format!(
                "https://github.com/{}/releases/download/{tag}/SHA256SUMS",
                s.repository
            ),
            &dir.join("SHA256SUMS"),
        )?;
        let archive = dir.join("mail-web-linux-amd64.tar.gz");
        client.download(&url, &archive)?;
        verify(
            &archive,
            &dir.join("SHA256SUMS"),
            "mail-web-linux-amd64.tar.gz",
        )?;
        let stage = dir.join(format!("package-{}", rand::random::<u64>()));
        unpack(&archive, &stage)?;
        (stage, Some(tag))
    };
    let manifest: Manifest = serde_json::from_slice(&fs::read(dir.join("release-manifest.json"))?)?;
    ensure!(manifest.architecture == "linux/amd64", "发布包架构不匹配");
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
        assert_eq!(select(r, "latest").unwrap().0, "v1.1.0-alpha.2");
    }
    #[test]
    fn stable_excludes_preview() {
        assert_eq!(
            select(
                vec![
                    release("v1.0.0", false, false, true),
                    release("v1.1.0-alpha.1", false, true, true)
                ],
                "stable"
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
                "latest"
            )
            .is_err()
        );
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
}
