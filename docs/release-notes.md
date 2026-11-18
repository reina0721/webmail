Mail Web v0.4.0-alpha.5

- **IP 备用入口。** 已启用 HTTP 直连并绑定具体 IP 的站点，在设置 HTTPS 主域名后仍可从原 IP 和端口登录、收发邮件和进入控制台。两个入口分别建立会话，注册和找回密码继续使用主地址。通配监听可用 `DIRECT_ACCESS_ORIGIN` 指定备用地址。
- **控制台版本管理。** 运营管理员可查看运行版本、选择适配本机架构的发布包升级，或确认后恢复旧版快照。宿主机服务继续处理容器重启期间的任务，切换失败时尝试恢复切换前的快照。回退会还原快照中的 Webmail 本地数据和配置。
- **Linux AMD64 与 ARM64。** 提供离线应用包、独立 CLI、对应源码及 SHA-256 校验清单。公开后的完整验证状态和日志会显示在下方。

在原安装目录升级。建议先留下旧版快照，以便登记为回退目标。

```sh
./mailweb backup &&
./mailweb self-update --version v0.4.0-alpha.5 &&
./mailweb update --version v0.4.0-alpha.5 --yes &&
./mailweb status --json
```

由 root 管理的标准 Compose 和 systemd 部署可执行 `sudo ./mailweb version-manager enable`，再打开控制台的「版本管理」。IP 修复入口可通过 `./mailweb setup --direct` 查看。[操作说明](https://github.com/reina0721/webmail/blob/v0.4.0-alpha.5/docs/cli.md#在控制台切换版本)
