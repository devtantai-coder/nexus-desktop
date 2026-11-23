import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { MemoryManager } from '../memory.ts'
import { Store } from '../store.ts'

const withDir = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('memory: MEMORY.md and USER.md seed, persist, validate and feed prompt', () => {
  withDir((dir) => {
    const memory = new MemoryManager(dir)
    const seeded = memory.files()
    assert.deepEqual(
      seeded.map((file) => file.kind),
      ['MEMORY.md', 'USER.md'],
    )
    assert.ok(existsSync(join(dir, 'MEMORY.md')))
    assert.ok(existsSync(join(dir, 'USER.md')))
    assert.equal(seeded[0]?.template, true)
    assert.deepEqual(memory.promptLines(), [], 'templates are not injected into the prompt')

    memory.write('USER.md', 'Người dùng nói tiếng Việt.')
    memory.write('MEMORY.md', 'Project X dùng pnpm và chạy typecheck trước commit.')
    const reopened = new MemoryManager(dir)
    assert.equal(reopened.read('USER.md').content, 'Người dùng nói tiếng Việt.')
    assert.equal(reopened.read('USER.md').template, false)
    const lines = reopened.promptLines()
    assert.equal(lines.length, 2)
    assert.ok(lines[0]?.includes('MEMORY.md:'))
    assert.ok(lines[1]?.includes('tiếng Việt'))

    assert.throws(
      () => memory.write('../secrets.env' as 'MEMORY.md', 'bad'),
      /MEMORY.md or USER.md/,
    )
    assert.throws(() => memory.write('MEMORY.md', 'x'.repeat(200_001)), /too large/)
  })
})

test('store: empty projectId is normalised to NULL for FK columns', () => {
  withDir((dir) => {
    const store = new Store(join(dir, 'nexus.db'))
    store.migrate()
    store.seedDefaults()
    try {
      const session = store.sessionCreate({ title: 'Không dự án', projectId: '' })
      assert.equal(session['projectId'], undefined)
      const task = store.taskCreate({
        sessionId: String(session['id']),
        projectId: '',
        prompt: 'probe',
        title: 'probe',
      })
      assert.equal(task['projectId'], undefined)
      const note = store.memoryCreate({ projectId: '', kind: 'fact', content: 'global note' })
      assert.equal(note['projectId'], undefined)
      assert.equal(store.memoryList(undefined, 10).length, 1)
    } finally {
      store.close()
    }
  })
})

test('memory: project notes and conversation history are searchable', () => {
  withDir((dir) => {
    const store = new Store(join(dir, 'nexus.db'))
    store.migrate()
    store.seedDefaults()
    try {
      const session = store.sessionCreate({ title: 'Phiên tìm kiếm' })
      const sessionId = String(session['id'])
      store.messageCreate({ sessionId, role: 'user', content: 'nhớ mã màu xanh-lá cần thử lại' })
      store.messageCreate({ sessionId, role: 'assistant', content: 'đã ghi nhận' })
      const note = store.memoryCreate({
        kind: 'decision',
        content: 'Quy ước đặt tên biến snake_case',
        tags: ['style'],
      })

      const noteHits = store.memorySearch('snake_case', 10)
      assert.equal(noteHits.length, 1)
      assert.equal(noteHits[0]['id'], note['id'])
      assert.equal(store.memorySearch('', 10).length, 0)

      const hits = store.messageSearch('xanh-lá', 10)
      assert.equal(hits.length, 1)
      assert.equal(hits[0]['sessionId'], sessionId)
      assert.equal(hits[0]['sessionTitle'], 'Phiên tìm kiếm')
      assert.equal(hits[0]['role'], 'user')
      assert.equal(store.messageSearch('xanh-lá', 10, 'khac').length, 0)

      const global = store.memoryList(undefined, 10)
      assert.equal(global.length, 1, 'notes are available to future sessions')
    } finally {
      store.close()
    }
  })
})
