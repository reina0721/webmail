//! Names shared by release selection, archive validation and CLI self-update.
use anyhow::{Result, bail, ensure};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Architecture {
    Amd64,
    Arm64,
}

impl Architecture {
    pub fn from_names(os: &str, cpu: &str) -> Result<Self> {
        match (os, cpu) {
            ("linux" | "Linux", "x86_64" | "amd64") => Ok(Self::Amd64),
            ("linux" | "Linux", "aarch64" | "arm64") => Ok(Self::Arm64),
            _ => bail!("仅支持 Linux AMD64 / ARM64，当前为 {os}/{cpu}"),
        }
    }

    pub fn current() -> Result<Self> {
        Self::from_names(std::env::consts::OS, std::env::consts::ARCH)
    }

    pub fn platform(self) -> &'static str {
        match self {
            Self::Amd64 => "linux/amd64",
            Self::Arm64 => "linux/arm64",
        }
    }

    pub fn app_asset(self) -> &'static str {
        match self {
            Self::Amd64 => "mail-web-linux-amd64.tar.gz",
            Self::Arm64 => "mail-web-linux-arm64.tar.gz",
        }
    }

    pub fn cli_asset(self) -> &'static str {
        match self {
            Self::Amd64 => "mailwebctl-linux-amd64.tar.gz",
            Self::Arm64 => "mailwebctl-linux-arm64.tar.gz",
        }
    }

    pub fn validate(self, platform: &str) -> Result<()> {
        ensure!(platform == self.platform(), "发布包架构不匹配");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_names_and_assets() {
        for cpu in ["x86_64", "amd64"] {
            let arch = Architecture::from_names("Linux", cpu).unwrap();
            assert_eq!(arch, Architecture::Amd64);
            assert_eq!(arch.app_asset(), "mail-web-linux-amd64.tar.gz");
            assert_eq!(arch.cli_asset(), "mailwebctl-linux-amd64.tar.gz");
        }
        for cpu in ["aarch64", "arm64"] {
            let arch = Architecture::from_names("linux", cpu).unwrap();
            assert_eq!(arch, Architecture::Arm64);
            assert_eq!(arch.app_asset(), "mail-web-linux-arm64.tar.gz");
            assert_eq!(arch.cli_asset(), "mailwebctl-linux-arm64.tar.gz");
            assert!(arch.validate("linux/amd64").is_err());
            assert!(arch.validate("linux/arm64").is_ok());
        }
        assert!(Architecture::from_names("darwin", "arm64").is_err());
        assert!(Architecture::from_names("linux", "armv7l").is_err());
    }
}
