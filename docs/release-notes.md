Mail Web v0.4.0-alpha.6

- **站点地址可以单独保存。** 旧版误填的 Turnstile 密钥或暂时无法连接 Stalwart 时，仍可从控制台修复主地址。
- **安装、修复、注册分步操作。** 已安装的站点直接显示邮件服务状态和下一步入口。首次安装说明 Stalwart 管理员和 Webmail 运营邮箱各自在哪里使用。
- **Turnstile 与收信验证。** 自动配置显示要绑定的域名、账号发现结果和 Account ID 获取入口。先完成自动检查、人机和收信验证，再开启公开注册。
- **邮箱打开时显示加载状态。** 通知提示避开安装和控制台页面。

在控制台打开「版本管理」，选择 `v0.4.0-alpha.6` 更新。尚未启用宿主机服务的安装，可以在原安装目录执行：

```sh
./mailweb self-update --version v0.4.0-alpha.6 &&
./mailweb update --version v0.4.0-alpha.6 --yes &&
./mailweb status --json
```

AMD64 与 ARM64 提供离线应用包和独立 CLI。版本切换与恢复请参阅[升级指南](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.6/docs/cli.md)。
