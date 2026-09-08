/**
 * 发版前断言：Node import 名、浏览器 ModuleLoader id、npm 包名必须字节级相同。
 *
 * DSH 用 cordis.patch.yml 的 `name` 做 profile 目录下的 import()，
 * 又要求 client.js 用同一个字符串调用 __ModuleLoader__.load({ id })。
 * 两处和 package.json 的 name 只要有一处漂移，Web 就会 Failed to load plugins。
 *
 * cordis 的 export const name（lib/index.js）是插件 id，允许与包名不同，这里不检查。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function mustMatch(label, pattern, source, rel) {
  const match = source.match(pattern)
  if (match === null) {
    throw new Error(`${rel} 里找不到 ${label}（正则：${pattern}）`)
  }
  return match[1]
}

const pkg = JSON.parse(read('package.json'))
const expected = pkg.name
if (typeof expected !== 'string' || expected === '') {
  throw new Error('package.json 缺少 name')
}

const patchRel = pkg.dsh?.bundle?.patch ?? './cordis.patch.yml'
const yaml = read(patchRel)
const client = read('lib/client.js')

const yamlName = mustMatch(
  'bundle name',
  /^\s+name:\s*['"]([^'"]+)['"]/m,
  yaml,
  patchRel,
)
const loaderId = mustMatch(
  'ModuleLoader id',
  /__ModuleLoader__\.load\(\s*\{\s*id:\s*['"]([^'"]+)['"]/,
  client,
  'lib/client.js',
)
const pluginVersion = mustMatch(
  'PLUGIN_VERSION',
  /^const PLUGIN_VERSION = ['"]([^'"]+)['"]/m,
  client,
  'lib/client.js',
)

const errors = []
if (yamlName !== expected) {
  errors.push(`cordis.patch.yml name "${yamlName}" !== package.json name "${expected}"`)
}
if (loaderId !== expected) {
  errors.push(`__ModuleLoader__.load id "${loaderId}" !== package.json name "${expected}"`)
}
if (pluginVersion !== pkg.version) {
  errors.push(`PLUGIN_VERSION "${pluginVersion}" !== package.json version "${pkg.version}"`)
}

if (errors.length > 0) {
  console.error('bundle id 校验失败（改一处必须三处一起改）：')
  for (const line of errors) console.error(`  - ${line}`)
  process.exit(1)
}

console.log(`bundle id ok: ${expected}@${pkg.version}`)
