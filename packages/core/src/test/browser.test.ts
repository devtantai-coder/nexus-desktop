import assert from 'node:assert/strict'
import { test } from 'node:test'

import { browserUrl } from '../browser.ts'
import { ToolRegistry } from '../tools.ts'

test('browserUrl accepts http/https and rejects other schemes', () => {
  assert.equal(browserUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(browserUrl('http://localhost:3000'), 'http://localhost:3000/')
  for (const bad of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'about:blank', 'not a url']) {
    assert.throws(() => browserUrl(bad))
  }
})

test('browser automation tools are registered', () => {
  const tools = ToolRegistry.standard()
  for (const name of [
    'browser_open',
    'browser_read',
    'browser_click',
    'browser_fill',
    'browser_press',
    'browser_screenshot',
    'browser_close',
    'browser_list',
  ]) {
    assert.ok(tools.get(name), `${name} missing`)
  }
  const open = tools.get('browser_open')
  if (!open) throw new Error('browser_open missing')
  assert.deepEqual(open.parameters.required, ['url'])
})
