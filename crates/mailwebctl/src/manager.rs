//! Host-only version jobs. The container can request a fixed operation through
//! the socket; it cannot access the retained jobs, snapshots or Docker.
use crate::{
    Cli,
    config::{self, Settings},
    docker, image, operations,
    platform::Architecture,
    release::{self, Manifest},
};
use anyhow::{Context, Result, ensure};
use clap::Parser;
use mailweb_shared::deployment::{
    Inventory, Job, MAX_REQUEST, Operation, Phase, PublishedVersion, Request, Snapshot, Submit,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt, PermissionsExt, chown},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const PRIVATE: &str = ".version-manager";
const SOCKET: &str = "version-manager-socket/control.sock";
const SNAPSHOT_FILES: [&str; 4] = [
    "mail-web.sqlite",
    ".env",
    "compose.yaml",
    "config-secrets.tar.gz",
];

#[derive(clap::Subcommand, Debug)]
pub enum Action {
    Enable,
    Import {
        snapshot: PathBuf,
    },
    Restore {
        id: String,
        #[arg(long)]
        yes: bool,
    },
    #[command(hide = true)]
    Serve,
}

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    snapshot: Snapshot,
    manifest: Manifest,
}

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    job: Job,
    request: Submit,
    actor: String,
    safety: Option<String>,
    previously_running: bool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn id_valid(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn snapshot_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}
fn version(tag: &str) -> Result<semver::Version> {
    ensure!(tag.len() <= 100, "版本号过长");
    let v = semver::Version::parse(tag.strip_prefix('v').context("版本需要 v 前缀")?)?;
    ensure!(
        v.build.is_empty() && tag == format!("v{v}"),
        "需要精确发布版本"
    );
    Ok(v)
}
fn current(s: &Settings) -> Result<String> {
    let installed = format!(
        "v{}",
        s.values.get("MAIL_WEB_VERSION").context("未安装应用")?
    );
    version(&installed)?;
    if let Some(manifest) = operations::installed(s)? {
        ensure!(
            manifest.version == installed,
            "安装发布清单与当前版本不一致，请先用 CLI 修复"
        );
    }
    Ok(installed)
}
fn running_version(s: &Settings) -> Option<String> {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let response: Value = client
        .get(format!("{}/api/v1/health/ready", s.url()))
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .ok()?;
    let tag = format!("v{}", response["version"].as_str()?);
    version(&tag).ok()?;
    Some(tag)
}
fn owned_path(path: &Path, directory: bool) -> Result<()> {
    let m = fs::symlink_metadata(path)?;
    ensure!(
        m.uid() == 0 && m.mode() & 0o022 == 0 && if directory { m.is_dir() } else { m.is_file() },
        "版本管理需要宿主机 root 独占写入 {}",
        path.display()
    );
    Ok(())
}
fn private_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().mode(0o700).create(path)?;
    }
    owned_path(path, true)?;
    ensure!(
        fs::metadata(path)?.mode() & 0o077 == 0,
        "管理数据目录必须为 0700"
    );
    Ok(())
}
fn instance(root: &Path) -> Result<Settings> {
    let s = Settings::load(root)?;
    owned_path(&s.root, true)?;
    for entry in [".env", "compose.yaml"] {
        owned_path(&s.root.join(entry), false)?;
    }
    for dir in ["bin", "releases", "version-manager-socket"] {
        owned_path(&s.root.join(dir), true)?;
    }
    let uid = app_uid(&s)?;
    ensure!(uid != 0, "Webmail 容器必须使用非 root UID");
    Ok(s)
}
fn app_uid(s: &Settings) -> Result<u32> {
    Ok(s.values
        .get("APP_UID")
        .map_or("10001", String::as_str)
        .parse()?)
}
fn app_gid(s: &Settings) -> Result<u32> {
    Ok(s.values
        .get("APP_GID")
        .map_or("10001", String::as_str)
        .parse()?)
}
fn store<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    config::atomic(path, &serde_json::to_vec(value)?, 0o600)?;
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}
fn load<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T> {
    Ok(serde_json::from_reader(File::open(path)?)?)
}
fn state(root: &Path) -> PathBuf {
    root.join(PRIVATE)
}

fn enable(s: &Settings) -> Result<()> {
    docker::require()?;
    current(s)?;
    docker::owned(s)?;
    let lock = s.lock()?;
    let old = fs::read(s.root.join("compose.yaml"))?;
    let name = format!(
        "mailweb-version-{}.service",
        &hex::encode(Sha256::digest(s.root.as_os_str().as_encoded_bytes()))[..16]
    );
    let binary = s.root.join("bin/mailweb-version-manager");
    let quote = |p: &Path| -> Result<String> {
        let value = p.to_str().context("安装目录需要 UTF-8")?;
        ensure!(!value.chars().any(char::is_control), "安装目录包含控制字符");
        Ok(format!(
            "\"{}\"",
            value
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('%', "%%")
                .replace('$', "$$")
        ))
    };
    let unit = format!(
        "[Unit]\nDescription=Mail Web version manager\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart={} --dir {} version-manager serve\nRestart=on-failure\nRestartSec=3\nUMask=0022\nEnvironment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n\n[Install]\nWantedBy=multi-user.target\n",
        quote(&binary)?,
        quote(&s.root)?
    );
    let systemctl = |args: &[&str]| -> Result<()> {
        ensure!(
            Command::new("systemctl").args(args).status()?.success(),
            "systemctl 执行失败"
        );
        Ok(())
    };
    systemctl(&["show", "--property=Version"])?;
    operations::install_manager_mount(s)?;
    config::atomic(&binary, &fs::read(std::env::current_exe()?)?, 0o755)?;
    config::atomic(
        &Path::new("/etc/systemd/system").join(&name),
        unit.as_bytes(),
        0o644,
    )?;
    systemctl(&["daemon-reload"])?;
    // Recovery on service startup also needs the installation lock.
    drop(lock);
    let activate = (|| -> Result<()> {
        systemctl(&["enable", &name])?;
        systemctl(&["restart", &name])?;
        let deadline = std::time::Instant::now() + Duration::from_secs(90);
        while UnixStream::connect(s.root.join(SOCKET)).is_err() {
            ensure!(
                std::time::Instant::now() < deadline,
                "宿主机版本管理套接字未就绪，请查看 systemd 日志"
            );
            thread::sleep(Duration::from_millis(100));
        }
        let _lock = s.lock()?;
        docker::start(&instance(&s.root)?)
    })();
    if let Err(error) = activate {
        config::atomic(&s.root.join("compose.yaml"), &old, 0o600)?;
        let _ = systemctl(&["disable", "--now", &name]);
        docker::start(s)?;
        return Err(error).context("未启用版本管理，已恢复原启动配置");
    }
    println!("版本管理服务已启用：{name}");
    Ok(())
}

pub fn run(s: &Settings, action: &Action) -> Result<()> {
    ensure!(
        unsafe { libc::geteuid() } == 0,
        "请以宿主机 root 运行版本管理命令"
    );
    owned_path(&s.root, true)?;
    if matches!(action, Action::Enable) && !s.root.join("version-manager-socket").exists() {
        fs::create_dir(s.root.join("version-manager-socket"))?;
    }
    let s = instance(&s.root)?;
    private_dir(&state(&s.root))?;
    private_dir(&state(&s.root).join("jobs"))?;
    private_dir(&state(&s.root).join("snapshots"))?;
    match action {
        Action::Enable => enable(&s),
        Action::Import { snapshot } => {
            let _lock = s.lock()?;
            let source = snapshot.canonicalize()?;
            let stamp = fs::metadata(&source)?
                .modified()?
                .duration_since(UNIX_EPOCH)?
                .as_millis() as u64;
            let entry = retain(&s, &source, stamp)?;
            println!("已登记 {} {}", entry.snapshot.version, entry.snapshot.id);
            Ok(())
        }
        Action::Restore { id, yes } => {
            ensure!(*yes, "恢复会替换本机数据，请先备份并指定 --yes");
            let _lock = s.lock()?;
            let entry = snapshot(&s, id)?;
            prepare_image(&s, &entry.manifest)?;
            let backup = operations::backup(&s, false)?;
            let safety = retain(&s, &backup, now());
            let safety = match safety {
                Ok(entry) => entry,
                Err(error) => {
                    let _ = docker::start(&s);
                    return Err(error);
                }
            };
            println!("切换前快照：{}", safety.snapshot.id);
            if let Err(error) = apply(&s, &entry, true, || Ok(())) {
                apply(&s, &safety, false, || Ok(()))?;
                return Err(error).context("恢复失败，已恢复切换前的版本");
            }
            Ok(())
        }
        Action::Serve => serve(&s),
    }
}

fn snapshot_dir(s: &Settings, id: &str) -> PathBuf {
    state(&s.root).join("snapshots").join(id)
}
fn snapshot_entry(s: &Settings, id: &str) -> Result<Entry> {
    ensure!(id_valid(id), "快照 ID 无效");
    let dir = snapshot_dir(s, id);
    let entry: Entry = load(&dir.join("snapshot.json"))?;
    ensure!(
        entry.snapshot.id == id && entry.snapshot.version == entry.manifest.version,
        "快照清单不一致"
    );
    Ok(entry)
}
fn snapshot(s: &Settings, id: &str) -> Result<Entry> {
    let entry = snapshot_entry(s, id)?;
    let dir = snapshot_dir(s, id);
    for file in SNAPSHOT_FILES {
        release::verify(&dir.join(file), &dir.join("SHA256SUMS"), file)?;
    }
    Ok(entry)
}
fn read_regular_at(dir: &File, filename: &str) -> Result<File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let filename = std::ffi::CString::new(filename)?;
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            filename.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    ensure!(file.metadata()?.is_file(), "快照只能包含普通文件");
    Ok(file)
}
fn retain(s: &Settings, source: &Path, created_at: u64) -> Result<Entry> {
    let dir = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(source)?;
    let root = state(&s.root).join("snapshots");
    let staged = tempfile::tempdir_in(&root)?;
    for name in SNAPSHOT_FILES.into_iter().chain(["SHA256SUMS"]) {
        let mut input = read_regular_at(&dir, name)?;
        let mut output = File::create(staged.path().join(name))?;
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
    }
    for file in SNAPSHOT_FILES {
        release::verify(
            &staged.path().join(file),
            &staged.path().join("SHA256SUMS"),
            file,
        )?;
    }
    let mut sqlite_header = [0u8; 16];
    File::open(staged.path().join("mail-web.sqlite"))?.read_exact(&mut sqlite_header)?;
    ensure!(&sqlite_header == b"SQLite format 3\0", "快照数据库格式无效");
    let env = config::env_read(&staged.path().join(".env"))?;
    let tag = format!("v{}", env.get("MAIL_WEB_VERSION").context("快照缺少版本")?);
    version(&tag)?;
    let archive = tempfile::tempdir_in(&root)?;
    release::unpack(&staged.path().join("config-secrets.tar.gz"), archive.path())?;
    let mut manifest: Manifest = load(&archive.path().join("config/installed-release.json"))
        .context("快照需要匹配的发布清单")?;
    ensure!(manifest.version == tag, "快照与发布清单版本不一致");
    manifest.image_id = prepare_image(s, &manifest)?;
    let entry = Entry {
        snapshot: Snapshot {
            id: snapshot_id(),
            version: tag,
            created_at,
        },
        manifest,
    };
    store(&staged.path().join("snapshot.json"), &entry)?;
    fs::rename(staged.path(), snapshot_dir(s, &entry.snapshot.id))?;
    File::open(&root)?.sync_all()?;
    Ok(entry)
}
fn prepare_image(s: &Settings, manifest: &Manifest) -> Result<String> {
    let tag = version(&manifest.version)?;
    ensure!(
        manifest.image == format!("mail-web:{tag}")
            && manifest.architecture == Architecture::current()?.platform(),
        "快照镜像与本机架构或版本不匹配"
    );
    if image::matches(&manifest.image, &manifest.image_id).unwrap_or(false) {
        return Ok(manifest.image_id.clone());
    }
    let (package, source) = release::prepare(s, &manifest.version, "latest", None, None)?;
    let canonical =
        image::declared_config_id(&package.join("image.tar"), &source.image, &source.image_id)?;
    let expected = image::declared_config_id(
        &package.join("image.tar"),
        &source.image,
        &manifest.image_id,
    )?;
    ensure!(
        canonical == expected && source.source_commit == manifest.source_commit,
        "发布镜像与快照不匹配"
    );
    docker::stream(&[
        "load",
        "-i",
        package.join("image.tar").to_str().context("镜像路径无效")?,
    ])?;
    ensure!(
        image::matches(&source.image, &canonical)?,
        "导入镜像与快照不匹配"
    );
    Ok(canonical)
}
fn apply(
    s: &Settings,
    entry: &Entry,
    revoke: bool,
    starting: impl FnOnce() -> Result<()>,
) -> Result<()> {
    prepare_image(s, &entry.manifest)?;
    operations::apply_managed_snapshot(
        s,
        &snapshot_dir(s, &entry.snapshot.id),
        &entry.manifest,
        revoke,
        starting,
    )
}

fn record_path(s: &Settings, id: &str) -> PathBuf {
    state(&s.root).join("jobs").join(format!("{id}.json"))
}
fn recent(s: &Settings) -> Result<Option<Record>> {
    let mut active = None;
    let mut last: Option<(SystemTime, Record)> = None;
    for entry in fs::read_dir(state(&s.root).join("jobs"))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let record: Record = load(&path)?;
        if record.job.phase.finished() {
            let time = entry.metadata()?.modified()?;
            if last.as_ref().is_none_or(|(previous, _)| time > *previous) {
                last = Some((time, record));
            }
        } else {
            ensure!(active.is_none(), "发现多个未完成版本任务，需要宿主机核对");
            active = Some(record);
        }
    }
    Ok(active.or_else(|| last.map(|(_, record)| record)))
}
fn checkpoint(s: &Settings, record: &mut Record, phase: Phase, message: &str) -> Result<()> {
    record.job.phase = phase;
    record.job.message = message.into();
    store(&record_path(s, &record.job.id), record)
}
fn mark_safety(s: &Settings, record: &mut Record, backup: &Path) -> Result<()> {
    let entry = retain(s, backup, now())?;
    record.safety = Some(entry.snapshot.id.clone());
    record.job.recovery_command = Some(format!(
        "./bin/mailweb-version-manager version-manager restore {} --yes",
        entry.snapshot.id
    ));
    checkpoint(s, record, Phase::Switch, "快照已保留，正在切换版本")
}
fn submit(s: &Settings, job: Submit, actor: String) -> Result<(Record, bool)> {
    ensure!(id_valid(&job.id), "任务 ID 无效");
    let path = record_path(s, &job.id);
    if path.is_file() {
        let record: Record = load(&path)?;
        ensure!(
            record.request == job && record.actor == actor,
            "任务 ID 已使用"
        );
        return Ok((record, false));
    }
    ensure!(
        recent(s)?.is_none_or(|r| r.job.phase.finished()),
        "已有版本切换任务正在运行"
    );
    let current = current(s)?;
    ensure!(
        current == job.expected_version,
        "运行版本已改变，请刷新后重试"
    );
    let target_version = match job.operation {
        Operation::Update => {
            ensure!(
                version(&job.target)? > version(&current)?,
                "请选择更高版本；旧版需要匹配快照"
            );
            job.target.clone()
        }
        Operation::Rollback => {
            ensure!(job.confirm_data_restore, "需要确认恢复快照数据");
            let entry = snapshot_entry(s, &job.target)?;
            ensure!(
                version(&entry.snapshot.version)? < version(&current)?,
                "请选择低于当前版本的快照"
            );
            entry.snapshot.version
        }
    };
    let record = Record {
        job: Job {
            id: job.id.clone(),
            operation: job.operation,
            target_version,
            phase: Phase::Queued,
            message: "任务已接受".into(),
            running_version: Some(current),
            recovery_command: None,
        },
        request: job,
        actor,
        safety: None,
        previously_running: false,
    };
    store(&path, &record)?;
    Ok((record, true))
}
fn transact(s: &Settings, record: &mut Record) -> Result<()> {
    ensure!(
        current(s)? == record.request.expected_version,
        "运行版本已改变，请刷新后重试"
    );
    match record.request.operation {
        Operation::Update => {
            let target = record.request.target.clone();
            let cli = Cli::try_parse_from(["mailwebctl", "update", "--yes", "--version", &target])?;
            let mut updated = s.clone();
            operations::install(
                &mut updated,
                s,
                &cli,
                &target,
                None,
                &mut |phase, backup| {
                    if let Some(backup) = backup {
                        return mark_safety(s, record, backup);
                    }
                    let message = match phase {
                        Phase::Download => "正在下载发布包",
                        Phase::Verify => "正在核对镜像与发布清单",
                        Phase::Backup => "正在备份当前版本",
                        Phase::Health => "正在等待新版本启动和健康检查",
                        _ => "正在切换版本",
                    };
                    checkpoint(s, record, phase, message)
                },
            )
        }
        Operation::Rollback => {
            checkpoint(s, record, Phase::Verify, "正在校验旧版快照与镜像")?;
            let entry = snapshot(s, &record.request.target)?;
            prepare_image(s, &entry.manifest)?;
            checkpoint(s, record, Phase::Backup, "正在备份当前版本")?;
            let backup = operations::backup(s, false)?;
            mark_safety(s, record, &backup)?;
            apply(s, &entry, true, || {
                checkpoint(s, record, Phase::Health, "正在等待旧版启动和健康检查")
            })
        }
    }
}
fn recover(s: &Settings, record: &mut Record, message: &str) -> Result<()> {
    let before = record.job.phase;
    let restored = if let Some(id) = record.safety.clone() {
        checkpoint(s, record, Phase::Recovering, "正在恢复切换前的快照")?;
        snapshot(s, &id).and_then(|entry| apply(s, &entry, false, || Ok(())))
    } else if before == Phase::Backup && record.previously_running {
        docker::start(s)
    } else {
        record.job.running_version = running_version(s);
        return checkpoint(s, record, Phase::Failed, message);
    };
    record.job.running_version = running_version(s);
    match restored {
        Ok(()) => checkpoint(
            s,
            record,
            Phase::Recovered,
            &format!("{message}，已恢复切换前版本"),
        ),
        Err(error) => {
            eprintln!("自动恢复失败：{error:#}");
            checkpoint(
                s,
                record,
                Phase::Failed,
                &format!("{message}，自动恢复失败，请在服务器执行恢复命令"),
            )
        }
    }
}
fn execute(root: &Path, mut record: Record) -> Result<()> {
    let s = instance(root)?;
    let _lock = match s.lock() {
        Ok(lock) => lock,
        Err(error) => return checkpoint(&s, &mut record, Phase::Failed, &error.to_string()),
    };
    record.previously_running = docker::running(&s);
    let result = transact(&s, &mut record).and_then(|()| {
        record.job.running_version = running_version(&s);
        ensure!(
            record.job.running_version.as_deref() == Some(&record.job.target_version),
            "启动版本与目标版本不一致"
        );
        Ok(())
    });
    match result {
        Ok(()) => checkpoint(&s, &mut record, Phase::Succeeded, "版本切换完成"),
        Err(error) => {
            eprintln!("版本切换失败：{error:#}");
            // Host diagnostics can contain paths or Docker output. Keep the web
            // response to actionable, non-sensitive messages.
            let message = match record.job.phase {
                Phase::Download => "下载或附件校验失败，请查看宿主机服务日志",
                Phase::Verify => "镜像或快照校验失败，请查看宿主机服务日志",
                Phase::Backup => "未能保留切换前快照",
                Phase::Queued => "当前版本已变化，请刷新后重试",
                _ => "目标版本启动失败",
            };
            recover(&s, &mut record, message)
        }
    }
}

type Listings = Arc<Mutex<(String, Vec<PublishedVersion>)>>;
fn inventory(s: &Settings, releases: &Listings) -> Result<Inventory> {
    let (releases_status, mut releases) = releases.lock().unwrap().clone();
    let installed = Settings::load(&s.root)?
        .values
        .get("MAIL_WEB_VERSION")
        .map(|tag| version(&format!("v{tag}")))
        .transpose()?;
    if let Some(installed) = &installed {
        releases.retain(|release| version(&release.version).is_ok_and(|v| &v > installed));
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(state(&s.root).join("snapshots"))? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if id_valid(&id)
            && let Ok(item) = load::<Entry>(&entry.path().join("snapshot.json"))
            && installed.as_ref().is_none_or(|installed| {
                version(&item.snapshot.version).is_ok_and(|v| &v < installed)
            })
        {
            snapshots.push(item.snapshot);
        }
    }
    snapshots.sort_by_key(|s| std::cmp::Reverse(s.created_at));
    Ok(Inventory {
        releases,
        releases_status,
        snapshots,
        job: recent(s)?.map(|r| r.job),
    })
}
fn peer_uid(stream: &UnixStream) -> Result<u32> {
    use std::os::fd::AsRawFd;
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut length = std::mem::size_of_val(&cred) as libc::socklen_t;
    let status = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    ensure!(status == 0, "无法核对版本管理连接身份");
    Ok(cred.uid)
}
fn connection(s: &Settings, releases: &Listings, mut stream: UnixStream) -> Result<()> {
    let uid = peer_uid(&stream)?;
    ensure!(
        uid == 0 || uid == app_uid(s)?,
        "拒绝其他用户访问版本管理服务"
    );
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut line = Vec::new();
    BufReader::new((&stream).take(MAX_REQUEST + 1)).read_until(b'\n', &mut line)?;
    let response = (|| -> Result<Value> {
        ensure!(
            line.len() as u64 <= MAX_REQUEST && line.ends_with(b"\n"),
            "版本请求无效"
        );
        match serde_json::from_slice::<Request>(&line)? {
            Request::Status => Ok(serde_json::to_value(inventory(s, releases)?)?),
            Request::Job { id } => {
                ensure!(id_valid(&id), "任务 ID 无效");
                let record: Record = load(&record_path(s, &id)).context("任务不存在")?;
                Ok(serde_json::to_value(record.job)?)
            }
            Request::Submit { job, actor } => {
                ensure!(
                    actor.len() <= 64 && actor.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-'),
                    "操作者无效"
                );
                let current = instance(&s.root)?;
                let (record, start) = submit(&current, job, actor)?;
                let view = serde_json::to_value(&record.job)?;
                if start {
                    let root = s.root.clone();
                    thread::spawn(move || {
                        if let Err(error) = execute(&root, record) {
                            eprintln!("版本任务中断：{error:#}");
                        }
                    });
                }
                Ok(view)
            }
        }
    })();
    let packet = match response {
        Ok(body) => json!({"data":body}),
        Err(error) => json!({"error":error.to_string()}),
    };
    serde_json::to_writer(&mut stream, &packet)?;
    stream.write_all(b"\n")?;
    Ok(())
}
fn serve(s: &Settings) -> Result<()> {
    use std::os::unix::fs::FileTypeExt;
    let _daemon = {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(state(&s.root).join("daemon.lock"))?;
        fs2::FileExt::try_lock_exclusive(&file)?;
        file
    };
    if let Some(mut record) = recent(s)?.filter(|r| !r.job.phase.finished()) {
        let _lock = s.lock()?;
        recover(s, &mut record, "上次任务被宿主机重启中断")?;
    }
    let path = s.root.join(SOCKET);
    if let Ok(meta) = fs::symlink_metadata(&path) {
        ensure!(meta.file_type().is_socket(), "版本管理套接字路径已被占用");
        fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o660))?;
    chown(&path, Some(0), Some(app_gid(s)?))?;
    let releases = Arc::new(Mutex::new(("loading".into(), Vec::new())));
    let catalog = releases.clone();
    let root = s.root.clone();
    thread::spawn(move || {
        loop {
            let result = Settings::load(&root)
                .and_then(|s| release::Client::new(None)?.published(&s.repository));
            let delay = if result.is_ok() { 300 } else { 45 };
            {
                let mut cache = catalog.lock().unwrap();
                match result {
                    Ok(items) => *cache = ("ready".into(), items),
                    Err(error) => {
                        eprintln!("发布列表读取失败：{error:#}");
                        cache.0 = "unavailable".into();
                    }
                }
            }
            thread::sleep(Duration::from_secs(delay));
        }
    });
    for stream in listener.incoming() {
        if let Err(error) = stream
            .map_err(Into::into)
            .and_then(|stream| connection(s, &releases, stream))
        {
            eprintln!("版本管理连接失败：{error:#}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_stale_concurrent_and_unregistered_version_requests() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".env"), "MAIL_WEB_VERSION=0.4.0-alpha.4\n").unwrap();
        fs::create_dir_all(dir.path().join(PRIVATE).join("jobs")).unwrap();
        fs::create_dir_all(dir.path().join(PRIVATE).join("snapshots")).unwrap();
        let s = Settings::load(dir.path()).unwrap();
        let mut request = Submit {
            id: "a".repeat(32),
            expected_version: "v0.4.0-alpha.3".into(),
            operation: Operation::Update,
            target: "v0.4.0-alpha.5".into(),
            confirm_data_restore: false,
        };
        let actor = "b".repeat(32);
        assert!(submit(&s, request.clone(), actor.clone()).is_err());
        request.expected_version = "v0.4.0-alpha.4".into();
        let mut old = request.clone();
        old.target = "v0.4.0-alpha.2".into();
        assert!(submit(&s, old.clone(), actor.clone()).is_err());
        old.operation = Operation::Rollback;
        assert!(submit(&s, old.clone(), actor.clone()).is_err());
        old.confirm_data_restore = true;
        old.target = "../backups/untrusted".into();
        assert!(submit(&s, old.clone(), actor.clone()).is_err());
        old.target = "1".repeat(32);
        assert!(submit(&s, old, actor.clone()).is_err());
        assert!(submit(&s, request.clone(), actor.clone()).unwrap().1);
        assert!(!submit(&s, request.clone(), actor.clone()).unwrap().1);
        request.id = "c".repeat(32);
        assert!(submit(&s, request, actor).is_err());
    }
}
