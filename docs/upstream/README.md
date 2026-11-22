# Bulwark 来源与本站适配

基线：[`bulwarkmail/webmail@7cdedb60cc157cfeaf19623732b1135da6d3dc28`](https://github.com/bulwarkmail/webmail/tree/7cdedb60cc157cfeaf19623732b1135da6d3dc28)。许可证为 AGPL-3.0-only；根目录 LICENSE、NOTICE 保留上游版权、MIT 血缘及第三方许可。

本站前端初始导入了固定 Bulwark 基线的完整邮件、日历、联系人和文件能力（JMAP 客户端、Zustand 状态、TipTap 编辑器扩展、离线数据库/同步、导入导出、Sieve、日历和联系人协议工具、多语言翻译、资源与相关测试），并在此基础上演进为独立的 `kirakira.moe × Material Design` 前端体系。根目录 `LICENSE`、`NOTICE` 与 `docs/upstream/dsh/` 持续由 `node tooling/check-upstream.mjs` 校验，确保上游开源许可与署名始终完整保留；原逐文件 SHA-256 锁定已解除，以支持 `src/components/ui/*`、导航壳层、个人设置壳层及全站视觉/动效体系的自由演进。`bulwark-manifest.json` 仍作为历史导入基线与架构边界参考保留。

适配范围：

| 入口 | 本站演进 |
| --- | --- |
| `src/lib/jmap/client.ts` | 本站会话传输，账号选择、CSRF、上传、SSE、发送幂等；保留上游协议实现。清理服务身份显示名；解释 Stalwart 1.0 的目录共享边界。 |
| `src/stores/auth-store.ts` | 逐个验证本站登记账号；HTTPOnly 多会话；不在浏览器持久保存邮箱密码；恢复账号时重新校验 cookie。保留上游隔离的客户端、缓存和离线状态。 |
| `src/lib/browser-navigation.ts` | 偏好、个人账号管理、运营策略转接 Rust。非本站传输保留上游行为，便于上游测试及差异维护。 |
| `src/components/ui/*` | 全面替换为 `@mail-web/ui/native-controls`（MUI v9 二次封装）底座，保留全部业务接口与无障碍/测试契约。 |
| `src/components/layout/*` & `src/components/settings/*` & `src/components/command-palette/*` | 导航栏、顶栏、侧栏壳、个人设置壳与命令面板升级为 `kirakira.moe × Material Design` 磨砂层级、弹性激活指示与 6 套个性色联动；保留全部核心业务大页面与协议逻辑。 |
| `src/components/settings/account-settings.tsx` | 加入本站的设备撤销、统一用量和未知提交核对。个人设置与控制台分离。 |
| `src/native` | 本站登录/注册/验证、安装向导、统一控制台 8 大分区与宿主壳，遵循专业控制台紧凑布局与信息密度。 |
| `packages/material-ui` | 全站唯一 MUI v9 二次封装网关：动态 `oklab` 6 套个性色、L0–L5 色阶、紧凑密度、5 类 `kirakira` 动效曲线与全量基础控件。 |
| 测试及 worker 构建脚本 | 路径迁移；MUI 模态、焦点和样式断言适配。两项桌面独立窗口测试不属于本次 Web 交付范围，明确从客户端测试排除。 |

原平台 UI、HeroUI、旧 Tailwind 全局入口及 `workspace-*` 页面均已移除。上游自己的 Tailwind 工具类属于本次导入的客户端，只有一套主题入口；它不读取旧平台样式。

客户端质量门禁明确选择加密与恢复客户端测试 `account-archive.test.ts`、`account-archive-client.test.ts`，不执行导入上游 Next 服务端路由的 `account-archive-route.test.ts`、`account-archive-shared-store.test.ts`。本站该端点由 Rust 实现，所有者、错误参数、会话及真实存取由 Rust 测试和 `tests/native-client-integration.py` 检查；两个上游服务端测试保留原样，不伪造不存在的 Next 路由使它们通过。v21 扩大通配符时曾误收集这两个文件导致门禁失败，修正了测试范围，未将该次运行计为通过。

源码入口为当前仓库及发布包 `source.tar.gz`。运行版本由 `/build.json` 和 `/api/v1/health/ready` 显示。尚未提交的工作树构建明确标记 `working-tree`，不能声称它对应已发布提交。

## 传输、通知与独立网关来源

`backend/src/push.rs` 根据上述固定基线的 `app/api/push/preview/route.ts`、`app/api/push/action/route.ts` 适配 Rust 会话传输，保留来源与修改说明。`lib/clean-preview.ts` 从同基线 `lib/utils.ts` 提取原有预览清理函数，供原生服务 worker 共用；其余 UI 仍通过原 utils 导出使用。

自动发送网关使用官方 Rust SDK：`mail-auth 0.14.1`（签名核验）、`mail-send 0.6.2`（SMTP 客户端）和 `smtp-proto 0.2.5`（协议解析）。版本与校验值固定在 Cargo.lock，许可由对应 crates 元数据提供。网关代码为本站实现，不冒充 Bulwark 模块，也未复制 Stalwart Enterprise 的专有实现。Stalwart 仅以官方镜像运行；对其开源接口及源码的只读检查用于核对 Sieve、签名和路由行为。

账号加密备份继续复用 Bulwark 密码派生和加密信封。远程 ICS 传输适配为 Rust 公共网络获取边界，保留上游订阅状态、解析和展示逻辑。原生 SMTP/JMAP/日历邀请与自动邮件共用本站限额，不改变上游编辑器、规则生成器与原生模块的操作组织。

全局 Web 宿主由 `src/native/web-hosts.tsx` 按同基线布局装配，包含所有账号的实时事件、后台通知按钮、独立写信窗口及主窗口交接、会话超时、设备策略、日历空闲忙碌策略、PWA 安装与更新、备份/设置同步提示及钓鱼举报。插件、嵌入式认证和桌面桥不作为本次 Web 的全局宿主。独立窗口直接使用上游 `PopoutShell` 的封装会话交接，避免再执行一次普通登录与全套数据初始化。

本机浏览器四格式导入采用本站无敏感数据的 EML/ZIP/mbox 样本，以及固定提交的 `lib/mail-import/__tests__/fixtures/Outlook.pst` 原样样本；实际导入 17 封、创建 3 个目录。保留上游跳过嵌套邮件独立导入、联系人和日历项目的明确说明。导出增加保存位置/浏览器下载选择，复用原有加密暂存与内存限制；修改记录包含所有目录的语言键。导入导出弹层将阶段按钮交给 MUI 的初始焦点接口，保留原生的进度和取消组织。

Git 属性对导入源文件和 MIME 样本关闭换行转换，保留固定哈希及签名字节。暂存后的独立检出再次校验全部 4,194 个文件；根运行目录忽略规则限定在根目录，避免误漏上游 `structured-mail/data/airport-timezones.json`。对应源码包同样逐文件核对清单，包含版本文件、Docker 输入和许可证，不包含运行数据。

Cloudflare 官方失败、重复和成功测试密钥只在独立恢复副本配置，经应用配置接口写入并执行真实验证；生产模式拒绝测试密钥。测试来源为 [官方说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)，不使用真实生产密钥执行这些故障场景。
