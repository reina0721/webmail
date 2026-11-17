//! Mail Web host manager. General command organization adapted from
//! reina0721/dsh-docker@86a6e10 (MIT OR Apache-2.0); see docs/upstream/dsh.
mod config;
mod docker;
mod image;
mod operations;
mod platform;
mod release;
use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    version,
    about = "Mail Web 安装与维护工具（Stalwart 在网页控制台配置）"
)]
struct Cli {
    #[arg(long, global = true)]
    dir: Option<PathBuf>,
    #[arg(long, global = true, alias = "name")]
    container_name: Option<String>,
    #[arg(long, global = true)]
    bind: Option<String>,
    #[arg(long, global = true)]
    port: Option<u16>,
    #[arg(long, global = true)]
    public_origin: Option<String>,
    #[arg(long, global = true)]
    allow_http: bool,
    #[arg(long, global = true)]
    repository: Option<String>,
    #[arg(long, global = true)]
    download_mirror: Option<String>,
    #[arg(long,global=true,default_value="latest",value_parser=["latest","stable"])]
    channel: String,
    #[arg(long, short = 'y', global = true)]
    yes: bool,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand, Debug)]
enum Command {
    Install {
        #[arg(long = "version", default_value = "latest")]
        version: String,
        #[arg(long)]
        bundle: Option<PathBuf>,
    },
    Update {
        #[arg(long = "version", default_value = "latest")]
        version: String,
        #[arg(long)]
        bundle: Option<PathBuf>,
    },
    Configure,
    Start,
    Stop,
    Restart,
    Status,
    Version,
    Logs {
        #[arg(short, long)]
        follow: bool,
        #[arg(long, default_value_t = 100)]
        tail: usize,
    },
    Doctor {
        #[arg(long)]
        network: bool,
        #[arg(long)]
        fix: bool,
    },
    Backup,
    Restore {
        snapshot: PathBuf,
    },
    Setup {
        #[arg(long)]
        show_token: bool,
    },
    RotateSetupToken,
    CheckUpdate {
        #[arg(default_value = "latest")]
        version: String,
    },
    SelfUpdate {
        #[arg(long = "version", default_value = "latest")]
        version: String,
    },
    PolicyVerified {
        #[arg(value_parser=["true","false"])]
        value: String,
    },
}
fn run() -> Result<()> {
    let mut cli = Cli::parse();
    if cli.repository.is_none() {
        cli.repository = std::env::var("MAIL_WEB_REPOSITORY")
            .ok()
            .filter(|s| !s.is_empty());
    }
    if cli.dir.is_none() {
        cli.dir = std::env::var_os("MAIL_WEB_ROOT").map(PathBuf::from);
    }
    if cli.container_name.is_none() {
        cli.container_name = std::env::var("MAIL_WEB_CONTAINER_NAME")
            .ok()
            .filter(|s| !s.is_empty());
    }
    if cli.bind.is_none() {
        cli.bind = std::env::var("MAIL_WEB_LISTEN_ADDRESS")
            .ok()
            .filter(|s| !s.is_empty());
    }
    if cli.port.is_none() {
        cli.port = std::env::var("MAIL_WEB_PORT")
            .ok()
            .map(|s| s.parse())
            .transpose()?;
    }
    cli.allow_http |= std::env::var("MAIL_WEB_ALLOW_HTTP").as_deref() == Ok("true");
    platform::Architecture::current()?;
    operations::run(cli)
}
fn main() {
    if let Err(error) = run() {
        eprintln!("错误: {error:#}");
        std::process::exit(1)
    }
}

#[cfg(test)]
mod argument_tests {
    use super::*;
    #[test]
    fn legacy_binding_and_global_flags() {
        let cli = Cli::try_parse_from([
            "mailwebctl",
            "--dir",
            "/tmp/example",
            "install",
            "--bind",
            "127.0.0.1:19293",
            "--yes",
            "--version",
            "v0.4.0-alpha.2",
        ])
        .unwrap();
        assert!(cli.yes);
        assert_eq!(cli.bind.as_deref(), Some("127.0.0.1:19293"));
    }
    #[test]
    fn unknown_options_rejected() {
        assert!(
            Cli::try_parse_from([
                "mailwebctl",
                "install",
                "--stalwart-password",
                "not-supported"
            ])
            .is_err()
        );
    }
}
