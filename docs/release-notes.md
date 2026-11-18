Mail Web v0.4.0-alpha.14

- 安装与修复页直接显示 Cloudflare API Token 和 Account ID。重新读取会显示当前主地址和任务状态，并保留正在填写的内容。
- 站点设置可用同一个 Token 核对和修复迁移后的 Turnstile 组件。原组件存在时补齐新域名，找不到时由管理员确认是否创建替代组件。
- 页面显示组件名称、Account ID、Site Key、上次核对的绑定域名和 Secret 保存状态。真人验证和验证码收信仍在「注册与验证」完成。
- Linux AMD64 和 ARM64 均提供离线包、独立 CLI、对应源码与 SHA-256 校验清单。

在控制台「版本管理」选择 `v0.4.0-alpha.14` 更新。[升级与恢复指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.14/docs/cli.md)
