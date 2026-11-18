# Mail Web 部署与运维指南

通用、可自行部署的 Webmail 与管理控制台。Next.js 静态界面由 Rust/Axum 提供，SQLite 保存平台数据，现有 Stalwart 保存邮件。**项目不预设邮件域名或运营品牌**：部署后在安装面板填写自己的站点名称、域名和 Stalwart 连接信息。公开注册默认关闭。

当前发布通道为开发预览。最新重构的逐项状态见 [功能对照表](feature-parity.md)，上游复用与许可证见 [来源清单](upstream/README.md)。快速发布与完整验证分别记录，尚未完成完整验证的版本会在 Release 说明中标为 pending 或 running。构建、隔离集成测试和真实部署验收分别记录，不将构建成功当作邮件投递或注册服务验收。

## 本机隔离环境

```sh
sh deploy/test-env.sh up --build --verify
```

脚本创建独立的 Compose 项目、两台真实 Stalwart 和 Mailpit，通过应用初始化 API 配置域名、身份、Hook、运营邮箱和 Cloudflare 官方测试密钥；不会修改其他业务容器。`status`、`logs`、`verify`、`down` 使用同一个脚本。热更新入口为 `sh deploy/dev.sh up`，返回生产构建使用 `sh deploy/dev.sh down`。

完整验收包含 Docker 内类型/构建/测试、真实业务、旧版故障回归、独立备份恢复和至少 30 分钟持续注册。未完成的产品功能会令发布后完整验证失败并在 Release 说明中标明；当前重构状态和阻塞见 [重构报告](rebuild-test-report.md) 与 [未完成项](rebuild-blockers.md)。本机结果不代表公网域名、反垃圾信誉或生产 Turnstile 已验收。

## 1. 部署方式与准备

支持 Linux AMD64 和 ARM64（以所选 Release 实际附件为准），宿主机需已有 Docker Engine、Compose v2，以及 Bash、curl、tar 和 SHA-256 工具。支持 root 或已有 Docker 权限的普通用户；安装器不安装系统软件。

服务器下载并校验 GitHub Release 包，通过 `docker load` 导入镜像。目标服务器不编译源码、不从镜像仓库拉取镜像。安装器只管理应用目录、容器、监听和访问方式；Stalwart 授权、域名、账号、Hook 与 Turnstile 均由网页控制台配置。

## 2. 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash
```

中文向导通过 `/dev/tty` 读取输入，支持管道运行。首次默认目录为 `~/apps/mail-web`，监听 `127.0.0.1:18090`，默认采用已有 HTTPS 反代；容器名和 Compose 项目名按规范化目录生成稳定标识。向导可修改目录、名称、IP、端口和访问方式。安装器不修改宿主机反代、DNS、证书或防火墙。

已有 HTTPS 反代的无人值守示例：

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash -s -- \
  --yes --dir "$HOME/apps/mail-web" --container-name my-webmail \
  --bind 127.0.0.1 --port 18090 --public-origin https://mail.example.org
```

HTTP 直连需明确选择或传入 `--allow-http`：

```bash
curl -fsSL https://raw.githubusercontent.com/reina0721/webmail/main/install.sh | bash -s -- \
  --yes --dir "$HOME/apps/mail-web" --bind 0.0.0.0 --port 18090 \
  --allow-http --public-origin http://YOUR_SERVER_IP:18090
```

IPv6 使用 `--bind ::1 --port 18090`；旧写法 `--bind '[::1]:18090'` 和 `--name` 仍兼容。同机多实例选择不同目录、名称及端口。通配监听输出可用的本地诊断地址，远程使用服务器实际 IP；不会把 `0.0.0.0` 或 `::` 当作访问地址。

默认选择最高 SemVer 已发布版本，包含预发布并排除草稿；仅稳定版使用 `--channel stable`，精确版本使用 `--version v0.4.0-alpha.14`。选定版本缺少产物或校验失败会停止，不回退。引导 CLI 固定到已验收版本，应用版本由 Rust 解析 Release 列表。Fork 使用 `--repository OWNER/REPO`；下载代理使用 `--download-mirror HTTPS_URL`，始终校验同一 SHA-256。

安装完成后运行：

```bash
"$HOME/apps/mail-web/mailweb" status
"$HOME/apps/mail-web/mailweb" setup --show-token
```

管理链接包含敏感令牌，请保密。非终端输出默认隐藏令牌；显式 `setup --show-token` 可显示。无需手工编辑 `.env`。完整参数、维护命令及旧版迁移见 [Rust CLI 文档](cli.md)。

## 3. 进入面板配置 Stalwart

1. 打开安装器输出的管理链接。已登录 Webmail 的运营管理员可以直接打开「安装与修复」。
2. 填写 **Stalwart HTTPS 地址**，使用 Stalwart 管理员账号或管理员 API Key，点击「验证 Stalwart 权限」。
3. 填写 **公开访问来源**（用户打开 Webmail 的地址），选择 **邮箱域名**（邮箱地址中 `@` 后的部分），绑定已有普通运营邮箱或创建普通运营邮箱。
4. 点击「检查安装配置」，确认后点击「应用配置」。Webmail 会创建本安装的专用服务身份、发件账号、运行密钥和 Hook。

配置完成后，运营邮箱即可登录和收发。若要开放注册，可在向导中填写 Cloudflare API Token，或接通邮件服务后从「站点与默认设置」自动配置 Turnstile，再完成收信验证。 [自动配置和权限说明](stalwart-setup.md#automatic) · [收信验证与开放注册](stalwart-setup.md#enable-registration)

以下是保留的“高级手工配置”字段，正常自动配置不需要逐项填写：

| 项目 | 填写内容 |
|---|---|
| 站点名称 | 你自己的品牌或组织名称 |
| 邮箱域名 | Stalwart 中已有的域名，不含 `@`；不会被安装器代替创建 |
| 网站访问地址 | 最终用户访问的完整来源，包含协议和非默认端口，不含路径 |
| Stalwart 地址 | 现有 HTTPS 来源，不含 `/jmap` 路径、用户名或密码 |
| 专用目录服务 API 密钥 | 目录管理服务身份的密钥 |

保存前，服务器会实际请求 Stalwart，确认密钥能够读取所选域名，并自动读取域名 ID。失败会保留表单输入。配置使用安装密钥加密，写入 `config/runtime.enc`；读取接口仅返回密钥是否已设置，不回显密钥。留空密钥字段会保留现有值。

保存后，进程有序退出，由 Docker 的重启策略重新启动，面板会等待新进程就绪。数据库、草稿和安装密钥保留。已有平台账号时，不允许简单替换邮箱域名。

再次进入配置面板时，已登录的运营身份会自动回读；失败时使用“读取配置／重试”，不会允许用空白表单覆盖现有配置。输入 Stalwart 地址后自动生成相关入口；填写专用密钥后可只读查询域名、账号及 Hook。通过 SSH 辅助入口访问时，网站访问地址仍应保留服务器的实际来源，不能改成临时的本地代理地址；同一服务器留空密钥字段会保留已保存的密钥。更换 Stalwart 来源必须重新提供该服务器的密钥，重新核对可选账号与 Hook。

首次接通后，在面板绑定一个**已有的普通邮箱**作为本部署的运营身份：填写该邮箱、它的密码和外部恢复邮箱。服务器先验证邮箱所有权与普通用户角色，再建立本地运营关联；不修改该账号的 Stalwart 管理员权限或密码。Stalwart 管理员及带系统权限的服务身份不能作为此处的普通运营邮箱。

运营角色仅属于本部署。默认自动向导同时支持绑定已有和新建普通运营邮箱；下文脚本是额外的高级初始化方式，不接管已有地址。

### 多个 Stalwart 与邮箱域名

首个连接完成后，在同一面板的“邮件服务连接”点击“新增连接”，对第二台 Stalwart 临时授权，选域名并自动配置。不需要另建运营邮箱；运行凭据、Hook 和初始化任务按服务分别保存。已有连接可“读取可绑定的其他域名”，追加该服务的域名。品牌、网站来源和 Turnstile 仍属于整个站点。

运营后台通过域名选择器分别管理账号、注册策略与任务。每个域名单独完成本站检查，手动开启注册；一个连接故障不改变其他连接的策略。详见[多服务接入教程](stalwart-setup.md#multiple-services)。

**保留原登录规则：先在 Webmail 登记或绑定，再使用对应服务器的完整邮箱地址和原密码登录。** 添加服务或域名不会自动导入上游用户；没有本地记录的账号仍不能登录。原生客户端可逐个验证并关联本站账号，邮件状态与设置按账号隔离；统一收件箱的完整验收状态见功能对照表。已有账号不能通过改绑域名迁移到另一台服务器。

旧站点升级自动迁移为默认连接和默认域名，保留本地账号、运营身份、会话和计数。更新前 CLI 自动创建一致性快照；迁移或检查失败时不清空重建数据。新安装的默认模板只包含容器、监听等基础设施参数，旧环境变量兼容读取。

## 4. 公网 HTTP 的安全管理入口

本节工具运行在管理员自己的电脑，服务器只使用已有 SSH；不在服务器安装 Node 或代理。

管理员电脑需要 Node.js 24 和 OpenSSH。下载该版本的 `deploy/admin-access.mjs`，运行：

```sh
node admin-access.mjs \
  --ssh USER@SERVER \
  --identity /path/to/ssh-key \
  --origin http://YOUR_SERVER_IP:YOUR_PORT \
  --port 4204
```

打开工具输出的本地链接，输入安装管理令牌。它通过 SSH 加密转发，并把最终公网来源预填入“网站访问地址”。代理只监听回环，检查本地 Host 和 Origin，再转发到固定目标；不记录请求正文。结束后按 Ctrl+C 关闭。这个临时通道不会把公网 HTTP 用户入口变成 HTTPS。

已有可信 HTTPS 入口时，直接通过它打开面板即可，不需要此工具。

## 5. 目录服务、注册与提交策略

现有 Stalwart 的管理对象通过 JMAP 管理 API 访问。操作界面名称以所部署版本为准，参见 [Stalwart 管理 API](https://stalw.art/docs/management/) 和 [账号管理](https://www.stalw.art/docs/auth/accounts/manage/)。

建议创建独立的普通服务身份，只启用：

- 账号管理：`sysAccountCreate`、`sysAccountGet`、`sysAccountQuery`、`sysAccountUpdate`。
- 域名读取：`sysDomainGet`、`sysDomainQuery`。
- 使用提交策略时：`sysMtaHookGet`、`sysMtaHookUpdate`、`sysActionCreate`、`actionReloadSettings`。

为它创建专用 API 密钥。运行时不保存 Stalwart 管理员密码。不要将带系统权限的身份当作个人邮箱使用。

公开注册还需要在面板的折叠分组中配置：

1. 验证邮件身份：普通发件账号 ID、对应 API 密钥和完整发件地址。
2. Turnstile：Site Key 与 Secret；外部验证服务需要匹配实际网站来源。
3. 专用于本部署的 MTA Hook：ID 和共享密钥。不要共用其他应用的 Hook；其回调必须能够从 Stalwart 到达本部署的 `/internal/mta-hook`。
4. 在页面内完成本站自动检查、人机验证与验证码收信；完整协议回归作为版本发布检查执行。

`deploy/bootstrap-stalwart.sh` 与 `deploy/setup-hook.sh` 是可选高级辅助脚本。它们只在安装目录写入项目文件，通过 Stalwart API 创建独立服务身份和新 Hook，不改管理员密码。必须显式提供 `MAIL_DOMAIN`、`STALWART_ADMIN_EMAIL`、临时管理凭据，以及 Stalwart 可达的 `MTA_HOOK_URL`。域名和回调地址没有部署站点默认值。现有名称冲突时拒绝接管。临时管理凭据应在结束后撤销。

正常开通请在自动配置结果或运营后台点击 **检查注册条件**，修复清单中的具体问题，再通过正式网站完成真实 Turnstile 和外部验证码收信。返回刷新结果后，由运营人员开启注册并保存策略。无需执行手工验收命令，也不会停止生产服务或修改正常邮箱的限额。旧 policy-verified 命令仅保留为历史声明，不作为注册门槛。

高级创建新运营邮箱：在本安装 `secrets/operator.initial-password` 写入至少 16 字符的初始密码，使用已配置的目录服务及专属 Hook 执行：

```sh
docker compose --project-directory "$INSTALL_DIR" -f "$INSTALL_DIR/compose.yaml" \
  run --rm --no-deps --pull never mail-web \
  --init-operator OPERATOR_EMAIL EXTERNAL_RECOVERY_EMAIL /app/secrets/operator.initial-password
```

命令使用本部署配置的域名，拒绝接管已有地址；结果未知时保留待核对记录，不重复创建。完成后轮换初始密码并移走明文交接文件。

## 6. CLI 更新、备份和恢复

HTTPS 反代保留原始 `Host`。启用了 HTTP 且绑定具体 IP 的实例可从原 IP 和端口进入邮箱与管理后台。通配监听时按 [IP 备用入口](cli.md#ip-备用入口) 指定备用地址。控制台的 [版本管理](cli.md#在控制台切换版本) 通过宿主机服务执行升级与快照回退。

**正在使用 v0.4.0-alpha.2：请直接按 [逐步升级教程](cli.md#从-v040-alpha2-升级逐步操作) 操作，包含找目录、备份、更新 CLI、更新应用和失败恢复。** 不需要重新安装或重新配置 Stalwart。

以下为日常维护命令参考，可从任意工作目录调用，始终识别自身安装目录：

```bash
INSTALL_DIR="$HOME/apps/mail-web"
"$INSTALL_DIR/mailweb" status --json
"$INSTALL_DIR/mailweb" doctor --json
"$INSTALL_DIR/mailweb" logs --tail 100
"$INSTALL_DIR/mailweb" backup
"$INSTALL_DIR/mailweb" self-update --version v0.4.0-alpha.14
"$INSTALL_DIR/mailweb" update --version v0.4.0-alpha.14 --yes
"$INSTALL_DIR/mailweb" restore "$INSTALL_DIR/backups/SNAPSHOT" --yes
```

更新先下载、校验并导入镜像，然后停止本实例并保存一致性快照，再启动新版本。保留旧镜像和快照；启动失败返回非零并显示匹配快照的恢复命令。数据库迁移后禁止直接以旧程序打开新数据库。恢复先验证完整性，失败恢复原文件；成功后撤销旧会话。

变更监听使用 `configure`。已配置站点以非交互方式更改 IP 或端口时，必须用 `--public-origin` 明确保留的 HTTPS 反代地址或新的 HTTP 直连地址。维护命令仅修改加密配置中的网站来源，不重新配置 Stalwart；来源变更后的验证要求会在控制台说明，注册开放策略保持独立。

```bash
"$INSTALL_DIR/mailweb" configure --bind 127.0.0.1 --port 18091 \
  --public-origin https://mail.example.org --yes
```

旧 `deploy/mail-web.sh` 统一转交 Rust CLI，旧命令及参数继续兼容。重复运行根安装器并指定原 `--dir` 即可升级旧安装，不重建数据。备份包含加密配置和密钥，请保存独立离线副本。详见 [CLI 与迁移说明](cli.md)。

## 7. 数据与边界

| 相对路径 | 内容 |
|---|---|
| `.env` | 镜像版本、容器名、监听和其他基础设施选项 |
| `config/runtime.enc` | 加密的站点与默认 Stalwart 连接配置 |
| `config/turnstile-setup.enc` | 单独配置 Turnstile 的加密归属及恢复记录，不包含 Cloudflare API Token |
| `config/initialization*.enc` | 按连接分开的加密初始化进度与生成凭据；不包含临时管理员授权 |
| `config/installed-release.json` | 已安装产物的版本、架构和镜像标识 |
| `data/db` | SQLite、WAL 与 SHM；包括额外连接的加密运行配置、域名策略与就绪记录 |
| `data/staging` | 附件暂存 |
| `secrets` | 安装管理令牌、加密密钥及可选服务密钥 |
| `logs` | 应用轮转日志 |
| `backups` | 一致性快照与恢复前文件 |
| `releases` | 校验后的下载包与发布内容 |

Compose 只挂载本安装的相对目录；安装器不写固定全局工作路径。Docker 引擎本身的镜像层、网络和容器元数据属于已有 Docker 基础设施。应用关闭 Docker JSON 日志，业务日志写入相对 `logs/`。

CLI 校验容器的 Compose 工作目录归属，拒绝操作属于其他安装的同名容器；托管目录中的符号链接也会被拒绝。不会改其他应用、DNS、反代或邮件服务器的文件。

用户密码由 Stalwart 管理。Web 会话使用加密保存的限时上游凭据，写操作检查精确 Origin 和 CSRF。HTTPS 使用 Secure、HttpOnly 的 `__Host-` 会话 Cookie；显式启用的 HTTP 使用独立 Cookie 名称，不把它宣称为安全上下文。写信的幂等 ID 使用浏览器加密随机源，兼容显式 HTTP 下没有 `randomUUID()` 的情况，见 [Web Crypto 说明](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。

## 8. 构建与发布维护

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend typecheck
pnpm --dir frontend build
node frontend/tooling/check-boundaries.mjs
node frontend/tooling/check-boundaries-fixtures.mjs
node tooling/check-persistence.mjs
node --test tests/motion-styles.test.mjs tests/operation-id.test.mjs tests/admin-access.test.mjs tests/setup-guidance.test.mjs tests/platform-account-context.test.mjs
cargo fmt --all -- --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo run --locked -p mail-web -- --openapi > backend/contract/openapi.json
pnpm --dir frontend exec openapi-typescript ../backend/contract/openapi.json -o apps/web/src/platform/lib/generated-api.ts
```

API 契约从 Rust/Utoipa 生成，生成文件不手改。发布流程、双架构附件、版本一致性、草稿验收和失败重试见 [发布维护指南](releasing.md)。普通提交运行质量与真实服务测试；版本标签或带 `[release-preview]` 的 main 提交通过快速检查、双架构草稿安装及恢复验收后公开。随后对同一发布提交运行全量客户端、全部业务及持续注册检查，结果自动写入 Release 说明。

发布包包含完整镜像、CLI、Compose、教程、接口契约及对应提交源码。服务器通过 `docker load` 导入镜像；默认部署继续使用 `pull_policy: never`。SHA-256 用于验证下载完整性，发布来源依赖 GitHub 仓库和发布权限。

前端业务与布局基于 Bulwark，MUI 提供基础控件；来源、许可证和差异记录见 [上游复用清单](upstream/README.md)。安装和宿主机 CLI 参考固定 DSH 基线，见 [DSH 来源说明](upstream/dsh/README.md)。
