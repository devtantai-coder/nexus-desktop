import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { goalPromptLines, projectRules } from '../agent.ts'
import { Core } from '../index.ts'
import { EventBus } from '../events.ts'
import { WorkspaceWatcher } from '../watcher.ts'
import { ensureDirectory, writeFileAtomic } from '../util.ts'

let tempDir = ''
let core: Core

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-core-service-'))
  core = new Core({
    databasePath: join(tempDir, 'nexus.db'),
    userDataDir: tempDir,
    appVersion: '9.9.9',
  })
  core.initialize()
})

after(() => {
  core.shutdown()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('projectRules', () => {
  it('đọc AGENTS.md và ưu tiên hơn CLAUDE.md', () => {
    const dir = mkdtempSync(join(tempDir, 'rules-'))
    assert.equal(projectRules(dir), '')
    writeFileAtomic(join(dir, 'AGENTS.md'), '  Dùng pnpm, không npm.\n')
    const rules = projectRules(dir)
    assert.ok(rules.includes('AGENTS.md'))
    assert.ok(rules.includes('Dùng pnpm'))
    writeFileAtomic(join(dir, 'CLAUDE.md'), 'CLAUDE RULES\n')
    assert.ok(!projectRules(dir).includes('CLAUDE RULES'))
  })
})

describe('goalPromptLines', () => {
  it('dựng prompt từ goal', () => {
    assert.equal(goalPromptLines(null), '')
    assert.equal(goalPromptLines({ objective: '  ' }), '')
    const lines = goalPromptLines({ objective: 'Ship MCP OAuth', rounds: 3 })
    assert.ok(lines.includes('Ship MCP OAuth'))
    assert.ok(lines.includes('Rounds so far: 3'))
    assert.ok(lines.includes('NEXUS_GOAL_DONE'))
  })
})

describe('Core dispatch', () => {
  it('seed settings tiếng Việt', async () => {
    const settings = (await core.request('settings.all', {})) as Record<string, unknown>
    assert.equal(settings['language.locale'], 'vi')
  })

  it('project.open + workspace tree/read/write', async () => {
    const projectDir = join(tempDir, 'project')
    ensureDirectory(projectDir)
    writeFileAtomic(join(projectDir, 'index.ts'), 'const x = 1\n')
    const project = (await core.request('project.open', { path: projectDir })) as { id: string; path: string }
    assert.equal(project.path, projectDir)
    const tree = (await core.request('workspace.tree', { projectId: project.id, depth: 1 })) as {
      children: unknown[]
    }
    assert.ok(Array.isArray(tree.children))
    const read = (await core.request('workspace.readFile', {
      projectId: project.id,
      path: 'index.ts',
    })) as { content: string }
    assert.ok(read.content.includes('const x'))
    const write = (await core.request('workspace.writeFile', {
      projectId: project.id,
      path: 'index.ts',
      content: 'const y = 2\n',
    })) as { size: number }
    assert.equal(write.size, 12)
    const session = (await core.request('session.create', {
      projectId: project.id,
      title: 'Core session',
    })) as { id: string; title: string }
    assert.equal(session.title, 'Core session')
    const messages = (await core.request('session.messages', { sessionId: session.id })) as unknown[]
    assert.ok(Array.isArray(messages))

    const steer = (await core.request('agent.steer', { taskId: 'missing-task', prompt: 'steer' })) as {
      queued: boolean
    }
    assert.equal(steer.queued, false)
    const stopAfter = (await core.request('agent.stopAfterTurn', { taskId: 'missing-task' })) as {
      stopped: boolean
    }
    assert.equal(stopAfter.stopped, false)

    await assert.rejects(
      () => core.request('agent.contextUsage', { taskId: 'missing-task' }),
      (error: Error & { code?: string }) => error.code === 'E_DB',
    )
    await assert.rejects(
      () => core.request('agent.rewind', { taskId: 'missing-task' }),
      (error: Error & { code?: string }) => error.code === 'E_DB',
    )
    await assert.rejects(
      () => core.request('session.rewind', { sessionId: session.id, messageId: 'missing-message' }),
      (error: Error & { code?: string }) => error.code === 'E_VALIDATION',
    )
    const backup = (await core.request('db.backup', {})) as { path: string }
    assert.ok(existsSync(backup.path))
    await assert.rejects(
      () => core.request('nope.method', {}),
      (error: Error & { code?: string }) => error.code === 'E_METHOD',
    )
  })
})

describe('WorkspaceWatcher', () => {
  it('phát sự kiện khi file đổi', async () => {
    const dir = mkdtempSync(join(tempDir, 'watch-'))
    const events = new EventBus()
    let changed = false
    events.setSink((event) => {
      const typed = event as { type?: string; payload?: { path?: string } }
      if (typed.type !== 'workspace.file.changed') return
      if (typed.payload?.path !== 'watched.txt') return
      changed = true
    })
    const watcher = new WorkspaceWatcher(events)
    watcher.watch('project', dir)
    await new Promise((resolve) => setTimeout(resolve, 250))
    writeFileAtomic(join(dir, 'watched.txt'), 'hello\n')
    const deadline = Date.now() + 3000
    while (!changed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    watcher.unwatch('project')
    assert.ok(changed, 'watcher emits file change')
  })
})
