Mail Web v0.4.0-alpha.15

- 版本管理列出配置仓库中的所有公开 GitHub Release，并标出缺少本机架构安装包或校验清单的版本。管理服务未启用时也能查看列表。
- 全新安装可以切换到历史版本。Webmail 先保存当前数据库与配置快照，再用全新的本地数据启动旧版。可恢复任意已登记快照，也可升回切换前的版本。
- 宿主机 CLI 可以查看快照、切换任务和恢复命令。旧版缺少版本管理页时，可继续从宿主机管理。
- 包含上一版的 Turnstile 修复，可为迁移后的域名修复绑定，或在原组件被删后自动创建替代组件。
- Linux AMD64 和 ARM64 提供离线包、独立 CLI、源码及 SHA-256 校验清单。

更新到 `v0.4.0-alpha.15` 后，在安装目录运行 `sudo ./mailweb version-manager enable` 启用或更新宿主机服务。[升级与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.15/docs/cli.md)
