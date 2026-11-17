//! Docker stores may report either a config digest or a manifest digest as Id.
//! The saved config binds runtime options and all uncompressed rootfs layers.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SavedImage {
    config: String,
    repo_tags: Option<Vec<String>>,
}
pub fn config_id(path: &Path, image: &str) -> Result<String> {
    let mut manifest = None;
    for entry in tar::Archive::new(File::open(path)?).entries()? {
        let entry = entry?;
        if entry.path()?.to_string_lossy().trim_start_matches("./") == "manifest.json" {
            ensure!(
                entry.header().entry_type().is_file() && entry.size() <= 1_048_576,
                "镜像清单无效"
            );
            ensure!(manifest.is_none(), "镜像清单重复");
            manifest = Some(serde_json::from_reader::<_, Vec<SavedImage>>(entry)?);
        }
    }
    let matches: Vec<_> = manifest
        .context("镜像包缺少清单")?
        .into_iter()
        .filter(|item| {
            item.repo_tags.as_ref().is_some_and(|tags| {
                tags.iter()
                    .any(|tag| tag.strip_prefix("docker.io/library/").unwrap_or(tag) == image)
            })
        })
        .collect();
    ensure!(matches.len() == 1, "镜像包中的目标镜像不唯一或缺失");
    let mut digest = None;
    for entry in tar::Archive::new(File::open(path)?).entries()? {
        let mut entry = entry?;
        if entry.path()?.to_string_lossy().trim_start_matches("./")
            == matches[0].config.trim_start_matches("./")
        {
            ensure!(
                entry.header().entry_type().is_file() && entry.size() <= 1_048_576,
                "镜像配置无效"
            );
            ensure!(digest.is_none(), "镜像配置重复");
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            digest = Some(format!("sha256:{}", hex::encode(Sha256::digest(&bytes))));
        }
    }
    digest.context("镜像包缺少配置")
}
pub fn matches(image: &str, expected: &str) -> Result<bool> {
    let reported = crate::docker::capture(&["image", "inspect", "--format", "{{.Id}}", image])?;
    if reported.trim() == expected {
        return Ok(true);
    }
    // Preserve cryptographic verification across classic/containerd stores.
    // Exporting is local and works offline; no daemon settings are changed.
    let stage = tempfile::tempdir()?;
    let archive = stage.path().join("image.tar");
    crate::docker::capture(&[
        "image",
        "save",
        "-o",
        archive.to_str().context("镜像临时路径无效")?,
        image,
    ])?;
    Ok(config_id(&archive, image)? == expected)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(tag: &str, config: &[u8], duplicate: bool) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut archive = tar::Builder::new(file.reopen().unwrap());
        let manifest = serde_json::to_vec(
            &serde_json::json!([{"Config":"config.json","RepoTags":[tag],"Layers":[]}]),
        )
        .unwrap();
        for (name, body) in [
            ("manifest.json", manifest.as_slice()),
            ("config.json", config),
        ]
        .into_iter()
        .chain(duplicate.then_some(("config.json", config)))
        {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive.append_data(&mut header, name, body).unwrap();
        }
        archive.finish().unwrap();
        file
    }
    #[test]
    fn config_digest_is_portable_and_binds_the_rootfs() {
        let one = fixture(
            "docker.io/library/mail-web:1",
            br#"{"rootfs":{"diff_ids":["sha256:first"]}}"#,
            false,
        );
        let two = fixture(
            "mail-web:1",
            br#"{"rootfs":{"diff_ids":["sha256:changed"]}}"#,
            false,
        );
        let first = config_id(one.path(), "mail-web:1").unwrap();
        assert_ne!(first, config_id(two.path(), "mail-web:1").unwrap());
        assert!(config_id(one.path(), "mail-web:other").is_err());
        assert!(config_id(fixture("mail-web:1", b"{}", true).path(), "mail-web:1").is_err());
    }
}
