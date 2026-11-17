Mail Web v0.4.0-alpha.2

新增一键安装与独立 Rust 运维 CLI。根 `install.sh` 固定下载并校验引导 CLI，由 Rust 选择最高 SemVer 已发布版本（默认包含预发布），再校验应用包并通过 `docker load` 部署。支持中文 TTY 向导、管道安装、无人值守、空格目录、稳定目录标识、自定义容器名、IPv4/IPv6 和宿主机端口映射。

安装只处理基础设施；Stalwart 授权、域名、账号、Hook 与 Turnstile 仍由 `/console/setup/` 完成。新安装明确显示“应用已安装，邮件服务待配置”。已有站点变更监听时明确保留反代 Origin 或设置新的直连 Origin；加密配置只更新网站来源，注册开放策略及上游配置保持独立。

`./mailweb` 提供安装、配置、生命周期、脱敏状态/诊断、日志、更新、备份、恢复、配置入口和 CLI 自更新。兼容旧管理脚本、参数和既有安装数据，保留旧镜像及一致性快照，禁止直接降级打开已迁移数据库。写操作采用安装级锁，拒绝跨安装容器操作。

发布新增静态 CLI 包、CLI 版本清单、对应源码与 DSH 双许可来源记录。CI 先上传草稿，再下载真实产物执行安装、旧版迁移和备份恢复，通过后公开。完整用法见 [CLI 文档](https://github.com/reina0721/webmail/blob/main/docs/cli.md)，证据见 [安装器报告](https://github.com/reina0721/webmail/blob/main/docs/installer-test-report.md)。

沿用上一版本完整 Bulwark 客户端、统一控制台及注册稳定性修复。本次验收范围为本机 Docker 和隔离邮件环境，不提高公网生产域名、反垃圾信誉或生产 Turnstile 的验收状态。
