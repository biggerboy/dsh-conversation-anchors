/**
 * dsh-conversation-anchors — host half.
 *
 * Registers the `conversation-anchors` settings namespace so the browser half
 * can persist rail style (Codex left / DeepSeek right / DSH built-in). All UI still lives in
 * the client half (./client).
 *
 * DSH 0.2.x: export `Config` (volatile fields) + `settings.configure({ auto: false })`.
 * DSH 0.1.x: keep `settings.register(ns, schema, { applies: 'live' })`.
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

/** Host settings namespace (kebab, matches the client bind key / cordis entry id). */
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

/** Load schemastery from cwd or the running `dsh` CLI. */
function loadSchemastery() {
  const mod = loadPeer('@deepseek-ai/schemastery')
  const z = mod?.default ?? mod
  return typeof z?.object === 'function' ? z : undefined
}

/** Mark a field volatile when the running schemastery supports it (0.2.x forms). */
function asVolatile(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

/**
 * Build the durable style schema used by both Config (0.2.x) and register (0.1.x).
 * @param z - schemastery root.
 */
function styleField(z) {
  return asVolatile(z.union(['codex', 'deepseek', 'official']).default(DEFAULT_STYLE))
}

const schemastery = loadSchemastery()

/**
 * DSH 0.2.x projects plugin `Config` into the settings describe mirror.
 * Absent when schemastery cannot be resolved (rail then uses localStorage only).
 */
export const Config = schemastery === undefined
  ? undefined
  : schemastery.object({
    [STYLE_FIELD]: styleField(schemastery),
  })

/**
 * Register / present the durable section when a settings provider exists.
 * - 0.2.x: `Config` already projects the form; `configure({ auto: false })` keeps
 *   the custom General-slot row (no auto-generated settings page).
 * - 0.1.x: `settings.register(ns, schema, { applies: 'live' })`.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (settings === undefined || settings === null) return

    // DSH 0.2.x — presentation only; schema comes from exported Config.
    if (typeof settings.configure === 'function') {
      settingsCtx.effect(
        () => settings.configure({ auto: false }, ctx.fiber),
        'conversation-anchors: settings presentation',
      )
      return
    }

    // DSH 0.1.x — explicit namespace registration.
    if (typeof settings.register !== 'function') {
      console.warn('[conversation-anchors] settings API unrecognized; rail style stays in localStorage')
      return
    }
    const z = loadSchemastery()
    if (z === undefined) {
      console.warn('[conversation-anchors] @deepseek-ai/schemastery not resolved; rail style stays in localStorage')
      return
    }
    const schema = z.object({
      [STYLE_FIELD]: z.union(['codex', 'deepseek', 'official']).default(DEFAULT_STYLE),
    })
    settings.register(
      settingsNamespace(SETTINGS_NS),
      schema,
      { applies: 'live' },
    )
  })
}
