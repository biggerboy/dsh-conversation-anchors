# Changelog

本文件记录已发布到 npm 的版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.16] - 2026-09-02

### 修复

- **DeepSeek 第一个 tick / 标题偏淡**：与 Codex 同源——首轮误标 `unloaded`；DeepSeek 改为 tick 同宽仅降透明度，未加载标题用 tertiary 色；并增强 chat 索引回退与首帧后 reconcile。
- **流式回复时 active 闪烁**：贴底或会话 `running` 时锁定最后一轮 active（对齐官方）；`syncActive` 去重；chat 更新改为增量 patch 轨，不再每个 token 重建 DOM。
- **轨高按比例自适应**：DeepSeek 槽位上限为对话区高度的 **10%**；Codex 为 **70%** 并垂直居中（不再写死 300px，也不随内容铺满整列）。
- **Codex 悬停箭头**：tick 超出槽位时，鼠标悬停在轨上才在顶部/底部显示箭头；点击选中上一/下一条横条并跳转（不是翻页滚动）。
- **Codex tick 被压扁**：槽位变矮时 flex 子项默认收缩，导致十几轮挤在一小块且不出箭头；tick 改为 `flex: none`，超出后滚动并出现箭头。
- **Codex 箭头样式**：箭头移到轨外约 28px（远离 tick 列）；悬停箭头时显示浅灰圆形背景。
- **Codex 箭头体验**：圆形悬停底更圆（26px / `border-radius:50%`）；休息态 tick 中心与箭头对齐、只向右拉长；箭头离轨约 48px；气泡收窄为内容宽度，去掉原生 title，仅悬停自定义气泡。
- **Codex 悬停 wave / 箭头气泡**：轨加宽避免拉长短线被裁切；箭头上 mousemove 不再清掉气泡。

## [0.1.15] - 2026-09-02

### 修复

- **Codex 悬停卡片**：点击锚点跳转后，再次悬停同一 tick 时鼠标移开轨区，预览卡片会正常消失（不再因 tick 仍持有焦点而残留）。
- **Codex 第一个 tick 偏短**：合并 `turnOutline` 时若第 1 轮已在 Chat 窗口内，不再误标为 `unloaded`；会话打开过程中也暂不画 outline-only 的短 tick。
- **DeepSeek 轨垂直居中**：按实际 tick 列高度（而非 300px 上限槽位）在对话可视区内居中，避免轮次少时偏上。
- **单轮会话隐藏轨**：Codex / DeepSeek 风格下仅 1 轮对话时不显示锚点列表（官方风格不受影响）。

### 兼容

- 已对照 DSH **0.1.2-alpha.3 / alpha.4** 验证：插件未使用 alpha.4 移除的 `Session.events`，`turnOutline` / `loadThrough` / `uiConversation` 接口无变更。

## [0.1.14] - 2026-09-01

### 新增

- 锚点风格第三项 **DSH 官方（右侧）**：隐藏插件自绘轨，改用 DSH 0.1.2+ 内置紧凑回合导航；选 Codex / DeepSeek 时会自动隐藏官方轨，避免双轨重叠。
- **全会话大纲对齐 DSH 0.1.2-alpha.3+**：检测到 `turnOutline` 时，Codex / DeepSeek 轨合并 Host 大纲（含未加载轮次）；点击未加载刻度调用 `session.loadThrough(seq)` 按需分页并跳转。

### 变更

- **思考过程折叠**：检测 DSH 0.1.2+ 官方 Compact（`ui-chat.transcriptView === 'compact'`）或 DOM 中的 `[data-turn-process]` 后，自动跳过插件折叠，避免与官方双重披露；旧版 DSH 或 Normal 对话显示仍使用插件折叠。
- **历史拉齐**：有 `turnOutline` 或风格为「DSH 官方」时**不再**自动 drain；无大纲的旧版仍走 `loadOlder` 循环。

### 修复

- 锚点风格切换后立即生效，不再被 Host 设置回写悄悄改回 `codex`（写入失败或未重启 `dsh web` 时仍保留本地选择）。
- 从「DSH 官方」切回 Codex / DeepSeek 时插件轨不再卡在 `hidden`（设置页打开时 host 未就绪也会立刻显示并重排）。
- 插件锚点改从 `uiConversation.target('chat')` 读取（DSH 0.1.2+ 不再把 chat 挂在 SessionSnapshot 上），Codex / DeepSeek 轨可正常出 tick；`uiConversation` inject 改为可选，避免旧版 DSH 因缺服务而无法挂载。

## [0.1.13] - 2026-08-27

### 变更

- DeepSeek 右侧轨改为固定高度卡片（最多 300px），轮次多了在卡片内滚动，不再铺满整列。当前选中项会自动滚进可视区。
- 悬停展开标题面板：圆角加大；短线改为胶囊圆角；未悬停不画滚动条，悬停时在短线右侧显示 6px 浅色细滑块（不用系统滚动条，避免挤走短线）。卡片与页面右缘留出间距。
- 点击锚点后鼠标离开列表即收起面板，不必再点别处。

### 修复

- 滚到会话末尾且最后一轮撑不满一屏时，选中最后一条锚点。此前 scroll-spy 只认视口顶部，点最后一条也会被立刻改回去。

## [0.1.12] - 2026-08-27

### 修复

- 点击横线改为滚动对话列自己的 `[data-conversation-scroll]`。此前 `scrollIntoView` 在外层 `overflow: hidden` 下经常滚不到，看起来像没跳转。

## [0.1.11] - 2026-08-27

### 新增

- 锚点风格可在 **设置 → 通用** 里选择，默认仍是 Codex 左侧轨。DeepSeek 右侧等长蓝横线是可选项，改完立刻换轨，不用重启（[#3](https://github.com/biggerboy/dsh-conversation-anchors/issues/3)）。

### 变更

- DeepSeek 右侧轨：悬停某一行时标题和短线加深；浏览器原生 title 提示去掉。标题被截断时，停约 0.8 秒才弹出完整标题（黑底白字），未截断的不弹。
- 设置里的锚点风格下拉改为与「语言 / 权限」相同的弹出层：打开后触发器仍是浅色圆角，菜单白底圆角阴影，不再用系统原生 select 的黑框灰底。

### 修复

- DeepSeek 右侧轨在刷新、刚加载、或悬停展开标题时，当前轮次会标成蓝色。此前 scroll-spy 常打到助手回复节点（轨上只有用户提问），或在轨挂上之前就跑过一遍，结果所有横线都保持灰色。
- 标当前条时不再在 MutationObserver 里反复写 `aria-selected`。该属性本来就在观察名单里，会把自己再次叫醒，把标签页卡死。
- host 半边不再静态 import `@deepseek-ai/dsh-settings` / `schemastery`。`link:` 检出在 DSH 的 `node_modules` 树外，静态 import 会让 `dsh web` 直接起不来；改为从当前 profile / 正在跑的 `dsh` CLI 解析。

## [0.1.10] - 2026-08-26

### 新增

- 发版前校验 `package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`__ModuleLoader__.load` 的 `id` 三者一致，并核对 `PLUGIN_VERSION` 与包版本。`npm publish` 会走 `prepublishOnly`，对不上直接失败。
- 键盘跳转：焦点在横线轨或鼠标停在轨上时，方向键 / `j` `k` 跳到相邻轮次，`Home` / `End` 到两端；输入框内不响应。
- 拉齐历史时在轨旁显示进度（`正在拉齐历史… n/80`）；达到 80 页上限时提示后自动消失。

### 修复

- 自动拉齐历史若中途停住，不再把「加载更早」藏死。否则窗口从半截回合开始，第一条用户消息和对应横线都会消失。滚到顶部时若还有更早分页会继续拉取。
- 思考过程折叠不再把工具循环中间的 `assistant-step` 正文留在折叠条外。那些「去核实… / Let me check…」和最终回复同一种节点，只是还没到收尾；现在只露出最后一个有正文的回复，Think 与工具调用仍收进「思考过程」。
- 深色模式下横线轨与悬停卡片不再混用浅色回退色：悬停横线改为白色，卡片用略亮于页面的深灰底（对齐 Codex），标题/正文用浅色，避免白字配白底看不清（[#2](https://github.com/biggerboy/dsh-conversation-anchors/issues/2)）。

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

[Unreleased]: https://github.com/biggerboy/dsh-conversation-anchors/compare/v0.1.16...HEAD
[0.1.16]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.16
[0.1.15]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.15
[0.1.13]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.13
[0.1.12]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.12
[0.1.11]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.11
[0.1.10]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.10
[0.1.9]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.9
[0.1.8]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.8
[0.1.7]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.7
[0.1.1]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.1
[0.1.0]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.0
