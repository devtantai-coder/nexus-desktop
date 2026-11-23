import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, after as testAfter } from 'node:test'

import { Core } from '../index.ts'
import { roleBrief, roleConfigDefault } from '../agent.ts'
import { ToolRegistry } from '../tools.ts'

test('orchestrator has an external-library sub-agent role', () => {
  const roles = roleConfigDefault()
  const librarian = roles.find((role: { role: string }) => role.role === 'librarian')
  assert.ok(librarian, 'librarian role missing')
  assert.equal(librarian.enabled, true)
  assert.match(librarian.description, /external-library/i)
})

test('subagent tool is available to the agent', () => {
  const tool = ToolRegistry.standard().get('subagent')
  assert.ok(tool, 'subagent tool missing')
  const properties = tool.parameters.properties as Record<string, unknown>
  assert.ok(properties['prompt'])
  assert.ok(properties['role'])
})

test('mọi vai trò chuyên môn đều có brief riêng, không chỉ role-play', () => {
  const roles = roleConfigDefault()
  assert.equal(roles.length, 7)
  for (const role of roles) {
    const brief = roleBrief(String(role['role']))
    assert.ok(brief.length > 80, `${String(role['role'])} thiếu brief chuyên môn`)
  }
  assert.match(roleBrief('librarian'), /web_search/)
  assert.equal(roleBrief('unknown-role'), '')
})

test('delegate_parallel và terminal tools được đăng ký cho agent', () => {
  const tools = ToolRegistry.standard()
  const parallel = tools.get('delegate_parallel')
  assert.ok(parallel, 'delegate_parallel tool missing')
  assert.equal(parallel.risk, 'write')
  const read = tools.get('agent_terminal_read')
  const write = tools.get('agent_terminal_write')
  assert.ok(read && write, 'agent terminal tools missing')
  assert.equal(read.risk, 'read')
  assert.equal(write.risk, 'exec')
  assert.deepEqual(write.parameters.required, ['data'])
})

let tempDir = ''
let core: Core

testAfter(() => {
  core?.shutdown()
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true })
})

test('orchestrator.run từ chối prompt rỗng và vai trò không tồn tại', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-orchestrator-test-'))
  core = new Core({
    databasePath: join(tempDir, 'nexus.db'),
    userDataDir: tempDir,
    appVersion: 'test',
  })
  core.initialize()
  const session = (await core.request('session.create', { title: 'Orchestrator test' })) as {
    id: string
  }
  await assert.rejects(
    () => core.request('orchestrator.run', { sessionId: session.id, prompt: '  ' }),
    /prompt is required/,
  )
  await assert.rejects(
    () =>
      core.request('orchestrator.run', {
        sessionId: session.id,
        prompt: 'do work',
        roles: ['bogus'],
      }),
    /No enabled orchestrator role/,
  )
})
