# Changelog

本文件记录已发布到 npm 的版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复

- 思考过程折叠不再把工具循环中间的 `assistant-step` 正文留在折叠条外。那些「去核实… / Let me check…」和最终回复同一种节点，只是还没到收尾；现在只露出最后一个有正文的回复，Think 与工具调用仍收进「思考过程」。
- 深色模式下横线轨与悬停卡片不再混用浅色回退色：悬停横线改为白色，卡片用略亮于页面的深灰底（对齐 Codex），标题/正文用浅色，避免白字配白底看不清。

## [0.1.10] - 2026-08-26

### 新增

- 发版前校验 `package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`__ModuleLoader__.load` 的 `id` 三者一致，并核对 `PLUGIN_VERSION` 与包版本。`npm publish` 会走 `prepublishOnly`，对不上直接失败。
- 键盘跳转：焦点在横线轨或鼠标停在轨上时，方向键 / `j` `k` 跳到相邻轮次，`Home` / `End` 到两端；输入框内不响应。
- 拉齐历史时在轨旁显示进度（`正在拉齐历史… n/80`）；达到 80 页上限时提示后自动消失。

### 修复

- 自动拉齐历史若中途停住，不再把「加载更早」藏死。否则窗口从半截回合开始，第一条用户消息和对应横线都会消失。滚到顶部时若还有更早分页会继续拉取。

### 变更

- 思考过程折叠箭头改为与 DSH 自带 Think 披露相同的 14px 线框 chevron（收起朝下，展开旋转朝上），紧跟「思考过程 · N 步」排布，不再右对齐。

## [0.1.9] - 2026-08-25

### 修复

- `lib/client.js` 的 `__ModuleLoader__.load` 注册 id 改为完整 npm 包名 `@biggerboy123/dsh-conversation-anchors`，与 `cordis.patch.yml` 的 `name` 对齐。0.1.8 只改了 YAML，浏览器半边仍注册无 scope 的 `dsh-conversation-anchors`，启动 Web 会报 `loaded without registering "@biggerboy123/dsh-conversation-anchors"`。

## [0.1.8] - 2026-08-25

### 修复

- `cordis.patch.yml` 的 loader `name` 改为完整 npm 包名 `@biggerboy123/dsh-conversation-anchors`。此前写成无 scope 的 `dsh-conversation-anchors`，DSH 会以 profile 目录为基址 `import()`，导致 `Cannot find package`，Web 无法启动。

## [0.1.7] - 2026-08-25

### 变更

- 左侧导航改为 Codex 风格短横线轨：每轮用户提问一条浅灰短横线，当前滚动位置那条更长、更深。
- 悬停时指针处最长最深，邻近短线按距离缩短，形成菱形起伏；悬停预览改为 `position: fixed` 浮动卡片（问题 + 回复摘要）。
- 打开会话后循环调用 `session.loadOlder()`，直到没有更早分页（最多 80 页），锚点一次出齐；同时隐藏对话区「加载更早」按钮。
- 轨迹标签、首页 hero、空会话下隐藏横线轨；思考过程折叠在轨迹页同样不显示。

### 文档

- 安装说明改为 scoped npm 包名 `@biggerboy123/dsh-conversation-anchors`，并补充 Git 源安装路径。

## [0.1.1] - 2026-08-25

相对 npm `0.1.0` 同步本地已有能力。

### 新增

- 滚动联动（scroll-spy）：高亮当前视口附近那一轮。
- 点击跳转后短横线闪光提示。
- 悬停预览补充该轮助手回复摘要（正文或工具名）。
- 界面文案中英切换（跟随 `document.documentElement.lang`）。

## [0.1.0] - 2026-08-17

首个公开发布。

### 新增

- 对话内容区左侧锚点导航：每轮用户提问一条入口，悬停预览、点击平滑滚动到对应消息。
- **思考过程折叠**：回合结束后把 Think 与工具调用收成一行披露；正在生成的回合保持展开，点击可展开/收起。
- 跟随当前会话快照实时刷新；切换会话即切换锚点列表。
- 仅 Web GUI（`platform: "web"`），host 半边无操作占位，行为全部在浏览器半边。

[Unreleased]: https://github.com/biggerboy/dsh-conversation-anchors/compare/v0.1.10...HEAD
[0.1.10]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.10
[0.1.9]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.9
[0.1.8]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.8
[0.1.7]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.7
[0.1.1]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.1
[0.1.0]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.0
