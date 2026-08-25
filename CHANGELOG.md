# Changelog

本文件记录已发布到 npm 的版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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

[0.1.8]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.8
[0.1.7]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.7
[0.1.1]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.1
[0.1.0]: https://github.com/biggerboy/dsh-conversation-anchors/releases/tag/v0.1.0
