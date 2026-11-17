Mail Web v0.4.0-alpha.4

修复已安装站点的 Turnstile 自动配置：只需具有 Turnstile 编辑权限的 Cloudflare API Token。无法列出账号时可填写 Account ID；无需重新授权 Stalwart。程序自动创建组件并加密保存 Site Key / Secret，不长期保留 API Token；失败重试核对已有资源，避免重复创建。

真实 Turnstile 需要 Webmail 使用域名访问；通过 IP 安装和使用邮箱后，可稍后自行配置域名并更新公开访问来源。Site Key 不能填网站地址，Secret 不能填 API Token。保存时拒绝明显错误；历史误填值可通过自动配置修复。验证组件或脚本加载失败时在原页显示原因与修复入口，避免整页崩溃。自动检查显示处理结果和明确的收信验证入口；保存配置、自动检查通过、真人收信验证和公开注册策略分别记录。

首次提供 Linux AMD64 / ARM64 原生构建的离线应用包及 Rust CLI；本预发布先公开现有附件，再继续完整验证。AMD64／ARM64 安装、备份及故障恢复与 AMD64 v0.4.0-alpha.2 原地升级已通过；更早 v0.3.0-alpha.2 历史 Shell 安装夹具未通过，不声明全部测试通过。保留 AGPL、上游来源记录、对应源码、SHA256SUMS，并补齐双语开源文档。

从 v0.4.0-alpha.2 升级：进入原安装目录执行 `./mailweb backup`，先执行 `./mailweb self-update --version v0.4.0-alpha.4` 更新管理工具，然后 `./mailweb update --version v0.4.0-alpha.4 --yes`。升级自动校验发布包、保存一致性快照并更新应用与管理 CLI；保留账号、邮件数据、安装密钥、Stalwart 配置及监听端口。故障时使用命令给出的准确快照路径执行 `./mailweb restore /absolute/path/to/backups/SNAPSHOT --yes`，不要手动把旧镜像连接到已升级的数据库。详见 [升级说明](https://github.com/reina0721/webmail/blob/main/docs/cli.md#从-v040-alpha2-升级逐步操作)。

生产域名实际 Turnstile 与公网邮件投递仍需部署后由真人完成验证；此版本不把隔离测试结果提升为生产验收状态。

兼容 Docker classic 与 containerd 镜像存储：镜像清单使用规范配置摘要；加载与恢复时仍核对 SHA-256 配置摘要，避免把 manifest 摘要差异误判成镜像内容变化。
