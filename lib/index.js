/**
 * dsh-conversation-anchors — host half (no-op).
 *
 * This plugin is browser-only: the content-area anchor list and click-to-scroll
 * navigation live entirely in the client half (./client). The host half
 * exists only so the bundle patch row can be loaded as a cordis plugin in the
 * node process. It registers nothing and tears nothing down.
 *
 * @module dsh-conversation-anchors
 */

/** Stable cordis plugin name. */
export const name = 'conversation-anchors'

/** No host services are required. */
export const inject = []

/**
 * Host-side apply: intentionally empty. The browser half (./client) carries
 * all behavior via the `dsh.client` declaration in package.json.
 * @param _ctx - host cordis context (unused).
 */
export function apply(_ctx) {
  // No host-side surfaces to mount.
}
