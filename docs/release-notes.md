Mail Web v0.4.0-alpha.9

- 注册条件检查会指出 HTTPS 证书校验失败，并提示检查反代上的完整证书链。
- Stalwart 遮蔽 Hook 认证密钥时，Webmail 可用加密初始化记录确认该 Hook 的归属，再检测新地址并迁移回调。
- 历史版本验收采用先更新 CLI、再升级应用的步骤。
- Linux AMD64 和 ARM64 均提供离线包、独立 CLI、对应源码与 SHA-256 校验清单。

在控制台「版本管理」选择 `v0.4.0-alpha.9` 更新。[升级与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.9/docs/cli.md)
