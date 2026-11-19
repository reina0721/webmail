Mail Web v0.4.0-alpha.19

- 优化发布与打包流水线架构：引入并行快速检查（`fast-check` 在 30 秒内拦截编译/Clippy/类型/OpenAPI 错误）、跨版本复用的 Rust 第三方依赖缓存（忽略工作区版本号递增导致的缓存失效）、应用与 CLI 并行容器构建以及 `pigz` 并行压缩打包。
- 开启 `[profile.release] strip = "symbols"` 进一步缩小发布包体积（加速慢速网络下载）并修复 `full-validation` 中的 `clippy::collapsible_if` 问题。
- 新增 `tooling/pre-release-check.sh` 推送前预检脚本，支持通过本机 Linux/Docker 提前捕获跨平台编译问题。
- Linux AMD64 和 ARM64 提供离线包、独立 CLI、源码及 SHA-256 校验清单。

[版本切换与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.19/docs/cli.md)
