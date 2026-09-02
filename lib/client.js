/**
 * dsh-conversation-anchors — browser half.
 *
 * Injects a conversation tick rail into the conversation pane (not the app
 * sidebar): one short dash per user-sent message. Codex (default) sits on
 * the left with a diamond hover wave and a floating preview card. DeepSeek
 * sits on the right with equal-length ticks and an expanding title panel.
 * Style is chosen in Settings → General. Clicking a tick scrolls to that
 * node's `[data-chat-anchor-key]` row. When DSH exposes `turnOutline` +
 * `loadThrough` (0.1.2-alpha.3+), the rail lists the whole session and
 * pages on demand; older hosts still drain `session.loadOlder()`.
 *
 * Mechanism notes:
 * - The conversation column has no additive slot for a left rail, so the
 *   outline is injected at the DOM level onto ConversationRoot (the parent of
 *   `[data-conversation-scroll]`), with a MutationObserver self-heal against
 *   React re-renders.
 * - Anchor data is read from the live session through `ctx.sessions`.
 *
 * Failure policy: DOM/rendering problems are logged, never thrown — an
 * external plugin must not take the web GUI down.
 *
 * DSH Web loads this file as a classic script, not ESM. The bundle must
 * register its CJS factory via window.__ModuleLoader__.load({id, factory})
 * using the npm package name as id (must match cordis.patch.yml `name`),
 * or the shell reports:
 * "loaded without registering ... via __ModuleLoader__.load".
 */
window.__ModuleLoader__.load({
  id: '@biggerboy123/dsh-conversation-anchors',
  factory: (_require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

/** ConversationRoot: parent of the transcript scrollport. */
function conversationHost() {
  const scroll = document.querySelector('[data-conversation-scroll]')
  const host = scroll?.parentElement
  return host instanceof HTMLElement ? host : undefined
}

const PLUGIN_VERSION = '0.1.17'

/** Host settings namespace (must match lib/index.js). */
const SETTINGS_NS = 'conversation-anchors'

/** DSH 0.1.2+ Chat settings namespace (`transcriptView`: normal | compact). */
const OFFICIAL_CHAT_SETTINGS_NS = 'ui-chat'

/** Durable field inside that namespace. */
const STYLE_FIELD = 'style'

/** Fallback when Host settings are unavailable. */
const LOCAL_STYLE_KEY = 'dsh-conversation-anchors:style'

/** Default keeps the Codex left rail that existing installs already use. */
const DEFAULT_STYLE = 'codex'

/** DeepSeek overflow tooltip: wait so it does not flash on every pass. */
const DEEPSEEK_TIP_DELAY = 800

/** Vertical inset when centering the rail slot inside the conversation pane. */
const RAIL_PANE_INSET = 24

/** Floor so a tiny pane still has a usable tick column. */
const RAIL_MIN_SLOT = 96

/** DeepSeek max rail height as a fraction of the conversation pane. */
const DEEPSEEK_MAX_PANE_RATIO = 0.3

/** Codex max rail height as a fraction of the conversation pane. */
const CODEX_MAX_PANE_RATIO = 0.7

/** Codex hover step chevron row height (overlay; does not permanently shrink the tick column). */
const CODEX_STEP_ROW_PX = 20

/**
 * Cap the rail slot by style-specific pane percentage (responsive).
 * DeepSeek 10% / Codex 70% — not content-sized and not a fixed px.
 */
function computeRailSlotCap(paneH, style = getStyle()) {
  if (!Number.isFinite(paneH) || paneH <= 0) return RAIL_MIN_SLOT
  const ratio = style === 'codex' ? CODEX_MAX_PANE_RATIO : DEEPSEEK_MAX_PANE_RATIO
  const byRatio = Math.round(paneH * ratio)
  const byInset = Math.round(paneH - RAIL_PANE_INSET * 2)
  return Math.max(RAIL_MIN_SLOT, Math.min(byRatio, byInset))
}

/** Match DSH ChatView: within this distance of the floor counts as "at bottom". */
const FOLLOW_THRESHOLD = 24

/** While a turn is streaming, allow extra slack before leaving bottom-follow mode. */
const RUNNING_BOTTOM_SLACK = 96

/** Collapsed rail width: tick + right gutter so the overlay bar does not shove ticks. */
const DEEPSEEK_RAIL_PX = 32

/** Hover panel width (grows left from the rail). */
const DEEPSEEK_PANEL_PX = 252

/** Hard cap on eager `loadOlder` pages (50 messages each) so a huge log cannot hang the tab. */
const MAX_OLDER_PAGES = 80

/** Official ChatView paging labels, plus the colloquial "load more" the user expects. */
const OLDER_LABELS = new Set(['加载更早', 'Load earlier', '加载更多', 'Load more', 'Load older'])

/** DSH IconChevronDownOutline14 path — thin chevron, not a filled triangle. */
const CHEVRON_DOWN_PATH = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

/** Build the 14×14 outline chevron used by native Think / DisclosureRow. */
function chevronDownSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', CHEVRON_DOWN_PATH)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

/** Collapse whitespace in a summary string; keep the full title for hover. */
function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** Truncate preview copy for the hover card body. */
function clipPreview(text, max) {
  const value = normalizeText(text)
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + '…'
}

/** Surface-copy dictionaries (zh key source, en mirrors every key). */
const zh = {
  'title': '对话锚点',
  'empty': '暂无消息',
  'image': '图片',
  'you': '你',
  'process': '思考过程',
  'steps': '· {count} 步',
  'processExpand': '展开思考过程',
  'processCollapse': '收起思考过程',
  'railKeys': '方向键或 j/k 跳转，Home/End 到两端',
  'drainWait': '正在拉齐历史…',
  'drainProgress': '正在拉齐历史… {page}/{max}',
  'drainCapped': '历史已拉到上限（{max} 页）',
  'styleTitle': '锚点风格',
  'styleDesc': '默认 Codex 左侧短横线。选 DSH 官方则使用内置右侧轨（需 DSH 0.1.2+）。DeepSeek 为展开标题面板。',
  'styleCodex': 'Codex（左侧）',
  'styleDeepseek': 'DeepSeek（右侧）',
  'styleOfficial': 'DSH 官方（右侧）',
  'turnN': '第 {n} 轮',
  'jumpLoad': '加载并跳转到第 {n} 轮',
  'jumping': '正在加载第 {n} 轮…',
  'stepUp': '上一轮对话',
  'stepDown': '下一轮对话',
  'stepAtFirst': '已到第一轮对话',
  'stepAtLast': '已到最后一轮对话',
}

const en = {
  'title': 'Anchors',
  'empty': 'No messages',
  'image': 'Image',
  'you': 'You',
  'process': 'Thinking',
  'steps': '· {count} steps',
  'processExpand': 'Expand thinking',
  'processCollapse': 'Collapse thinking',
  'railKeys': 'Arrow keys or j/k to jump, Home/End for ends',
  'drainWait': 'Loading earlier…',
  'drainProgress': 'Loading earlier… {page}/{max}',
  'drainCapped': 'Stopped at {max} history pages',
  'styleTitle': 'Anchor style',
  'styleDesc': 'Codex left-rail by default. DSH built-in uses the native right rail (DSH 0.1.2+). DeepSeek expands a title panel.',
  'styleCodex': 'Codex (left)',
  'styleDeepseek': 'DeepSeek (right)',
  'styleOfficial': 'DSH built-in (right)',
  'turnN': 'Turn {n}',
  'jumpLoad': 'Load and jump to turn {n}',
  'jumping': 'Loading turn {n}…',
  'stepUp': 'Previous turn',
  'stepDown': 'Next turn',
  'stepAtFirst': 'Already at the first turn',
  'stepAtLast': 'Already at the last turn',
}

/** Active dictionary, picked by the document language at call time. */
function dictionary() {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/** Translate a key with optional {name} template params. */
function t(key, values) {
  const dict = dictionary()
  let text = dict[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Normalize a stored value to one of the rail styles. */
function normalizeStyle(value) {
  if (value === 'deepseek') return 'deepseek'
  if (value === 'official') return 'official'
  return DEFAULT_STYLE
}

/** Label for the settings dropdown and trigger. */
function styleLabel(style) {
  if (style === 'deepseek') return t('styleDeepseek')
  if (style === 'official') return t('styleOfficial')
  return t('styleCodex')
}

/** Mirror style on `<html>` so injected CSS can hide the built-in TurnNavigator. */
function syncRailStyleMarker() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-dsh-anchors-rail-style', getStyle())
}

/** Read the last locally cached style (Host settings may still be loading). */
function readLocalStyle() {
  try {
    return normalizeStyle(window.localStorage?.getItem(LOCAL_STYLE_KEY))
  } catch {
    return DEFAULT_STYLE
  }
}

/** Mirror the chosen style so a missing settings provider still remembers it. */
function writeLocalStyle(style) {
  try {
    window.localStorage?.setItem(LOCAL_STYLE_KEY, style)
  } catch { /* private mode / blocked storage */ }
}

const styleListeners = new Set()
let cachedStyle = readLocalStyle()
let styleScope
/** In-flight user choice until Host confirms the same value (avoids revert on failed writes). */
let pendingStyle = null

/** True when this browser has an explicit cached style choice. */
function hasLocalStyleChoice() {
  try {
    return window.localStorage?.getItem(LOCAL_STYLE_KEY) !== null
  } catch {
    return false
  }
}

/** Current rail style (`codex` | `deepseek` | `official`). */
function getStyle() {
  return cachedStyle
}

/** Codex / DeepSeek rails only help when there are 2+ turns to jump between. */
function shouldHidePluginRail(anchors) {
  if (getStyle() === 'official') return anchors.length === 0
  return anchors.length <= 1
}

/** Subscribe to live style changes. */
function subscribeStyle(listener) {
  styleListeners.add(listener)
  return () => { styleListeners.delete(listener) }
}

/** Publish a style and notify the rail + settings row. */
function applyStyleValue(next) {
  const style = normalizeStyle(next)
  if (style === cachedStyle) return
  cachedStyle = style
  writeLocalStyle(style)
  syncRailStyleMarker()
  for (const listener of styleListeners) {
    try { listener() } catch { /* a listener must not take the plugin down */ }
  }
}

/** Pick style from scope snapshot, else local cache; never silently drop a local choice. */
function styleFromSnapshot(snapshot) {
  if (pendingStyle !== null) return pendingStyle
  const hostStyle = snapshot?.status === 'ready' && snapshot.value !== undefined && snapshot.value !== null
    ? normalizeStyle(snapshot.value[STYLE_FIELD])
    : undefined
  const localStyle = readLocalStyle()
  if (hasLocalStyleChoice() && hostStyle !== undefined && localStyle !== hostStyle) {
    return localStyle
  }
  if (hostStyle !== undefined) return hostStyle
  return localStyle
}

/** Persist a user choice: optimistic local update, then Host write when possible. */
function setRailStyle(style) {
  const next = normalizeStyle(style)
  pendingStyle = next
  applyStyleValue(next)
  if (styleScope !== undefined && typeof styleScope.set === 'function') {
    void styleScope.set(STYLE_FIELD, next).finally(() => {
      const snap = styleScope.getSnapshot()
      const hostStyle = snap?.status === 'ready' && snap.value !== undefined && snap.value !== null
        ? normalizeStyle(snap.value[STYLE_FIELD])
        : undefined
      if (hostStyle === next) pendingStyle = null
      else if (pendingStyle === next) {
        console.warn(
          `[dsh-conversation-anchors] host kept style=${hostStyle ?? '?'} (wanted ${next}); using local. Restart \`dsh web\` if this persists.`,
        )
      }
    }).catch((error) => {
      console.warn('[dsh-conversation-anchors] failed to persist style:', error)
    })
  }
}

/** Bind `ctx.settingsScope` when the settings domain is present. */
function bindStyleScope(ctx) {
  if (typeof ctx?.settingsScope?.bind !== 'function') return undefined
  try {
    const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS })
    styleScope = scope
    const sync = () => { applyStyleValue(styleFromSnapshot(scope.getSnapshot())) }
    const pushLocalIfNeeded = () => {
      if (!hasLocalStyleChoice()) return
      const snap = scope.getSnapshot()
      if (snap?.status !== 'ready' || snap.writable !== true) return
      const localStyle = readLocalStyle()
      const hostStyle = normalizeStyle(snap.value?.[STYLE_FIELD])
      if (localStyle !== hostStyle && pendingStyle === null) setRailStyle(localStyle)
    }
    sync()
    pushLocalIfNeeded()
    const dispose = scope.subscribe(() => {
      sync()
      pushLocalIfNeeded()
    })
    return dispose
  } catch (error) {
    console.warn('[dsh-conversation-anchors] settings bind failed:', error)
    return undefined
  }
}

/** True when the event target is an editable field (composer, search, etc.). */
function isTypingTarget(target) {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]') !== null
}

/** Extract preview text from a user message node. */
function nodeSummary(node) {
  const data = node?.data
  const content = Array.isArray(data?.content) ? data.content : []
  const text = normalizeText(
    content
      .filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' '),
  )
  if (text !== '') return text
  if (content.some((b) => b !== null && typeof b === 'object' && b.type === 'image')) return t('image')
  return t('you')
}

/** Extract a short text preview from an assistant node's blocks. */
function assistantSummary(node) {
  const data = node?.data
  const blocks = Array.isArray(data?.blocks) ? data.blocks : []
  const text = normalizeText(
    blocks
      .filter((b) => b !== null && typeof b === 'object' && b.kind === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' '),
  )
  if (text !== '') return text
  const tools = blocks
    .filter((b) => b !== null && typeof b === 'object' && b.kind === 'tool-call' && typeof b.name === 'string')
    .map((b) => b.name)
  if (tools.length > 0) return '🔧 ' + tools.join(', ')
  return ''
}

/**
 * Build the ordered anchor list, one entry per user turn. Each turn carries
 * the user question and, when the following assistant turn produced text or
 * tool calls, a short answer preview for richer navigation.
 * Falls back to the same navigation projection DSH uses for the official rail.
 * @param chat - Chat target snapshot from uiConversation.
 * @returns {Array<{id: string, turn: number, key?: string, seq?: number, loaded: boolean, summary: string, answer: string}>}
 */
function buildAnchorsFromNavigation(chat) {
  const items = chat?.navigation?.items?.()
  if (!Array.isArray(items) || items.length === 0) return []
  return items.map((item) => {
    const turn = typeof item.turn === 'number' ? item.turn : 0
    const key = typeof item.anchorKey === 'string' ? item.anchorKey : undefined
    return {
      id: key ?? `turn:${turn}`,
      turn,
      key,
      loaded: typeof key === 'string',
      summary: normalizeText(item.prompt) || t('turnN', { n: turn }),
      answer: normalizeText(item.response),
    }
  })
}

function buildAnchorsFromOrder(chat) {
  const order = chat?.order
  const nodes = chat?.nodes
  if (!Array.isArray(order) || nodes === undefined) return []
  const anchors = []
  let current = null
  for (const key of order) {
    const node = nodes.get?.(key)
    if (node === undefined || node === null) continue
    if (node.visibility === 'hidden') continue
    const kind = node.kind
    if (kind === 'user') {
      const anchorKey = typeof node.key === 'string' ? node.key : key
      const loc = node.location
      const turn = (loc?.kind === 'turn' || loc?.kind === 'step')
        ? loc.turn.turn
        : anchors.length + 1
      current = {
        id: anchorKey,
        turn,
        key: anchorKey,
        loaded: true,
        summary: nodeSummary(node),
        answer: '',
      }
      anchors.push(current)
      continue
    }
    if (kind === 'assistant-step' && current !== null) {
      const preview = assistantSummary(node)
      if (preview !== '') current.answer = preview
    }
  }
  return anchors
}

function buildAnchors(chat) {
  const fromOrder = buildAnchorsFromOrder(chat)
  if (fromOrder.length > 0) return fromOrder
  return buildAnchorsFromNavigation(chat)
}

/** Wire `turnOutline` entry, or undefined when malformed. */
function outlineEntry(value) {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value
  if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined
  if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0) return undefined
  return {
    turn: entry.turn,
    seq: entry.seq,
    prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
    response: typeof entry.response === 'string' ? entry.response : '',
  }
}

/**
 * Merge host `turnOutline` with loaded-window anchors (DSH 0.1.2-alpha.3+).
 * Loaded wins on the same turn; outline fills unloaded marks with jump seqs.
 */
function mergeAnchorsWithOutline(loaded, outline) {
  const byTurn = new Map()
  const rows = Array.isArray(outline) ? outline : []
  for (const raw of rows) {
    const entry = outlineEntry(raw)
    if (entry === undefined) continue
    byTurn.set(entry.turn, {
      id: `turn:${entry.turn}`,
      turn: entry.turn,
      seq: entry.seq,
      loaded: false,
      summary: normalizeText(entry.prompt) || t('turnN', { n: entry.turn }),
      answer: normalizeText(entry.response),
    })
  }
  for (const item of loaded) {
    const prev = byTurn.get(item.turn)
    const key = typeof item.key === 'string' ? item.key : undefined
    byTurn.set(item.turn, {
      id: key ?? item.id ?? `turn:${item.turn}`,
      turn: item.turn,
      key,
      loaded: typeof key === 'string',
      summary: item.summary !== '' ? item.summary : (prev?.summary ?? t('turnN', { n: item.turn })),
      answer: item.answer !== '' ? item.answer : (prev?.answer ?? ''),
    })
  }
  if (byTurn.size === 0) return []
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
}

/** Resolve a loaded turn's scroll key from the live Chat snapshot (same rules as the host rail). */
function loadedTurnAnchor(chat, turn) {
  if (chat === undefined || typeof turn !== 'number') return undefined
  const items = chat.navigation?.items?.()
  if (Array.isArray(items)) {
    const hit = items.find((item) => item.turn === turn)
    if (typeof hit?.anchorKey === 'string') {
      return { key: hit.anchorKey, loaded: true }
    }
  }
  const keys = chat.locations?.getTurn?.(turn)
  if (Array.isArray(keys)) {
    for (const nodeKey of keys) {
      const node = chat.nodes?.get?.(nodeKey)
      if (node === undefined || node === null || node.visibility === 'hidden') continue
      if (node.kind === 'user') {
        const key = typeof node.key === 'string' ? node.key : nodeKey
        return { key, loaded: true }
      }
    }
  }
  // Locations index can lag behind order/nodes on the first paint after open.
  const order = chat.order
  const nodes = chat.nodes
  if (Array.isArray(order) && nodes !== undefined) {
    for (const nodeKey of order) {
      const node = nodes.get?.(nodeKey)
      if (node === undefined || node === null || node.visibility === 'hidden') continue
      if (node.kind !== 'user') continue
      const loc = node.location
      const nodeTurn = (loc?.kind === 'turn' || loc?.kind === 'step') ? loc.turn.turn : undefined
      if (nodeTurn !== turn) continue
      const key = typeof node.key === 'string' ? node.key : nodeKey
      return { key, loaded: true }
    }
  }
  return undefined
}

/** Prefer the loaded-window source that covers the most turns with real anchor keys. */
function buildLoadedAnchors(chat) {
  const fromNav = buildAnchorsFromNavigation(chat)
  const fromOrder = buildAnchorsFromOrder(chat)
  if (fromOrder.length > fromNav.length) return fromOrder
  if (fromNav.length > 0) return fromNav
  return fromOrder
}

/** Reconcile outline rows against the live Chat index so in-window turns are not left `unloaded`. */
function reconcileOutlineAnchors(merged, chat) {
  if (chat === undefined) return merged
  return merged.map((anchor) => {
    if (anchor.loaded) return anchor
    const hit = loadedTurnAnchor(chat, anchor.turn)
    if (hit === undefined) return anchor
    return {
      ...anchor,
      id: hit.key ?? anchor.id,
      key: hit.key,
      loaded: true,
    }
  })
}

/** `session.projections.faceOf('turnOutline')` when the projection is present. */
function turnOutlineFace(session) {
  try {
    const face = session?.projections?.faceOf?.('turnOutline')
    if (face === undefined || typeof face.getSnapshot !== 'function') return undefined
    return face
  } catch {
    return undefined
  }
}

/** True when this session can serve a whole-log turn outline (alpha.3+). */
function hasTurnOutlineCapability(session) {
  return turnOutlineFace(session) !== undefined
}

/** Snapshot value of `turnOutline`, or undefined when absent. */
function readTurnOutline(session) {
  const face = turnOutlineFace(session)
  if (face === undefined) return undefined
  try {
    return face.getSnapshot()
  } catch {
    return undefined
  }
}

/** Build rail anchors: outline merge when available, else loaded-window only. */
function buildRailAnchors(ctx, sessionId, session) {
  const chat = readChatSnapshot(ctx, sessionId)
  if (!hasTurnOutlineCapability(session)) {
    return chat === undefined ? [] : buildAnchors(chat)
  }
  const snap = session?.getSnapshot?.()
  let loaded = chat === undefined ? [] : buildLoadedAnchors(chat)
  // While the session is still opening, paint only the loaded window — outline-only
  // ticks would all look "unloaded" (short) before chat/locations settle.
  if (snap?.openState !== 'open') {
    return loaded
  }
  const merged = mergeAnchorsWithOutline(loaded, readTurnOutline(session))
  return reconcileOutlineAnchors(merged, chat)
}

/** Live Chat target for one session (DSH 0.1.2+ keeps chat off SessionSnapshot). */
function chatTarget(ctx, sessionId) {
  if (sessionId === undefined || typeof ctx?.uiConversation?.binding !== 'function') return undefined
  try {
    return ctx.uiConversation.binding(sessionId).target('chat')
  } catch {
    return undefined
  }
}

/** Read the Chat snapshot used to paint anchor ticks. */
function readChatSnapshot(ctx, sessionId) {
  if (sessionId === undefined) return undefined
  const target = chatTarget(ctx, sessionId)
  if (target !== undefined && typeof target.getSnapshot === 'function') {
    return target.getSnapshot() ?? undefined
  }
  const legacy = ctx.sessions?.binding?.(sessionId)?.session?.getSnapshot?.()
  return legacy?.chat
}

/** Conversation column scroller (not the window — the shell is overflow:hidden). */
function conversationScroll() {
  const node = document.querySelector('[data-conversation-scroll]')
  return node instanceof HTMLElement ? node : undefined
}

/** The rendered chat row for `key`, skipping display:none process-fold targets. */
function findAnchorRow(key) {
  const scroll = conversationScroll()
  const scope = scroll ?? document
  for (const row of scope.querySelectorAll('[data-chat-anchor-key]')) {
    if (row.getAttribute('data-chat-anchor-key') !== key) continue
    if (!(row instanceof HTMLElement)) continue
    if (row.getClientRects().length === 0) continue
    return row
  }
  return undefined
}

/** Scroll the conversation to the node identified by `key`. */
function scrollToAnchor(key) {
  if (typeof key !== 'string') return false
  const row = findAnchorRow(key)
  if (row === undefined) return false
  const scroll = conversationScroll() ?? row.closest('[data-conversation-scroll]')
  if (scroll instanceof HTMLElement) {
    const top = scroll.scrollTop + row.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    return true
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

/**
 * Resolve the anchor key currently nearest the top of the conversation
 * scrollport. Mirrors the chat view's pagingAnchor: hit-test a few points down
 * the viewport with elementsFromPoint, then fall back to the first row whose
 * box crosses the viewport top.
 * @param scroll - the conversation scrollport element.
 * @returns {string | undefined} the visible anchor key, or undefined.
 */
function visibleAnchorKey(scroll) {
  if (!(scroll instanceof HTMLElement)) return undefined
  const viewport = scroll.getBoundingClientRect()
  const composer = scroll.querySelector('[data-composer-seat]')
  const visibleBottom = composer instanceof HTMLElement
    ? composer.getBoundingClientRect().top
    : viewport.bottom
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const left = viewport.left + 4
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(48, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(left, viewport.top + offset)) {
        const row = element instanceof HTMLElement ? element.closest('[data-chat-anchor-key]') : null
        if (row !== null && scroll.contains(row)) {
          const key = row.getAttribute('data-chat-anchor-key')
          if (typeof key === 'string') return key
        }
      }
    }
  }
  const rows = [...scroll.querySelectorAll('[data-chat-anchor-key]')]
  const hit = rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return hit?.getAttribute('data-chat-anchor-key') ?? undefined
}

/** True when the conversation scroller is pinned to (or near) the bottom. */
function scrollPinnedToBottom(scroll, threshold = FOLLOW_THRESHOLD) {
  if (!(scroll instanceof HTMLElement)) return false
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= threshold + 1
}

/** Signature of rail structure — turns, keys, loaded flags (not preview text). */
function anchorsStructureSig(anchors) {
  return anchors.map((anchor) => [
    anchor.turn,
    anchor.loaded ? 1 : 0,
    anchor.key ?? '',
    anchor.id,
    anchor.seq ?? '',
  ].join(':')).join('|')
}

/** Styles injected once with the outline. */
function injectStyle() {
  const id = 'dsh-anchors-style'
  let style = document.getElementById(id)
  if (style === null) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  style.textContent = [
    ':root{',
    '--dsh-anchors-tick:rgba(140,140,140,.5);',
    '--dsh-anchors-tick-mid:rgba(140,140,140,.75);',
    '--dsh-anchors-tick-strong:#1a1a1a;',
    '--dsh-anchors-tip-bg:#fff;',
    '--dsh-anchors-tip-title:#111;',
    '--dsh-anchors-tip-body:#6b6b6b;',
    '--dsh-anchors-tip-shadow:0 8px 28px rgba(0,0,0,.14),0 0 0 1px rgba(0,0,0,.06);',
    '--dsh-anchors-ds-tick:rgba(140,140,140,.45);',
    '--dsh-anchors-ds-tick-active:var(--dsw-static-deepseek-500,#4176e6);',
    '--dsh-anchors-ds-label:#8b8b8b;',
    '--dsh-anchors-ds-label-active:var(--dsw-static-deepseek-500,#4176e6);',
    '--dsh-anchors-ds-label-hover:#1a1a1a;',
    '--dsh-anchors-ds-tick-hover:#1a1a1a;',
    '--dsh-anchors-ds-panel-bg:#fff;',
    '--dsh-anchors-ds-panel-shadow:0 8px 28px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.05);',
    '}',
    'body[data-ds-dark-theme],html[data-ds-dark-theme]{',
    '--dsh-anchors-tick:rgba(255,255,255,.32);',
    '--dsh-anchors-tick-mid:rgba(255,255,255,.58);',
    '--dsh-anchors-tick-strong:#fff;',
    '--dsh-anchors-tip-bg:var(--dsw-alias-tooltip-bg,#3c3c3e);',
    '--dsh-anchors-tip-title:#f3f3f3;',
    '--dsh-anchors-tip-body:#c8c8c8;',
    '--dsh-anchors-tip-shadow:0 8px 28px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08);',
    '--dsh-anchors-ds-tick:rgba(255,255,255,.32);',
    '--dsh-anchors-ds-tick-active:var(--dsw-static-deepseek-400,#679efe);',
    '--dsh-anchors-ds-label:rgba(255,255,255,.55);',
    '--dsh-anchors-ds-label-active:var(--dsw-static-deepseek-400,#679efe);',
    '--dsh-anchors-ds-label-hover:#f3f3f3;',
    '--dsh-anchors-ds-tick-hover:#fff;',
    '--dsh-anchors-ds-panel-bg:var(--dsw-alias-tooltip-bg,#3c3c3e);',
    '--dsh-anchors-ds-panel-shadow:0 8px 28px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08);',
    '}',
    '[data-phase="hero"] [data-dsh-anchors-outline]{display:none;}',
    '[data-dsh-anchors-outline][hidden]{display:none!important;}',
    '[data-dsh-anchors-outline][data-empty]:not([data-draining]){display:none!important;}',
    '[data-dsh-process-hide],[data-dsh-hide-older]{display:none!important;}',
    '[data-dsh-process-toggle]{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:2px 0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);font:inherit;font-size:14px;line-height:24px;text-align:left;cursor:pointer;}',
    '[data-dsh-process-toggle]:hover{color:var(--dsw-alias-label-secondary,#666);}',
    '[data-dsh-process-toggle] [data-dsh-process-label]{font-weight:400;}',
    '[data-dsh-process-toggle] [data-dsh-process-count]{opacity:.8;}',
    '[data-dsh-process-toggle] [data-dsh-process-chevron]{flex:none;display:inline-flex;align-items:center;color:currentColor;transition:transform .12s;}',
    '[data-dsh-process-toggle] [data-dsh-process-chevron] svg{display:block;width:14px;height:14px;}',
    '[data-dsh-process-toggle][aria-expanded="true"] [data-dsh-process-chevron]{transform:rotate(180deg);}',
    'html[data-dsh-anchors-rail-style]:not([data-dsh-anchors-rail-style="official"]) [data-conversation-scroll] nav[aria-label="轮次导航"],',
    'html[data-dsh-anchors-rail-style]:not([data-dsh-anchors-rail-style="official"]) [data-conversation-scroll] nav[aria-label="Turn navigation"]{display:none!important;pointer-events:none!important;}',
    '[data-dsh-anchors-outline]{box-sizing:border-box;position:fixed;z-index:20;display:flex;flex-direction:column;justify-content:center;margin:0;padding:0;border:0;background:transparent;pointer-events:none;overflow:visible;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list]::-webkit-scrollbar,[data-dsh-anchors-outline] [data-dsh-anchors-scroller]::-webkit-scrollbar{width:0;height:0;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list]::-webkit-scrollbar,[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-scroller]::-webkit-scrollbar{display:none;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item]:focus,[data-dsh-anchors-outline] [data-dsh-anchors-item]:focus-visible,[data-dsh-anchors-outline] [data-dsh-anchors-list]:focus,[data-dsh-anchors-outline] [data-dsh-anchors-list]:focus-visible{outline:none;box-shadow:none;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-empty]{display:none;}',
    '[data-dsh-anchors-status]{position:absolute;bottom:8px;z-index:4;box-sizing:border-box;max-width:min(280px,calc(100vw - 48px));padding:4px 8px;border-radius:8px;background:var(--dsh-anchors-tip-bg);color:var(--dsh-anchors-tip-body);font-size:12px;line-height:18px;white-space:nowrap;pointer-events:none;box-shadow:var(--dsh-anchors-tip-shadow);}',
    '[data-dsh-anchors-status][hidden]{display:none!important;}',
    '[data-dsh-anchors-tip]{position:fixed;z-index:10000;box-sizing:border-box;width:min(280px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;background:var(--dsh-anchors-tip-bg);color:var(--dsh-anchors-tip-title);border:0;font-size:12px;line-height:18px;box-shadow:var(--dsh-anchors-tip-shadow);pointer-events:none;}',
    '[data-dsh-anchors-tip][data-compact]{width:auto;max-width:max-content;padding:5px 9px;border-radius:8px;white-space:nowrap;}',
    '[data-dsh-anchors-tip][data-compact] [data-dsh-anchors-tip-title]{display:block;font-size:12px;line-height:16px;font-weight:500;-webkit-line-clamp:unset;overflow:visible;white-space:nowrap;}',
    '[data-dsh-anchors-tip-title]{font-size:13px;line-height:18px;font-weight:650;color:var(--dsh-anchors-tip-title);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}',
    '[data-dsh-anchors-tip][data-overflow]{background:#1a1a1a;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
    '[data-dsh-anchors-tip][data-overflow] [data-dsh-anchors-tip-title]{display:block;-webkit-line-clamp:unset;white-space:normal;overflow-wrap:anywhere;font-weight:400;color:#fff;}',
    '[data-dsh-anchors-tip-body]{margin-top:4px;font-size:12px;line-height:17px;font-weight:400;color:var(--dsh-anchors-tip-body);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}',
    '[data-dsh-anchors-style-row]{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex;}',
    '[data-dsh-anchors-style-text]{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex;}',
    '[data-dsh-anchors-style-title]{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px;}',
    '[data-dsh-anchors-style-desc]{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;}',
    '[data-dsh-anchors-style-select]{appearance:none;background:var(--dsw-alias-bg-module-platform);height:36px;min-width:168px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;outline:none;box-shadow:none;}',
    '[data-dsh-anchors-style-select]:hover{background:var(--dsw-alias-interactive-bg-hover);}',
    '[data-dsh-anchors-style-select]:focus,[data-dsh-anchors-style-select]:focus-visible{outline:none;box-shadow:none;border:none;}',
    '[data-dsh-anchors-style-chevron]{flex:none;display:block;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#8b8b8b);}',
    '[data-dsh-anchors-style-menu]{box-sizing:border-box;z-index:10050;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.06));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08));}',
    '[data-dsh-anchors-style-option]{box-sizing:border-box;width:100%;height:36px;margin:0;padding:0 12px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;}',
    '[data-dsh-anchors-style-option]:hover{background:var(--dsw-alias-interactive-bg-hover);}',
    '[data-dsh-anchors-style-check]{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-primary);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"]{left:8px;width:56px;align-items:stretch;overflow:visible;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-ds-bar]{display:none!important;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list]{box-sizing:border-box;position:relative;flex:1 1 auto;margin:0;min-height:0;height:100%;width:56px;display:flex;flex-direction:column;overflow:visible;pointer-events:auto;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]::before,[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]::after{content:"";position:absolute;left:0;width:56px;height:48px;pointer-events:auto;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]::before{top:-48px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]::after{bottom:-48px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-scroller]{flex:1 1 auto;min-height:0;width:56px;display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:6px 0;overflow-y:auto;overflow-x:visible;scrollbar-width:none;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step]{box-sizing:border-box;position:absolute;left:28px;z-index:2;display:none;align-items:center;justify-content:center;width:26px;height:26px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsh-anchors-tick);cursor:pointer;outline:none;box-shadow:none;transform:translateX(-50%);transition:background-color .12s ease,color .12s ease;-webkit-tap-highlight-color:transparent;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step="up"]{top:-48px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step="down"]{bottom:-48px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]:hover [data-dsh-anchors-codex-step],[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-rail-overflow]:focus-within [data-dsh-anchors-codex-step]{display:flex;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step]:hover:not([aria-disabled="true"]){background:rgba(128,128,128,.22);color:var(--dsh-anchors-tick-strong);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step][aria-disabled="true"]{opacity:.4;cursor:default;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step][aria-disabled="true"]:hover{background:rgba(128,128,128,.14);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step="up"] svg{transform:rotate(180deg);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-codex-step] svg{display:block;width:14px;height:14px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item]{box-sizing:border-box;display:flex;flex:none;flex-shrink:0;align-items:center;justify-content:flex-start;width:56px;height:11px;margin:0;padding:0 0 0 24px;border:0;background:transparent;cursor:pointer;outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-label]{display:none!important;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-tick]{display:block;width:8px;height:2.5px;border-radius:1px;background:var(--dsh-anchors-tick);transform-origin:left center;transition:width .14s ease,height .14s ease,background-color .14s ease;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item][data-active] [data-dsh-anchors-tick]{width:8px;height:2.5px;background:var(--dsh-anchors-tick-strong);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item][data-unloaded] [data-dsh-anchors-tick]{opacity:.55;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item][data-active][data-unloaded] [data-dsh-anchors-tick]{opacity:1;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item][data-busy] [data-dsh-anchors-tick]{animation:dshAnchorsBusy 1s ease-in-out infinite;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-active] [data-dsh-anchors-tick]{width:8px;height:2.5px;background:var(--dsh-anchors-tick);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="0"] [data-dsh-anchors-tick]{width:32px;height:3px;background:var(--dsh-anchors-tick-strong);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="1"] [data-dsh-anchors-tick]{width:24px;height:2.75px;background:var(--dsh-anchors-tick-mid);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="2"] [data-dsh-anchors-tick]{width:17px;height:2.5px;background:var(--dsh-anchors-tick-mid);opacity:.9;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="3"] [data-dsh-anchors-tick]{width:12px;height:2.5px;background:var(--dsh-anchors-tick);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="4"] [data-dsh-anchors-tick]{width:8px;height:2.5px;background:var(--dsh-anchors-tick);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="5"] [data-dsh-anchors-tick]{width:6px;height:2.5px;background:var(--dsh-anchors-tick);opacity:.8;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-item][data-flash] [data-dsh-anchors-tick]{animation:dshAnchorsFlash 1.2s ease-out;}',
    '@keyframes dshAnchorsFlash{0%{background:var(--dsw-static-deepseek-500,#38bdf8);}100%{background:var(--dsh-anchors-tick-strong);}}',
    '@keyframes dshAnchorsBusy{0%,100%{opacity:.35;}50%{opacity:1;}}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="codex"] [data-dsh-anchors-status]{left:40px;}',
    `[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"]{width:${DEEPSEEK_RAIL_PX}px;min-width:0;max-width:${DEEPSEEK_RAIL_PX}px;align-items:flex-end;overflow:visible;height:auto;max-height:none;}`,
    `[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]{box-sizing:border-box;position:absolute;right:0;top:0;bottom:0;left:auto;flex:none;margin:0;min-height:0;width:${DEEPSEEK_RAIL_PX}px;overflow:visible;pointer-events:auto;border-radius:20px;background:transparent;transition:width .16s ease,background-color .16s ease,box-shadow .16s ease;}`,
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-scroller]{box-sizing:border-box;height:100%;width:100%;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:8px 18px 8px 0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;transition:padding .16s ease;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-scroller]::-webkit-scrollbar{width:0;height:0;display:none;}',
    `[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover,[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within{width:${DEEPSEEK_PANEL_PX}px;background:var(--dsh-anchors-ds-panel-bg);box-shadow:var(--dsh-anchors-ds-panel-shadow);}`,
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover [data-dsh-anchors-scroller],[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within [data-dsh-anchors-scroller]{padding:8px 18px 8px 12px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-ds-bar]{display:none;position:absolute;right:5px;left:auto;top:10px;bottom:10px;width:6px;margin:0;padding:0;border:0;border-radius:6px;background:var(--dsh-anchors-ds-panel-bg);pointer-events:auto;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover [data-dsh-anchors-ds-bar]:not([hidden]),[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within [data-dsh-anchors-ds-bar]:not([hidden]){display:block;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-ds-thumb]{position:absolute;top:0;left:0;width:6px;min-height:16px;border-radius:6px;background:rgba(140,140,140,.28);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item]{box-sizing:border-box;display:flex;flex:none;align-items:center;justify-content:flex-end;gap:0;width:100%;height:26px;margin:0;padding:0;border:0;background:transparent;cursor:pointer;outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent;transition:gap .16s ease;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover [data-dsh-anchors-item],[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within [data-dsh-anchors-item]{gap:10px;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-label]{flex:1 1 auto;min-width:0;max-width:0;opacity:0;overflow:hidden;color:var(--dsh-anchors-ds-label);font-size:12px;line-height:18px;font-weight:400;text-align:left;white-space:nowrap;text-overflow:ellipsis;pointer-events:none;transition:max-width .16s ease,opacity .12s ease,color .12s ease;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover [data-dsh-anchors-label],[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within [data-dsh-anchors-label]{max-width:176px;opacity:1;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-active] [data-dsh-anchors-label]{color:var(--dsh-anchors-ds-label-active);font-weight:500;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item]:hover [data-dsh-anchors-label]{color:var(--dsh-anchors-ds-label-hover);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item]:hover [data-dsh-anchors-tick]{height:2.5px;background:var(--dsh-anchors-ds-tick-hover);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-active]:hover [data-dsh-anchors-label]{color:var(--dsh-anchors-ds-label-active);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-active]:hover [data-dsh-anchors-tick]{height:3px;background:var(--dsh-anchors-ds-tick-active);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-tick]{flex:none;display:block;width:10px;height:2px;border-radius:999px;background:var(--dsh-anchors-ds-tick);transition:height .12s ease,background-color .12s ease;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-active] [data-dsh-anchors-tick]{height:3px;background:var(--dsh-anchors-ds-tick-active);}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-unloaded] [data-dsh-anchors-tick]{opacity:.55;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-active][data-unloaded] [data-dsh-anchors-tick]{opacity:1;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-unloaded] [data-dsh-anchors-label]{color:var(--dsw-alias-label-tertiary,#999);opacity:1;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:hover [data-dsh-anchors-item][data-unloaded] [data-dsh-anchors-label],[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-list]:focus-within [data-dsh-anchors-item][data-unloaded] [data-dsh-anchors-label]{color:var(--dsh-anchors-ds-label);opacity:.78;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-busy] [data-dsh-anchors-tick]{animation:dshAnchorsBusy 1s ease-in-out infinite;}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-item][data-flash] [data-dsh-anchors-tick]{animation:dshAnchorsDsFlash 1.2s ease-out;}',
    '@keyframes dshAnchorsDsFlash{0%{background:var(--dsw-static-deepseek-300,#b7c8fe);}100%{background:var(--dsh-anchors-ds-tick-active);}}',
    '[data-dsh-anchors-outline][data-dsh-anchors-style="deepseek"] [data-dsh-anchors-status]{right:24px;}',
  ].join('\n')
}

/**
 * True when the session header is on the Trajectory tab (zh 轨迹 / en Trajectory).
 * Prefers the trajectory view's own scroll marker; falls back to the selected tab label.
 */
function isTrajectoryView(host) {
  if (!(host instanceof HTMLElement)) return false
  if (host.querySelector('[data-trajectory-scroll]') !== null) return true
  const selected = host.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')
  if (selected === null) return false
  const label = (selected.textContent ?? '').replace(/\s+/g, '').trim()
  return label === '轨迹' || /^trajectory$/i.test(label)
}

/** Measure collapsed DeepSeek tick column height (padding + rows + gaps). */
function measureDeepseekContentHeight(list) {
  if (!(list instanceof HTMLElement)) return 0
  const n = list.querySelectorAll('[data-dsh-anchors-item]').length
  if (n === 0) return 0
  return 16 + n * 26 + Math.max(0, n - 1) * 6
}

/** Measure Codex tick column height (padding + rows + gaps). */
function measureCodexContentHeight(list) {
  if (!(list instanceof HTMLElement)) return 0
  const n = list.querySelectorAll('[data-dsh-anchors-item]').length
  if (n === 0) return 0
  return 12 + n * 11 + Math.max(0, n - 1) * 4
}

/** Show Codex step buttons when ticks overflow; visible only while the rail is hovered. */
function paintCodexSteps(list) {
  if (!(list instanceof HTMLElement)) return
  const outline = list.parentElement
  const scroller = list.querySelector('[data-dsh-anchors-scroller]')
  const up = list.querySelector('[data-dsh-anchors-codex-step="up"]')
  const down = list.querySelector('[data-dsh-anchors-codex-step="down"]')
  if (!(scroller instanceof HTMLElement) || !(up instanceof HTMLButtonElement) || !(down instanceof HTMLButtonElement)) return
  if (outline?.getAttribute('data-dsh-anchors-style') !== 'codex') {
    list.removeAttribute('data-rail-overflow')
    up.hidden = true
    down.hidden = true
    return
  }
  const overflow = scroller.scrollHeight > scroller.clientHeight + 1
  list.toggleAttribute('data-rail-overflow', overflow)
  up.hidden = !overflow
  down.hidden = !overflow
  if (!overflow) {
    up.setAttribute('aria-disabled', 'true')
    down.setAttribute('aria-disabled', 'true')
    up.removeAttribute('title')
    down.removeAttribute('title')
    up.setAttribute('aria-label', t('stepAtFirst'))
    down.setAttribute('aria-label', t('stepAtLast'))
    return
  }
  const items = [...list.querySelectorAll('[data-dsh-anchors-item]')]
  let i = items.findIndex((item) => item.hasAttribute('data-active'))
  if (i < 0) {
    const focused = document.activeElement
    i = items.indexOf(focused)
  }
  if (i < 0) i = 0
  const atFirst = i <= 0
  const atLast = i >= items.length - 1
  up.setAttribute('aria-disabled', atFirst ? 'true' : 'false')
  down.setAttribute('aria-disabled', atLast ? 'true' : 'false')
  const upLabel = atFirst ? t('stepAtFirst') : t('stepUp')
  const downLabel = atLast ? t('stepAtLast') : t('stepDown')
  up.removeAttribute('title')
  down.removeAttribute('title')
  up.setAttribute('aria-label', upLabel)
  down.setAttribute('aria-label', downLabel)
}

/**
 * Cap the rail slot to the adaptive pane budget; return the painted slot height.
 * Codex step arrows overlay on hover and do not permanently reserve rows.
 */
function lockRailSlot(list, cap, measureContent) {
  if (!(list instanceof HTMLElement) || !Number.isFinite(cap) || cap <= 0) return 0
  const outline = list.parentElement
  const style = outline?.getAttribute('data-dsh-anchors-style')
  const contentH = measureContent(list)
  const slotH = Math.round(Math.min(contentH, cap))
  list.style.height = '100%'
  if (outline instanceof HTMLElement) outline.style.height = `${slotH}px`
  paintCodexSteps(list)
  if (style === 'deepseek') paintDeepseekBar(list)
  return slotH
}

/** @deprecated alias */
function lockDeepseekListCap(list, cap) {
  return lockRailSlot(list, cap, measureDeepseekContentHeight)
}

/** Overlay thumb to the right of ticks. Native scrollbars shift ticks and keep arrows. */
function paintDeepseekBar(list) {
  if (!(list instanceof HTMLElement)) return
  const outline = list.parentElement
  const scroller = list.querySelector('[data-dsh-anchors-scroller]')
  const bar = list.querySelector('[data-dsh-anchors-ds-bar]')
  const thumb = list.querySelector('[data-dsh-anchors-ds-thumb]')
  if (!(scroller instanceof HTMLElement) || !(bar instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return
  if (outline?.getAttribute('data-dsh-anchors-style') !== 'deepseek') {
    bar.hidden = true
    return
  }
  const overflow = scroller.scrollHeight > scroller.clientHeight + 1
  const hot = list.matches(':hover') || list.matches(':focus-within')
  bar.hidden = !(overflow && hot)
  if (bar.hidden) return
  const trackH = bar.clientHeight
  if (trackH <= 0) {
    window.requestAnimationFrame(() => { paintDeepseekBar(list) })
    return
  }
  const ratio = scroller.clientHeight / Math.max(1, scroller.scrollHeight)
  const thumbH = Math.max(16, Math.round(trackH * ratio))
  const maxTop = Math.max(0, trackH - thumbH)
  const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
  const top = Math.round((scroller.scrollTop / maxScroll) * maxTop)
  thumb.style.height = `${thumbH}px`
  thumb.style.transform = `translateY(${top}px)`
}

/**
 * Pin the rail to the conversation scrollport's visible box (viewport-fixed).
 * Using the scrollport top — not ConversationRoot — keeps it below the
 * session header / 对话·轨迹 tabs and above the composer.
 * Hidden entirely on the Trajectory tab.
 */
function layoutOutline(host, outline) {
  if (!(host instanceof HTMLElement) || outline === undefined) return
  if (isTrajectoryView(host) || getStyle() === 'official') {
    outline.hidden = true
    return
  }
  outline.hidden = false
  const scroll = host.matches('[data-conversation-scroll]')
    ? host
    : host.querySelector('[data-conversation-scroll]')
  if (!(scroll instanceof HTMLElement)) return
  const scrollRect = scroll.getBoundingClientRect()
  const composer = scroll.querySelector('[data-composer-seat]')
  const bottomEdge = composer instanceof HTMLElement
    ? composer.getBoundingClientRect().top
    : scrollRect.bottom
  const paneH = Math.max(0, bottomEdge - scrollRect.top)
  const list = outline.querySelector('[data-dsh-anchors-list]')
  const style = getStyle()
  const cap = computeRailSlotCap(paneH, style)
  const bandH = Math.max(0, paneH - RAIL_PANE_INSET * 2)
  outline.style.setProperty('--dsh-anchors-rail-cap', `${cap}px`)
  if (style === 'deepseek') {
    outline.style.left = 'auto'
    outline.style.right = `${Math.max(20, Math.round(window.innerWidth - scrollRect.right + 8))}px`
    outline.style.width = `${DEEPSEEK_RAIL_PX}px`
    outline.style.minWidth = '0'
    outline.style.maxWidth = `${DEEPSEEK_RAIL_PX}px`
    outline.style.bottom = 'auto'
    const slotH = list instanceof HTMLElement ? lockRailSlot(list, cap, measureDeepseekContentHeight) : cap
    outline.style.top = `${Math.round(scrollRect.top + RAIL_PANE_INSET + Math.max(0, (bandH - slotH) / 2))}px`
  } else {
    outline.style.right = 'auto'
    outline.style.left = `${Math.round(scrollRect.left + 6)}px`
    outline.style.width = '56px'
    outline.style.minWidth = '56px'
    outline.style.maxWidth = '56px'
    outline.style.bottom = 'auto'
    const slotH = list instanceof HTMLElement ? lockRailSlot(list, cap, measureCodexContentHeight) : cap
    outline.style.top = `${Math.round(scrollRect.top + RAIL_PANE_INSET + Math.max(0, (bandH - slotH) / 2))}px`
    if (list instanceof HTMLElement) list.style.height = '100%'
  }
}

/**
 * Hide ChatView's "加载更早" paging control only while we are draining.
 * If drain stops with `hasMore` still true, the button must come back —
 * otherwise the first user turn can sit outside the window with no way to
 * page it in, and the rail has no tick for it either.
 */
function syncOlderChrome(hide) {
  if (!hide) {
    for (const el of document.querySelectorAll('[data-dsh-hide-older]')) {
      el.removeAttribute('data-dsh-hide-older')
    }
    return
  }
  const scroll = document.querySelector('[data-conversation-scroll]')
  if (!(scroll instanceof HTMLElement)) return
  const firstRow = scroll.querySelector('[data-chat-anchor-key]')
  const column = firstRow instanceof HTMLElement ? firstRow.parentElement : null
  if (column instanceof HTMLElement) {
    for (const child of column.children) {
      if (child === firstRow || child.hasAttribute('data-chat-anchor-key')) break
      if (child.querySelector('button') !== null) {
        child.setAttribute('data-dsh-hide-older', '')
      }
    }
  }
  for (const button of scroll.querySelectorAll('button')) {
    const label = normalizeText(button.textContent)
    if (!OLDER_LABELS.has(label)) continue
    button.setAttribute('data-dsh-hide-older', '')
    button.parentElement?.setAttribute('data-dsh-hide-older', '')
  }
}

/**
 * Wait until `pred(snapshot)` is true, the generation is cancelled, or the
 * session errors. Resolves without throwing so an external plugin stays quiet.
 */
function waitSnapshot(session, pred, generation, currentGeneration) {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = () => {}
    const done = () => {
      if (settled) return
      settled = true
      try { unsubscribe() } catch { /* noop */ }
      resolve()
    }
    const check = () => {
      if (currentGeneration() !== generation) {
        done()
        return
      }
      const snapshot = typeof session.getSnapshot === 'function' ? session.getSnapshot() : undefined
      if (snapshot !== undefined && pred(snapshot)) done()
    }
    if (typeof session.subscribe !== 'function') {
      check()
      if (!settled) done()
      return
    }
    unsubscribe = session.subscribe(check)
    if (settled) {
      try { unsubscribe() } catch { /* noop */ }
      return
    }
    check()
  })
}

/**
 * Mount the content-area outline, waiting for the conversation pane and
 * self-healing on later React re-renders.
 * @param ctx - client cordis context (carries `sessions`).
 * @returns disposer removing the outline, observers, and subscriptions.
 */
function mountAnchors(ctx) {
  injectStyle()
  let outline
  let list
  let scroller
  let dsBar
  let dsThumb
  let codexUp
  let codexDown
  let empty
  let status
  let host
  let placed = false
  let currentSessionId = undefined
  let currentUnsubscribe = undefined
  let currentChatUnsubscribe = undefined
  let currentOutlineUnsubscribe = undefined
  let tip
  let tipTimer
  let statusTimer
  let waveIndex = -1
  let waveLockedIndex = -1
  let lastWaveY
  let resizeObserver
  let drainGeneration = 0
  let drainActive = false
  let pinnedKey
  let pinUntil = 0
  /** Turn currently paging in via `loadThrough` (alpha.3+). */
  let busyTurn = null
  /** After loadThrough, scroll to this turn once its chat key appears. */
  let pendingJumpTurn = null
  let jumpGeneration = 0
  const drainedIds = new Set()
  const anchorItems = new Map()
  const currentDrainGen = () => drainGeneration
  /** Last painted structure sig — skip DOM rebuild when only preview text moves. */
  let railStructureSig = ''
  /** Skip redundant active DOM writes (streaming scroll-spy noise). */
  let paintedActiveKey = undefined
  let railUpdateRaf = undefined

  const resolveItemAnchor = (item) => {
    const turn = Number.parseInt(item.getAttribute('data-turn') ?? '', 10)
    if (!Number.isFinite(turn)) return undefined
    const session = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session
    return buildRailAnchors(ctx, currentSessionId, session).find((a) => a.turn === turn)
  }

  const lastRailAnchorKey = () => {
    const items = railItems()
    for (let i = items.length - 1; i >= 0; i--) {
      const key = items[i].getAttribute('data-anchor-key')
      if (typeof key === 'string') return key
    }
    return undefined
  }

  const applyAnchorToItem = (item, anchor) => {
    item.setAttribute('data-rail-id', anchor.id)
    item.setAttribute('data-turn', String(anchor.turn))
    if (typeof anchor.seq === 'number') item.setAttribute('data-turn-seq', String(anchor.seq))
    else item.removeAttribute('data-turn-seq')
    if (typeof anchor.key === 'string') item.setAttribute('data-anchor-key', anchor.key)
    else item.removeAttribute('data-anchor-key')
    if (anchor.loaded) item.removeAttribute('data-unloaded')
    else item.setAttribute('data-unloaded', '')
    if (busyTurn === anchor.turn) item.setAttribute('data-busy', '')
    else item.removeAttribute('data-busy')
    const aria = !anchor.loaded
      ? t('jumpLoad', { n: anchor.turn })
      : anchor.answer !== ''
        ? `${anchor.summary}\n${anchor.answer}`
        : anchor.summary
    item.setAttribute('aria-label', aria)
    const previewBody = clipPreview(anchor.answer !== '' ? anchor.answer : '', 160)
    item.setAttribute('data-summary', anchor.summary)
    item.setAttribute('data-body', previewBody)
    const label = item.querySelector('[data-dsh-anchors-label]')
    if (label !== null) label.textContent = anchor.summary
    if (typeof anchor.key === 'string') anchorItems.set(anchor.key, item)
    anchorItems.set(anchor.id, item)
  }

  const bindAnchorItem = (item) => {
    item.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      dismissWave(item)
      const anchor = resolveItemAnchor(item)
      if (anchor !== undefined) void navigateToAnchor(anchor, item)
    })
    item.addEventListener('click', (event) => {
      dismissWave(item)
      if (event.detail === 0) {
        item.focus({ preventScroll: true })
        const anchor = resolveItemAnchor(item)
        if (anchor !== undefined) void navigateToAnchor(anchor, item)
      }
    })
    item.addEventListener('focus', () => {
      if (getStyle() !== 'codex') return
      if (waveLockedIndex >= 0) return
      applyWave(railItems().indexOf(item))
    })
    item.addEventListener('blur', () => {
      window.requestAnimationFrame(() => {
        if (list === undefined) return
        if (list.contains(document.activeElement)) return
        if (list.matches(':hover')) return
        clearWave()
      })
    })
    item.addEventListener('mouseenter', () => {
      if (getStyle() !== 'deepseek') return
      scheduleTruncatedTip(item)
    })
    item.addEventListener('mouseleave', () => {
      if (getStyle() !== 'deepseek') return
      hideTip()
    })
  }

  const createAnchorItem = (anchor) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('data-dsh-anchors-item', '')
    item.setAttribute('role', 'option')
    item.tabIndex = -1
    bindAnchorItem(item)
    const label = document.createElement('span')
    label.setAttribute('data-dsh-anchors-label', '')
    const tick = document.createElement('span')
    tick.setAttribute('data-dsh-anchors-tick', '')
    item.appendChild(label)
    item.appendChild(tick)
    applyAnchorToItem(item, anchor)
    return item
  }

  const patchRailItems = (anchors) => {
    const byTurn = new Map(anchors.map((a) => [a.turn, a]))
    for (const item of railItems()) {
      const turn = Number.parseInt(item.getAttribute('data-turn') ?? '', 10)
      const anchor = byTurn.get(turn)
      if (anchor !== undefined) applyAnchorToItem(item, anchor)
    }
  }

  const paintEmptyRail = () => {
    while (scroller.firstChild !== null) scroller.removeChild(scroller.firstChild)
    anchorItems.clear()
    railStructureSig = ''
    paintedActiveKey = undefined
    outline.setAttribute('data-empty', '')
    scroller.appendChild(empty)
    paintDeepseekBar(list)
  }

  const renderFull = (anchors) => {
    while (scroller.firstChild !== null) scroller.removeChild(scroller.firstChild)
    anchorItems.clear()
    paintedActiveKey = undefined
    outline.removeAttribute('data-empty')
    railStructureSig = anchorsStructureSig(anchors)
    for (const anchor of anchors) {
      scroller.appendChild(createAnchorItem(anchor))
    }
  }

  const finishRailUpdate = (anchors) => {
    if (host !== undefined) layoutOutline(host, outline)
    syncRailLoadedFlags()
    settlePendingJump(anchors)
    syncActive()
    if (list instanceof HTMLElement) paintCodexSteps(list)
    // Keep waveIndex across streaming patches so hover tip updates in place
    // instead of hide→show flicker every token.
    if (waveLockedIndex >= 0) return
    if (list.matches(':hover') && lastWaveY !== undefined) {
      applyWave(nearestWaveIndex(lastWaveY))
    }
  }

  const updateRail = () => {
    if (list === undefined || scroller === undefined || empty === undefined || outline === undefined) return
    syncOlderChrome(drainActive)
    const session = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session
    const anchors = buildRailAnchors(ctx, currentSessionId, session)

    if (shouldHidePluginRail(anchors)) {
      if (railStructureSig !== '' || scroller.querySelector('[data-dsh-anchors-item]') !== null) {
        paintEmptyRail()
      }
      return
    }

    const sig = anchorsStructureSig(anchors)
    const hasItems = scroller.querySelector('[data-dsh-anchors-item]') !== null
    if (sig === railStructureSig && hasItems) {
      patchRailItems(anchors)
    } else {
      renderFull(anchors)
    }
    finishRailUpdate(anchors)
  }

  const scheduleRailUpdate = () => {
    if (railUpdateRaf !== undefined) return
    railUpdateRaf = window.requestAnimationFrame(() => {
      railUpdateRaf = undefined
      updateRail()
    })
  }

  const render = () => {
    if (railUpdateRaf !== undefined) {
      window.cancelAnimationFrame(railUpdateRaf)
      railUpdateRaf = undefined
    }
    updateRail()
  }

  const itemByChatKey = (key) => {
    if (typeof key !== 'string') return undefined
    const direct = anchorItems.get(key)
    if (direct !== undefined && direct.getAttribute('data-anchor-key') === key) return direct
    for (const item of anchorItems.values()) {
      if (item.getAttribute('data-anchor-key') === key) return item
    }
    return undefined
  }

  const hideTip = () => {
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer)
      tipTimer = undefined
    }
    tip?.remove()
    tip = undefined
  }

  const placeTip = (node, item) => {
    const tick = item.querySelector('[data-dsh-anchors-tick]')
    const tickRect = tick instanceof HTMLElement ? tick.getBoundingClientRect() : item.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const tipRect = node.getBoundingClientRect()
    let left = getStyle() === 'deepseek'
      ? itemRect.left - tipRect.width - 10
      : tickRect.right + 17
    let top = itemRect.top + itemRect.height / 2 - tipRect.height / 2
    if (left < 8) left = Math.min(itemRect.right + 10, window.innerWidth - tipRect.width - 8)
    if (left + tipRect.width > window.innerWidth - 8) {
      left = Math.max(8, itemRect.left - tipRect.width - 8)
    }
    if (top + tipRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - tipRect.height - 8)
    }
    if (top < 8) top = 8
    node.style.left = `${left}px`
    node.style.top = `${top}px`
  }

  const fillTip = (node, title, body) => {
    let heading = node.querySelector('[data-dsh-anchors-tip-title]')
    if (heading === null) {
      heading = document.createElement('div')
      heading.setAttribute('data-dsh-anchors-tip-title', '')
      node.appendChild(heading)
    }
    heading.textContent = title
    let snippet = node.querySelector('[data-dsh-anchors-tip-body]')
    if (typeof body === 'string' && body !== '') {
      if (snippet === null) {
        snippet = document.createElement('div')
        snippet.setAttribute('data-dsh-anchors-tip-body', '')
        node.appendChild(snippet)
      }
      snippet.textContent = body
    } else {
      snippet?.remove()
    }
  }

  const showTip = (item, title, body, immediate, opts) => {
    if (typeof title !== 'string' || title === '') return
    const compact = opts?.compact === true
      || (item instanceof HTMLElement && item.hasAttribute('data-dsh-anchors-codex-step'))
    const paint = () => {
      tipTimer = undefined
      let node = tip
      if (node === undefined) {
        node = document.createElement('div')
        node.setAttribute('data-dsh-anchors-tip', '')
        document.body.appendChild(node)
        tip = node
      }
      fillTip(node, title, body)
      if (compact) node.setAttribute('data-compact', '')
      else node.removeAttribute('data-compact')
      if (!compact && getStyle() === 'deepseek') node.setAttribute('data-overflow', '')
      else node.removeAttribute('data-overflow')
      placeTip(node, item)
    }
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer)
      tipTimer = undefined
    }
    // Never tear down an existing tip to refresh — streaming patches used to
    // hide→recreate every frame and the bubble flickered.
    if (tip !== undefined || immediate === true) {
      paint()
      return
    }
    tipTimer = window.setTimeout(paint, 50)
  }

  const labelTruncated = (item) => {
    const label = item.querySelector('[data-dsh-anchors-label]')
    if (!(label instanceof HTMLElement)) return false
    // Collapsed panel: max-width is 0; that is not an ellipsis.
    if (label.clientWidth < 8) return false
    return label.scrollWidth > label.clientWidth + 1
  }

  const railItems = () => list === undefined
    ? []
    : [...list.querySelectorAll('[data-dsh-anchors-item]')]

  /** DeepSeek: delayed full-title tip, only when the expanded label is ellipsized. */
  const scheduleTruncatedTip = (item) => {
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer)
      tipTimer = undefined
    }
    const title = item.getAttribute('data-summary') ?? ''
    if (title === '') {
      hideTip()
      return
    }
    tipTimer = window.setTimeout(() => {
      tipTimer = undefined
      if (getStyle() !== 'deepseek') return
      if (!item.isConnected || !item.matches(':hover')) return
      if (!labelTruncated(item)) return
      showTip(item, title, '', true)
    }, DEEPSEEK_TIP_DELAY)
  }

  const clearWave = (opts) => {
    waveIndex = -1
    if (list === undefined) return
    list.removeAttribute('data-waving')
    for (const item of railItems()) item.removeAttribute('data-wave')
    if (opts?.keepTip !== true) hideTip()
  }

  const dismissWave = (item) => {
    const items = railItems()
    waveLockedIndex = items.indexOf(item)
    clearWave()
  }

  const applyWave = (index) => {
    if (getStyle() !== 'codex') {
      clearWave()
      return
    }
    const items = railItems()
    if (index < 0 || index >= items.length) {
      clearWave()
      return
    }
    list.setAttribute('data-waving', '')
    items.forEach((item, i) => {
      const dist = Math.abs(i - index)
      if (dist > 5) item.removeAttribute('data-wave')
      else item.setAttribute('data-wave', String(dist))
    })
    const focus = items[index]
    const title = focus.getAttribute('data-summary') ?? ''
    const body = focus.getAttribute('data-body') ?? ''
    const immediate = waveIndex >= 0 && tip !== undefined
    const same = index === waveIndex
    waveIndex = index
    if (same && tip !== undefined) {
      fillTip(tip, title, body)
      placeTip(tip, focus)
      return
    }
    showTip(focus, title, body, immediate)
  }

  const nearestWaveIndex = (clientY) => {
    const items = railItems()
    let best = -1
    let bestDist = Infinity
    items.forEach((item, i) => {
      const rect = item.getBoundingClientRect()
      const dist = Math.abs(clientY - (rect.top + rect.bottom) / 2)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }

  const placeOutline = (targetHost) => {
    if (outline === undefined) return false
    if (outline.parentElement !== targetHost) targetHost.appendChild(outline)
    targetHost.setAttribute('data-dsh-anchors-host', '')
    layoutOutline(targetHost, outline)
    return true
  }

  /** Drop stale `data-unloaded` when chat index catches up after first paint. */
  const syncRailLoadedFlags = (retry = false) => {
    if (list === undefined) return
    const session = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session
    if (!hasTurnOutlineCapability(session)) return
    const chat = readChatSnapshot(ctx, currentSessionId)
    if (chat === undefined) return
    let patched = false
    for (const item of list.querySelectorAll('[data-dsh-anchors-item][data-unloaded]')) {
      const turn = Number.parseInt(item.getAttribute('data-turn') ?? '', 10)
      if (!Number.isFinite(turn)) continue
      const hit = loadedTurnAnchor(chat, turn)
      if (hit === undefined) continue
      item.removeAttribute('data-unloaded')
      if (typeof hit.key === 'string') item.setAttribute('data-anchor-key', hit.key)
      patched = true
    }
    if (patched) {
      railStructureSig = ''
      paintDeepseekBar(list)
    }
    if (!retry && list.querySelector('[data-dsh-anchors-item][data-unloaded]') !== null) {
      window.requestAnimationFrame(() => { syncRailLoadedFlags(true) })
    }
  }

  const settlePendingJump = (anchors) => {
    if (pendingJumpTurn === null) return
    const hit = anchors.find((a) => a.turn === pendingJumpTurn && a.loaded && typeof a.key === 'string')
    if (hit === undefined) {
      const session = ctx.sessions?.binding?.(currentSessionId)?.session
      const snap = session?.getSnapshot?.()
      if (snap?.hasMore === false && snap?.loadingOlder !== true) {
        busyTurn = null
        pendingJumpTurn = null
        for (const el of scroller?.querySelectorAll('[data-busy]') ?? []) el.removeAttribute('data-busy')
      }
      return
    }
    const key = hit.key
    const turn = pendingJumpTurn
    busyTurn = null
    pendingJumpTurn = null
    activateAnchor(key)
    window.requestAnimationFrame(() => {
      const item = itemByChatKey(key)
      if (scrollToAnchor(key) && item !== undefined) flashItem(item)
      for (const el of document.querySelectorAll(`[data-dsh-anchors-item][data-turn="${turn}"][data-busy]`)) {
        el.removeAttribute('data-busy')
      }
    })
  }

  const navigateToAnchor = async (anchor, item) => {
    if (anchor.loaded && typeof anchor.key === 'string') {
      busyTurn = null
      pendingJumpTurn = null
      activateAnchor(anchor.key)
      if (scrollToAnchor(anchor.key)) flashItem(item)
      return
    }
    const session = ctx.sessions?.binding?.(currentSessionId)?.session
    if (session === undefined || typeof session.loadThrough !== 'function' || typeof anchor.seq !== 'number') {
      console.warn('[dsh-conversation-anchors] cannot jump to unloaded turn without loadThrough')
      return
    }
    const generation = ++jumpGeneration
    busyTurn = anchor.turn
    pendingJumpTurn = anchor.turn
    item.setAttribute('data-busy', '')
    if (status !== undefined) {
      outline?.setAttribute('data-draining', '')
      status.hidden = false
      status.textContent = t('jumping', { n: anchor.turn })
    }
    try {
      await session.loadThrough(anchor.seq)
    } catch (error) {
      console.warn('[dsh-conversation-anchors] loadThrough failed:', error)
      if (generation === jumpGeneration) {
        busyTurn = null
        pendingJumpTurn = null
        item.removeAttribute('data-busy')
        hideDrainStatus()
      }
      return
    }
    if (generation !== jumpGeneration) return
    const anchors = buildRailAnchors(ctx, currentSessionId, session)
    settlePendingJump(anchors)
    if (pendingJumpTurn === null) hideDrainStatus()
  }

  const hideDrainStatus = () => {
    if (statusTimer !== undefined) {
      window.clearTimeout(statusTimer)
      statusTimer = undefined
    }
    outline?.removeAttribute('data-draining')
    if (status !== undefined) {
      status.hidden = true
      status.textContent = ''
    }
  }

  const paintDrainStatus = (page) => {
    if (status === undefined || outline === undefined) return
    outline.setAttribute('data-draining', '')
    status.hidden = false
    status.textContent = page === undefined
      ? t('drainWait')
      : t('drainProgress', { page, max: MAX_OLDER_PAGES })
  }

  const finishDrainStatus = (capped) => {
    if (statusTimer !== undefined) {
      window.clearTimeout(statusTimer)
      statusTimer = undefined
    }
    if (capped) {
      outline?.setAttribute('data-draining', '')
      if (status !== undefined) {
        status.hidden = false
        status.textContent = t('drainCapped', { max: MAX_OLDER_PAGES })
      }
      statusTimer = window.setTimeout(() => {
        statusTimer = undefined
        hideDrainStatus()
      }, 4000)
      return
    }
    hideDrainStatus()
  }

  /**
   * Page through `session.loadOlder()` until the window covers the full log
   * (or the page cap / a cancelled generation). ChatView then drops its
   * "加载更早" button because `hasMore` becomes false.
   */
  const drainOlder = async (session, sessionId) => {
    if (session === undefined || typeof session.loadOlder !== 'function') return
    const generation = drainGeneration
    drainActive = true
    syncOlderChrome(true)
    let pages = 0
    try {
      await waitSnapshot(
        session,
        (snap) => snap.openState === 'open' || snap.openState === 'error',
        generation,
        currentDrainGen,
      )
      if (generation !== drainGeneration) return
      const opened = session.getSnapshot?.()
      if (opened?.openState === 'open' && opened.hasMore === true) paintDrainStatus()
      let stalls = 0
      while (pages < MAX_OLDER_PAGES && generation === drainGeneration) {
        const snap = session.getSnapshot?.()
        if (snap === undefined || snap.openState !== 'open' || snap.hasMore !== true) break
        paintDrainStatus(pages)
        if (snap.loadingOlder === true) {
          await waitSnapshot(session, (next) => next.loadingOlder !== true, generation, currentDrainGen)
          continue
        }
        const sizeBefore = Array.isArray(snap.chat?.order) ? snap.chat.order.length : 0
        await session.loadOlder()
        if (generation !== drainGeneration) return
        const after = session.getSnapshot?.()
        const sizeAfter = Array.isArray(after?.chat?.order) ? after.chat.order.length : 0
        if (after?.hasMore !== true) break
        if (sizeAfter > sizeBefore) {
          pages += 1
          stalls = 0
          paintDrainStatus(pages)
          continue
        }
        stalls += 1
        if (stalls >= 8) break
        await new Promise((resolve) => { window.setTimeout(resolve, 120) })
      }
      if (pages >= MAX_OLDER_PAGES) {
        console.warn(`[dsh-conversation-anchors] stopped after ${MAX_OLDER_PAGES} history pages`)
      }
    } catch (error) {
      console.warn('[dsh-conversation-anchors] load older failed:', error)
    } finally {
      if (generation === drainGeneration) {
        drainActive = false
        const snap = session.getSnapshot?.()
        if (sessionId !== undefined && (snap?.hasMore === false || pages >= MAX_OLDER_PAGES)) {
          drainedIds.add(sessionId)
        }
        finishDrainStatus(pages >= MAX_OLDER_PAGES)
      }
      syncOlderChrome(drainActive)
    }
  }

  const maybeDrain = (session, sessionId) => {
    if (session === undefined || typeof session.loadOlder !== 'function' || sessionId === undefined) return
    // Official rail owns its own outline + loadThrough; do not background-drain.
    if (getStyle() === 'official') return
    // alpha.3+: whole-session outline is already available — page on demand instead.
    if (hasTurnOutlineCapability(session)) return
    if (drainedIds.has(sessionId) || drainActive) return
    const snap = session.getSnapshot?.()
    if (snap?.openState === 'open' && snap.hasMore !== true) {
      drainedIds.add(sessionId)
      return
    }
    void drainOlder(session, sessionId)
  }

  const bindOutline = (session) => {
    if (currentOutlineUnsubscribe !== undefined) {
      currentOutlineUnsubscribe()
      currentOutlineUnsubscribe = undefined
    }
    const face = turnOutlineFace(session)
    if (face !== undefined && typeof face.subscribe === 'function') {
      currentOutlineUnsubscribe = face.subscribe(() => { scheduleRailUpdate() })
    }
  }

  const followCurrent = () => {
    if (ctx?.sessions?.list?.getSnapshot === undefined) return
    const snapshot = ctx.sessions.list.getSnapshot()
    const next = snapshot?.current
    if (next === currentSessionId) {
      scheduleRailUpdate()
      maybeDrain(ctx.sessions.binding?.(next)?.session, next)
      return
    }
    drainGeneration += 1
    drainActive = false
    jumpGeneration += 1
    busyTurn = null
    pendingJumpTurn = null
    pinnedKey = undefined
    pinUntil = 0
    railStructureSig = ''
    paintedActiveKey = undefined
    hideDrainStatus()
    currentSessionId = next
    if (currentUnsubscribe !== undefined) {
      currentUnsubscribe()
      currentUnsubscribe = undefined
    }
    if (currentChatUnsubscribe !== undefined) {
      currentChatUnsubscribe()
      currentChatUnsubscribe = undefined
    }
    if (currentOutlineUnsubscribe !== undefined) {
      currentOutlineUnsubscribe()
      currentOutlineUnsubscribe = undefined
    }
    if (next === undefined) {
      render()
      return
    }
    const binding = ctx.sessions.binding?.(next)
    const session = binding?.session
    if (session !== undefined && typeof session.subscribe === 'function') {
      currentUnsubscribe = session.subscribe(() => {
        scheduleRailUpdate()
        maybeDrain(session, next)
      })
    }
    const chat = chatTarget(ctx, next)
    if (chat !== undefined && typeof chat.subscribe === 'function') {
      currentChatUnsubscribe = chat.subscribe(() => { scheduleRailUpdate() })
    }
    bindOutline(session)
    render()
    maybeDrain(session, next)
  }

  const bindResize = (targetHost) => {
    resizeObserver?.disconnect()
    resizeObserver = undefined
    if (typeof ResizeObserver !== 'function') return
    resizeObserver = new ResizeObserver(() => { layoutOutline(targetHost, outline) })
    resizeObserver.observe(targetHost)
    const scroll = targetHost.querySelector('[data-conversation-scroll]')
    const composer = scroll?.querySelector('[data-composer-seat]')
    if (scroll instanceof HTMLElement) resizeObserver.observe(scroll)
    if (composer instanceof HTMLElement) resizeObserver.observe(composer)
  }

  /** Color-only landing flash. Skip while the hover wave is active so a
   * click does not shrink the lengthened tick. */
  const flashItem = (item) => {
    if (!(item instanceof HTMLElement)) return
    if (list !== undefined && list.hasAttribute('data-waving')) return
    item.removeAttribute('data-flash')
    // Force a reflow so a consecutive click restarts the animation.
    void item.offsetWidth
    item.setAttribute('data-flash', '')
    window.setTimeout(() => { item.removeAttribute('data-flash') }, 1500)
  }

  const focusedRailIndex = () => {
    const items = railItems()
    if (items.length === 0) return -1
    const activeEl = document.activeElement
    const focused = items.indexOf(activeEl)
    if (focused >= 0) return focused
    const active = items.findIndex((item) => item.hasAttribute('data-active'))
    return active >= 0 ? active : 0
  }

  const jumpToIndex = (index) => {
    const items = railItems()
    if (index < 0 || index >= items.length) return
    const item = items[index]
    item.focus({ preventScroll: true })
    revealInList(item, true)
    revealInScroller(item)
    if (getStyle() === 'codex') applyWave(index)
    const railId = item.getAttribute('data-rail-id')
    const key = item.getAttribute('data-anchor-key')
    const turnAttr = item.getAttribute('data-turn')
    const turn = turnAttr === null ? NaN : Number(turnAttr)
    const session = ctx.sessions?.binding?.(currentSessionId)?.session
    const anchors = buildRailAnchors(ctx, currentSessionId, session)
    const anchor = anchors.find((a) => a.id === railId)
      ?? anchors.find((a) => a.turn === turn)
      ?? (typeof key === 'string' ? { loaded: true, key, turn, id: key, summary: '', answer: '' } : undefined)
    if (anchor !== undefined) void navigateToAnchor(anchor, item)
  }

  const revealInScroller = (item) => {
    if (!(scroller instanceof HTMLElement) || !(item instanceof HTMLElement)) return
    if (!list.contains(item)) return
    const viewTop = scroller.scrollTop
    const viewBottom = viewTop + scroller.clientHeight
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < viewTop) scroller.scrollTop = itemTop
    else if (itemBottom > viewBottom) scroller.scrollTop = itemBottom - scroller.clientHeight
    paintCodexSteps(list)
  }

  const stepCodexRail = (delta) => {
    if (getStyle() !== 'codex') return
    const items = railItems()
    if (items.length === 0) return
    let i = items.findIndex((item) => item.hasAttribute('data-active'))
    if (i < 0) i = focusedRailIndex()
    if (i < 0) i = 0
    jumpToIndex(Math.max(0, Math.min(items.length - 1, i + delta)))
    paintCodexSteps(list)
  }

  const onRailKey = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (outline === undefined || outline.hidden || list === undefined) return
    if (isTypingTarget(event.target)) return
    const items = railItems()
    if (items.length === 0) return
    const railHot = list.contains(document.activeElement) || list.matches(':hover')
    if (!railHot) return
    const i = focusedRailIndex()
    let next
    if (event.key === 'ArrowDown' || event.key === 'j') next = Math.min(items.length - 1, Math.max(0, i) + 1)
    else if (event.key === 'ArrowUp' || event.key === 'k') next = Math.max(0, (i < 0 ? 0 : i) - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      jumpToIndex(i < 0 ? 0 : i)
      return
    } else return
    event.preventDefault()
    jumpToIndex(next)
  }

  /**
   * Map any in-view chat node (assistant-step, tool-call, …) to the user-turn
   * tick that owns it. The rail only has one item per user question.
   */
  const owningAnchorKey = (scroll, hitKey) => {
    if (typeof hitKey !== 'string') return undefined
    if (itemByChatKey(hitKey) !== undefined) return hitKey
    const rows = [...scroll.querySelectorAll('[data-chat-anchor-key]')]
    let owner
    for (const row of rows) {
      const key = row.getAttribute('data-chat-anchor-key')
      if (typeof key === 'string' && itemByChatKey(key) !== undefined) owner = key
      if (key === hitKey) break
    }
    return owner
  }

  /** Last user-turn tick whose row still intersects the conversation viewport. */
  const lastVisibleAnchorKey = (scroll) => {
    const viewport = scroll.getBoundingClientRect()
    const composer = scroll.querySelector('[data-composer-seat]')
    const visibleBottom = composer instanceof HTMLElement
      ? composer.getBoundingClientRect().top
      : viewport.bottom
    let last
    for (const row of scroll.querySelectorAll('[data-chat-anchor-key]')) {
      const key = row.getAttribute('data-chat-anchor-key')
      if (typeof key !== 'string' || itemByChatKey(key) === undefined) continue
      const rect = row.getBoundingClientRect()
      if (rect.bottom > viewport.top && rect.top < visibleBottom) last = key
    }
    return last
  }

  const resolveActiveKey = (scroll) => {
    const session = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session
    const running = session?.getSnapshot?.()?.running === true
    const bottomSlack = running ? RUNNING_BOTTOM_SLACK : FOLLOW_THRESHOLD
    if (scrollPinnedToBottom(scroll, bottomSlack)) {
      const last = lastRailAnchorKey()
      if (typeof last === 'string') return last
    }
    const lastTick = lastRailAnchorKey()
    const hit = visibleAnchorKey(scroll)
    return owningAnchorKey(scroll, hit)
      ?? lastVisibleAnchorKey(scroll)
      ?? lastTick
  }

  const revealInList = (item, force = false) => {
    if (getStyle() !== 'deepseek' || list === undefined || scroller === undefined) return
    if (!(item instanceof HTMLElement) || !list.contains(item)) return
    if (!force && list.matches(':hover')) return
    const cap = Math.round(Number.parseFloat(
      outline?.style.getPropertyValue('--dsh-anchors-rail-cap') || String(RAIL_MIN_SLOT),
    ))
    const measure = getStyle() === 'deepseek' ? measureDeepseekContentHeight : measureCodexContentHeight
    lockRailSlot(list, cap, measure)
    const view = scroller.getBoundingClientRect()
    if (view.height <= 1) return
    const itemRect = item.getBoundingClientRect()
    const pad = 8
    let delta = 0
    if (itemRect.top < view.top + pad) delta = itemRect.top - view.top - pad
    else if (itemRect.bottom > view.bottom - pad) delta = itemRect.bottom - view.bottom + pad
    if (delta !== 0) scroller.scrollTop += delta
    paintDeepseekBar(list)
  }

  const paintActive = (key) => {
    const next = typeof key === 'string' ? key : undefined
    if (next === paintedActiveKey) return
    paintedActiveKey = next
    let activeItem
    for (const item of anchorItems.values()) {
      const chatKey = item.getAttribute('data-anchor-key')
      const active = next !== undefined && chatKey === next
      if (active) {
        activeItem = item
        if (!item.hasAttribute('data-active')) item.setAttribute('data-active', '')
        if (item.getAttribute('aria-selected') !== 'true') item.setAttribute('aria-selected', 'true')
      } else {
        if (item.hasAttribute('data-active')) item.removeAttribute('data-active')
        if (item.getAttribute('aria-selected') !== 'false') item.setAttribute('aria-selected', 'false')
      }
    }
    if (activeItem !== undefined) {
      revealInList(activeItem)
      if (getStyle() === 'codex') revealInScroller(activeItem)
    }
    paintCodexSteps(list)
  }

  /** Keep the clicked tick selected while smooth-scroll settles (last turn may never reach the top). */
  const activateAnchor = (key) => {
    if (typeof key !== 'string' || itemByChatKey(key) === undefined) return false
    pinnedKey = key
    pinUntil = Date.now() + 800
    paintActive(key)
    return true
  }

  /** Highlight the rail tick for the turn currently nearest the viewport top. */
  const syncActive = () => {
    if (outline === undefined || host === undefined) return
    const scroll = host.matches('[data-conversation-scroll]')
      ? host
      : host.querySelector('[data-conversation-scroll]')
    if (!(scroll instanceof HTMLElement)) return
    if (pinnedKey !== undefined && Date.now() < pinUntil && itemByChatKey(pinnedKey) !== undefined) {
      paintActive(pinnedKey)
      return
    }
    pinnedKey = undefined
    paintActive(resolveActiveKey(scroll))
  }

  /** Bound scroll handler (throttled by rAF so streaming re-layout stays cheap). */
  let scrollRaf = undefined
  const onScrollSpy = () => {
    if (scrollRaf !== undefined) return
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = undefined
      syncActive()
      const scroll = host === undefined
        ? undefined
        : host.matches('[data-conversation-scroll]')
          ? host
          : host.querySelector('[data-conversation-scroll]')
      if (scroll instanceof HTMLElement && scroll.scrollTop < 96) {
        maybeDrain(ctx.sessions?.binding?.(currentSessionId)?.session, currentSessionId)
      }
    })
  }

  const tryPlace = () => {
    if (host !== undefined && !host.isConnected) {
      hostObserver.disconnect()
      host.removeAttribute('data-dsh-anchors-host')
      host = undefined
      placed = false
    }
    const nextHost = conversationHost()
    if (nextHost !== undefined && nextHost !== host) {
      host?.removeAttribute('data-dsh-anchors-host')
      hostObserver.disconnect()
      host = nextHost
      placed = false
    }
    if (host === undefined) return
    placed = placeOutline(host)
    if (placed) {
      bindResize(host)
      syncOlderChrome(drainActive)
      syncActive()
      hostObserver.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase', 'style', 'class', 'aria-selected'] })
      const scroll = host.matches('[data-conversation-scroll]')
        ? host
        : host.querySelector('[data-conversation-scroll]')
      scroll?.removeEventListener('scroll', onScrollSpy)
      scroll?.addEventListener('scroll', onScrollSpy, { passive: true })
    }
  }

  const onWindowChange = () => {
    if (host !== undefined) layoutOutline(host, outline)
  }

  const waitObserver = new MutationObserver(() => {
    if (host === undefined || !host.isConnected || (outline !== undefined && !host.contains(outline))) {
      tryPlace()
    }
  })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const hostObserver = new MutationObserver((records) => {
    if (host === undefined || !host.isConnected) {
      placed = false
      tryPlace()
      return
    }
    // Ignore our own rail writes (aria-selected / inline style). Observing
    // those fed syncActive/layoutOutline back into this callback and froze the tab.
    if (outline !== undefined && records.length > 0 && records.every((record) => (
      record.target === outline || outline.contains(record.target)
    ))) {
      return
    }
    if (outline !== undefined && !host.contains(outline)) {
      placed = placeOutline(host)
      bindResize(host)
    } else {
      layoutOutline(host, outline)
      syncOlderChrome(drainActive)
      if (outline.hidden) hideTip()
    }
  })

  const paintStyle = () => {
    if (outline === undefined) return
    syncRailStyleMarker()
    const style = getStyle()
    outline.setAttribute('data-dsh-anchors-style', style)
    if (style !== 'codex') clearWave()
    if (style === 'official') {
      outline.hidden = true
      // Cancel any legacy drain started before switching to official.
      drainGeneration += 1
      drainActive = false
      syncOlderChrome(false)
      hideDrainStatus()
    } else {
      // Official mode leaves outline.hidden=true; switching back must not wait
      // for layoutOutline(host) — host can be undefined while settings is open.
      outline.hidden = false
      tryPlace()
      render()
      if (host !== undefined && host.isConnected) layoutOutline(host, outline)
      maybeDrain(ctx.sessions?.binding?.(currentSessionId)?.session, currentSessionId)
    }
    if (list instanceof HTMLElement) paintDeepseekBar(list)
    syncActive()
  }

  const listDispose = ctx?.sessions?.list?.subscribe?.(followCurrent)
  const styleDispose = subscribeStyle(paintStyle)

  outline = document.createElement('div')
  outline.setAttribute('data-dsh-anchors-outline', '')
  outline.setAttribute('data-dsh-anchors-style', getStyle())
  outline.setAttribute('data-dsh-anchors-version', PLUGIN_VERSION)
  outline.setAttribute('aria-label', t('title'))

  list = document.createElement('div')
  list.setAttribute('data-dsh-anchors-list', '')
  list.setAttribute('role', 'listbox')
  list.setAttribute('tabindex', '0')
  list.setAttribute('aria-orientation', 'vertical')
  list.setAttribute('aria-label', `${t('title')}。${t('railKeys')}`)
  scroller = document.createElement('div')
  scroller.setAttribute('data-dsh-anchors-scroller', '')
  codexUp = document.createElement('button')
  codexUp.type = 'button'
  codexUp.setAttribute('data-dsh-anchors-codex-step', 'up')
  codexUp.setAttribute('aria-label', t('stepUp'))
  codexUp.hidden = true
  codexUp.appendChild(chevronDownSvg())
  codexDown = document.createElement('button')
  codexDown.type = 'button'
  codexDown.setAttribute('data-dsh-anchors-codex-step', 'down')
  codexDown.setAttribute('aria-label', t('stepDown'))
  codexDown.hidden = true
  codexDown.appendChild(chevronDownSvg())
  codexUp.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (codexUp.getAttribute('aria-disabled') === 'true') return
    stepCodexRail(-1)
  })
  codexDown.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (codexDown.getAttribute('aria-disabled') === 'true') return
    stepCodexRail(1)
  })
  const tipCodexStep = (button) => {
    const label = button.getAttribute('aria-label')
    if (typeof label !== 'string' || label === '') return
    clearWave({ keepTip: true })
    showTip(button, label, '', true, { compact: true })
  }
  codexUp.addEventListener('mouseenter', () => { tipCodexStep(codexUp) })
  codexDown.addEventListener('mouseenter', () => { tipCodexStep(codexDown) })
  codexUp.addEventListener('mouseleave', () => { hideTip() })
  codexDown.addEventListener('mouseleave', () => { hideTip() })
  dsBar = document.createElement('div')
  dsBar.setAttribute('data-dsh-anchors-ds-bar', '')
  dsBar.hidden = true
  dsThumb = document.createElement('div')
  dsThumb.setAttribute('data-dsh-anchors-ds-thumb', '')
  dsBar.appendChild(dsThumb)
  scroller.addEventListener('scroll', () => {
    paintDeepseekBar(list)
    paintCodexSteps(list)
  }, { passive: true })
  dsBar.addEventListener('pointerdown', (event) => {
    if (getStyle() !== 'deepseek' || scroller === undefined || dsThumb === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const track = dsBar.getBoundingClientRect()
    const thumbH = dsThumb.offsetHeight
    const maxTop = Math.max(1, track.height - thumbH)
    const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
    const yOf = (clientY) => Math.min(maxTop, Math.max(0, clientY - track.top - thumbH / 2))
    if (event.target !== dsThumb) scroller.scrollTop = (yOf(event.clientY) / maxTop) * maxScroll
    const startY = event.clientY
    const startScroll = scroller.scrollTop
    const onMove = (moveEvent) => {
      scroller.scrollTop = startScroll + ((moveEvent.clientY - startY) / maxTop) * maxScroll
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })
  list.addEventListener('mouseenter', () => {
    if (getStyle() === 'codex') {
      paintCodexSteps(list)
      return
    }
    if (getStyle() !== 'deepseek') return
    paintDeepseekBar(list)
    const active = list.querySelector('[data-dsh-anchors-item][data-active]')
    if (!(active instanceof HTMLElement)) return
    revealInList(active, true)
    window.setTimeout(() => {
      revealInList(active, true)
      paintDeepseekBar(list)
    }, 160)
  })
  list.addEventListener('mouseleave', () => {
    lastWaveY = undefined
    waveLockedIndex = -1
    if (getStyle() === 'deepseek') {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && list.contains(focused)) focused.blur()
      paintDeepseekBar(list)
      return
    }
    // Codex: pointer left the rail — drop hover preview even when the clicked
    // tick still holds focus (otherwise the floating card sticks until blur).
    clearWave()
  })
  list.addEventListener('mousemove', (event) => {
    if (getStyle() !== 'codex') return
    if (event.target instanceof Element && event.target.closest('[data-dsh-anchors-codex-step]')) {
      lastWaveY = undefined
      // Keep the step tip; only drop the tick wave marks.
      clearWave({ keepTip: true })
      return
    }
    lastWaveY = event.clientY
    const index = nearestWaveIndex(event.clientY)
    if (waveLockedIndex >= 0) {
      if (index === waveLockedIndex) return
      waveLockedIndex = -1
    }
    if (index === waveIndex) return
    applyWave(index)
  })
  list.appendChild(codexUp)
  list.appendChild(scroller)
  list.appendChild(codexDown)
  list.appendChild(dsBar)
  outline.appendChild(list)

  empty = document.createElement('div')
  empty.setAttribute('data-dsh-anchors-empty', '')
  empty.textContent = t('empty')

  status = document.createElement('div')
  status.setAttribute('data-dsh-anchors-status', '')
  status.setAttribute('aria-live', 'polite')
  status.hidden = true
  outline.appendChild(status)

  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)
  window.addEventListener('keydown', onRailKey)

  followCurrent()
  tryPlace()

  return () => {
    drainGeneration += 1
    drainActive = false
    jumpGeneration += 1
    busyTurn = null
    pendingJumpTurn = null
    waitObserver.disconnect()
    hostObserver.disconnect()
    resizeObserver?.disconnect()
    window.removeEventListener('resize', onWindowChange)
    window.removeEventListener('scroll', onWindowChange, true)
    window.removeEventListener('keydown', onRailKey)
    hideTip()
    hideDrainStatus()
    if (railUpdateRaf !== undefined) {
      window.cancelAnimationFrame(railUpdateRaf)
      railUpdateRaf = undefined
    }
    if (currentUnsubscribe !== undefined) currentUnsubscribe()
    if (currentChatUnsubscribe !== undefined) currentChatUnsubscribe()
    if (currentOutlineUnsubscribe !== undefined) currentOutlineUnsubscribe()
    if (typeof listDispose === 'function') listDispose()
    if (typeof styleDispose === 'function') styleDispose()
    host?.removeAttribute('data-dsh-anchors-host')
    document.documentElement.removeAttribute('data-dsh-anchors-rail-style')
    outline?.remove()
  }
}

/**
 * Sessions are required. `uiConversation` is optional: DSH 0.1.2+ exposes
 * chat there; older builds still keep `session.getSnapshot().chat` (see
 * {@link readChatSnapshot}). Settings/slots stay optional.
 */
const inject = {
  sessions: true,
  uiConversation: { required: false },
  slots: { required: false },
  settingsScope: { required: false },
}

/** True when a flow item still has a live Think/tool row. */
function turnIsRunning(items) {
  return items.some((el) => (
    el.getAttribute('data-state') === 'running'
    || el.querySelector('[data-state="running"]') !== null
  ))
}

/** True when an assistant-step still has visible body besides Think. */
function assistantHasAnswer(item) {
  if (item.getAttribute('data-chat-flow-kind') !== 'assistant-step') return false
  const thinks = [...item.querySelectorAll('[data-variant="think"]')]
  if (thinks.length === 0) return (item.textContent ?? '').trim() !== ''
  const parent = thinks[0].parentElement
  if (parent === null) return (item.textContent ?? '').trim() !== ''
  for (const child of parent.children) {
    if (child.getAttribute('data-variant') === 'think') continue
    if ((child.textContent ?? '').trim() !== '') return true
  }
  return false
}

/** Last assistant-step in the turn that still shows a reply body. */
function lastAnswerItem(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (assistantHasAnswer(items[index])) return items[index]
  }
  return undefined
}

/**
 * Process rows to fold: tool-call cards, intermediate assistant-steps, and
 * Think disclosures on the final reply. `keepVisible` is that last answer.
 */
function processTargets(item, keepVisible) {
  const kind = item.getAttribute('data-chat-flow-kind')
  if (kind === 'tool-call') return [item]
  if (kind !== 'assistant-step') return []
  if (item !== keepVisible) return [item]
  return [...item.querySelectorAll('[data-variant="think"]')]
}

/** Split the chat column into turns starting at each user message. */
function collectTurns(scroll) {
  const flows = [...scroll.querySelectorAll('[data-chat-anchor-key][data-chat-flow-kind]')]
  const turns = []
  let current
  for (const el of flows) {
    const kind = el.getAttribute('data-chat-flow-kind')
    if (kind === 'user') {
      current = {
        id: el.getAttribute('data-chat-anchor-key') ?? `turn-${turns.length}`,
        items: [],
      }
      turns.push(current)
      continue
    }
    if (current === undefined) {
      current = { id: 'preamble', items: [] }
      turns.push(current)
    }
    current.items.push(el)
  }
  return turns
}

/** True when the live transcript already renders DSH's turn-process fold. */
function officialTurnProcessInDom() {
  const scroll = document.querySelector('[data-conversation-scroll]')
  if (!(scroll instanceof HTMLElement)) return false
  return scroll.querySelector('[data-turn-process], [data-chat-flow-kind="turn-process"]') !== null
}

/** Read DSH Chat `transcriptView` when the ui-chat settings scope is ready. */
function readOfficialTranscriptView(ctx) {
  if (typeof ctx?.settingsScope?.bind !== 'function') return undefined
  try {
    const scope = ctx.settingsScope.bind({ namespace: OFFICIAL_CHAT_SETTINGS_NS })
    const snap = scope?.getSnapshot?.()
    if (snap?.status === 'ready' && typeof snap.value?.transcriptView === 'string') {
      return snap.value.transcriptView
    }
  } catch {
    /* older DSH builds without ui-chat */
  }
  return undefined
}

/**
 * DSH 0.1.2+ exposes completed-turn process folding (Compact transcript).
 * When active, the plugin must not mount its own DOM fold (avoids double disclosure).
 */
function hasOfficialTurnProcessFold(ctx) {
  if (officialTurnProcessInDom()) return true
  return readOfficialTranscriptView(ctx) === 'compact'
}

/**
 * After a turn finishes, fold Think, tool-call, and in-progress assistant
 * commentary behind one disclosure. The last assistant-step with a reply body
 * stays visible.
 * Click expands; a live (running) turn stays open.
 * Skipped when {@link hasOfficialTurnProcessFold} is true (DSH 0.1.2+ Compact).
 */
function mountProcessFold(ctx) {
  const expanded = new Set()
  const toggles = new Map()
  let observer
  let timer
  let chatSettingsDispose
  let loggedOfficialSkip = false

  const clearToggle = (id) => {
    const toggle = toggles.get(id)
    if (toggle === undefined) return
    toggle.remove()
    toggles.delete(id)
  }

  const ensureToggle = (id, anchor, count, collapsed) => {
    let toggle = toggles.get(id)
    if (toggle === undefined) {
      toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.setAttribute('data-dsh-process-toggle', '')
      const label = document.createElement('span')
      label.setAttribute('data-dsh-process-label', '')
      const countEl = document.createElement('span')
      countEl.setAttribute('data-dsh-process-count', '')
      const chevron = document.createElement('span')
      chevron.setAttribute('data-dsh-process-chevron', '')
      chevron.appendChild(chevronDownSvg())
      toggle.appendChild(label)
      toggle.appendChild(countEl)
      toggle.appendChild(chevron)
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (expanded.has(id)) expanded.delete(id)
        else expanded.add(id)
        sync()
      })
      toggles.set(id, toggle)
    }
    const label = toggle.querySelector('[data-dsh-process-label]')
    const countEl = toggle.querySelector('[data-dsh-process-count]')
    const chevron = toggle.querySelector('[data-dsh-process-chevron]')
    if (label !== null) label.textContent = t('process')
    if (countEl !== null) countEl.textContent = t('steps', { count })
    if (chevron !== null && chevron.querySelector('svg') === null) chevron.appendChild(chevronDownSvg())
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggle.setAttribute('title', collapsed ? t('processExpand') : t('processCollapse'))
    const parent = anchor.parentElement
    if (parent !== null && toggle.parentElement !== parent) parent.insertBefore(toggle, anchor)
    else if (parent !== null && toggle.nextElementSibling !== anchor) parent.insertBefore(toggle, anchor)
    return toggle
  }

  const clearPluginFold = () => {
    for (const id of [...toggles.keys()]) clearToggle(id)
    for (const el of document.querySelectorAll('[data-dsh-process-hide]')) {
      el.removeAttribute('data-dsh-process-hide')
    }
  }

  const sync = () => {
    if (hasOfficialTurnProcessFold(ctx)) {
      if (!loggedOfficialSkip) {
        loggedOfficialSkip = true
        console.info('[dsh-conversation-anchors] DSH official turn-process fold active; plugin fold skipped')
      }
      clearPluginFold()
      return
    }
    loggedOfficialSkip = false

    const scroll = document.querySelector('[data-conversation-scroll]')
    if (!(scroll instanceof HTMLElement) || isTrajectoryView(scroll.parentElement ?? scroll)) {
      clearPluginFold()
      return
    }
    const seen = new Set()
    for (const turn of collectTurns(scroll)) {
      const keepVisible = lastAnswerItem(turn.items)
      const targets = turn.items.flatMap((item) => processTargets(item, keepVisible))
      if (targets.length === 0) {
        clearToggle(turn.id)
        continue
      }
      seen.add(turn.id)
      const running = turnIsRunning(turn.items)
      const collapsed = !running && !expanded.has(turn.id)
      const firstFlow = turn.items.find((item) => processTargets(item, keepVisible).length > 0)
      if (firstFlow === undefined) {
        clearToggle(turn.id)
        continue
      }
      if (running) {
        clearToggle(turn.id)
        for (const el of targets) el.removeAttribute('data-dsh-process-hide')
        continue
      }
      ensureToggle(turn.id, firstFlow, targets.length, collapsed)
      for (const el of targets) {
        if (collapsed) el.setAttribute('data-dsh-process-hide', '')
        else el.removeAttribute('data-dsh-process-hide')
      }
    }
    for (const id of [...toggles.keys()]) {
      if (!seen.has(id)) clearToggle(id)
    }
  }

  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      sync()
    }, 50)
  }

  observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state', 'data-chat-flow-kind', 'data-phase', 'aria-selected'],
  })
  try {
    if (typeof ctx?.settingsScope?.bind === 'function') {
      const chatScope = ctx.settingsScope.bind({ namespace: OFFICIAL_CHAT_SETTINGS_NS })
      if (typeof chatScope?.subscribe === 'function') {
        chatSettingsDispose = chatScope.subscribe(schedule)
      }
    }
  } catch {
    /* ui-chat scope absent on older DSH */
  }
  sync()

  return () => {
    observer.disconnect()
    if (timer !== undefined) window.clearTimeout(timer)
    if (typeof chatSettingsDispose === 'function') {
      try { chatSettingsDispose() } catch { /* noop */ }
    }
    clearPluginFold()
  }
}

/** Resolve a seeded module (React); missing modules must not take the plugin down. */
function tryRequire(name) {
  try {
    return _require(name)
  } catch {
    return undefined
  }
}

/** General settings row: DSH Menu (same as Language / Permissions), live write. */
function createStyleRow(React, primitives) {
  const ui = primitives?.default ?? primitives
  const Menu = ui?.Menu
  const Chevron = ui?.IconChevronDownOutline14
  const ReactDOM = tryRequire('react-dom')

  const chevronEl = typeof Chevron === 'function'
    ? React.createElement(Chevron, { 'data-dsh-anchors-style-chevron': '' })
    : React.createElement(
      'svg',
      {
        'data-dsh-anchors-style-chevron': '',
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        fill: 'none',
        'aria-hidden': 'true',
      },
      React.createElement('path', { d: CHEVRON_DOWN_PATH, fill: 'currentColor' }),
    )

  const checkEl = React.createElement(
    'svg',
    {
      'data-dsh-anchors-style-check': '',
      width: 14,
      height: 14,
      viewBox: '0 0 14 14',
      fill: 'none',
      'aria-hidden': 'true',
    },
    React.createElement('path', {
      d: 'M2.5 7.2L5.4 10.1L11.5 3.9',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )

  return function StyleRow() {
    const [style, setStyle] = React.useState(getStyle)
    const [open, setOpen] = React.useState(false)
    const triggerRef = React.useRef(null)
    const [menuBox, setMenuBox] = React.useState(null)
    React.useEffect(() => subscribeStyle(() => { setStyle(getStyle()) }), [])
    React.useLayoutEffect(() => {
      if (!open || typeof Menu === 'function') return undefined
      const place = () => {
        const node = triggerRef.current
        if (!(node instanceof HTMLElement)) return
        const rect = node.getBoundingClientRect()
        const width = Math.max(rect.width, 168)
        setMenuBox({
          top: Math.round(rect.bottom + 4),
          left: Math.round(rect.right - width),
          width: Math.round(width),
        })
      }
      place()
      window.addEventListener('resize', place)
      return () => { window.removeEventListener('resize', place) }
    }, [open])
    React.useEffect(() => {
      if (!open || typeof Menu === 'function') return undefined
      const onPointer = (event) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (triggerRef.current?.contains(target)) return
        if (target instanceof Element && target.closest('[data-dsh-anchors-style-menu]')) return
        setOpen(false)
      }
      const onKey = (event) => {
        if (event.key === 'Escape') setOpen(false)
      }
      document.addEventListener('mousedown', onPointer)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onPointer)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])

    const options = [
      { id: 'codex', label: t('styleCodex') },
      { id: 'official', label: t('styleOfficial') },
      { id: 'deepseek', label: t('styleDeepseek') },
    ]
    const selectedLabel = styleLabel(style)
    const trigger = React.createElement(
      'button',
      {
        ref: triggerRef,
        type: 'button',
        'data-dsh-anchors-style-select': '',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': t('styleTitle'),
        onClick: () => { setOpen((value) => !value) },
      },
      selectedLabel,
      chevronEl,
    )

    let control
    if (typeof Menu === 'function') {
      control = React.createElement(Menu, {
        open,
        onClose: () => { setOpen(false) },
        items: options,
        selectedId: style,
        onSelect: (id) => {
          setOpen(false)
          const next = typeof id === 'string' ? id : id?.id
          if (typeof next === 'string') setRailStyle(next)
        },
        align: 'end',
        portal: true,
        anchor: trigger,
      })
    } else {
      const menu = open && menuBox !== null
        ? React.createElement(
          'div',
          {
            'data-dsh-anchors-style-menu': '',
            role: 'listbox',
            'aria-label': t('styleTitle'),
            style: {
              position: 'fixed',
              top: `${menuBox.top}px`,
              left: `${menuBox.left}px`,
              width: `${menuBox.width}px`,
            },
          },
          options.map((option) => React.createElement(
            'button',
            {
              key: option.id,
              type: 'button',
              role: 'option',
              'aria-selected': option.id === style,
              'data-dsh-anchors-style-option': '',
              onClick: () => {
                setOpen(false)
                setRailStyle(option.id)
              },
            },
            option.label,
            option.id === style ? checkEl : null,
          )),
        )
        : null
      const portal = menu !== null && typeof ReactDOM?.createPortal === 'function'
        ? ReactDOM.createPortal(menu, document.body)
        : menu
      control = React.createElement(React.Fragment, null, trigger, portal)
    }

    return React.createElement(
      'div',
      { 'data-dsh-anchors-style-row': '' },
      React.createElement(
        'div',
        { 'data-dsh-anchors-style-text': '' },
        React.createElement('div', { 'data-dsh-anchors-style-title': '' }, t('styleTitle')),
        React.createElement('div', { 'data-dsh-anchors-style-desc': '' }, t('styleDesc')),
      ),
      control,
    )
  }
}

/** Register the General-settings row when slots + React are available. */
function mountSettingsRow(ctx) {
  injectStyle()
  if (typeof ctx?.slots?.inject !== 'function') return undefined
  const React = tryRequire('react')
  if (React === undefined || typeof React.createElement !== 'function' || typeof React.useState !== 'function' || typeof React.useRef !== 'function') {
    return undefined
  }
  const StyleRow = createStyleRow(React, tryRequire('@deepseek-ai/dsh-client-ui-primitives'))
  try {
    return ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'conversation-anchors-style',
      order: 30,
    }, StyleRow))
  } catch (error) {
    console.warn('[dsh-conversation-anchors] settings row failed:', error)
    return undefined
  }
}

/** Browser-half apply: mount the outline, process-fold, and settings row. */
function apply(ctx) {
  injectStyle()
  syncRailStyleMarker()
  console.info(`[dsh-conversation-anchors] ${PLUGIN_VERSION} rail style=${getStyle()}`)
  try {
    mountSettingsRow(ctx)
  } catch (error) {
    console.warn('[dsh-conversation-anchors] settings row failed:', error)
  }

  ctx.effect(() => {
    const dispose = bindStyleScope(ctx)
    return () => {
      try { dispose?.() } catch { /* noop */ }
      styleScope = undefined
    }
  }, 'dsh-conversation-anchors: settings scope')

  ctx.effect(() => {
    let dispose
    try {
      dispose = mountAnchors(ctx)
    } catch (error) {
      console.warn('[dsh-conversation-anchors] mount failed:', error)
      return undefined
    }
    return () => {
      try { dispose() } catch { /* noop */ }
    }
  }, 'dsh-conversation-anchors: content outline')

  ctx.effect(() => {
    let dispose
    try {
      dispose = mountProcessFold(ctx)
    } catch (error) {
      console.warn('[dsh-conversation-anchors] process fold failed:', error)
      return undefined
    }
    return () => {
      try { dispose() } catch { /* noop */ }
    }
  }, 'dsh-conversation-anchors: process fold')
}

    exports.mountAnchors = mountAnchors
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})