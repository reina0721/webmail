//! Docker command progress and compatibility checks adapted from DSH docker.rs
//! at 86a6e10, MIT OR Apache-2.0. Mail Web uses release-import delivery only.
use crate::config::Settings;
use anyhow::{Context, Result, ensure};
use std::{
    process::{Command, Stdio},
    time::Duration,
};
pub fn capture(args: &[&str]) -> Result<String> {
    let out = Command::new("docker")
        .args(args)
        .output()
        .context("无法执行 Docker")?;
    ensure!(
        out.status.success(),
        "Docker 命令失败: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?)
}
pub fn stream(args: &[&str]) -> Result<()> {
    ensure!(
        Command::new("docker")
            .args(args)
            .stdin(Stdio::null())
            .status()?
            .success(),
        "Docker 操作失败"
    );
    Ok(())
}
pub fn require() -> Result<()> {
    capture(&["info", "--format", "{{.ServerVersion}}"])?;
    capture(&["compose", "version"])?;
    Ok(())
}
pub fn compose(s: &Settings, args: &[&str], output: bool) -> Result<String> {
    let root = s.root.to_str().context("安装目录需为 UTF-8")?;
    let file = s.root.join("compose.yaml");
    let env = s.root.join(".env");
    let mut all = vec![
        "compose",
        "--project-directory",
        root,
        "--env-file",
        env.to_str().context("配置路径需为 UTF-8")?,
        "-f",
        file.to_str().context("配置路径需为 UTF-8")?,
    ];
    all.extend(args);
    if output {
        capture(&all)
    } else {
        stream(&all)?;
        Ok(String::new())
    }
}
pub fn owned(s: &Settings) -> Result<bool> {
    let exists = capture(&[
        "container",
        "ls",
        "-aq",
        "--filter",
        &format!("name=^/{}$", s.name),
    ])?;
    if exists.trim().is_empty() {
        return Ok(false);
    }
    let root = capture(&[
        "inspect",
        "--format",
        "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}",
        &s.name,
    ])?;
    ensure!(
        std::path::Path::new(root.trim()) == s.root,
        "容器 {} 属于其他安装，拒绝修改",
        s.name
    );
    Ok(true)
}
pub fn running(s: &Settings) -> bool {
    capture(&["inspect", "--format", "{{.State.Running}}", &s.name])
        .is_ok_and(|v| v.trim() == "true")
}
pub fn stop(s: &Settings) -> Result<()> {
    owned(s)?;
    compose(s, &["stop"], false)?;
    Ok(())
}
pub fn start(s: &Settings) -> Result<()> {
    owned(s)?;
    compose(s, &["config", "--quiet"], false)?;
    compose(s, &["up", "-d", "--pull", "never", "--no-build"], false)?;
    let http = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?;
    let url = format!("{}/api/v1/health/ready", s.url());
    for _ in 0..60 {
        if http.get(&url).send().is_ok_and(|r| r.status().is_success())
            && compose(
                s,
                &["exec", "-T", "mail-web", "/app/mail-web", "--healthcheck"],
                true,
            )
            .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1))
    }
    let _ = stop(s);
    anyhow::bail!(
        "宿主机映射 HTTP/容器健康检查失败，服务已停止。查看 ./mailweb logs；升级请恢复匹配快照"
    )
}
pub fn maintenance(s: &Settings, args: &[&str]) -> Result<()> {
    let mut cmd = vec!["run", "--rm", "--no-deps", "--pull", "never", "mail-web"];
    cmd.extend(args);
    compose(s, &cmd, false)?;
    Ok(())
}
