# @biggerboy123/dsh-conversation-anchors

会话锚点导航插件 —— 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 在对话内容区左侧提供 Codex 风格的短横线锚点：当前会话每一轮用户提问对应一条短横线，悬停预览、点击即可平滑滚动定位。

纯浏览器端插件，以树外（out-of-tree）bundle 的形式安装，不修改 DSH 源码。host 半部分为无操作占位，全部行为在浏览器半部分（`./client`）实现。

## 名称对照

GitHub 仓库 owner 和 npm 包 scope **不是同一个字符串**，安装时不要混用：

| 用途 | 名称 |
| --- | --- |
| GitHub 仓库 | [`biggerboy/dsh-conversation-anchors`](https://github.com/biggerboy/dsh-conversation-anchors) |
| npm 包名 | `@biggerboy123/dsh-conversation-anchors` |

`dsh plugin add` 默认走 **npm registry**，参数必须写 **npm 包名** `@biggerboy123/dsh-conversation-anchors`。不要写成 GitHub 风格的 `biggerboy/dsh-conversation-anchors` 或 `biggerboy123/dsh-conversation-anchors`，registry 上没有这两个名字，会装失败。

## 功能

- **Codex 风格横线轨**：内容区左侧 gutter 一列浅灰短横线，当前滚动位置那条更长、更深
- **悬停起伏**：鼠标在横线上滑动时，指针处最长最深，邻近短线按距离逐渐缩短，形成菱形起伏
- **点击定位**：点击锚点平滑滚动到 `[data-chat-anchor-key]` 对应行
- **一次拉齐历史**：打开会话后循环调用 `session.loadOlder()`，直到没有更早的分页，锚点一次出齐；同时隐藏对话区「加载更早」按钮
- **实时刷新**：订阅当前会话快照，新消息到达时锚点列表自动更新
- **切换会话自适应**：跟随 `ctx.sessions` 的当前会话选择，切换会话即切换锚点
- **轨迹页隐藏**：轨迹标签下隐藏横线轨
- **思考过程折叠**：回合结束后把 Think 与工具调用收成一行披露

## 安装

需要 Node `^22.19 || >=24` 和 `dsh` CLI（`npm i -g @deepseek-ai/dsh@next`）。

### 从 npm 安装（推荐）

这条命令从 **npm registry**（`https://registry.npmjs.org`）拉包，**需要能访问 npm**，不经过 GitHub。github.com 超时不影响这条路径。

```sh
dsh plugin --profile web add @biggerboy123/dsh-conversation-anchors
```

安装过程中 pnpm 常会打印类似：

```text
✕ missing peer @deepseek-ai/dsh-client-runtime  Wanted: ^0.1.0-rc.6
```

这是 **良性告警，不是安装失败**。该 peer 由 DSH Web 自己提供，profile 里 hoisted 的 `node_modules` 运行时能解析到。只要命令 **退出码为 0**，就可以继续：重启 `dsh web`，打开任意会话即可在对话区左侧看到短横线锚点。

### 从 Git 仓库安装（npm 不通时）

走 GitHub / git 源，需要能访问 `github.com`（或你自己的镜像）。不要把仓库路径当成 npm 包名去 `add`。

```sh
# 默认分支
dsh plugin --profile web add github:biggerboy/dsh-conversation-anchors

# 指定分支或标签
dsh plugin --profile web add github:biggerboy/dsh-conversation-anchors#master
```

装完同样需要**重启 `dsh web`**。只刷新浏览器页面不会重新拉插件。

## 使用

- 左侧短横线对应每一轮用户提问；当前可见轮次的横线更长
- 悬停查看该轮问题与回复摘要，点击滚动到对应消息
- 无会话或空会话时横线轨自动隐藏

## 工作原理

1. 通过 `ctx.sessions` 服务读取当前会话的 `ConversationSnapshot`
2. 遍历 `snapshot.chat.order`，每个可见 `user` 节点生成一条横线，后续第一条有正文的 `assistant-step` 作为预览
3. 点击时定位到 chat 视图渲染的 `[data-chat-anchor-key]` DOM 行，`scrollIntoView` 平滑滚动
4. 会话 `open` 之后循环 `session.loadOlder()`（每页 50 条消息，最多 80 页），让 `hasMore` 变为 false，ChatView 不再渲染「加载更早」

## 已知限制

- 仅支持 Web GUI 平台（`platform: "web"`），不支持 TUI / headless
- 超大会话会在 80 页（约 4000 条消息）处停止继续拉取，避免拖死标签页
- 侧边栏 shell 无对外可注册的 slot，本插件采用 DOM 级注入；DSH 布局 DOM 若大幅变更可能需要适配

## 开发

本地改代码时用 `link:` 指向检出目录（不经过 npm / GitHub）：

```sh
dsh plugin --profile web add link:$(pwd)
```

改 `lib/client.js` 后重启 `dsh web` 即生效。

## 许可

MIT
