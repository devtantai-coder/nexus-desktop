import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Store } from '../store.ts'
import { Workspace } from '../workspace.ts'
import { ToolRegistry } from '../tools.ts'
import type { ToolContext } from '../tools.ts'
import { selectedAgentEngine } from '../agent.ts'
import { writeFileAtomic, ensureDirectory } from '../util.ts'

let tempDir = ''
let store: Store
let workspace: Workspace

const context = (): ToolContext => ({
  store,
  workspace,
  git: null,
  processes: null,
  sessionId: '',
  taskId: '',
  projectId: '',
  mcp: null,
  changes: [],
})

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-tools-test-'))
  ensureDirectory(join(tempDir, 'src'))
  writeFileAtomic(
    join(tempDir, 'src/service.ts'),
    "import { x } from './x'\nexport interface Payload { id: string }\nexport class UserService {\n  run(input: Payload) { return input }\n}\nexport function createService() { return new UserService() }\n",
  )
  writeFileAtomic(join(tempDir, 'README.md'), '# demo\n')
  store = new Store(join(tempDir, 'nexus.db'))
  store.migrate()
  workspace = new Workspace(tempDir)
})

after(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('deep tools', () => {
  it('repo_map tìm tối thiểu 3 symbols', async () => {
    const registry = ToolRegistry.standard()
    const map = (await registry.execute('repo_map', {}, context())) as {
      totalSymbols: number
      files: unknown[]
    }
    assert.ok(map.totalSymbols >= 3, `expected >= 3 symbols, got ${map.totalSymbols}`)
  })

  it('symbol_search tìm UserService', async () => {
    const registry = ToolRegistry.standard()
    const result = (await registry.execute('symbol_search', { query: 'Service' }, context())) as {
      symbols: unknown[]
    }
    assert.ok(result.symbols.length >= 1)
  })

  it('find_references dùng AST', async () => {
    const registry = ToolRegistry.standard()
    const result = (await registry.execute(
      'find_references',
      { symbol: 'UserService' },
      context(),
    )) as { references: Array<{ kind: string; line: number }> }
    assert.ok(result.references.some((hit) => hit.kind === 'declaration'))
    assert.ok(result.references.some((hit) => hit.kind === 'constructor'))
  })

  it('chọn agent engine từ settings + session', () => {
    assert.equal(selectedAgentEngine(store), 'native')
    store.settingSet('agent.engine', 'langgraph')
    assert.equal(selectedAgentEngine(store), 'langgraph')
    assert.equal(selectedAgentEngine(store, 'claude-agent-sdk'), 'claude-agent-sdk')
    store.settingSet('agent.engine', 'bogus')
    assert.equal(selectedAgentEngine(store), 'native')
    store.settingSet('agent.engine', 'native')

    const project = store.projectOpen(tempDir, 'engine-session')
    const session = store.sessionCreate({
      projectId: project['id'],
      title: 'Engine session',
      engine: 'langgraph',
    })
    assert.equal(session['engine'], 'langgraph')
    assert.equal(store.sessionGet(session['id'])?.['engine'], 'langgraph')
    store.sessionUpdate(session['id'], { engine: 'claude-agent-sdk' })
    assert.equal(store.sessionGet(session['id'])?.['engine'], 'claude-agent-sdk')

    store.providerSave({ kind: 'anthropic', name: 'Anthropic', enabled: true })
    store.settingSet('agent.engine', 'auto')
    assert.equal(selectedAgentEngine(store), 'claude-agent-sdk')
    store.settingSet('agent.engine', 'native')
    assert.equal(selectedAgentEngine(store), 'native')
    store.settingSet('agent.engine', 'auto')
  })

  it('read_multiple_files đọc 2 files', async () => {
    const registry = ToolRegistry.standard()
    const result = (await registry.execute(
      'read_multiple_files',
      { paths: ['src/service.ts', 'README.md'] },
      context(),
    )) as { files: Array<{ path: string; content?: string }> }
    assert.equal(result.files.length, 2)
    const service = result.files.find((file) => file.path === 'src/service.ts')
    assert.ok(service?.content?.includes('class UserService'))
  })
})
