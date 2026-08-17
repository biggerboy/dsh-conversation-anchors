# @biggerboy123/dsh-conversation-anchors

会话锚点导航插件 —— 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 提供侧边栏对话目录：把当前会话的每一轮对话（用户提问、助手回复、工具调用、命令等）做成锚点列表，点击即可平滑滚动定位到对话中的对应位置。

纯浏览器端插件，以树外（out-of-tree）bundle 的形式安装，不修改 DSH 源码。host 半部分为无操作占位，全部行为在浏览器半部分（`./client`）实现。

## 功能

- **逐节点锚点**：会话中每个可见节点生成一条锚点（用户消息 / 助手回复 / 工具调用 / 命令 / 上下文等），带角色徽标与摘要文本
- **点击定位**：点击锚点平滑滚动到 `[data-chat-anchor-key]` 对应行
- **实时刷新**：订阅当前会话快照，新消息 / 新回复到达时锚点列表自动更新
- **切换会话自适应**：跟随 `ctx.sessions` 的当前会话选择，切换会话即切换锚点
- **DOM 级注入 + 自愈**：注入到侧边栏「新会话」按钮下方，MutationObserver 自愈 React 重渲染

## 安装

需要 Node `^22.19 || >=24` 和 `dsh` CLI（`npm i -g @deepseek-ai/dsh@next`）。

```sh
dsh plugin --profile web add @biggerboy123/dsh-conversation-anchors
```

安装后**重启 `dsh web`**，侧边栏即出现「对话锚点」区块。

## 使用

- 侧边栏「对话锚点」区块列出当前会话的锚点，每条显示角色徽标（你 / AI / 🔧 工具 / 命令 等）+ 摘要文本
- 点击任意锚点，右侧对话区平滑滚动到对应消息
- 无会话或空会话时显示「暂无对话」

## 工作原理

1. 通过 `ctx.sessions` 服务读取当前会话的 `ConversationSnapshot`
2. 遍历 `snapshot.chat.order`（对话节点有序 key 列表），经 `chat.nodes.get(key)` 取得每个节点的 `kind` 与 `data`
3. 从节点数据提取摘要文本（user 消息取正文、assistant 取回复正文、工具取工具名等）
4. 点击时定位到 chat 视图渲染的 `[data-chat-anchor-key]` DOM 行，`scrollIntoView` 平滑滚动

## 已知限制

- 仅支持 Web GUI 平台（`platform: "web"`），不支持 TUI / headless
- 锚点摘要对长文本截断至约 60 字符，完整内容仍在对话区可见
- 历史窗口未加载的旧节点不会出现在锚点列表（与对话区的分页加载一致）
- 侧边栏 shell 无对外可注册的 slot，本插件采用 DOM 级注入；DSH 布局 DOM 若大幅变更可能需要适配（当前兼容 `data-pane` 与 `.centerCol` 两种中心列）

## 开发

```sh
# 本地 link 安装（改代码后重启 web 即生效）
dsh plugin --profile web add link:$(pwd)
```

## 许可

MIT
