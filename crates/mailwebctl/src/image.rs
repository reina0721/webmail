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
/// Legacy publishers sometimes recorded an OCI descriptor instead of config Id.
/// Accept that spelling only when its hashed source manifest binds this config.
pub fn declared_config_id(path: &Path, image: &str, declared: &str) -> Result<String> {
    let canonical = config_id(path, image)?;
    if canonical == declared {
        return Ok(canonical);
    }
    let mut nodes = std::collections::HashMap::new();
    for entry in tar::Archive::new(File::open(path)?).entries()? {
        let mut entry = entry?;
        if entry.header().entry_type().is_file()
            && entry.size() <= 1_048_576
            && entry.path()?.to_string_lossy().starts_with("blobs/sha256/")
        {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            if let Ok(node) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                nodes.insert(
                    format!("sha256:{}", hex::encode(Sha256::digest(&bytes))),
                    node,
                );
            }
        }
    }
    let mut pending = vec![declared.to_owned()];
    let mut visited = std::collections::HashSet::new();
    while let Some(id) = pending.pop() {
        if !visited.insert(id.clone()) {
            continue;
        }
        ensure!(visited.len() <= 1024, "镜像描述符过多");
        if let Some(node) = nodes.get(&id) {
            match node["mediaType"].as_str().unwrap_or_default() {
                "application/vnd.oci.image.manifest.v1+json"
                | "application/vnd.docker.distribution.manifest.v2+json" => {
                    if node["config"]["digest"] == canonical {
                        return Ok(canonical);
                    }
                }
                "application/vnd.oci.image.index.v1+json"
                | "application/vnd.docker.distribution.manifest.list.v2+json" => {
                    if let Some(items) = node["manifests"].as_array() {
                        pending.extend(
                            items
                                .iter()
                                .filter_map(|item| item["digest"].as_str().map(str::to_owned)),
                        );
                    }
                }
                _ => {}
            }
        }
    }
    anyhow::bail!("镜像配置与发布声明不匹配")
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
    fn legacy_descriptor_must_cryptographically_bind_the_same_config() {
        let source = fixture("mail-web:1", b"{}", false);
        let canonical = config_id(source.path(), "mail-web:1").unwrap();
        let node=serde_json::to_vec(&serde_json::json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"digest":canonical}})).unwrap();
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(&node)));
        let target = tempfile::NamedTempFile::new().unwrap();
        let mut builder = tar::Builder::new(target.reopen().unwrap());
        for entry in tar::Archive::new(source.reopen().unwrap())
            .entries()
            .unwrap()
        {
            let mut entry = entry.unwrap();
            builder.append(&entry.header().clone(), &mut entry).unwrap();
        }
        let mut header = tar::Header::new_gnu();
        header.set_size(node.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(
                &mut header,
                format!("blobs/sha256/{}", &digest[7..]),
                node.as_slice(),
            )
            .unwrap();
        builder.finish().unwrap();
        assert_eq!(
            declared_config_id(target.path(), "mail-web:1", &digest).unwrap(),
            canonical
        );
        assert!(
            declared_config_id(
                target.path(),
                "mail-web:1",
                &format!("sha256:{}", "0".repeat(64))
            )
            .is_err()
        );
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
