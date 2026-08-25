/**
 * dsh-conversation-anchors — browser half.
 *
 * Injects a Codex-style tick rail into the left gutter of the conversation
 * pane (not the app sidebar): one short dash per user-sent message. The
 * current tick is longer and darker; hovering a dash shows a floating preview
 * card; clicking scrolls to that node's `[data-chat-anchor-key]` row. The
 * rail is borderless and sits below the session header so it does not cover
 * the top bar. Opening a session drains `session.loadOlder()` so the rail
 * lists the full history instead of the latest page only.
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

const PLUGIN_VERSION = '0.1.9'

/** Hard cap on eager `loadOlder` pages (50 messages each) so a huge log cannot hang the tab. */
const MAX_OLDER_PAGES = 80

/** Official ChatView paging labels, plus the colloquial "load more" the user expects. */
const OLDER_LABELS = new Set(['加载更早', 'Load earlier', '加载更多', 'Load more', 'Load older'])

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
 * @returns {Array<{key: string, index: number, summary: string, answer: string}>}
 */
function buildAnchors(snapshot) {
  const order = snapshot?.chat?.order
  const nodes = snapshot?.chat?.nodes
  if (!Array.isArray(order) || nodes === undefined) return []
  const anchors = []
  let current = null
  for (const key of order) {
    const node = nodes.get?.(key)
    if (node === undefined || node === null) continue
    if (node.visibility === 'hidden') continue
    const kind = node.kind
    if (kind === 'user') {
      current = {
        key: typeof node.key === 'string' ? node.key : key,
        index: anchors.length + 1,
        summary: nodeSummary(node),
        answer: '',
      }
      anchors.push(current)
      continue
    }
    if (kind === 'assistant-step' && current !== null && current.answer === '') {
      const preview = assistantSummary(node)
      if (preview !== '') current.answer = preview
    }
  }
  return anchors
}

/** Scroll the conversation to the node identified by `key`. */
function scrollToAnchor(key) {
  if (typeof key !== 'string') return false
  const rows = document.querySelectorAll('[data-chat-anchor-key]')
  for (const row of rows) {
    if (row.getAttribute('data-chat-anchor-key') !== key) continue
    row.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }
  return false
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
    '[data-phase="hero"] [data-dsh-anchors-outline]{display:none;}',
    '[data-dsh-anchors-outline][hidden],[data-dsh-anchors-outline][data-empty]{display:none!important;}',
    '[data-dsh-process-hide],[data-dsh-hide-older]{display:none!important;}',
    '[data-dsh-process-toggle]{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:2px 0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);font:inherit;font-size:14px;line-height:24px;text-align:left;cursor:pointer;}',
    '[data-dsh-process-toggle]:hover{color:var(--dsw-alias-label-secondary,#666);}',
    '[data-dsh-process-toggle] [data-dsh-process-label]{font-weight:400;}',
    '[data-dsh-process-toggle] [data-dsh-process-count]{opacity:.8;}',
    '[data-dsh-process-toggle] [data-dsh-process-chevron]{margin-left:auto;flex:none;font-size:12px;line-height:1;opacity:.7;}',
    '[data-dsh-anchors-outline]{box-sizing:border-box;position:fixed;left:8px;width:36px;z-index:3;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;margin:0;padding:0;border:0;background:transparent;pointer-events:none;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list]{flex:0 1 auto;margin:auto 0;min-height:0;max-height:100%;width:36px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:6px 0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;pointer-events:auto;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list]::-webkit-scrollbar{display:none;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item]{box-sizing:border-box;display:flex;align-items:center;width:36px;height:11px;margin:0;padding:0;border:0;background:transparent;cursor:pointer;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-tick]{display:block;width:8px;height:1.5px;border-radius:1px;background:var(--dsw-alias-label-quaternary,rgba(140,140,140,.5));transform-origin:left center;transition:width .14s ease,height .14s ease,background-color .14s ease;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item][data-active] [data-dsh-anchors-tick]{width:16px;height:2px;background:var(--dsw-alias-label-primary,#1a1a1a);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-active] [data-dsh-anchors-tick]{width:8px;height:1.5px;background:var(--dsw-alias-label-quaternary,rgba(140,140,140,.5));}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="0"] [data-dsh-anchors-tick]{width:32px;height:2.5px;background:var(--dsw-alias-label-primary,#1a1a1a);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="1"] [data-dsh-anchors-tick]{width:22px;height:2px;background:var(--dsw-alias-label-secondary,#8a8a8a);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="2"] [data-dsh-anchors-tick]{width:15px;height:1.5px;background:rgba(140,140,140,.75);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="3"] [data-dsh-anchors-tick]{width:11px;height:1.5px;background:rgba(140,140,140,.6);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="4"] [data-dsh-anchors-tick]{width:8px;height:1.5px;background:rgba(140,140,140,.5);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list][data-waving] [data-dsh-anchors-item][data-wave="5"] [data-dsh-anchors-tick]{width:6px;height:1.5px;background:rgba(140,140,140,.42);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item][data-flash] [data-dsh-anchors-tick]{animation:dshAnchorsFlash 1.2s ease-out;}',
    '@keyframes dshAnchorsFlash{0%{background:var(--dsw-static-deepseek-500,#38bdf8);}100%{background:var(--dsw-alias-label-primary,#1a1a1a);}}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-empty]{display:none;}',
    '[data-dsh-anchors-tip]{position:fixed;z-index:10000;box-sizing:border-box;width:min(280px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-float,#fff);color:var(--dsw-alias-label-primary,#111);border:0;font-size:12px;line-height:18px;box-shadow:0 8px 28px rgba(0,0,0,.14),0 0 0 1px rgba(0,0,0,.04);pointer-events:none;}',
    '[data-dsh-anchors-tip-title]{font-size:13px;line-height:18px;font-weight:650;color:var(--dsw-alias-label-primary,#111);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}',
    '[data-dsh-anchors-tip-body]{margin-top:4px;font-size:12px;line-height:17px;font-weight:400;color:var(--dsw-alias-label-secondary,#6b6b6b);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}',
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

/**
 * Pin the rail to the conversation scrollport's visible box (viewport-fixed).
 * Using the scrollport top — not ConversationRoot — keeps it below the
 * session header / 对话·轨迹 tabs and above the composer.
 * Hidden entirely on the Trajectory tab.
 */
function layoutOutline(host, outline) {
  if (!(host instanceof HTMLElement) || outline === undefined) return
  if (isTrajectoryView(host)) {
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
  outline.style.left = `${Math.round(scrollRect.left + 6)}px`
  outline.style.top = `${Math.round(scrollRect.top)}px`
  outline.style.bottom = `${Math.max(0, Math.round(window.innerHeight - bottomEdge))}px`
  outline.style.maxHeight = 'none'
}

/**
 * Hide ChatView's "加载更早" paging control. CSS modules hash the official
 * `.older` class, so we mark the chrome row that sits above the first
 * `[data-chat-anchor-key]` (and any leftover labelled button).
 */
function hideOlderButtons() {
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
  let empty
  let host
  let placed = false
  let currentSessionId = undefined
  let currentUnsubscribe = undefined
  let tip
  let tipTimer
  let waveIndex = -1
  let waveLockedIndex = -1
  let lastWaveY
  let resizeObserver
  let drainGeneration = 0
  let drainActive = false
  const drainedIds = new Set()
  const anchorItems = new Map()
  const currentDrainGen = () => drainGeneration

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
    let left = tickRect.right + 12
    let top = itemRect.top + itemRect.height / 2 - tipRect.height / 2
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

  const showTip = (item, title, body, immediate) => {
    if (typeof title !== 'string' || title === '') return
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
      placeTip(node, item)
    }
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer)
      tipTimer = undefined
    }
    if (immediate === true && tip !== undefined) {
      paint()
      return
    }
    if (tip !== undefined && immediate !== true) {
      hideTip()
    }
    tipTimer = window.setTimeout(paint, immediate === true ? 0 : 50)
  }

  const railItems = () => list === undefined
    ? []
    : [...list.querySelectorAll('[data-dsh-anchors-item]')]

  const clearWave = () => {
    waveIndex = -1
    if (list === undefined) return
    list.removeAttribute('data-waving')
    for (const item of railItems()) item.removeAttribute('data-wave')
    hideTip()
  }

  const dismissWave = (item) => {
    const items = railItems()
    waveLockedIndex = items.indexOf(item)
    clearWave()
  }

  const applyWave = (index) => {
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

  const render = () => {
    if (list === undefined || empty === undefined || outline === undefined) return
    hideOlderButtons()
    const snapshot = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session?.getSnapshot?.()
    const anchors = snapshot === undefined ? [] : buildAnchors(snapshot)

    while (list.firstChild !== null) list.removeChild(list.firstChild)
    anchorItems.clear()

    if (anchors.length === 0) {
      outline.setAttribute('data-empty', '')
      list.appendChild(empty)
      return
    }
    outline.removeAttribute('data-empty')
    for (const anchor of anchors) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('data-dsh-anchors-item', '')
      item.setAttribute('data-anchor-key', anchor.key)
      item.setAttribute('aria-label', anchor.answer !== ''
        ? `${anchor.summary}\n${anchor.answer}`
        : anchor.summary)
      const previewBody = clipPreview(anchor.answer !== '' ? anchor.answer : '', 160)
      item.setAttribute('data-summary', anchor.summary)
      item.setAttribute('data-body', previewBody)
      item.addEventListener('pointerdown', () => { dismissWave(item) })
      item.addEventListener('click', () => {
        dismissWave(item)
        if (scrollToAnchor(anchor.key)) flashItem(item)
      })
      item.addEventListener('focus', () => {
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
      const tick = document.createElement('span')
      tick.setAttribute('data-dsh-anchors-tick', '')
      item.appendChild(tick)
      list.appendChild(item)
      anchorItems.set(anchor.key, item)
    }
    syncActive()
    if (host !== undefined) layoutOutline(host, outline)
    waveIndex = -1
    if (waveLockedIndex >= 0) return
    if (list.matches(':hover') && lastWaveY !== undefined) {
      applyWave(nearestWaveIndex(lastWaveY))
    }
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
    let pages = 0
    try {
      await waitSnapshot(
        session,
        (snap) => snap.openState === 'open' || snap.openState === 'error',
        generation,
        currentDrainGen,
      )
      if (generation !== drainGeneration) return
      while (pages < MAX_OLDER_PAGES && generation === drainGeneration) {
        const snap = session.getSnapshot?.()
        if (snap === undefined || snap.openState !== 'open' || snap.hasMore !== true) break
        if (snap.loadingOlder === true) {
          await waitSnapshot(session, (next) => next.loadingOlder !== true, generation, currentDrainGen)
          continue
        }
        const sizeBefore = Array.isArray(snap.chat?.order) ? snap.chat.order.length : 0
        await session.loadOlder()
        pages += 1
        if (generation !== drainGeneration) return
        const after = session.getSnapshot?.()
        const sizeAfter = Array.isArray(after?.chat?.order) ? after.chat.order.length : 0
        if (after?.hasMore === true && sizeAfter <= sizeBefore) break
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
      }
      hideOlderButtons()
    }
  }

  const maybeDrain = (session, sessionId) => {
    if (session === undefined || typeof session.loadOlder !== 'function' || sessionId === undefined) return
    if (drainedIds.has(sessionId) || drainActive) return
    const snap = session.getSnapshot?.()
    if (snap?.openState === 'open' && snap.hasMore !== true) {
      drainedIds.add(sessionId)
      return
    }
    void drainOlder(session, sessionId)
  }

  const followCurrent = () => {
    if (ctx?.sessions?.list?.getSnapshot === undefined) return
    const snapshot = ctx.sessions.list.getSnapshot()
    const next = snapshot?.current
    if (next === currentSessionId) {
      render()
      maybeDrain(ctx.sessions.binding?.(next)?.session, next)
      return
    }
    drainGeneration += 1
    drainActive = false
    currentSessionId = next
    if (currentUnsubscribe !== undefined) {
      currentUnsubscribe()
      currentUnsubscribe = undefined
    }
    if (next === undefined) {
      render()
      return
    }
    const binding = ctx.sessions.binding?.(next)
    const session = binding?.session
    if (session !== undefined && typeof session.subscribe === 'function') {
      currentUnsubscribe = session.subscribe(render)
    }
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

  /** Highlight the anchor item whose node is currently nearest the viewport top. */
  const syncActive = () => {
    if (outline === undefined || host === undefined) return
    const scroll = host.matches('[data-conversation-scroll]')
      ? host
      : host.querySelector('[data-conversation-scroll]')
    const key = scroll instanceof HTMLElement ? visibleAnchorKey(scroll) : undefined
    for (const [anchorKey, item] of anchorItems) {
      if (anchorKey === key) item.setAttribute('data-active', '')
      else item.removeAttribute('data-active')
    }
  }

  /** Bound scroll handler (throttled by rAF so streaming re-layout stays cheap). */
  let scrollRaf = undefined
  const onScrollSpy = () => {
    if (scrollRaf !== undefined) return
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = undefined
      syncActive()
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
      hideOlderButtons()
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

  const hostObserver = new MutationObserver(() => {
    if (host === undefined || !host.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (outline !== undefined && !host.contains(outline)) {
      placed = placeOutline(host)
      bindResize(host)
    } else {
      layoutOutline(host, outline)
      hideOlderButtons()
      if (outline.hidden) hideTip()
    }
  })

  const listDispose = ctx?.sessions?.list?.subscribe?.(followCurrent)

  outline = document.createElement('div')
  outline.setAttribute('data-dsh-anchors-outline', '')
  outline.setAttribute('data-dsh-anchors-version', PLUGIN_VERSION)
  outline.setAttribute('aria-label', t('title'))

  list = document.createElement('div')
  list.setAttribute('data-dsh-anchors-list', '')
  list.addEventListener('mousemove', (event) => {
    lastWaveY = event.clientY
    const index = nearestWaveIndex(event.clientY)
    if (waveLockedIndex >= 0) {
      if (index === waveLockedIndex) return
      waveLockedIndex = -1
    }
    if (index === waveIndex) return
    applyWave(index)
  })
  list.addEventListener('mouseleave', () => {
    lastWaveY = undefined
    waveLockedIndex = -1
    if (list !== undefined && list.contains(document.activeElement)) return
    clearWave()
  })
  outline.appendChild(list)

  empty = document.createElement('div')
  empty.setAttribute('data-dsh-anchors-empty', '')
  empty.textContent = t('empty')

  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)

  followCurrent()
  tryPlace()

  return () => {
    drainGeneration += 1
    drainActive = false
    waitObserver.disconnect()
    hostObserver.disconnect()
    resizeObserver?.disconnect()
    window.removeEventListener('resize', onWindowChange)
    window.removeEventListener('scroll', onWindowChange, true)
    hideTip()
    if (currentUnsubscribe !== undefined) currentUnsubscribe()
    if (typeof listDispose === 'function') listDispose()
    host?.removeAttribute('data-dsh-anchors-host')
    outline?.remove()
  }
}

/** Services required before the outline can read session state. */
const inject = ['sessions']

/** True when a flow item still has a live Think/tool row. */
function turnIsRunning(items) {
  return items.some((el) => (
    el.getAttribute('data-state') === 'running'
    || el.querySelector('[data-state="running"]') !== null
  ))
}

/** Process rows inside one flow item: Think disclosures and whole tool-call cards. */
function processTargets(item) {
  const kind = item.getAttribute('data-chat-flow-kind')
  if (kind === 'tool-call') return [item]
  const thinks = [...item.querySelectorAll('[data-variant="think"]')]
  if (thinks.length === 0) return []
  const parent = thinks[0].parentElement
  if (parent !== null) {
    let onlyThink = true
    for (const child of parent.children) {
      if (child.getAttribute('data-variant') === 'think') continue
      if ((child.textContent ?? '').trim() !== '') {
        onlyThink = false
        break
      }
    }
    if (onlyThink) return [item]
  }
  return thinks
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

/**
 * After a turn finishes, fold Think + tool-call rows behind one disclosure.
 * Click expands; a live (running) turn stays open.
 */
function mountProcessFold() {
  const expanded = new Set()
  const toggles = new Map()
  let observer
  let timer

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
    if (chevron !== null) chevron.textContent = collapsed ? '›' : '‹'
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggle.setAttribute('title', collapsed ? t('processExpand') : t('processCollapse'))
    const parent = anchor.parentElement
    if (parent !== null && toggle.parentElement !== parent) parent.insertBefore(toggle, anchor)
    else if (parent !== null && toggle.nextElementSibling !== anchor) parent.insertBefore(toggle, anchor)
    return toggle
  }

  const sync = () => {
    const scroll = document.querySelector('[data-conversation-scroll]')
    if (!(scroll instanceof HTMLElement) || isTrajectoryView(scroll.parentElement ?? scroll)) {
      for (const id of [...toggles.keys()]) clearToggle(id)
      return
    }
    const seen = new Set()
    for (const turn of collectTurns(scroll)) {
      const targets = turn.items.flatMap(processTargets)
      if (targets.length === 0) {
        clearToggle(turn.id)
        continue
      }
      seen.add(turn.id)
      const running = turnIsRunning(turn.items)
      const collapsed = !running && !expanded.has(turn.id)
      const firstFlow = turn.items.find((item) => processTargets(item).length > 0)
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
  sync()

  return () => {
    observer.disconnect()
    if (timer !== undefined) window.clearTimeout(timer)
    for (const id of [...toggles.keys()]) clearToggle(id)
    for (const el of document.querySelectorAll('[data-dsh-process-hide]')) {
      el.removeAttribute('data-dsh-process-hide')
    }
  }
}

/** Browser-half apply: mount the outline and process-fold under lifetime effects. */
function apply(ctx) {
  console.info(`[dsh-conversation-anchors] ${PLUGIN_VERSION} Codex rail`)
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
      dispose = mountProcessFold()
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
