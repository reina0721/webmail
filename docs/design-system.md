# Mail Web 客户端设计规范

本规范定义了 Mail Web 邮件工作区（基于 Bulwark 协议引擎与业务工作区）及原生管理控制台、认证页的统一视觉与交互语言：融合 **kirakira.moe** 的精致粉白通透美学、**Material Design（MUI v9 二次封装）** 的严谨组件体系，以及专业控制台所必需的**紧凑布局、高信息密度与清晰视觉层级**。始终保留 Mail Web 自身品牌，不使用任何参考站点的标识、插画或版权素材。

## 组件与样式边界

- `frontend/packages/material-ui`（`@mail-web/ui`）是 MUI 二次封装的唯一入口。基础控件、浮层、焦点环、色板、紧凑密度与无障碍动态策略均由该包统一收敛，业务层（含所有邮件工作区与控制台代码）禁止直接导入 `@mui/*`。
- `frontend/packages/material-ui` 保持 Host 隔离，不直接访问 `window` / `document` / `navigator` / `localStorage` / `sessionStorage`；剪贴板、路由与偏好持久化由宿主应用通过回调或状态 store 注入。
- 邮件工作区 `src/components/ui/*` 基础原语（`Button`、`IconButton`、`Input`、`TimeField`、`Dialog`、`ConfirmDialog`、`PromptDialog`、`ContextMenu`、`SearchableSelect`、`Field`、`Toolbar`、`Toast`、`EmptyState`、`Spinner`、`WelcomeBanner`、`FirstStartNoticeBar` 等）全部转接 `@mail-web/ui/native-controls`，同时保留完整的 JMAP / CalDAV / CardDAV / Files / Offline 业务生命周期与无障碍契约。
- 样式入口仅加载 `bulwark-globals.css` 与 `@mail-web/ui/client.css`（内部按 `tokens.css` → `motion.css` 组织），MUI 使用 CSS layer，严禁在非上游文件中使用 `!important` 或在组件中硬编码十六进制 / `rgba()` 颜色。
- 开源许可证与上游归属说明见 `docs/upstream/README.md`、`LICENSE`（AGPL-3.0-only）与 `NOTICE`。

## 视觉层级、色彩与 6 套 KIRAKIRA 强调色

### L0–L5 表面层级（oklab 动态混合）

- **L0 画布层（`--surface-canvas`）**：浅色暖白微带主题色调，深色暖暗灰基底。
- **L1 侧栏与导航层（`--surface-sidebar`）**：浅色微粉/主题色调白，深色微暖紫暗底，搭配柔和侧栏阴影（`--shadow-rail`）。
- **L2 卡片层（`--surface-card`）**：高对比清晰主体面，配合 1px 细边界与克制阴影，保证高密度表单与数据表可读性。
- **L3 嵌套输入/指标槽（`--surface-inset`）**：输入框、键值槽与配额摘要块使用的轻凹陷底面。
- **L4 悬浮亚克力层（`--surface-overlay` / `--surface-topbar`）**：命令面板、右键菜单、Toast、顶部吸顶栏与底部保存条使用半透明背景加 `backdrop-filter: blur(var(--surface-acrylic-blur))`；在高对比度、减少透明度和强制配色模式下自动回退为纯实色。

### 6 套个性主题色预设（控制台 + Webmail 同步）

由 `useAppearanceStore` 持久化并同步至 `<html data-accent="...">` 与 `<MaterialTheme dark accent>`，所有 `--accent-5` ~ `--accent-80`、焦点环、悬停态与 Bulwark `--color-*` 语义变量实时联动：

| 预设 ID | 名称 | 浅色主色 | 深色主色 |
| --- | --- | --- | --- |
| `sakura`（默认） | 樱花粉 | `#e05681` | `#f497b8` |
| `sky` | 晴空蓝 | `#3b78d8` | `#82b6ff` |
| `violet` | 紫罗兰 | `#8e44ad` | `#d0a2f7` |
| `forest` | 森林绿 | `#2f8547` | `#7ad899` |
| `amber` | 琥珀橙 | `#c46d10` | `#f5bc69` |
| `cyan` | 青岚蓝 | `#168098` | `#6fd2e6` |

## 专业控制台紧凑密度与工作区交互

- **紧凑高密度控制台**：侧栏展开宽度 `248px`、折叠迷你宽度 `68px`；顶部栏单行紧凑布局；卡片内边距 `18px`、表格单元格纵向内边距 `10px`、等宽数字（`tabular-nums`）；统计指标卡支持入场级联与轻悬停反馈；关键只读标识（版本哈希、CLI 命令、Turnstile Site Key、安装生成资源、服务来源地址）提供一键复制按钮与弹簧对勾反馈。
- **个性几何克制点缀**：在导航轨底栏与控制台侧栏底栏使用克制的 `skewX(-24deg)` 双斜杠几何分隔纹（`.kirakira-rail-stripes`）；当前激活导航项统一配备 3px 主题色胶囊指示条（`.nav-rail-indicator` / `.console-nav-indicator`）；设置图标悬停轻旋 60°。
- **Webmail 工作区**：保留桌面窄应用栏、文件夹侧栏、三栏/底部/全屏邮件阅读与独立弹窗（`PopoutShell`）；个人外观设置与 `Ctrl+K` 命令面板均支持即时切换深浅模式与 6 套个性主题色；移动端使用单列、底部标签栏与边缘抽屉。
- **未保存保护**：控制台及子标签页通过吸顶保存条（`ConsoleSaveBar`）与离开确认对话框保护未保存更改；切换站点设置子标签时保持表单状态不丢失。

## 动效曲线与无障碍契约

全部 `@keyframes` 统一登记在 `frontend/packages/material-ui/src/motion.css`，组件侧仅消费标准缓动令牌：

- `--ease-expo-out`（`cubic-bezier(0.19, 1, 0.22, 1)`）：面板、内容切换与状态变化主曲线。
- `--ease-circ-out`（`cubic-bezier(0, 0.55, 0.45, 1)`）：菜单弹出与微交互。
- `--ease-fluent`（`cubic-bezier(0.1, 0.9, 0.2, 1)`）：抽屉滑移、齿轮旋转与导航指示条。
- `--ease-spring`（`cubic-bezier(0.34, 1.56, 0.64, 1)`）：开关滑块与复制成功对勾微弹反馈。
- `--ease-theme`（`cubic-bezier(0, 0, 0, 1)`）：深浅主题色切换平滑过渡。

当系统启用 `prefers-reduced-motion: reduce` 或应用开启 `data-motion="reduced"` 时，自动关闭全部入场动画、过渡与位移；高对比度模式与 `forced-colors` 禁用模糊与装饰背景，保持 WCAG 对比度、键盘焦点环、触控 ≥ 44px 命中区与屏幕阅读器状态播报完整可用。
