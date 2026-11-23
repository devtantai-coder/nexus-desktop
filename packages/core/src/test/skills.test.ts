import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../store.ts'

let dir = ''
let store: Store

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-skills-test-'))
  store = new Store(join(dir, 'nexus.db'))
  store.migrate()
})

after(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('skills: save, self-improve by name, bump use, search and delete', () => {
  const first = store.skillSave({
    name: 'fix build',
    description: 'Quy trình sửa build',
    content: '1. chạy build\n2. đọc lỗi\n3. sửa lại',
    tags: ['auto'],
  })
  assert.equal(first.version, 1)
  assert.equal(first.useCount, 0)

  const second = store.skillSave({
    name: 'fix build',
    description: 'Quy trình sửa build (cập nhật)',
    content: '1. chạy build\n2. đọc lỗi\n3. sửa lại\n4. verify',
  })
  assert.equal(second.id, first.id)
  assert.equal(second.version, 2)

  store.skillBumpUse([String(first.id)])
  const found = store.skillSearch('sửa build')
  assert.ok(found.length >= 1)
  assert.equal(Number(found[0]['useCount']), 1)
  assert.ok(store.skillList(10).length >= 1)

  store.skillDelete(String(first.id))
  assert.equal(store.skillGet(String(first.id)), null)
})
