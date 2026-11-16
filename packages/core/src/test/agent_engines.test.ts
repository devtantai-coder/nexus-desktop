import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { AgentEngineManager, createNexusMcpServer } from '../agent.ts'
import { EventBus } from '../events.ts'
import { Store } from '../store.ts'
import { ProcessManager, ToolRegistry } from '../tools.ts'
import { Workspace } from '../workspace.ts'

let tempDir = ''
let store: Store
let workspace: Workspace

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-engine-test-'))
  mkdirSync(join(tempDir, 'src'))
  writeFileSync(join(tempDir, 'package.json'), '{"name":"engine-test"}')
  store = new Store(join(tempDir, 'nexus.db'))
  store.migrate()
  workspace = new Workspace(tempDir)
})

after(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Nexus MCP bridge', () => {
  it('chuyển toàn bộ tool schema sang in-process MCP server', async () => {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const registry = ToolRegistry.standard()
    const toolSchemas = registry.list().map((entry) => {
      const definition = registry.get(String(entry['name']))!
      return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      }
    })
    const server = createNexusMcpServer(
      sdk,
      {
        toolSchemas,
        workspace: null,
        git: null,
        taskId: 'task',
        sessionId: 'session',
        projectId: '',
      } as never,
      {
        tools: registry,
        store: {
          settingGet: () => ({}),
          settingSet: () => undefined,
          fileChangeRecord: () => undefined,
        },
        events: { emit: () => undefined },
        processes: {},
        mcp: { callNamespaced: async () => null },
      } as never,
    )
    assert.equal(server?.['type'], 'sdk')
    assert.equal(server?.['name'], 'nexus_core')
  })
})

describe('LangGraph engine', () => {
  it('chạy model → tool → model và dừng khi được duyệt', async () => {
    const project = store.projectOpen(tempDir, 'engine')
    const session = store.sessionCreate({
      projectId: project['id'],
      title: 'Engine',
      providerId: 'prov',
      modelId: 'mod',
    })
    const task = store.taskCreate({
      sessionId: session['id'],
      projectId: project['id'],
      title: 'Engine task',
      prompt: 'do it',
      mode: 'agent',
      permissionMode: 'workspace-write',
      providerId: 'prov',
      modelId: 'mod',
    })
    const assistant = store.messageCreate({
      sessionId: session['id'],
      role: 'assistant',
      content: '',
      status: 'streaming',
    })
    const events = new EventBus()
    const seen = new Set<string>()
    const managerBox: { current: AgentEngineManager | null } = { current: null }
    events.on((event) => {
      seen.add(event.type)
      if (event.type === 'agent.approval.required') {
        const id = String((event.payload as { id?: string }).id ?? '')
        setTimeout(() => managerBox.current?.approve(id, true), 10)
      }
    })
    let calls = 0
    const providers = {
      apiKey: () => 'test',
      chat: async () => {
        calls += 1
        if (calls === 1) {
          return {
            text: '',
            reasoning: '',
            finish_reason: 'tool_calls',
            tool_calls: [
              { id: 'call-1', name: 'execute_command', arguments: { command: 'echo hi' } },
            ],
            usage: { input_tokens: 5, output_tokens: 2, cached_tokens: 0 },
          }
        }
        return {
          text: 'done from langgraph',
          reasoning: '',
          finish_reason: 'stop',
          tool_calls: [],
          usage: { input_tokens: 7, output_tokens: 3, cached_tokens: 0 },
        }
      },
    }
    const manager = new AgentEngineManager({
      store,
      events,
      providers: providers as never,
      tools: ToolRegistry.standard(),
      processes: new ProcessManager(),
      mcp: null as never,
    })
    managerBox.current = manager
    await new Promise<void>((resolve) => {
      manager.run('langgraph', {
        taskId: String(task['id']),
        assistantId: String(assistant['id']),
        sessionId: String(session['id']),
        projectId: String(project['id']),
        prompt: 'do it',
        mode: 'agent',
        permissionMode: 'workspace-write',
        provider: { id: 'prov', kind: 'openai', baseUrl: '' },
        model: { modelId: 'mod' },
        workspace,
        git: null,
        systemPrompt: 'You are a test agent.',
        toolSchemas: [
          {
            name: 'execute_command',
            description: 'run a command',
            parameters: { type: 'object', properties: { command: { type: 'string' } } },
          },
        ],
        history: [{ role: 'user', content: 'do it' }],
        resume: false,
        isAborted: () => false,
        takeSteer: () => [],
        shouldStopAfterTurn: () => false,
        onFinish: resolve,
      })
    })
    const finalTask = store.taskGet(String(task['id']))
    const finalMessage = store.messageGet(String(assistant['id']))
    assert.equal(finalTask?.['state'], 'completed')
    assert.match(String(finalMessage?.['content'] ?? ''), /done from langgraph/)
    assert.ok(seen.has('agent.approval.required'))
    assert.ok(seen.has('agent.tool.started'))
    assert.ok(seen.has('agent.tool.completed'))
    assert.ok(seen.has('agent.task.completed'))
    manager.close()
  })
})
