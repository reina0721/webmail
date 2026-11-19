Mail Web v0.4.0-alpha.18

- 修复并增强宿主机自升级能力：移除大包下载 600 秒总超时限制，改为 15 秒连接超时与 45 秒空闲读取超时，支持基于 HTTP `Range` 的 `.part` 断点续传与本地已校验缓存复用。
- 新增自定义 GitHub 下载加速镜像（`DOWNLOAD_MIRROR` / `--download-mirror`）与 HTTP/HTTPS 网络代理（`RELEASE_PROXY` / `--release-proxy`），支持在控制台「版本管理」实时保存、立即刷新发布目录并在升级失败或取消时断点重试；所有下载包仍强制验证 `SHA256SUMS` 与源码提交。
- 在控制台「版本管理」展示实时下载进度条、已下载/总大小、瞬时速率、下载来源、低速提示与「取消下载」操作；版本切换成功后自动同步更新并热重启宿主机 `mailweb-version-manager` 服务。
- Linux AMD64 和 ARM64 提供离线包、独立 CLI、源码及 SHA-256 校验清单。

[版本切换与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.18/docs/cli.md)
