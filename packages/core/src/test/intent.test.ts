import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Core } from '../index.ts'
import { classifyPromptIntent, collectMarkers } from '../domain/intent.ts'

const expectTop = (prompt: string, expected: string): void => {
  const matches = classifyPromptIntent({ prompt })
  assert.ok(matches.length > 0, `no match for: ${prompt}`)
  assert.equal(matches[0]?.domainId, expected, `top for: ${prompt}`)
  assert.ok((matches[0]?.confidence ?? 0) >= 0.5)
}

test('intent: english prompts route to the right domain', () => {
  expectTop('train a torch model with transformers on this dataset', 'aiml')
  expectTop('fix the cmake cache and g++ linker flags', 'systems')
  expectTop('build the docker compose pipeline for ci/cd', 'devops')
  expectTop('apply the sqlite schema migration to production', 'database')
  expectTop('run nmap and trivy against the authorized target', 'security')
  expectTop('create a godot scene and main.gd for the game', 'game')
  expectTop('build an android apk and check adb devices', 'mobile')
  expectTop('design a qt widget window with qmake', 'desktop')
  expectTop('set up esp32 firmware with platformio', 'embedded')
})

test('intent: vietnamese prompts route to the right domain', () => {
  expectTop('huấn luyện mô hình torch cho bài toán này', 'aiml')
  expectTop('sửa lỗi biên dịch cmake trong thư viện', 'systems')
  expectTop('tạo trang web react vite cho dự án', 'web')
})

test('intent: markers boost a neutral prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-intent-'))
  try {
    writeFileSync(join(dir, 'platformio.ini'), '[env:esp32dev]\n')
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t(a);\n')
    const markers = collectMarkers(dir)
    assert.ok(markers.includes('platformio.ini'))
    assert.ok(markers.includes('schema.sql'))
    const embedded = classifyPromptIntent({ prompt: 'cập nhật project này', markers })
    const ids = embedded.map((entry) => entry.domainId)
    assert.ok(ids.includes('embedded'))
    assert.ok(ids.includes('database'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('intent: unrelated prompt yields no match', () => {
  assert.deepEqual(classifyPromptIntent({ prompt: 'xin chào bạn hôm nay thế nào' }), [])
})

test('intent: IPC domain.intent classifies with workspace markers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-intent-ipc-'))
  const core = new Core({
    databasePath: join(dir, 'nexus.db'),
    userDataDir: dir,
    appVersion: 'test',
  })
  try {
    core.initialize()
    const opened = await core.request('project.open', { path: dir })
    const plain = (await core.request('domain.intent', {
      prompt: 'huấn luyện mô hình torch và transformers',
    })) as Array<{ domainId: string; confidence: number }>
    assert.equal(plain[0]?.domainId, 'aiml')

    writeFileSync(join(dir, 'platformio.ini'), '[env:esp32dev]\n')
    const boosted = (await core.request('domain.intent', {
      prompt: 'cập nhật project này',
      projectId: opened.id,
    })) as Array<{ domainId: string }>
    assert.equal(boosted[0]?.domainId, 'embedded')
  } finally {
    core.shutdown()
    rmSync(dir, { recursive: true, force: true })
  }
})
