//! Host lifecycle adapted from DSH commands.rs/runtime.rs/backup.rs (86a6e10,
//! MIT OR Apache-2.0). Mail Web-specific snapshots and release import added.
use crate::{
    Cli, Command,
    config::{self, Settings},
    docker,
    release::{self, Manifest},
};
use anyhow::{Context, Result, bail, ensure};
use mailweb_shared::deployment::Phase;
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::IsTerminal,
    path::{Path, PathBuf},
    process::Command as Process,
};
const COMPOSE: &str = include_str!("../../../compose.yaml");
const WRAPPER: &str = include_str!("../../../deploy/mail-web.sh");
fn now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}
pub(crate) fn installed(s: &Settings) -> Result<Option<Manifest>> {
    let p = s.root.join("config/installed-release.json");
    if !p.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(p)?)?))
}
fn installed_root(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    let root = parent.parent()?;
    (parent.file_name().is_some_and(|s| s == "bin")
        && (root.join(".env").exists() || root.join("config/deployment.lock").exists()))
    .then(|| root.to_owned())
}
fn local_root(cli: &Cli) -> Result<PathBuf> {
    if let Some(root) = &cli.dir {
        return Ok(root.clone());
    }
    if let Some(root) = installed_root(&std::env::current_exe()?) {
        return Ok(root);
    }
    if matches!(cli.command, Command::Install { .. }) {
        let default =
            PathBuf::from(std::env::var_os("HOME").context("请提供 --dir")?).join("apps/mail-web");
        if let Some(mut tty) = config::tty().filter(|_| !cli.yes) {
            return Ok(config::prompt(&mut tty, "安装目录", &default.to_string_lossy())?.into());
        }
        return Ok(default);
    }
    Ok(std::env::current_dir()?)
}
pub fn run(cli: Cli) -> Result<()> {
    let mut s = Settings::load(&local_root(&cli)?)?;
    s.apply(&cli)?;
    if let Command::VersionManager { action } = &cli.command {
        return crate::manager::run(&s, action);
    }
    let writing = !matches!(
        cli.command,
        Command::Status
            | Command::Version
            | Command::Logs { .. }
            | Command::Setup { .. }
            | Command::CheckUpdate { .. }
            | Command::Doctor { fix: false, .. }
    );
    if writing {
        s.guard_directory(matches!(cli.command, Command::Restore { .. }))?;
        if !matches!(
            cli.command,
            Command::SelfUpdate { .. } | Command::RotateSetupToken
        ) {
            docker::require()?;
        }
        s.init()?;
        s = Settings::load(&s.root)?;
        s.apply(&cli)?;
    }
    let old = Settings::load(&s.root)?;
    s.apply(&cli)?;
    let _lock = if writing { Some(s.lock()?) } else { None };
    match &cli.command {
        Command::Install { version, bundle } | Command::Update { version, bundle } => install(
            &mut s,
            &old,
            &cli,
            version,
            bundle.as_deref(),
            &mut |_, _| Ok(()),
        ),
        Command::Configure => configure(&mut s, &old, &cli),
        Command::Start => docker::start(&s),
        Command::Stop => docker::stop(&s),
        Command::Restart => {
            docker::stop(&s)?;
            docker::start(&s)
        }
        Command::Status => status(&s, cli.json),
        Command::Version => {
            println!(
                "{}",
                installed(&s)?
                    .map(|m| m.version)
                    .unwrap_or_else(|| "未安装".into())
            );
            Ok(())
        }
        Command::Logs { follow, tail } => logs(&s, *follow, *tail),
        Command::Doctor { network, fix } => {
            doctor(&s, *network, *fix, cli.json, cli.download_mirror.as_deref())
        }
        Command::Backup => {
            let path = backup(&s, true)?;
            println!("{}", path.display());
            Ok(())
        }
        Command::Restore { snapshot } => {
            ensure!(cli.yes, "恢复会替换本实例数据，请备份后使用 --yes");
            restore(&old, snapshot, &cli)
        }
        Command::Setup { show_token, direct } => setup(&s, *show_token, *direct),
        Command::RotateSetupToken => {
            write_key(&s, "setup", true)?;
            s.permissions()?;
            setup(&s, false, false)
        }
        Command::CheckUpdate { version } => {
            let (tag, _) = release::Client::new(cli.download_mirror.as_deref())?.resolve(
                &s.repository,
                version,
                &cli.channel,
            )?;
            println!("{tag}");
            Ok(())
        }
        Command::SelfUpdate { version } => self_update(&s, &cli, version),
        Command::VersionManager { .. } => unreachable!(),
        Command::PolicyVerified { value } => {
            docker::stop(&s)?;
            let r = docker::maintenance(&s, &["--set-policy-verified", value]);
            let start = docker::start(&s);
            r?;
            start
        }
    }
}
fn write_key(s: &Settings, name: &str, replace: bool) -> Result<()> {
    let path = s.root.join(format!("secrets/{name}.key"));
    if !path.exists() || replace {
        let mut bytes = [0u8; 32];
        use rand::RngCore;
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        config::atomic(&path, hex::encode(bytes).as_bytes(), 0o600)?;
    }
    Ok(())
}
fn preflight(old: &Settings, new: &mut Settings, cli: &Cli) -> Result<()> {
    docker::require()?;
    loop {
        match docker::owned(new) {
            Ok(_) => break,
            Err(error) => {
                let Some(mut tty) = config::tty().filter(|_| !cli.yes) else {
                    return Err(error);
                };
                eprintln!("{error:#}");
                let name = config::prompt(&mut tty, "请选择本安装专用的其他容器名", &new.name)?;
                let mut candidate = new.clone();
                candidate.name = name;
                if let Err(error) = candidate.validate() {
                    eprintln!("{error:#}");
                    continue;
                }
                new.name = candidate.name;
            }
        }
    }
    let owns_old = old.root.join(".env").exists() && docker::owned(old)? && docker::running(old);
    if owns_old && old.port == new.port {
        return Ok(());
    }
    loop {
        match new.port_free() {
            Ok(()) => return Ok(()),
            Err(error) => {
                let Some(mut tty) = config::tty().filter(|_| !cli.yes) else {
                    return Err(error);
                };
                eprintln!("{error:#}");
                let value = config::prompt(&mut tty, "请选择其他端口", &new.port.to_string())?;
                if let Ok(port) = value.parse::<u16>()
                    && port > 0
                {
                    new.port = port;
                }
            }
        }
    }
}
fn desired_origin(s: &Settings, old: &Settings, cli: &Cli) -> Result<Option<String>> {
    if let Some(o) = &cli.public_origin {
        config::validate_origin(o, s.allow_http)?;
        return Ok(Some(o.clone()));
    }
    if old.root.join("config/runtime.enc").exists() && (old.bind != s.bind || old.port != s.port) {
        let Some(mut tty) = config::tty().filter(|_| !cli.yes) else {
            bail!("已有站点更改监听时，必须使用 --public-origin 指定保留的反代来源或新的直连来源")
        };
        let default = read_origin(old).unwrap_or_default();
        let o = config::prompt(
            &mut tty,
            "网站公开来源（反代保持原地址，直连填新的 IP:端口 URL）",
            &default,
        )?;
        config::validate_origin(&o, s.allow_http)?;
        return Ok(Some(o));
    }
    Ok(None)
}
fn read_origin(s: &Settings) -> Result<String> {
    let token = fs::read_to_string(s.root.join("secrets/setup.key"))?;
    let response = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(4))
        .build()?
        .get(format!("{}/api/v1/installation/config", s.url()))
        .bearer_auth(token.trim())
        .send()?
        .error_for_status()?
        .json::<Value>()?;
    Ok(response["settings"]["publicOrigin"]
        .as_str()
        .unwrap_or_default()
        .into())
}
fn ensure_not_downgrade(s: &Settings, version: &str) -> Result<()> {
    let target = semver::Version::parse(version.trim_start_matches('v'))?;
    let manifest = installed(s)?;
    // .env is committed before the new program may migrate the database. The
    // success manifest can still be old if startup or the host was interrupted.
    for record in [
        s.values.get("MAIL_WEB_VERSION").map(String::as_str),
        manifest.as_ref().map(|m| m.version.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        ensure!(
            semver::Version::parse(record.trim_start_matches('v'))? <= target,
            "禁止直接降级数据库；请使用匹配快照恢复"
        );
    }
    Ok(())
}
pub(crate) fn install(
    s: &mut Settings,
    old: &Settings,
    cli: &Cli,
    version: &str,
    bundle: Option<&Path>,
    progress: &mut dyn FnMut(Phase, Option<&Path>) -> Result<()>,
) -> Result<()> {
    if !matches!(cli.command, Command::Update { .. }) {
        config::wizard(s, cli)?;
    }
    let origin = desired_origin(s, old, cli)?;
    preflight(old, s, cli)?;
    progress(Phase::Download, None)?;
    let (package, mut manifest) = release::prepare(
        s,
        version,
        &cli.channel,
        cli.download_mirror.as_deref(),
        bundle,
    )?;
    progress(Phase::Verify, None)?;
    manifest.image_id = crate::image::declared_config_id(
        &package.join("image.tar"),
        &manifest.image,
        &manifest.image_id,
    )?;
    ensure_not_downgrade(s, &manifest.version)?;
    eprintln!(
        "校验完成：{} · {}",
        manifest.version, manifest.source_commit
    );
    docker::stream(&[
        "load",
        "-i",
        package.join("image.tar").to_str().context("包路径无效")?,
    ])?;
    ensure!(
        crate::image::matches(&manifest.image, &manifest.image_id)?,
        "导入镜像 ID 与清单不符"
    );
    let runtime: Value = serde_json::from_str(&docker::capture(&[
        "run",
        "--rm",
        "--pull",
        "never",
        &manifest.image,
        "--runtime-info",
    ])?)?;
    ensure!(
        runtime["version"].as_str() == Some(manifest.version.trim_start_matches('v'))
            && (manifest.cli_version.is_none()
                || runtime["revision"].as_str() == Some(&manifest.source_commit)),
        "镜像版本/提交与发布清单不一致"
    );
    if let Some(version) = &manifest.cli_version {
        ensure!(
            version == manifest.version.trim_start_matches('v'),
            "应用与 CLI 清单版本不一致"
        );
        verify_cli_version(&package.join("bin/mailwebctl"), version)?;
    }
    if !s.root.join("bin/mailwebctl").exists() {
        install_cli(
            s,
            package
                .join("bin/mailwebctl")
                .is_file()
                .then(|| package.join("bin/mailwebctl"))
                .as_deref(),
        )?;
    }
    let existed = old.root.join(".env").exists();
    let snapshot = if existed {
        progress(Phase::Backup, None)?;
        Some(backup(old, false)?)
    } else {
        None
    };
    let apply = (|| -> Result<()> {
        progress(Phase::Switch, snapshot.as_deref())?;
        if !existed {
            s.values = config::env_read(&package.join(".env.example"))?;
            s.values.remove("PUBLIC_ORIGIN");
        }
        s.values.insert(
            "MAIL_WEB_VERSION".into(),
            manifest.version.trim_start_matches('v').into(),
        );
        s.save()?;
        config::atomic(&s.root.join("compose.yaml"), COMPOSE.as_bytes(), 0o600)?;
        for key in ["session", "setup", "mta-hook"] {
            write_key(s, key, false)?
        }
        s.permissions()?;
        if let Some(o) = &origin {
            docker::maintenance(s, &["--set-public-origin", o])?;
            s.values.insert("PUBLIC_ORIGIN".into(), o.clone());
            s.save()?;
        }
        progress(Phase::Health, None)?;
        docker::start(s)?;
        config::atomic(
            &s.root.join("config/installed-release.json"),
            &serde_json::to_vec_pretty(&manifest)?,
            0o600,
        )?;
        install_cli(
            s,
            package
                .join("bin/mailwebctl")
                .is_file()
                .then(|| package.join("bin/mailwebctl"))
                .as_deref(),
        )?;
        install_docs(&package, &s.root)?;
        Ok(())
    })();
    if let Err(e) = apply {
        let _ = docker::stop(s);
        if let Some(snapshot) = snapshot {
            bail!(
                "升级未完成，服务已停止。使用 ./mailweb restore '{}' --yes 恢复匹配快照。原因: {e:#}",
                snapshot.display()
            )
        }
        return Err(e);
    }
    summary(s, &manifest)?;
    Ok(())
}
fn verify_cli_version(source: &Path, version: &str) -> Result<()> {
    let output = Process::new(source).arg("--version").output()?;
    ensure!(
        output.status.success()
            && String::from_utf8_lossy(&output.stdout).trim() == format!("mailwebctl {version}"),
        "CLI 版本与发布版本不一致"
    );
    Ok(())
}
fn install_cli(s: &Settings, source: Option<&Path>) -> Result<()> {
    let exe = std::env::current_exe()?;
    let source = source.unwrap_or(&exe);
    let output = Process::new(source).arg("--version").output()?;
    ensure!(
        output.status.success()
            && String::from_utf8_lossy(&output.stdout).starts_with("mailwebctl "),
        "包内管理 CLI 无效"
    );
    config::atomic(&s.root.join("bin/mailwebctl"), &fs::read(source)?, 0o755)?;
    // Relative symlink, adapted from DSH's project-root launcher.
    let launcher = s.root.join("mailweb");
    if launcher.exists() || launcher.is_symlink() {
        let m = fs::symlink_metadata(&launcher)?;
        ensure!(!m.is_dir(), "mailweb 入口被目录占用");
        fs::remove_file(&launcher)?
    }
    std::os::unix::fs::symlink("bin/mailwebctl", launcher)?;
    config::atomic(
        &s.root.join("deploy/mail-web.sh"),
        WRAPPER.as_bytes(),
        0o755,
    )?;
    config::atomic(
        &s.root.join("deploy/install.sh"),
        include_bytes!("../../../deploy/install.sh"),
        0o755,
    )?;
    Ok(())
}
fn configure(s: &mut Settings, old: &Settings, cli: &Cli) -> Result<()> {
    ensure!(old.root.join(".env").exists(), "尚未安装");
    config::wizard(s, cli)?;
    let origin = desired_origin(s, old, cli)?;
    preflight(old, s, cli)?;
    let snapshot = backup(old, false)?;
    let r = (|| -> Result<()> {
        s.save()?;
        config::atomic(&s.root.join("compose.yaml"), COMPOSE.as_bytes(), 0o600)?;
        if let Some(o) = origin {
            docker::maintenance(s, &["--set-public-origin", &o])?;
            s.values.insert("PUBLIC_ORIGIN".into(), o);
            s.save()?
        }
        s.permissions()?;
        docker::start(s)
    })();
    if let Err(error) = r {
        let _ = docker::stop(s);
        bail!(
            "配置更改失败；使用 ./mailweb restore '{}' --yes 恢复。{error:#}",
            snapshot.display()
        )
    }
    status(s, cli.json)
}
fn status(s: &Settings, json_output: bool) -> Result<()> {
    let owned = docker::owned(s)?;
    let running = owned && docker::running(s);
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(3))
        .build()?;
    let health = client
        .get(format!("{}/api/v1/health/ready", s.url()))
        .send()
        .ok()
        .filter(|r| r.status().is_success())
        .and_then(|r| r.json::<Value>().ok());
    let install = client
        .get(format!("{}/api/v1/installation", s.url()))
        .send()
        .ok()
        .and_then(|r| r.json::<Value>().ok());
    let report = json!({"directory":s.root,"container":s.name,"running":running,"healthy":running&&health.is_some(),"version":installed(s)?.map(|m|m.version),"revision":health.as_ref().and_then(|h|h["revision"].as_str()),"bind":s.bind,"port":s.port,"accessUrl":s.url(),"directAccessUrl":s.direct_access_url()?,"configured":install.as_ref().is_some_and(|i|i["configured"]==true)});
    if json_output {
        println!("{}", serde_json::to_string_pretty(&report)?)
    } else {
        println!(
            "{}\n容器：{} · 运行：{} · 健康：{}\n访问：{}\n{}",
            s.root.display(),
            s.name,
            running,
            running && health.is_some(),
            s.url(),
            if report["configured"] == true {
                "邮件服务已配置"
            } else {
                "应用已安装，邮件服务待配置：./mailweb setup"
            }
        )
    }
    Ok(())
}
fn logs(s: &Settings, follow: bool, tail: usize) -> Result<()> {
    use std::io::{Read, Seek, SeekFrom};
    docker::owned(s)?;
    let mut offsets = std::collections::BTreeMap::new();
    loop {
        for entry in fs::read_dir(s.root.join("logs"))? {
            let path = entry?.path();
            if !path.is_file() {
                continue;
            }
            config::safe_tree(&path)?;
            let mut file = File::open(&path)?;
            let len = file.metadata()?.len();
            if let Some(position) = offsets.get(&path) {
                let position = if *position > len { 0 } else { *position };
                file.seek(SeekFrom::Start(position))?;
                let mut data = String::new();
                file.read_to_string(&mut data)?;
                print!("{data}");
            } else {
                let mut data = String::new();
                file.read_to_string(&mut data)?;
                for line in data
                    .lines()
                    .rev()
                    .take(tail)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                {
                    println!("{line}");
                }
            }
            offsets.insert(path, len);
        }
        if !follow {
            return Ok(());
        }
        std::io::Write::flush(&mut std::io::stdout())?;
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
fn doctor(
    s: &Settings,
    network: bool,
    fix: bool,
    json_output: bool,
    mirror: Option<&str>,
) -> Result<()> {
    if fix {
        s.permissions()?
    }
    let mut checks = Vec::new();
    checks.push(json!({"check":"docker-compose","passed":docker::require().is_ok()}));
    checks.push(json!({"check":"container-ownership","passed":docker::owned(s).is_ok()}));
    checks.push(json!({"check":"compose-config","passed":docker::compose(s,&["config","--quiet"],true).is_ok()}));
    checks.push(json!({"check":"managed-paths","passed":(["config","secrets","data","logs","backups","bin"].iter().all(|p|config::safe_tree(&s.root.join(p)).is_ok()))}));
    if network {
        checks.push(json!({"check":"release-network","passed":release::Client::new(mirror)?.resolve(&s.repository,"latest","latest").is_ok()}))
    }
    let good = checks.iter().all(|c| c["passed"] == true);
    if json_output {
        println!("{}", json!({"passed":good,"checks":checks}))
    } else {
        for c in checks {
            println!(
                "{} {}",
                if c["passed"] == true {
                    "通过"
                } else {
                    "失败"
                },
                c["check"]
            )
        }
    }
    ensure!(good, "诊断存在失败项");
    Ok(())
}
fn setup(s: &Settings, show: bool, direct: bool) -> Result<()> {
    let origin = if direct {
        s.direct_access_url()?
            .context("未启用 HTTP IP 备用入口，请检查监听地址和 DIRECT_ACCESS_ORIGIN")?
    } else {
        s.root
            .join("config/runtime.enc")
            .exists()
            .then(|| read_origin(s).ok())
            .flatten()
            .or_else(|| s.values.get("PUBLIC_ORIGIN").cloned())
            .filter(|o| config::validate_origin(o, s.allow_http).is_ok())
            .unwrap_or_else(|| s.url())
    };
    let url = format!("{}/console/setup/", origin.trim_end_matches('/'));
    println!("配置入口：{url}");
    if show || std::io::stdout().is_terminal() {
        let token = fs::read_to_string(s.root.join("secrets/setup.key"))?;
        println!("管理能力链接（请保密）：{url}#setup_token={}", token.trim())
    } else {
        println!("管理令牌保存在 secrets/setup.key；显式使用 setup --show-token 获取管理链接")
    };
    Ok(())
}
fn summary(s: &Settings, m: &Manifest) -> Result<()> {
    println!(
        "安装完成：{}\n提交：{}\n目录：{}",
        m.version,
        m.source_commit,
        s.root.display()
    );
    if s.bind.is_unspecified() {
        println!(
            "监听所有 {} 地址；远程访问请使用服务器实际 IP 和端口 {}。",
            if s.bind.is_ipv6() { "IPv6" } else { "IPv4" },
            s.port
        )
    };
    setup(s, false, false)?;
    println!(
        "应用已安装；Stalwart 配置在网页向导完成。\n管理命令：./mailweb status / doctor / logs / update / backup"
    );
    Ok(())
}
fn archive_config(s: &Settings, destination: &Path) -> Result<()> {
    let enc =
        flate2::write::GzEncoder::new(File::create(destination)?, flate2::Compression::default());
    let mut b = tar::Builder::new(enc);
    fn add(
        b: &mut tar::Builder<flate2::write::GzEncoder<File>>,
        root: &Path,
        path: &Path,
    ) -> Result<()> {
        let name = path.strip_prefix(root)?;
        if name == Path::new("config/deployment.lock") {
            return Ok(());
        };
        let m = fs::symlink_metadata(path)?;
        ensure!(!m.file_type().is_symlink(), "备份路径包含符号链接");
        if m.is_dir() {
            b.append_dir(name, path)?;
            for e in fs::read_dir(path)? {
                add(b, root, &e?.path())?
            }
        } else {
            b.append_path_with_name(path, name)?
        }
        Ok(())
    }
    for dir in ["config", "secrets"] {
        add(&mut b, &s.root, &s.root.join(dir))?
    }
    b.into_inner()?.finish()?;
    Ok(())
}
pub(crate) fn backup(s: &Settings, restart: bool) -> Result<PathBuf> {
    docker::owned(s)?;
    let running = docker::running(s);
    if running {
        docker::stop(s)?
    }
    let dest = s
        .root
        .join(format!("backups/{}-{}", now(), std::process::id()));
    fs::create_dir(&dest)?;
    s.permissions()?;
    let result = (|| -> Result<()> {
        let file = format!(
            "/app/backups/{}/mail-web.sqlite",
            dest.file_name().unwrap().to_string_lossy()
        );
        docker::maintenance(s, &["--backup", &file])?;
        for n in [".env", "compose.yaml"] {
            fs::copy(s.root.join(n), dest.join(n))?;
        }
        archive_config(s, &dest.join("config-secrets.tar.gz"))?;
        let mut sums = String::new();
        for n in [
            "mail-web.sqlite",
            ".env",
            "compose.yaml",
            "config-secrets.tar.gz",
        ] {
            sums += &format!("{}  {n}\n", release::checksum(&dest.join(n))?)
        }
        config::atomic(&dest.join("SHA256SUMS"), sums.as_bytes(), 0o600)?;
        Ok(())
    })();
    if running && (restart || result.is_err()) {
        let start = docker::start(s);
        if result.is_ok() {
            start?;
        } else if let Err(error) = start {
            eprintln!("备份失败后重启原实例也失败，请运行 ./mailweb start：{error:#}");
        }
    }
    result?;
    s.permissions()?;
    Ok(dest)
}
fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    config::safe_tree(from)?;
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.path().is_dir() {
            copy_tree(&e.path(), &target)?
        } else {
            config::safe_tree(&target)?;
            fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}
fn install_docs(package: &Path, root: &Path) -> Result<()> {
    for file in [
        "README.md",
        "README_ZH.md",
        "CONTRIBUTING.md",
        "CHANGELOG.md",
        "SECURITY.md",
        "llms.txt",
        ".env.example",
        "LICENSE",
        "NOTICE",
    ] {
        if package.join(file).is_file() {
            config::safe_tree(&root.join(file))?;
            fs::copy(package.join(file), root.join(file))?;
        }
    }
    for directory in ["docs", "examples"] {
        if package.join(directory).is_dir() {
            config::safe_tree(&root.join(directory))?;
            copy_tree(&package.join(directory), &root.join(directory))?;
        }
    }
    Ok(())
}
fn apply_snapshot(s: &Settings, path: &Path, restore_host_config: bool) -> Result<()> {
    let stage = tempfile::tempdir_in(&s.root)?;
    release::unpack(&path.join("config-secrets.tar.gz"), stage.path())?;
    for d in ["config", "secrets"] {
        for entry in fs::read_dir(s.root.join(d))? {
            let entry = entry?;
            if d == "config" && entry.file_name() == "deployment.lock" {
                continue;
            }
            if entry.path().is_dir() {
                fs::remove_dir_all(entry.path())?
            } else {
                fs::remove_file(entry.path())?
            }
        }
        if stage.path().join(d).is_dir() {
            copy_tree(&stage.path().join(d), &s.root.join(d))?
        }
    }
    if restore_host_config {
        for n in [".env", "compose.yaml"] {
            config::atomic(&s.root.join(n), &fs::read(path.join(n))?, 0o600)?
        }
    }
    for suffix in ["", "-wal", "-shm"] {
        let file = s.root.join(format!("data/db/mail-web.sqlite{suffix}"));
        if file.exists() {
            let preserved = s.root.join(format!(
                "backups/pre-restore-{}-{suffix}",
                rand::random::<u64>()
            ));
            fs::rename(file, preserved)?
        }
    }
    fs::copy(
        path.join("mail-web.sqlite"),
        s.root.join("data/db/mail-web.sqlite"),
    )?;
    Ok(())
}
/// The version manager passes its own verified snapshot. Its host configuration
/// comes only from the live installation, never from a historical archive.
pub(crate) fn apply_managed_snapshot(
    s: &Settings,
    snapshot: &Path,
    manifest: &Manifest,
    revoke_sessions: bool,
    starting: impl FnOnce() -> Result<()>,
) -> Result<()> {
    docker::stop(s)?;
    apply_snapshot(s, snapshot, false)?;
    let mut restored = s.clone();
    restored.values.insert(
        "MAIL_WEB_VERSION".into(),
        manifest.version.trim_start_matches('v').into(),
    );
    restored.save()?;
    config::atomic(&s.root.join("compose.yaml"), COMPOSE.as_bytes(), 0o600)?;
    config::atomic(
        &s.root.join("config/installed-release.json"),
        &serde_json::to_vec_pretty(manifest)?,
        0o600,
    )?;
    restored.permissions()?;
    if revoke_sessions {
        docker::maintenance(&restored, &["--revoke-all-sessions"])?;
    }
    starting()?;
    docker::start(&restored)
}
pub(crate) fn install_manager_mount(s: &Settings) -> Result<()> {
    let file = s.root.join("compose.yaml");
    // The automatic host helper supports the official generated Compose file.
    // Preserve any custom setup rather than replacing it during enable.
    let existing = fs::read_to_string(&file)?;
    let prior = COMPOSE.replace(
        "      - ./version-manager-socket:/run/mailweb-manager:ro\n",
        "",
    );
    ensure!(
        existing == COMPOSE || existing == prior,
        "检测到自定义 Compose，请使用官方部署配置启用网页版本管理"
    );
    config::atomic(&file, COMPOSE.as_bytes(), 0o600)
}

fn restore(s: &Settings, snapshot: &Path, cli: &Cli) -> Result<()> {
    let path = if snapshot.is_absolute() {
        snapshot.into()
    } else {
        s.root.join(snapshot)
    }
    .canonicalize()?;
    ensure!(
        path.starts_with(s.root.join("backups").canonicalize()?),
        "快照必须在当前安装 backups 内"
    );
    config::safe_tree(&path)?;
    for n in [
        "mail-web.sqlite",
        ".env",
        "compose.yaml",
        "config-secrets.tar.gz",
    ] {
        release::verify(&path.join(n), &path.join("SHA256SUMS"), n)?
    }
    let stage = tempfile::tempdir_in(&s.root)?;
    release::unpack(&path.join("config-secrets.tar.gz"), stage.path())?;
    let env = config::env_read(&path.join(".env"))?;
    if stage.path().join("config/runtime.enc").exists() && cli.public_origin.is_none() {
        let original_bind = env
            .get("LISTEN_ADDRESS")
            .map(String::as_str)
            .unwrap_or("127.0.0.1")
            .trim_matches(['[', ']'])
            .parse()?;
        let original_port = env
            .get("PORT")
            .map(String::as_str)
            .unwrap_or("18090")
            .parse()?;
        let (target_bind, target_port) = if let Some(bind) = &cli.bind {
            let (ip, port) = config::endpoint(bind, cli.port)?;
            (ip, port.unwrap_or(original_port))
        } else {
            (original_bind, cli.port.unwrap_or(original_port))
        };
        ensure!(
            original_bind == target_bind && original_port == target_port,
            "恢复时更改已有站点监听，必须使用 --public-origin 明确保留的反代来源或新的直连来源"
        );
    }
    let version = env.get("MAIL_WEB_VERSION").context("快照缺少版本")?;
    let image = format!("mail-web:{version}");
    let m = stage.path().join("config/installed-release.json");
    if m.is_file() {
        let m: Manifest = serde_json::from_slice(&fs::read(m)?)?;
        ensure!(
            crate::image::matches(&image, &m.image_id)?,
            "快照镜像 ID 不匹配"
        )
    } else {
        // Historical snapshots lack a manifest, but the retained image must
        // still exist before the current installation is stopped.
        docker::capture(&["image", "inspect", "--format", "{{.Id}}", &image])?;
    }
    let existing = s.root.join(".env").exists();
    let was_running = existing && docker::running(s);
    let safety = if existing {
        Some(backup(s, false)?)
    } else {
        None
    };
    let apply = (|| -> Result<()> {
        apply_snapshot(s, &path, true)?;
        let mut new = Settings::load(&s.root)?;
        new.project = s.project.clone();
        new.apply(cli)?;
        if let Some(n) = &cli.container_name {
            new.name = n.clone()
        }
        if let Some(origin) = &cli.public_origin {
            new.values.insert("PUBLIC_ORIGIN".into(), origin.clone());
        }
        new.save()?;
        docker::owned(&new)?;
        new.permissions()?;
        if let Some(origin) = &cli.public_origin {
            docker::maintenance(&new, &["--set-public-origin", origin])?
        }
        docker::maintenance(&new, &["--revoke-all-sessions"])?;
        docker::start(&new)?;
        Ok(())
    })();
    if let Err(error) = apply {
        if let Ok(failed) = Settings::load(&s.root) {
            let _ = docker::stop(&failed);
        }
        if let Some(safety) = safety {
            apply_snapshot(s, &safety, true)?;
            s.permissions()?;
            if was_running {
                let _ = docker::start(s);
            }
        }
        return Err(error).context("恢复失败，已还原原安装文件和数据");
    };
    println!("快照恢复完成，旧会话已撤销");
    Ok(())
}
fn self_update(s: &Settings, cli: &Cli, version: &str) -> Result<()> {
    let c = release::Client::new(cli.download_mirror.as_deref())?;
    let (tag, _) = c.resolve(&s.repository, version, &cli.channel)?;
    let base = format!(
        "https://github.com/{}/releases/download/{tag}",
        s.repository
    );
    let temp = tempfile::tempdir_in(&s.root)?;
    let name = crate::platform::Architecture::current()?.cli_asset();
    c.download(
        &format!("{base}/SHA256SUMS"),
        &temp.path().join("SHA256SUMS"),
    )?;
    c.download(&format!("{base}/{name}"), &temp.path().join(name))?;
    release::verify(
        &temp.path().join(name),
        &temp.path().join("SHA256SUMS"),
        name,
    )?;
    let unpack = temp.path().join("unpack");
    release::unpack(&temp.path().join(name), &unpack)?;
    verify_cli_version(&unpack.join("bin/mailwebctl"), tag.trim_start_matches('v'))?;
    install_cli(s, Some(&unpack.join("bin/mailwebctl")))?;
    println!("管理 CLI 已更新至 {tag}");
    Ok(())
}

#[cfg(test)]
mod root_tests {
    use super::*;
    #[test]
    fn installed_binary_owns_its_directory_even_for_reinstall() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("bin")).unwrap();
        fs::write(d.path().join(".env"), "PORT=12345\n").unwrap();
        assert_eq!(
            installed_root(&d.path().join("bin/mailwebctl")),
            Some(d.path().to_owned())
        );
    }
    #[test]
    fn bootstrap_binary_is_not_an_installation() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("bin")).unwrap();
        assert!(installed_root(&d.path().join("bin/mailwebctl")).is_none());
    }
}

#[cfg(test)]
mod downgrade_tests {
    use super::*;
    #[test]
    fn interrupted_upgrade_keeps_the_runtime_version_floor_even_with_an_old_manifest() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".env"), "MAIL_WEB_VERSION=0.4.0-alpha.2").unwrap();
        let s = Settings::load(d.path()).unwrap();
        assert!(ensure_not_downgrade(&s, "v0.3.0-alpha.2").is_err());
        s.init().unwrap();
        let old = Manifest {
            version: "v0.3.0-alpha.2".into(),
            source_commit: "a".repeat(40),
            architecture: "linux/amd64".into(),
            image: "mail-web:0.3.0-alpha.2".into(),
            image_id: format!("sha256:{}", "a".repeat(64)),
            cli_version: None,
        };
        fs::write(
            s.root.join("config/installed-release.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        assert!(ensure_not_downgrade(&s, "v0.3.0-alpha.2").is_err());
        assert!(ensure_not_downgrade(&s, "v0.4.0-alpha.2").is_ok());
    }
}
