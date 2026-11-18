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

默认选择整个 Release 列表中 SemVer 最高的非草稿版本，不按发布时间或 GitHub stable/latest API 排序。最高版本缺少必要资产或校验失败直接停止。引导 CLI 固定 `v0.4.0-alpha.8`，应用版本由 CLI 独立选择。没有稳定版时 stable 渠道明确失败。

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
| `setup --direct --show-token` | 生成 IP 备用入口的修复链接 |
| `version-manager enable` | 启用宿主机 systemd 版本管理服务 |
| `version-manager import /实际快照目录` | 校验并登记旧版快照 |
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

## IP 备用入口

Webmail 可通过一个公开主地址和一个 IP 备用地址访问。HTTPS 反代须保留原始 `Host`（包括非默认端口）。浏览器在两个地址分别登录。域名或反代故障时，可用 IP 打开邮箱与后台；注册、找回密码、人机验证与收信验证在主地址完成。

安装的 `ALLOW_HTTP=true` 且 `LISTEN_ADDRESS` 为具体 IP 时，备用地址自动使用该 IP 和宿主机 `PORT`。监听 `0.0.0.0` 或 `::` 时，在安装目录的 `.env` 指定 `DIRECT_ACCESS_ORIGIN=http://实际IP:端口`，IPv6 地址加方括号。设置后执行 `./mailweb start` 使 Compose 应用新的环境配置。

```bash
./mailweb status --json
./mailweb setup --direct --show-token
```

`directAccessUrl` 为备用地址，未启用时为 `null`。HTTP 明文连接适合受信网络内的应急访问。

## 在控制台切换版本

在已安装支持此功能的应用和管理 CLI 后，在原安装目录执行：

```bash
sudo ./mailweb version-manager enable
```

适用于由宿主机 root 管理的标准 Compose 安装和 systemd。启用时会重建本实例容器以挂载版本管理套接字。回到控制台「版本管理」可查看运行版本、发布清单和快照。升级会校验精确版本的附件，备份后切换，再检查实际运行版本。切换失败会用保存的快照尝试恢复；宿主机日志保留故障细节。

从终端升级前留下的旧版快照可在本机登记，例如：

```bash
sudo ./mailweb version-manager import '/安装目录/backups/实际快照目录'
```

登记会校验 SQLite、配置归档及发布镜像，并复制到仅宿主机 root 可读写的管理目录。控制台回退会还原快照内的 Webmail 数据库和运行配置，保留当前绑定和端口。快照之后的本地数据变更随之回退，应用会话需要重新登录；Stalwart 服务独立运行。

回到没有版本管理页的旧版后，按确认页给出的版本号从原安装目录运行 `sudo ./bin/mailweb-version-manager update --version v目标版本 --yes`。若旧版缺少 IP 备用机制，以旧版保存的主来源为准；管理员可从服务器终端使用 CLI 恢复。管理服务的名称在启用时输出，可用 `journalctl -u 服务名` 查看日志。

## 旧版迁移

1. 记录原安装目录并保留备份；不要在源码工作区执行安装。
2. 使用根安装命令并传 `--dir /原安装目录`，其他参数未明确修改时按旧 `.env` 读取。
3. 新安装器校验并加载发布镜像，保存更新前一致性快照，再原地升级；保留业务数据、密钥、加密连接配置及自定义端口。
4. 原 `deploy/mail-web.sh` 自动成为 Rust 兼容入口；`install vVERSION`、`update vVERSION`、`--name` 和旧 `--bind IP:PORT` 保留兼容。`MAIL_WEB_ROOT`、`MAIL_WEB_CONTAINER_NAME`、`MAIL_WEB_LISTEN_ADDRESS`、`MAIL_WEB_PORT`、`MAIL_WEB_ALLOW_HTTP`、`MAIL_WEB_REPOSITORY` 仍可作为兼容输入。

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash -s -- \
  --dir /srv/mail-web --yes --version v0.4.0-alpha.8
```

## 从 v0.4.0-alpha.2 升级（逐步操作）

在**运行 Webmail 的 Linux 服务器 SSH 终端**执行，不是在浏览器控制台或本地源码目录执行。使用当初安装时的维护用户；如果 Docker 命令提示权限不足，切换到原安装所用的用户或 root 后操作。

### 1. 找到正在运行的旧安装目录

先查看容器名、镜像和映射端口：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

找到镜像为 `mail-web:0.4.0-alpha.2`、端口与你网站一致的那一行。下面将 `你的Webmail容器名` 替换为该行的容器名：

```bash
CONTAINER='你的Webmail容器名'
docker inspect "$CONTAINER" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

输出就是原安装目录。用实际输出替换下面的路径，再确认版本；默认安装目录通常为 `~/apps/mail-web`，自定义安装不要直接照用默认路径：

```bash
cd '/上一步输出的原安装目录'
pwd
./mailweb status --json
```

应看到 `version` 为 `v0.4.0-alpha.2`、`healthy` 为 `true`，以及原来的 `port`、`container` 和 `directory`。若没有 `./mailweb`，先停止操作，确认是否找错目录；更早的 Shell 安装见上面的“旧版迁移”。

### 2. 备份并记下恢复路径

```bash
./mailweb backup
```

成功后输出一个完整目录，例如 `/srv/mail-web/backups/1790000000000-12345`。记下**你实际得到的路径**，并把该快照复制到安全位置。备份包含账号数据、加密配置及解密密钥，不能公开。备份失败时先排查错误，不继续升级。

### 3. 先更新管理工具，再更新应用

先确认 [GitHub Release 页面](https://github.com/reina0721/webmail/releases/tag/v0.4.0-alpha.8) 已公开且有 `SHA256SUMS` 和本机架构附件；草稿或正在构建的版本无法下载。

```bash
./mailweb self-update --version v0.4.0-alpha.8
./mailweb --version
```

第二条应输出 `mailwebctl 0.4.0-alpha.8`。这一步只更新管理工具，网站仍运行旧版。若下载失败或版本未改变，先处理终端错误，不继续下一条。

```bash
./mailweb update --version v0.4.0-alpha.8 --yes
```

管理工具会自动识别 AMD64／ARM64、下载并校验应用包，在升级前另存一致性快照，再短暂停止本实例并启动新版本。**不需要重装，不需要重新填写 Stalwart，不需要修改端口、DNS 或域名。** 原账号数据、加密配置、安装密钥和监听参数会保留。先执行 `self-update` 是为了获得 Docker classic／containerd 镜像标识兼容修复。

### 4. 确认升级结果

```bash
./mailweb status --json
./mailweb --version
```

应看到 `version: "v0.4.0-alpha.8"`、`running: true`、`healthy: true`，管理工具版本也为 `0.4.0-alpha.8`。浏览器刷新原网站，检查页面底部版本；原来的访问地址不变。健康状态异常时查看：

```bash
./mailweb logs --tail 100
./mailweb doctor --json
```

升级后进入 **站点与默认设置 → 自动配置 Turnstile 人机验证**。已有 Cloudflare API Token 时，通过自动配置生成对应组件的 Site Key／Secret；Site Key 不能填写网站地址，Secret 不能填写 API Token。Turnstile 需要正式域名；暂时使用 IP 地址时，可先完成应用升级，待域名准备好后再配置验证服务。CLI 升级不会创建 Cloudflare 资源或改变注册开放策略。

### 5. 如果升级失败，恢复匹配快照

下载或 SHA-256 校验失败时，现有服务保持运行，解决网络或附件错误后可重试同一更新命令。若新版本启动失败，终端会输出对应的恢复命令，优先照该命令执行。

手动恢复时，把下面的路径替换为步骤 2 记录的**真实快照路径**；不要原样复制示例路径：

```bash
./mailweb restore '/原安装目录/backups/实际快照目录' --yes
./mailweb status --json
```

恢复会同时还原快照对应的旧镜像、数据库和配置，并撤销旧会话，之后需重新登录。旧镜像必须仍在本机；升级确认前不要清理 Docker 镜像和 `backups/`。不要只修改 `.env` 里的版本号或手工启动旧镜像，否则旧程序可能打开已迁移的新数据库。

### 无法联网时

从同一 Release 下载本机架构的 `mailwebctl-linux-amd64.tar.gz`／`mailwebctl-linux-arm64.tar.gz`、`mail-web-linux-amd64.tar.gz`／`mail-web-linux-arm64.tar.gz` 和 `SHA256SUMS`，放在服务器同一临时目录。先按校验清单核对两个归档，再解出新管理工具到临时目录；从临时目录调用新管理工具并显式指定旧安装目录：

```bash
# 以下以 AMD64 为例，ARM64 将两个文件名中的 amd64 改为 arm64。
sha256sum --ignore-missing -c SHA256SUMS
mkdir -p upgrade-cli
tar -xzf mailwebctl-linux-amd64.tar.gz -C upgrade-cli
./upgrade-cli/bin/mailwebctl --dir '/原安装目录' update \
  --bundle "$PWD/mail-web-linux-amd64.tar.gz" --yes
```

校验输出必须同时包含 CLI 和应用包的 `OK`，任一失败均停止。应用包安装完成后会更新安装目录内的管理工具。随后回原安装目录执行步骤 4；失败时同样使用已记录的快照恢复。

## 更新与恢复

下载或校验失败不会停现有服务。下载、镜像校验成功后创建一致性备份，再升级。保留旧镜像和匹配快照，不自动清理或降级。启动失败返回非零，显示准确恢复命令。禁止直接让旧程序打开迁移后的数据库。

```bash
./mailweb backup
./mailweb self-update --version v0.4.0-alpha.8
./mailweb update --version v0.4.0-alpha.8 --yes
./mailweb restore /absolute/install/backups/SNAPSHOT --yes
```

快照必须位于目标安装的 `backups/`，完整性通过后才替换文件。恢复至新目录时先将整个快照放入新目录的 `backups/`，通过 `--dir`、`--container-name`、`--bind`、`--port`、`--public-origin` 明确目标参数。旧镜像必须仍在 Docker 本地，且 ID 与快照匹配；如已移除需先校验并加载对应旧 Release 镜像。恢复失败会还原被替换的原文件；成功后撤销旧会话。

备份包含解密密钥与管理令牌，必须保密并保存离线副本。`releases/` 保留已下载发布内容，`backups/` 保留快照，CLI 不自动删除这些数据。

## 发布与验收

Release 包含独立静态 CLI、应用镜像、安装脚本、对应源码、许可证、版本清单和 SHA256SUMS。第一阶段只完成两个架构的构建、版本／平台／源码归属和附件校验，然后自动公开。第二阶段下载已公开附件，运行安装、更新、双实例、网络、备份恢复、故障恢复、AMD64 历史升级、全部质量与业务测试。结果写回 Release 说明；第二阶段失败不会撤回或覆盖附件，源码修复需发布新版本。流程及附件清单见 [发布维护指南](releasing.md)。

本机隔离验收报告见 [安装器报告](installer-test-report.md)。DSH 固定基线复用记录与双许可见 [来源说明](upstream/dsh/README.md)。
