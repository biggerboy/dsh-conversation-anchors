/**
 * dsh-conversation-anchors — host half.
 *
 * Registers the `conversation-anchors` settings namespace so the browser half
 * can persist rail style (Codex left / DeepSeek right). All UI still lives in
 * the client half (./client).
 *
 * Peer packages (`@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`) live
 * inside the DSH / web-profile tree. A `link:` checkout sits outside that
 * tree, so this file must not statically import them — Node would fail the
 * whole plugin load. Resolve from cwd / the running `dsh` CLI instead.
 *
 * @module dsh-conversation-anchors
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Stable cordis plugin name. */
export const name = 'conversation-anchors'

/** Settings provider is optional; the rail still works without it. */
export const inject = []

/** Host settings namespace (kebab, matches the client bind key). */
export const SETTINGS_NS = 'conversation-anchors'

/** Durable rail-style field. */
export const STYLE_FIELD = 'style'

/** Default keeps the Codex left rail that existing users already know. */
export const DEFAULT_STYLE = 'codex'

/** Same branding rule as `@deepseek-ai/dsh-settings` (kebab, no extra import). */
function settingsNamespace(value) {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match /^[a-z][a-z0-9-]*$/`)
  }
  return value
}

/**
 * Resolve a DSH peer from the running Host, not from this linked checkout.
 * @param spec - package name.
 * @returns the loaded module, or undefined when no origin can resolve it.
 */
function loadPeer(spec) {
  const origins = [
    join(process.cwd(), 'package.json'),
    process.argv[1],
    import.meta.url,
  ]
  const home = process.env.USERPROFILE ?? process.env.HOME
  if (typeof home === 'string' && home !== '') {
    origins.push(join(home, '.dsh', 'profiles', 'web', 'package.json'))
  }
  if (typeof process.argv[1] === 'string' && process.argv[1] !== '') {
    try {
      origins.push(createRequire(process.argv[1]).resolve('@deepseek-ai/dsh/package.json'))
    } catch {
      /* argv[1] is not inside the dsh CLI tree */
    }
  }
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin === '') continue
    try {
      return createRequire(origin)(spec)
    } catch {
      continue
    }
  }
  return undefined
}

/** Load schemastery from the web profile or the `dsh` CLI install. */
function loadSchemastery() {
  const mod = loadPeer('@deepseek-ai/schemastery')
  const z = mod?.default ?? mod
  return typeof z?.object === 'function' ? z : undefined
}

/**
 * Register the durable section when a settings provider exists.
 * `applies: 'live'` so switching style in 设置 takes effect without restart.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    const z = loadSchemastery()
    if (z === undefined) {
      console.warn('[conversation-anchors] @deepseek-ai/schemastery not resolved; rail style stays in localStorage')
      return
    }
    const schema = z.object({
      style: z.union(['codex', 'deepseek']).default(DEFAULT_STYLE),
    })
    settingsCtx.settings.register(
      settingsNamespace(SETTINGS_NS),
      schema,
      { applies: 'live' },
    )
  })
}
