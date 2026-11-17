# 一键安装与 CLI 来源

固定基线：[reina0721/dsh-docker@86a6e10f3a616e7b2eba983744f9e8c65bb7860a](https://github.com/reina0721/dsh-docker/tree/86a6e10f3a616e7b2eba983744f9e8c65bb7860a)。原代码 MIT OR Apache-2.0，两份许可原样保留在本目录。

- `install.sh`：复用引导脚本的 TTY 组织、下载代理、SHA-256 和临时目录处理方式；下载固定版本 CLI，再由 Rust 选择应用 Release。
- `crates/mailwebctl/src/config.rs`：适配 runtime.rs 的目录初始化、权限边界和暂存写入，以及 commands.rs 的配置操作组织。
- `release.rs`：适配 commands.rs 自更新的下载/校验/解包流程，以及 backup.rs 的路径检查；新增 SemVer 渠道选择、完整镜像包和严格归档类型检查。
- `docker.rs`：适配 docker.rs 的子进程进度透传和镜像校验组织；只允许发布镜像导入，排除拉取和构建回退。
- `operations.rs` / `main.rs`：适配 CLI 子命令、生命周期和恢复暂存的组织。Webmail 的 SQLite 一致性快照、加密配置和 Origin 维护由本站实现及旧部署脚本迁移而来。

未移植 DSH 的 Basic Auth、开发工具链、SSH/Git 管理、ipvlan/macvlan、镜像仓库策略或应用本地构建。未将此修改描述为未经修改的上游实现。2026-11-17 修改。
