Mail Web v0.4.0-alpha.8

- **只用 Token 一键配置 Turnstile。** 对同一目标账号具有 `Account Settings: Read` 和 `Turnstile: Edit` 的 Token，若能读到唯一账号，Webmail 会在一次点击内选择账号、创建组件并保存密钥。
- 若 Token 可读到多个账号，页面会要求选择目标账号。若 Cloudflare 未返回账号，页面会提示 Token 所需权限。仍可用已有的 Account ID 继续配置。
- Linux AMD64 和 ARM64 均提供离线包、独立 CLI、对应源码与 SHA-256 校验清单。

在控制台「版本管理」选择 `v0.4.0-alpha.8` 更新。[升级与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.8/docs/cli.md)
