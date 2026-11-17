# 发布维护指南

本仓库使用两阶段 GitHub Actions：先快速检查并发布，再对同一版本执行完整验证。两阶段均覆盖 Linux AMD64 与 ARM64；分发离线应用包和 Rust CLI。目标服务器从 Release 下载、校验并 `docker load`，不拉取应用镜像仓库。历史版本可能只有 AMD64 附件。

## 版本与权限准备

本次候选版本为 `v0.4.0-alpha.3`，现有 `v0.4.0-alpha.2` 保持不变。每次发布前先检查 [Releases](https://github.com/reina0721/webmail/releases) 和远端标签，使用尚未绑定其他提交的新版本。

每次准备版本时，同步以下值并提交：

- `release-version.txt`：带 `v` 的版本。
- `backend/Cargo.toml`、`crates/mailwebctl/Cargo.toml`：不带 `v` 的包版本，以及 Cargo.lock 中对应的工作区包版本。
- 根 `install.sh` 的 `bootstrap_version`：带 `v`，必须是本次首次提供双架构 CLI 的版本或后续发布版本。
- `.env.example`、`examples/infrastructure.env.example` 及两份 README 的配置版本示例。
- `CHANGELOG.md` 的发布条目，以及 `docs/release-notes.md` 的本版说明。不得将旧验收记录改写成新版本验证。

运行：

```sh
python3 tooling/release_metadata.py check-version "$(cat release-version.txt)"
python3 tests/release-packaging.py
python3 tooling/check-repository.py
```

GitHub 必须允许 Actions 使用仓库的 `GITHUB_TOKEN`。仓库 **Settings → Actions → General → Workflow permissions** 可配置 Read and write permissions；若组织策略限制，需由管理员允许发布任务请求 `contents: write`。工作流默认及普通 PR 保持只读；发布预检和草稿附件验收任务也单独请求 `contents: write`，以获得草稿可见性；它们只在发布路径运行，普通 PR 不会启动这些任务。草稿上传与公开任务负责写 Releases，main 的旧运行取消任务单独请求 `actions: write`。草稿访问规则见 [GitHub Releases API 文档](https://docs.github.com/en/rest/releases/releases)。不需要 GHCR、Docker Hub 或包注册表密钥。

公开仓库使用 `ubuntu-24.04` 与 `ubuntu-24.04-arm` 原生 runner。迁移到其他服务或权限环境时，应先确认同等 runner 可用。Fork 需将 README 安装 URL、仓库链接、根 `install.sh` 的默认仓库、`.env.example`、示例和 CLI 默认仓库调整为实际 `OWNER/REPO`；工作流发布目标使用 `GITHUB_REPOSITORY`。

## 触发方式

普通提交、PR 和 main 的手动运行执行双架构检查；手动选择 `v*` 标签运行也会走标签发布路径。发布触发规则保留为：

1. 推送与版本文件完全相同的 `v*` 标签；可发布预发布或满足稳定版门禁的版本。
2. 向 main 推送提交消息含 `[release-preview]` 的提交；版本文件必须是预发布版本。

标签发布示例，在版本更新已经提交并推送后执行：

```sh
version=$(cat release-version.txt)
python3 tooling/release_metadata.py check-version "$version"
git tag -a "$version" -m "Mail Web $version"
git push origin "$version"
```

main 预发布提交可使用：

```sh
git commit -m "release: $(cat release-version.txt) [release-preview]"
git push origin main
```

上述命令会启动外部发布；应由维护者在检查完成后主动执行。稳定版继续要求 `docs/acceptance.json` 中 `readyForPublicRegistration` 为 true；该字段不是运行时域名注册开关。

## 第一阶段：快速检查、草稿验收与发布

`ci.yml`（Quick release and checks）先检查版本一致性、版本唯一性及提交归属。两种原生 runner 均执行 Rust 格式／全部 Rust 测试／Clippy、前端类型与生产构建、原生界面专项测试、API 契约、上游来源和真实 Stalwart 快速集成。通过后汇总草稿，两种架构重新下载真实附件，完成干净／重复安装、更新、备份恢复、故障恢复；AMD64 同时验证已公开 v0.4.0-alpha.2 Rust CLI 和旧 shell 版本升级。两侧成功后公开。

全量客户端回归及至少 30 分钟持续注册检查移到发布后；快速检查通过不表示完整验证已通过，也不表示公网邮件投递或生产 Turnstile 已验收。Release 说明明确区分 Fast checks 与 Full validation。

构建使用同一提交和版本，镜像的运行时版本与 revision 必须匹配；CLI 的 ELF 架构和版本必须匹配。打包命令在本机对应架构执行：

```sh
version=$(cat release-version.txt)
architecture=$(sh tooling/platform.sh)
docker build --platform "linux/$architecture" --build-arg MAIL_WEB_REVISION="$(git rev-parse HEAD)" -t "mail-web:${version#v}" .
sh tooling/package-release.sh "$version" "$architecture"
```

在已提交源码上运行，输出位于 `build/release/VERSION/ARCHITECTURE/`。修改后的未提交源文件不得用已提交 revision 标记。应用包中的 `source.tar.gz` 从该 Git 提交导出，包含追踪的源码、锁文件和许可证，不收录工作区运行数据或缓存。

标签与 main 预览的完整发布运行共用串行并发组，避免草稿验收期间被另一运行替换附件。双架构产物汇总后创建草稿，草稿提供：

| 附件 | 内容 |
| --- | --- |
| `mail-web-linux-amd64.tar.gz`、`mail-web-linux-arm64.tar.gz` | 单架构镜像、CLI、Compose、文档、契约和对应源码 |
| `mailwebctl-linux-amd64.tar.gz`、`mailwebctl-linux-arm64.tar.gz` | 单架构静态 CLI、CLI 清单与来源许可 |
| `release-manifest-linux-amd64.json`、`release-manifest-linux-arm64.json` | 对应架构、版本、提交、镜像 ID、SQLite 和迁移信息 |
| `release-manifest.json` | AMD64 清单的兼容副本；每个应用包内部仍使用这个名称 |
| `install.sh` | 本版引导安装脚本 |
| `SHA256SUMS` | 除自身以外全部附件的 SHA-256 |

汇总命令只接受两个架构齐全、内外清单一致、提交及版本一致的输入：

```sh
python3 tooling/release_metadata.py assemble "$(cat release-version.txt)" \
  --inputs build/release-inputs --output build/release-assets
(cd build/release-assets && sha256sum -c SHA256SUMS)
```

两个 runner 分别重新下载草稿的全部真实附件，再校验和安装对应架构。测试覆盖干净／重复安装、更新、网络配置、备份恢复及失败恢复；AMD64 额外验证历史 shell 发布包升级，ARM64 没有历史 AMD64 包迁移步骤。只有两侧成功后才公开。CLI 选择最高 SemVer 的已发布版本，缺少本机架构产物时直接失败，不自动回退旧版或其他架构。

## 第二阶段：发布后完整验证

`full-validation.yml`（Full validation）在快速流程完成后通过 `workflow_run` 读取其发布记录，校验仓库、版本、源码提交、公开状态及标签归属。它检出记录中的确切提交，下载并校验实际公开附件，在两种原生 runner 上使用发布镜像运行原有的全部客户端测试、全部真实 Stalwart 业务测试、旧数据及独立备份恢复，以及至少 30 分钟持续注册检查。普通提交和 PR 仍执行完整检查，保持只读权限。

完整验证开始和结束时，仅有结果汇报任务获得 `contents: write`，只更新 Release 说明中的自动验证区块，不上传或替换附件。状态为 pending、running、passed、failed 或 cancelled，并附 Actions 链接。完整检查失败会将该版标为 failed；维护者修复后必须同步新版本号并再次发布。不会自动改写源码、移动旧标签或回滚任何生产实例。

发布使用 `GITHUB_TOKEN` 时，`release: published` 事件不会可靠地启动另一个工作流，因此这里使用独立的 `workflow_run` 和已发布记录，而非要求额外 PAT。机制和信任边界见 [GitHub workflow_run 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)。来自外部 PR 的运行不能进入有写权限的发布结果汇报路径。

## 失败与重试

第一阶段失败保持未发布或草稿状态。第二阶段失败保留已公开产物并在 Release 说明标明失败。相同提交可在 Actions 中重跑任务；若需要修改源码，应使用新版本并同步版本字段。已有标签不可强推，已公开版本不可覆盖，同一版本也不能改绑到其他源码提交。过时的 main 构建在草稿上传前和公开前都会被拒绝。

查看快速流程中 `metadata`、`preflight`、两侧 `checks`、`draft`、两侧 `release-install` 和 `publish`；完整流程查看两侧 `checks` 和 `report`。检查失败阶段的日志，并在修复后重新完成所需阶段。若更新启动失败，使用 CLI 给出的匹配快照恢复；不要直接对迁移后的数据库运行旧程序。

GitHub 设置还应由维护者确认：Issues 可用；需要时启用私密漏洞报告；为 main 与版本标签设置适当保护。文件生成不代表这些远端设置已经变更。

重试原提交的快速失败任务或完整验证：

```sh
gh run rerun FAST_RUN_ID --failed --repo reina0721/webmail
gh run rerun FULL_RUN_ID --repo reina0721/webmail
```

重跑完整验证会继续使用该次快速发布记录绑定的源码提交。Release 的 Full validation 为 pending 或 running 时，尚没有该版本的完整通过结论；使用者可据此决定是否立即升级。
