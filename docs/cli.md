# 安装与 Rust CLI

支持 Linux AMD64 / ARM64（以所选 Release 的实际附件为准；历史版本可能只有 AMD64）。安装器下载 Release、校验 SHA-256、导入完整镜像；服务器无需 Rust、Node 或源码构建工具。Docker Engine 与 Compose v2 必须已安装，普通用户须已有 Docker 权限。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash
```

默认目录 `~/apps/mail-web`，默认监听 `127.0.0.1:18090`，内部始终为 `8080`。目录可包含空格。目录规范化后生成稳定容器及项目标识，也可指定容器名称。中文交互读取 `/dev/tty`；`--yes` 使用参数及已有配置，不读取交互输入。

| 参数 | 用途 |
|---|---|
| `--dir PATH` | 独立安装目录；重复安装传入原目录 |
| `--container-name NAME` | 容器名，旧 `--name` 等效 |
| `--bind IP` | IPv4/IPv6 宿主机监听；兼容 `IP:PORT`、`[IPv6]:PORT` |
| `--port PORT` | 宿主机端口；与旧端点端口冲突时拒绝 |
| `--public-origin URL` | 用户最终访问来源，不含路径；反代保留公网 HTTPS 来源 |
| `--allow-http` | 明确允许 HTTP 直连 |
| `--version latest\|vVERSION` | 最高 SemVer 或精确版本 |
| `--channel latest\|stable` | 默认包含预发布；stable 排除预发布 |
| `--repository OWNER/REPO` | 产物仓库，默认 reina0721/webmail |
| `--download-mirror HTTPS_URL` | 传输代理前缀，失败尝试官方来源；校验保持一致 |
| `--yes` | 无人值守执行 |

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash -s -- \
  --yes --dir "$HOME/apps/mail-web" --container-name my-webmail \
  --bind 127.0.0.1 --port 18090 --public-origin https://mail.example.org
```

HTTP 直连额外传 `--allow-http`，公开来源填实际服务器 IP；IPv6 URL 使用方括号。安装器不会创建反代、DNS、证书或防火墙规则。端口冲突时交互重选，无人值守直接失败；不接管其他安装的同名容器，也不覆盖未登记的非空目录或其他项目配置。

默认选择整个 Release 列表中 SemVer 最高的非草稿版本，不按发布时间或 GitHub stable/latest API 排序。最高版本缺少必要资产或校验失败直接停止。引导 CLI 固定 `v0.4.0-alpha.4`，应用版本由 CLI 独立选择。没有稳定版时 stable 渠道明确失败。

应用安装后 `/console/setup/` 显示“应用已安装，邮件服务待配置”。所有 Stalwart 授权、域名、账号、Hook 和 Turnstile 操作继续在网页完成，安装器没有相关凭据参数。

## 管理命令

项目目录内 `./mailweb` 指向 `bin/mailwebctl`；绝对路径调用可从任意工作目录运行。全局参数可放在子命令前后。状态和诊断的 JSON 输出不包含令牌、加密配置或上游凭据。

| 命令 | 行为 |
|---|---|
| `install --version latest --yes` | 下载并安装；已有目录保留参数和数据 |
| `configure` | 交互调整基础设施；支持全局参数及 `--yes` |
| `start` / `stop` / `restart` | 仅操作本安装的 Compose 实例 |
| `status --json` | 容器、实际宿主机 HTTP 健康、版本、提交与配置状态 |
| `version` | 已安装应用版本 |
| `logs --tail 100 --follow` | 读取本安装轮转日志 |
| `doctor --json` | Docker、Compose、容器归属和路径诊断 |
| `doctor --network --fix` | 加查 Release 网络、修复本安装已知目录权限 |
| `check-update [vVERSION]` | 查询渠道最高版本或指定版本 |
| `update --version vVERSION --yes` | 下载校验、一致性备份、升级及健康等待 |
| `backup` | 保存一致性 SQLite、加密配置、密钥、基础设施配置和校验和 |
| `restore /absolute/install/backups/SNAPSHOT --yes` | 校验后恢复匹配版本和数据，撤销旧会话 |
| `setup --show-token` | 显示本安装配置链接及令牌 |
| `rotate-setup-token` | 轮换本安装管理令牌 |
| `self-update --version latest` | 仅更新管理 CLI，校验版本及 SHA-256 |

维护写操作使用 `config/deployment.lock` 安装级锁。CLI 不修改全局 Git 配置或其他项目权限；权限修复只涉及已知托管路径。镜像加载后核对平台、版本、镜像 ID 和来源提交。Compose 使用 bridge 及宿主机端口映射，启动固定 `--pull never --no-build`。

## 监听与网站 Origin

反代改后端监听端口时，公开 Origin 通常保持不变：

```bash
./mailweb configure --bind 127.0.0.1 --port 18091 \
  --public-origin https://mail.example.org --yes
```

HTTP 直连改端口时，需同步设置新 Origin：

```bash
./mailweb configure --bind 0.0.0.0 --port 18091 --allow-http \
  --public-origin http://YOUR_SERVER_IP:18091 --yes
```

已配置站点非交互更改 IP/端口却未传 `--public-origin` 会拒绝。应用维护命令 `--set-public-origin URL` 仅更新加密配置的网站来源；不会执行 Stalwart 自动配置或改写管理员注册开放策略。控制台会提示检查来源变化后的验证要求。

## 旧版迁移

1. 记录原安装目录并保留备份；不要在源码工作区执行安装。
2. 使用根安装命令并传 `--dir /原安装目录`，其他参数未明确修改时按旧 `.env` 读取。
3. 新安装器校验并加载发布镜像，保存更新前一致性快照，再原地升级；保留业务数据、密钥、加密连接配置及自定义端口。
4. 原 `deploy/mail-web.sh` 自动成为 Rust 兼容入口；`install vVERSION`、`update vVERSION`、`--name` 和旧 `--bind IP:PORT` 保留兼容。`MAIL_WEB_ROOT`、`MAIL_WEB_CONTAINER_NAME`、`MAIL_WEB_LISTEN_ADDRESS`、`MAIL_WEB_PORT`、`MAIL_WEB_ALLOW_HTTP`、`MAIL_WEB_REPOSITORY` 仍可作为兼容输入。

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash -s -- \
  --dir /srv/mail-web --yes --version v0.4.0-alpha.4
```

## 从 v0.4.0-alpha.2 升级

在旧安装目录运行（默认 `~/apps/mail-web`；自定义安装目录须使用原路径）：

```bash
cd ~/apps/mail-web
./mailweb status --json
./mailweb backup
./mailweb self-update --version v0.4.0-alpha.4
./mailweb update --version v0.4.0-alpha.4 --yes
./mailweb status --json
```

旧版 Rust CLI 已支持原地升级，本版继续提供该能力；应用包内的管理 CLI 随应用一并更新。请先执行上面的 `self-update`，再更新应用，以获得 Docker classic／containerd 镜像标识兼容处理；无需重新初始化 Stalwart。下载和校验完成前不会停止现有服务，升级前自动保存一致性快照；更新过程会短暂重启服务。账号、邮件数据、加密配置、安装密钥和原监听参数会保留。若使用 `sudo` 安装，请继续使用同一维护用户和原目录。

成功后浏览器刷新并检查页面底部版本。进入 **站点与默认设置 → 自动配置 Turnstile 人机验证**，补齐此前缺失或误填的验证配置，再进行真人与验证码收信验证。CLI 升级不会自行创建 Cloudflare 资源或修改注册开放策略。

仅升级管理工具可用 `./mailweb self-update --version v0.4.0-alpha.4`；它不会升级正在运行的应用。完全离线时下载本机架构的应用包与同版 `SHA256SUMS` 放在一起，运行 `./mailweb update --bundle /absolute/path/mail-web-linux-amd64.tar.gz --yes`（ARM64 对应 `arm64` 文件）。

## 更新与恢复

下载或校验失败不会停现有服务。下载、镜像校验成功后创建一致性备份，再升级。保留旧镜像和匹配快照，不自动清理或降级。启动失败返回非零，显示准确恢复命令。禁止直接让旧程序打开迁移后的数据库。

```bash
./mailweb backup
./mailweb self-update --version v0.4.0-alpha.4
./mailweb update --version v0.4.0-alpha.4 --yes
./mailweb restore /absolute/install/backups/SNAPSHOT --yes
```

快照必须位于目标安装的 `backups/`，完整性通过后才替换文件。恢复至新目录时先将整个快照放入新目录的 `backups/`，通过 `--dir`、`--container-name`、`--bind`、`--port`、`--public-origin` 明确目标参数。旧镜像必须仍在 Docker 本地，且 ID 与快照匹配；如已移除需先校验并加载对应旧 Release 镜像。恢复失败会还原被替换的原文件；成功后撤销旧会话。

备份包含解密密钥与管理令牌，必须保密并保存离线副本。`releases/` 保留已下载发布内容，`backups/` 保留快照，CLI 不自动删除这些数据。

## 发布与验收

Release 包含独立静态 CLI、应用镜像、安装脚本、对应源码、许可证、版本清单和 SHA256SUMS。CI 汇总两种架构后创建草稿，由两个原生 runner 重新下载实际产物，分别执行安装、双实例、网络、备份及恢复验证；AMD64 额外验证历史版本升级。两侧通过后公开，完整客户端与持续业务验证随后在同一发布提交上运行，结果显示在 Release 说明。快速检查失败保留草稿；完整验证失败会标记该公开版本，修复后发布新版本，已公开附件不可覆盖。流程及附件清单见 [发布维护指南](releasing.md)。

本机隔离验收报告见 [安装器报告](installer-test-report.md)。DSH 固定基线复用记录与双许可见 [来源说明](upstream/dsh/README.md)。
