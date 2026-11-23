import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EventBus } from '../events.ts'
import { TerminalManager } from '../terminal.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('terminal: mỗi owner có phiên riêng, read trả output của chính phiên đó', async () => {
  const manager = new TerminalManager(new EventBus())
  const first = manager.create({ owner: 'task-a' })
  const second = manager.create({ owner: 'task-b' })
  const firstId = String(first['id'])
  const secondId = String(second['id'])

  assert.equal(first['owner'], 'task-a')
  assert.equal(second['owner'], 'task-b')
  assert.equal(manager.listForOwner('task-a').length, 1)
  assert.equal(manager.listForOwner('task-b').length, 1)
  assert.equal(manager.listForOwner('task-a')[0]?.['id'], firstId)

  try {
    manager.write(firstId, 'echo NEXUS_OWNED_TERMINAL\n')
    let text = ''
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(50)
      try {
        text = manager.read(firstId)
      } catch {
        break
      }
      if (text.includes('NEXUS_OWNED_TERMINAL')) break
    }
    assert.match(text, /NEXUS_OWNED_TERMINAL/, 'terminal của task-a phải thấy lệnh của chính nó')
    assert.equal(
      manager.read(secondId).includes('NEXUS_OWNED_TERMINAL'),
      false,
      'terminal của task-b không được thấy output của task-a',
    )
  } finally {
    manager.dispose(firstId)
    manager.dispose(secondId)
    manager.disposeAll()
  }
  assert.equal(manager.listForOwner('task-a').length, 0)
  assert.equal(manager.listForOwner('task-b').length, 0)
})

test('terminal: read giới hạn ở ký tự cuối và chặn id không tồn tại', () => {
  const manager = new TerminalManager(new EventBus())
  assert.throws(() => manager.read('missing'), /not found/)
  assert.equal(manager.listForOwner('').length, 0)
  manager.disposeAll()
})
