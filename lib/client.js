/**
 * dsh-conversation-anchors — browser half.
 *
 * Injects a conversation outline into the left gutter of the conversation
 * pane (not the app sidebar): one anchor per user-sent message. Hovering an
 * item reveals the full title; clicking scrolls to that node's
 * `[data-chat-anchor-key]` row. The rail is borderless and collapsible, and
 * sits below the session header so it does not cover the top bar.
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
 * using the package name as id, or the shell reports:
 * "loaded without registering ... via __ModuleLoader__.load".
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-anchors',
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

const COLLAPSED_KEY = 'dsh-conversation-anchors:collapsed'

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch { /* ignore quota / private mode */ }
}

/** Collapse whitespace in a summary string; keep the full title for hover. */
function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
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
  if (content.some((b) => b !== null && typeof b === 'object' && b.type === 'image')) return '图片'
  return '你'
}

/**
 * Build the ordered anchor list from user-sent messages only.
 * @returns {Array<{key: string, index: number, summary: string}>}
 */
function buildAnchors(snapshot) {
  const order = snapshot?.chat?.order
  const nodes = snapshot?.chat?.nodes
  if (!Array.isArray(order) || nodes === undefined) return []
  const anchors = []
  for (const key of order) {
    const node = nodes.get?.(key)
    if (node === undefined || node === null) continue
    if (node.kind !== 'user') continue
    if (node.visibility === 'hidden') continue
    anchors.push({
      key: typeof node.key === 'string' ? node.key : key,
      index: anchors.length + 1,
      summary: nodeSummary(node),
    })
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
    '[data-dsh-anchors-outline][hidden]{display:none!important;}',
    '[data-dsh-process-hide]{display:none!important;}',
    '[data-dsh-process-toggle]{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:2px 0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);font:inherit;font-size:14px;line-height:24px;text-align:left;cursor:pointer;}',
    '[data-dsh-process-toggle]:hover{color:var(--dsw-alias-label-secondary,#666);}',
    '[data-dsh-process-toggle] [data-dsh-process-label]{font-weight:400;}',
    '[data-dsh-process-toggle] [data-dsh-process-count]{opacity:.8;}',
    '[data-dsh-process-toggle] [data-dsh-process-chevron]{margin-left:auto;flex:none;font-size:12px;line-height:1;opacity:.7;}',
    '[data-dsh-anchors-outline]{box-sizing:border-box;position:fixed;left:8px;width:172px;z-index:3;display:flex;flex-direction:column;margin:0;padding:4px 2px;border:0;background:transparent;pointer-events:auto;}',
    '[data-dsh-anchors-outline][data-collapsed]{width:28px;bottom:auto!important;height:auto;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-head]{flex:none;display:flex;align-items:center;gap:4px;width:100%;padding:4px 6px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);font:inherit;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.01em;text-align:left;cursor:pointer;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-head]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary,#666);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-title]{flex:auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-chevron]{flex:none;width:14px;font-size:10px;line-height:14px;text-align:center;}',
    '[data-dsh-anchors-outline][data-collapsed] [data-dsh-anchors-title]{display:none;}',
    '[data-dsh-anchors-outline][data-collapsed] [data-dsh-anchors-head]{justify-content:center;padding:6px 0;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-list]{flex:auto;min-height:0;display:flex;flex-direction:column;gap:1px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;}',
    '[data-dsh-anchors-outline][data-collapsed] [data-dsh-anchors-list]{display:none;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item]{box-sizing:border-box;display:flex;align-items:flex-start;gap:6px;width:100%;padding:4px 6px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px;line-height:17px;text-align:left;cursor:pointer;overflow:hidden;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#222);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item][data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item][data-active] [data-dsh-anchors-badge]{background:rgba(56,189,248,.28);color:#075985;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-item][data-flash]{animation:dshAnchorsFlash 1.5s ease-out;}',
    '@keyframes dshAnchorsFlash{0%{background:rgba(56,189,248,.35);}100%{background:transparent;}}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-badge]{flex:none;min-width:15px;height:15px;margin-top:1px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1;font-weight:700;font-variant-numeric:tabular-nums;color:#0284c7;background:rgba(56,189,248,.16);}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-text]{min-width:0;flex:1;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}',
    '[data-dsh-anchors-outline] [data-dsh-anchors-empty]{padding:2px 6px;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:12px;line-height:17px;}',
    '[data-dsh-anchors-tip]{position:fixed;z-index:10000;box-sizing:border-box;max-width:min(420px,calc(100vw - 24px));padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-float,var(--dsw-alias-bg-base,#1e1e1e));color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));font-size:12px;line-height:18px;box-shadow:0 8px 24px rgba(0,0,0,.18);pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;}',
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
  outline.style.left = `${Math.round(scrollRect.left + 8)}px`
  outline.style.top = `${Math.round(scrollRect.top + 8)}px`
  if (outline.hasAttribute('data-collapsed')) {
    outline.style.bottom = 'auto'
    return
  }
  const bottomEdge = composer instanceof HTMLElement
    ? composer.getBoundingClientRect().top
    : scrollRect.bottom
  const bottom = Math.max(8, Math.round(window.innerHeight - bottomEdge + 8))
  outline.style.bottom = `${bottom}px`
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
  let resizeObserver
  const anchorItems = new Map()

  const hideTip = () => {
    if (tipTimer !== undefined) {
      window.clearTimeout(tipTimer)
      tipTimer = undefined
    }
    tip?.remove()
    tip = undefined
  }

  const showTip = (item, text) => {
    hideTip()
    if (typeof text !== 'string' || text === '') return
    tipTimer = window.setTimeout(() => {
      tipTimer = undefined
      const node = document.createElement('div')
      node.setAttribute('data-dsh-anchors-tip', '')
      node.textContent = text
      document.body.appendChild(node)
      const itemRect = item.getBoundingClientRect()
      const tipRect = node.getBoundingClientRect()
      let left = itemRect.right + 8
      let top = itemRect.top
      if (left + tipRect.width > window.innerWidth - 8) {
        left = Math.max(8, itemRect.left - tipRect.width - 8)
      }
      if (top + tipRect.height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - tipRect.height - 8)
      }
      if (top < 8) top = 8
      node.style.left = `${left}px`
      node.style.top = `${top}px`
      tip = node
    }, 180)
  }

  const placeOutline = (targetHost) => {
    if (outline === undefined) return false
    if (outline.parentElement !== targetHost) targetHost.appendChild(outline)
    targetHost.setAttribute('data-dsh-anchors-host', '')
    layoutOutline(targetHost, outline)
    return true
  }

  const render = () => {
    if (list === undefined || empty === undefined) return
    const snapshot = currentSessionId === undefined
      ? undefined
      : ctx.sessions?.binding?.(currentSessionId)?.session?.getSnapshot?.()
    const anchors = snapshot === undefined ? [] : buildAnchors(snapshot)

    while (list.firstChild !== null) list.removeChild(list.firstChild)
    anchorItems.clear()

    if (anchors.length === 0) {
      list.appendChild(empty)
      return
    }
    for (const anchor of anchors) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('data-dsh-anchors-item', '')
      item.setAttribute('data-anchor-key', anchor.key)
      item.setAttribute('aria-label', anchor.summary)
      item.addEventListener('click', () => {
        if (scrollToAnchor(anchor.key)) flashItem(item)
      })
      item.addEventListener('mouseenter', () => { showTip(item, anchor.summary) })
      item.addEventListener('mouseleave', hideTip)
      item.addEventListener('focus', () => { showTip(item, anchor.summary) })
      item.addEventListener('blur', hideTip)
      const badge = document.createElement('span')
      badge.setAttribute('data-dsh-anchors-badge', '')
      badge.textContent = String(anchor.index)
      const text = document.createElement('span')
      text.setAttribute('data-dsh-anchors-text', '')
      text.textContent = anchor.summary
      item.appendChild(badge)
      item.appendChild(text)
      list.appendChild(item)
      anchorItems.set(anchor.key, item)
    }
    syncActive()
  }

  const followCurrent = () => {
    if (ctx?.sessions?.list?.getSnapshot === undefined) return
    const snapshot = ctx.sessions.list.getSnapshot()
    const next = snapshot?.current
    if (next === currentSessionId) {
      render()
      return
    }
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

  /** Briefly flash an anchor item after a click-to-jump, as landing feedback. */
  const flashItem = (item) => {
    if (!(item instanceof HTMLElement)) return
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
      if (outline.hidden) hideTip()
    }
  })

  const listDispose = ctx?.sessions?.list?.subscribe?.(followCurrent)

  outline = document.createElement('div')
  outline.setAttribute('data-dsh-anchors-outline', '')

  const head = document.createElement('button')
  head.type = 'button'
  head.setAttribute('data-dsh-anchors-head', '')
  const title = document.createElement('span')
  title.setAttribute('data-dsh-anchors-title', '')
  title.textContent = '对话锚点'
  const chevron = document.createElement('span')
  chevron.setAttribute('data-dsh-anchors-chevron', '')
  head.appendChild(title)
  head.appendChild(chevron)
  outline.appendChild(head)

  const applyCollapsed = (collapsed) => {
    if (collapsed) outline.setAttribute('data-collapsed', '')
    else outline.removeAttribute('data-collapsed')
    chevron.textContent = collapsed ? '›' : '‹'
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    head.setAttribute('title', collapsed ? '展开对话锚点' : '折叠对话锚点')
    hideTip()
    if (host !== undefined) layoutOutline(host, outline)
  }

  head.addEventListener('click', () => {
    const next = !outline.hasAttribute('data-collapsed')
    writeCollapsed(next)
    applyCollapsed(next)
  })

  list = document.createElement('div')
  list.setAttribute('data-dsh-anchors-list', '')
  outline.appendChild(list)

  empty = document.createElement('div')
  empty.setAttribute('data-dsh-anchors-empty', '')
  empty.textContent = '暂无消息'

  applyCollapsed(readCollapsed())

  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)

  followCurrent()
  tryPlace()

  return () => {
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
    if (label !== null) label.textContent = '思考过程'
    if (countEl !== null) countEl.textContent = `· ${count} 步`
    if (chevron !== null) chevron.textContent = collapsed ? '›' : '‹'
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggle.setAttribute('title', collapsed ? '展开思考过程' : '收起思考过程')
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
