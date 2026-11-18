//! Project-local configuration and staged writes adapted from DSH runtime.rs
//! and commands.rs at 86a6e10, MIT OR Apache-2.0; Mail Web adaptations 2026.
use crate::Cli;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, IsTerminal, Write},
    net::{IpAddr, SocketAddr, TcpListener},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};
pub const REPO: &str = "reina0721/webmail";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub root: PathBuf,
    pub name: String,
    pub bind: IpAddr,
    pub port: u16,
    pub allow_http: bool,
    pub repository: String,
    pub project: String,
    pub values: BTreeMap<String, String>,
}
pub fn env_read(path: &Path) -> Result<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    if !path.exists() {
        return Ok(map);
    }
    for line in fs::read_to_string(path)?.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            ensure!(
                k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
                "配置键无效"
            );
            map.insert(k.into(), v.trim().into());
        }
    }
    Ok(map)
}
pub fn atomic(path: &Path, bytes: &[u8], mode: u32) -> Result<()> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().context("缺少父目录")?)?;
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(mode))?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn validate_repo(value: &str) -> Result<()> {
    let p: Vec<_> = value.split('/').collect();
    ensure!(
        p.len() == 2
            && p.iter().all(|s| !s.is_empty()
                && *s != "."
                && *s != ".."
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))),
        "仓库必须是 OWNER/REPO"
    );
    Ok(())
}
pub fn endpoint(bind: &str, port: Option<u16>) -> Result<(IpAddr, Option<u16>)> {
    if let Ok(ip) = bind.parse::<IpAddr>() {
        return Ok((ip, port));
    }
    let socket = bind
        .parse::<SocketAddr>()
        .context("监听地址必须是 IP 或旧格式 IP:PORT；IPv6 端点请加方括号")?;
    ensure!(
        port.is_none_or(|p| p == socket.port()),
        "--bind 与 --port 的端口冲突"
    );
    Ok((socket.ip(), Some(socket.port())))
}
pub fn validate_origin(value: &str, allow_http: bool) -> Result<()> {
    ensure!(
        !value.chars().any(char::is_whitespace),
        "网站来源不能包含空白字符"
    );
    let u = reqwest::Url::parse(value)?;
    ensure!(
        (u.scheme() == "https"
            || u.scheme() == "http"
                && (allow_http
                    || matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.path() == "/",
        "网站来源必须是完整 HTTPS 来源，HTTP 直连需要 --allow-http"
    );
    Ok(())
}
pub fn safe_tree(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    ensure!(
        !fs::symlink_metadata(path)?.file_type().is_symlink(),
        "拒绝管理符号链接: {}",
        path.display()
    );
    if path.is_dir() {
        for e in fs::read_dir(path)? {
            safe_tree(&e?.path())?
        }
    }
    Ok(())
}
fn lock_file(path: &Path) -> Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    ensure!(file.metadata()?.is_file(), "部署锁必须是普通文件");
    fs2::FileExt::try_lock_exclusive(&file).context("已有安装或维护操作正在运行")?;
    Ok(file)
}

impl Settings {
    pub fn load(root: &Path) -> Result<Self> {
        let root = if root.exists() {
            root.canonicalize()?
        } else {
            std::path::absolute(root)?
        };
        ensure!(
            !["/", "/root", "/home", "/usr", "/var", "/etc", "/opt"]
                .contains(&root.to_str().unwrap_or("")),
            "请选择专用安装子目录"
        );
        ensure!(
            !root.join(".git").exists(),
            "请使用独立部署目录，不要覆盖源码工作区"
        );
        safe_tree(&root.join(".env"))?;
        let values = env_read(&root.join(".env"))?;
        let hash = hex::encode(Sha256::digest(root.as_os_str().as_encoded_bytes()));
        let get = |k: &str, d: &str| values.get(k).cloned().unwrap_or_else(|| d.into());
        let bind = get("LISTEN_ADDRESS", "127.0.0.1");
        let bind = bind.trim_matches(['[', ']']).parse()?;
        let repository = get("RELEASE_REPOSITORY", REPO);
        let repository = if repository == "reina0721/mail-web" {
            REPO.into()
        } else {
            repository
        };
        let s = Self {
            name: get("CONTAINER_NAME", &format!("mail-web-{}", &hash[..8])),
            project: get("COMPOSE_PROJECT_NAME", &format!("mailweb-{}", &hash[..12])),
            bind,
            port: get("PORT", "18090").parse()?,
            allow_http: get("ALLOW_HTTP", "false") == "true",
            repository,
            root,
            values,
        };
        s.validate()?;
        Ok(s)
    }
    pub fn apply(&mut self, cli: &Cli) -> Result<()> {
        if let Some(n) = &cli.container_name {
            self.name = n.clone()
        }
        if let Some(b) = &cli.bind {
            let (ip, p) = endpoint(b, cli.port)?;
            self.bind = ip;
            if let Some(p) = p {
                self.port = p
            }
        } else if let Some(p) = cli.port {
            self.port = p
        }
        if cli.allow_http {
            self.allow_http = true
        }
        if let Some(r) = &cli.repository {
            self.repository = r.clone()
        }
        if let Some(o) = &cli.public_origin {
            validate_origin(o, self.allow_http)?
        }
        self.validate()
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(self.port > 0, "端口必须在 1–65535");
        ensure!(
            !self.name.is_empty()
                && self.name.as_bytes()[0].is_ascii_alphanumeric()
                && self
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)),
            "容器名无效"
        );
        ensure!(
            !self.project.is_empty()
                && self
                    .project
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)),
            "Compose 项目名无效"
        );
        self.direct_access_url()?;
        validate_repo(&self.repository)
    }
    pub fn guard_directory(&self, restoring: bool) -> Result<()> {
        if !self.root.exists() {
            return Ok(());
        }
        if self.values.contains_key("MAIL_WEB_VERSION")
            || self.root.join("config/installed-release.json").is_file()
        {
            return Ok(());
        }
        ensure!(
            !self.root.join(".env").exists(),
            "目录包含非 Mail Web 配置，拒绝接管；请选择独立安装目录"
        );
        let partial = self.root.join("config/deployment.lock").is_file();
        for entry in fs::read_dir(&self.root)? {
            let name = entry?.file_name();
            let name = name.to_string_lossy();
            let allowed = name == "install.sh"
                || restoring && name == "backups"
                || partial
                    && [
                        "bin",
                        "deploy",
                        "data",
                        "config",
                        "secrets",
                        "logs",
                        "backups",
                        "releases",
                        "docs",
                        "mailweb",
                        "version-manager-socket",
                        ".deployment.lock",
                    ]
                    .contains(&name.as_ref());
            ensure!(
                allowed,
                "目录包含未登记文件，拒绝覆盖其他项目；请选择独立安装目录"
            );
        }
        Ok(())
    }
    pub fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.root)?;
        for n in [
            "bin",
            "deploy",
            "data",
            "data/db",
            "data/staging",
            "config",
            "secrets",
            "logs",
            "backups",
            "releases",
            "version-manager-socket",
            "docs",
        ] {
            let p = self.root.join(n);
            safe_tree(&p)?;
            fs::create_dir_all(&p)?;
        }
        Ok(())
    }
    pub fn lock(&self) -> Result<(File, File)> {
        let host = lock_file(&self.root.join(".deployment.lock"))?;
        let legacy = lock_file(&self.root.join("config/deployment.lock"))?;
        Ok((host, legacy))
    }
    pub fn save(&mut self) -> Result<()> {
        for (k, v) in [
            ("CONTAINER_NAME", self.name.clone()),
            ("COMPOSE_PROJECT_NAME", self.project.clone()),
            ("LISTEN_ADDRESS", self.bind.to_string()),
            ("PORT", self.port.to_string()),
            ("ALLOW_HTTP", self.allow_http.to_string()),
            ("RELEASE_REPOSITORY", self.repository.clone()),
        ] {
            self.values.insert(k.into(), v);
        }
        self.values.entry("APP_UID".into()).or_insert_with(|| {
            if unsafe { libc::geteuid() } == 0 {
                "10001".into()
            } else {
                unsafe { libc::geteuid() }.to_string()
            }
        });
        self.values.entry("APP_GID".into()).or_insert_with(|| {
            if unsafe { libc::geteuid() } == 0 {
                "10001".into()
            } else {
                unsafe { libc::getegid() }.to_string()
            }
        });
        // Compose long port syntax owns IPv6 rendering; .env stores an unbracketed IP.
        let text = self
            .values
            .iter()
            .map(|(k, v)| format!("{k}={v}\n"))
            .collect::<String>();
        atomic(&self.root.join(".env"), text.as_bytes(), 0o600)
    }
    pub fn probe_ip(&self) -> IpAddr {
        if self.bind.is_unspecified() {
            if self.bind.is_ipv6() {
                "::1".parse().unwrap()
            } else {
                "127.0.0.1".parse().unwrap()
            }
        } else {
            self.bind
        }
    }
    pub fn direct_access_url(&self) -> Result<Option<String>> {
        let configured = self
            .values
            .get("DIRECT_ACCESS_ORIGIN")
            .map(String::as_str)
            .unwrap_or_default();
        mailweb_shared::direct_origin(self.bind, self.port, self.allow_http, configured)
            .map_err(|error| anyhow::anyhow!("DIRECT_ACCESS_ORIGIN: {error}"))
    }
    pub fn url(&self) -> String {
        format!("http://{}", SocketAddr::new(self.probe_ip(), self.port))
    }
    pub fn port_free(&self) -> Result<()> {
        TcpListener::bind(SocketAddr::new(self.bind, self.port))
            .with_context(|| format!("监听地址 {}:{} 不可用或端口被占用", self.bind, self.port))?;
        Ok(())
    }
    pub fn permissions(&self) -> Result<()> {
        for name in ["data", "config", "secrets", "logs", "backups"] {
            let path = self.root.join(name);
            safe_tree(&path)?;
            permissions(
                &path,
                self.values
                    .get("APP_UID")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(10001),
                self.values
                    .get("APP_GID")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(10001),
            )?
        }
        Ok(())
    }
}
fn permissions(path: &Path, uid: u32, gid: u32) -> Result<()> {
    // Only known managed paths, never the installation root, repo, or parent.
    if unsafe { libc::geteuid() } == 0 {
        let c = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())?;
        ensure!(
            unsafe { libc::chown(c.as_ptr(), uid, gid) } == 0,
            "无法设置应用目录权限"
        );
    }
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if path.is_dir() { 0o700 } else { 0o600 }),
    )?;
    if path.is_dir() {
        for e in fs::read_dir(path)? {
            permissions(&e?.path(), uid, gid)?
        }
    }
    Ok(())
}
pub fn tty() -> Option<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/tty")
        .ok()
        .filter(|f| f.is_terminal())
}
pub fn prompt(tty: &mut File, label: &str, default: &str) -> Result<String> {
    write!(tty, "{label} [{default}]: ")?;
    tty.flush()?;
    let mut value = String::new();
    std::io::BufReader::new(tty.try_clone()?).read_line(&mut value)?;
    let v = value.trim();
    Ok(if v.is_empty() {
        default.into()
    } else {
        v.into()
    })
}
pub fn wizard(s: &mut Settings, cli: &Cli) -> Result<()> {
    let Some(mut tty) = tty().filter(|_| !cli.yes) else {
        return Ok(());
    };
    writeln!(tty, "Mail Web 安装向导 — Stalwart 将在网页控制台配置")?;
    if cli.container_name.is_none() {
        loop {
            let mut candidate = s.clone();
            candidate.name = prompt(&mut tty, "容器名称", &s.name)?;
            match candidate.validate() {
                Ok(()) => {
                    s.name = candidate.name;
                    break;
                }
                Err(error) => writeln!(tty, "{error:#}")?,
            }
        }
    }
    if cli.bind.is_none() {
        loop {
            let v = prompt(
                &mut tty,
                "监听 IP（127.0.0.1 本机反代；0.0.0.0 全部 IPv4；:: 全部 IPv6）",
                &s.bind.to_string(),
            )?;
            match v.parse() {
                Ok(v) => {
                    s.bind = v;
                    break;
                }
                Err(_) => writeln!(tty, "请输入有效的 IPv4/IPv6 地址")?,
            }
        }
    }
    if cli.port.is_none()
        && cli
            .bind
            .as_ref()
            .is_none_or(|b| b.parse::<SocketAddr>().is_err())
    {
        loop {
            let v = prompt(&mut tty, "宿主机端口", &s.port.to_string())?;
            if let Ok(p) = v.parse::<u16>()
                && p > 0
            {
                s.port = p;
                break;
            }
            writeln!(tty, "端口必须在 1–65535")?
        }
    }
    if !cli.allow_http {
        loop {
            let value = prompt(
                &mut tty,
                "访问方式：proxy=已有 HTTPS 反代，http=HTTP 直连",
                if s.allow_http { "http" } else { "proxy" },
            )?;
            if matches!(value.as_str(), "proxy" | "http") {
                s.allow_http = value == "http";
                break;
            }
            writeln!(tty, "请输入 proxy 或 http")?;
        }
    }
    s.validate()?;
    writeln!(
        tty,
        "目录：{}\n容器：{}\n监听：{}:{}\nHTTP直连：{}",
        s.root.display(),
        s.name,
        s.bind,
        s.port,
        s.allow_http
    )?;
    ensure!(
        matches!(
            prompt(&mut tty, "确认安装配置？y/N", "N")?.as_str(),
            "y" | "Y"
        ),
        "安装已取消"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_compatibility() {
        assert_eq!(endpoint("[::1]:1234", None).unwrap().1, Some(1234));
        assert!(endpoint("127.0.0.1:1234", Some(1235)).is_err());
        assert!(endpoint("::1", None).unwrap().0.is_ipv6());
    }
    #[test]
    fn origins() {
        assert!(validate_origin("http://example.com", false).is_err());
        assert!(validate_origin("https://example.com/path", true).is_err());
        assert!(validate_origin("https://example.com:443", false).is_ok());
    }
    #[test]
    fn roundtrip_preserves_unknown_keys() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".env"), "PORT=19123\nCUSTOM=keep\n").unwrap();
        let mut s = Settings::load(d.path()).unwrap();
        s.save().unwrap();
        assert_eq!(env_read(&d.path().join(".env")).unwrap()["CUSTOM"], "keep");
    }
}

#[cfg(test)]
mod ownership_tests {
    use super::*;
    #[test]
    fn unrelated_directory_and_environment_are_never_adopted() {
        let d = tempfile::tempdir().unwrap();
        let settings = Settings::load(d.path()).unwrap();
        assert!(settings.guard_directory(false).is_ok());
        fs::write(d.path().join("compose.yaml"), "unrelated service").unwrap();
        assert!(settings.guard_directory(false).is_err());
        assert_eq!(
            fs::read_to_string(d.path().join("compose.yaml")).unwrap(),
            "unrelated service"
        );
        fs::remove_file(d.path().join("compose.yaml")).unwrap();
        fs::write(d.path().join(".env"), "OTHER_APPLICATION=1").unwrap();
        assert!(
            Settings::load(d.path())
                .unwrap()
                .guard_directory(false)
                .is_err()
        );
        fs::write(d.path().join(".env"), "MAIL_WEB_VERSION=0.3.0-alpha.2").unwrap();
        assert!(
            Settings::load(d.path())
                .unwrap()
                .guard_directory(false)
                .is_ok()
        );
    }
    #[test]
    fn interrupted_install_and_explicit_backup_destination_can_resume() {
        let d = tempfile::tempdir().unwrap();
        let settings = Settings::load(d.path()).unwrap();
        settings.init().unwrap();
        let _lock = settings.lock().unwrap();
        assert!(settings.guard_directory(false).is_ok());
        let fresh = tempfile::tempdir().unwrap();
        fs::create_dir(fresh.path().join("backups")).unwrap();
        let settings = Settings::load(fresh.path()).unwrap();
        assert!(settings.guard_directory(false).is_err());
        assert!(settings.guard_directory(true).is_ok());
    }
}
