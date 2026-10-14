import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function browser() {
  const styles = []
  const attributes = () => {
    const values = new Map()
    return { setAttribute: (key, value) => values.set(key, value), getAttribute: key => values.get(key) ?? null }
  }
  const document = {
    documentElement: attributes(),
    head: { appendChild: element => styles.push(element) },
    createElement: () => ({ ...attributes(), remove() { styles.splice(styles.indexOf(this), 1) } }),
    getElementById: id => styles.find(element => element.id === id) ?? null,
  }
  let plugin
  const window = { __ModuleLoader__: { load: entry => { plugin = entry.factory(() => undefined) } } }
  runInNewContext(source, { document, window, console: { info() {}, warn() {} } })
  const apply = () => plugin.apply({ inject() {}, effect() {} })
  // DSH claims unowned tags when materializing a module, then removes its tags on reload.
  const loadOther = owner => {
    for (const element of styles) if (element.getAttribute('data-plugin') === null) element.setAttribute('data-plugin', owner)
  }
  const unload = owner => {
    for (const element of [...styles]) if (element.getAttribute('data-plugin') === owner) element.remove()
  }
  return { styles, apply, loadOther, unload }
}

test('其他插件加载、停用或重载时保留锚点样式', () => {
  const page = browser()
  page.apply()
  const style = page.styles[0]
  for (const owner of ['@deepseekharness-plugin/dsh-model-efforts', '@deepseekharness-plugin/dsh-codex-picker']) {
    page.loadOther(owner)
    page.unload(owner)
    assert.equal(page.styles[0], style)
    assert.equal(style.getAttribute('data-plugin'), name)
  }
})

test('重复挂载复用样式节点，并纠正旧节点的错误归属', () => {
  const page = browser()
  page.apply()
  const style = page.styles[0]
  style.setAttribute('data-plugin', 'other-plugin')
  page.apply()
  assert.equal(page.styles.length, 1)
  assert.equal(page.styles[0], style)
  assert.equal(style.getAttribute('data-plugin'), name)
})

test('锚点自身重载时能清理并重新创建自己的样式', () => {
  const page = browser()
  page.apply()
  page.unload(name)
  assert.equal(page.styles.length, 0)
  page.apply()
  assert.equal(page.styles.length, 1)
  assert.equal(page.styles[0].getAttribute('data-plugin'), name)
})
