import type {
  AgentEngine,
  AgentMode,
  AgentRoleConfig,
  AppInfo,
  ContextUsage,
  FileChange,
  FileNode,
  GitStatus,
  Message,
  ModelCategory,
  ModelConfig,
  ModelReasoningEffort,
  NexusErrorPayload,
  PermissionMode,
  Project,
  ProviderConfig,
  ProviderKind,
  SearchResult,
  Session,
  Task,
  TaskStep,
  TerminalInfo,
  ToolCallRecord,
  UsageRecord,
} from './types'
import type { NexusEventEnvelope } from './events'

export interface Attachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
  base64?: string
  kind: 'file' | 'image'
}

export interface ProviderSaveInput {
  id?: string
  kind: ProviderKind
  name: string
  baseUrl?: string
  apiKey?: string | null
  enabled?: boolean
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs?: number
  models?: string[]
  error?: NexusErrorPayload
}

export interface DiscoveredModel {
  id: string
  baseModelId: string
  variant: string
  displayName?: string
  supportsReasoning: boolean
  supportedReasoningEfforts: ModelReasoningEffort[]
  reasoningMandatory: boolean
  contextWindow?: number
  maxOutputTokens?: number
}

export interface TaskDetail {
  task: Task
  steps: TaskStep[]
  toolCalls: ToolCallRecord[]
  fileChanges: FileChange[]
}

export interface SessionPatch {
  title?: string
  mode?: AgentMode
  providerId?: string | null
  modelId?: string | null
  modelVariant?: string | null
  permissionMode?: PermissionMode
  engine?: AgentEngine
  archived?: boolean
  pinned?: boolean
}

export interface ModelSaveInput {
  id?: string
  providerId: string
  modelId: string
  displayName?: string
  contextWindow?: number
  maxOutputTokens?: number
  temperature?: number
  categories?: ModelCategory[]
  supportsTools?: boolean
  supportsVision?: boolean
  supportsReasoning?: boolean
  reasoningEffort?: ModelReasoningEffort
  variant?: string
}

export interface GitCommitInfo {
  hash: string
  author: string
  date: string
  subject: string
}

export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  requests: number
  estimatedCostUsd: number
  byModel: Array<{ modelId: string; inputTokens: number; outputTokens: number; requests: number }>
}

export interface SessionStats {
  sessionId: string
  turns: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  llmMs: number
  ttftMs: number
  ttftCount: number
  steps: number
  toolMs: number
}

export interface CustomCommand {
  name: string
  description: string
  template: string
  source: 'project' | 'global'
  path: string
}

export interface McpServer {
  id: string
  command: string
  args: string[]
  /** Chỉ có với transport HTTP (streamable HTTP); rỗng với server stdio. */
  url?: string
  enabled: boolean
  status: { running: boolean; tools?: number }
  /** Lý do lần khởi động gần nhất thất bại (rỗng nếu chưa lỗi). */
  error?: string
  /** 2000 ký tự cuối của stderr (stdio) — dùng để chẩn đoán server. */
  stderr?: string
  /** Chỉ có với server dùng URL: trạng thái OAuth. */
  auth?: { authenticated: boolean; expiresAt?: number; error?: string }
}

export interface McpTool {
  serverId?: string
  name: string
  namespacedName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface DbStats {
  sizeBytes: number
  tables: Array<{ name: string; rows: number }>
}

export interface IpcContract {
  'app.info': { input: void; output: AppInfo }
  'app.openExternal': { input: { url: string }; output: void }
  'app.showItemInFolder': { input: { path: string }; output: void }
  'app.openLogs': { input: void; output: string }
  'app.logs': { input: { limit?: number }; output: string[] }
  'app.setNativeTheme': { input: { theme: 'light' | 'dark' | 'system' }; output: void }
  'app.notify': { input: { title: string; body?: string; level?: string }; output: void }
  'app.setPreventSleep': { input: { enabled: boolean }; output: void }

  'window.popout': { input: { sessionId: string }; output: void }
  'window.minimize': { input: void; output: void }
  'window.toggleMaximize': { input: void; output: { maximized: boolean } }
  'window.close': { input: void; output: void }
  'window.state': { input: void; output: { maximized: boolean; focused: boolean } }

  'settings.all': { input: void; output: Record<string, unknown> }
  'settings.set': { input: { key: string; value: unknown }; output: void }
  'settings.reset': { input: { key?: string }; output: void }

  'provider.list': { input: void; output: ProviderConfig[] }
  'provider.save': { input: ProviderSaveInput; output: ProviderConfig }
  'provider.delete': { input: { id: string }; output: void }
  'provider.test': { input: { id: string }; output: ProviderTestResult }
  'provider.discover': { input: { id: string }; output: DiscoveredModel[] }
  'provider.setKey': { input: { id: string; apiKey: string | null }; output: ProviderConfig }

  'model.list': { input: { providerId?: string } | void; output: ModelConfig[] }
  'model.save': { input: ModelSaveInput; output: ModelConfig }
  'model.delete': { input: { id: string }; output: void }
  'model.setDefault': { input: { id: string }; output: void }

  'project.pick': { input: void; output: Project | null }
  'project.open': { input: { path: string }; output: Project }
  'project.list': { input: void; output: Project[] }
  'project.remove': { input: { id: string }; output: void }
  'project.update': { input: { id: string; name?: string; description?: string }; output: Project }

  'workspace.tree': {
    input: { projectId: string; path?: string; depth?: number }
    output: FileNode
  }
  'workspace.readFile': {
    input: { projectId: string; path: string }
    output: { content: string; language: string; size: number; truncated: boolean; mtimeMs: number }
  }
  'workspace.writeFile': {
    input: { projectId: string; path: string; content: string }
    output: { path: string; size: number }
  }
  'workspace.createFile': {
    input: { projectId: string; path: string; content?: string }
    output: FileNode
  }
  'workspace.createDir': { input: { projectId: string; path: string }; output: FileNode }
  'workspace.rename': { input: { projectId: string; from: string; to: string }; output: FileNode }
  'workspace.delete': { input: { projectId: string; path: string }; output: void }
  'workspace.searchFiles': {
    input: { projectId: string; query: string; limit?: number }
    output: SearchResult[]
  }
  'workspace.searchCode': {
    input: { projectId: string; query: string; regex?: boolean; limit?: number }
    output: SearchResult[]
  }
  'workspace.pickFiles': {
    input: { kind: 'file' | 'image' }
    output: Attachment[]
  }

  'session.list': {
    input: { projectId?: string; archived?: boolean; query?: string } | void
    output: Session[]
  }
  'session.create': {
    input: {
      projectId?: string | null
      title?: string
      mode?: AgentMode
      providerId?: string | null
      modelId?: string | null
      modelVariant?: string | null
      permissionMode?: PermissionMode
      engine?: AgentEngine
    }
    output: Session
  }
  'session.get': { input: { id: string }; output: Session }
  'session.update': { input: { id: string; patch: SessionPatch }; output: Session }
  'session.delete': { input: { id: string }; output: void }
  'session.duplicate': { input: { id: string }; output: Session }
  'session.messages': { input: { sessionId: string }; output: Message[] }
  'session.rewind': {
    input: { sessionId: string; messageId: string }
    output: { sessionId: string; messageId: string; removed: number; reverted: number }
  }
  'session.export': { input: { sessionId: string }; output: { markdown: string } }

  'agent.start': {
    input: {
      sessionId: string
      prompt: string
      mode?: AgentMode
      permissionMode?: PermissionMode
      providerId?: string
      modelId?: string
      projectId?: string
      engine?: AgentEngine
      attachments?: Attachment[]
    }
    output: { taskId: string; messageId?: string; queued?: boolean }
  }
  'agent.cancel': { input: { taskId: string }; output: void }
  'agent.approve': {
    input: { approvalId: string; approved: boolean; alwaysAllow?: boolean }
    output: void
  }
  'agent.resume': { input: { taskId: string }; output: { taskId: string } }
  'agent.steer': {
    input: { taskId: string; prompt: string }
    output: { queued: boolean; reason?: string }
  }
  'agent.contextUsage': { input: { taskId: string }; output: ContextUsage }
  'agent.stopAfterTurn': {
    input: { taskId: string }
    output: { stopped: boolean; reason?: string }
  }
  'agent.rewind': { input: { taskId: string }; output: { taskId: string; reverted: number } }
  'agent.active': { input: void; output: Task[] }
  'agent.sandboxPolicy': {
    input: { permissionMode: string }
    output: {
      mode: string
      rules: Array<{ risk: string; inside: string; outside: string; reason?: string }>
    }
  }
  'agent.toolList': {
    input: void
    output: Array<{ name: string; description: string; risk: string }>
  }

  'task.list': {
    input: { sessionId?: string; projectId?: string; limit?: number } | void
    output: Task[]
  }
  'task.get': { input: { id: string }; output: TaskDetail }

  'chat.cancel': { input: { sessionId: string }; output: void }

  'git.status': { input: { projectId: string }; output: GitStatus }
  'git.diff': {
    input: { projectId: string; path?: string; staged?: boolean }
    output: { diff: string }
  }
  'git.log': { input: { projectId: string; limit?: number }; output: GitCommitInfo[] }
  'git.branches': {
    input: { projectId: string }
    output: { current?: string; all: string[] }
  }
  'git.stage': { input: { projectId: string; paths: string[] }; output: GitStatus }
  'git.unstage': { input: { projectId: string; paths: string[] }; output: GitStatus }
  'git.commit': {
    input: { projectId: string; message: string; paths?: string[] }
    output: { hash: string }
  }
  'git.checkout': {
    input: { projectId: string; branch: string; create?: boolean }
    output: GitStatus
  }
  'git.fetch': { input: { projectId: string }; output: string }
  'git.pull': { input: { projectId: string }; output: string }
  'git.push': { input: { projectId: string }; output: string }
  'git.discard': { input: { projectId: string; paths: string[] }; output: GitStatus }

  'terminal.create': {
    input: { projectId?: string; cwd?: string; cols?: number; rows?: number; shell?: string }
    output: TerminalInfo
  }
  'terminal.write': { input: { id: string; data: string }; output: void }
  'terminal.resize': { input: { id: string; cols: number; rows: number }; output: void }
  'terminal.dispose': { input: { id: string }; output: void }
  'terminal.list': { input: void; output: TerminalInfo[] }

  'change.list': {
    input: { taskId?: string; sessionId?: string; status?: string } | void
    output: FileChange[]
  }
  'change.diff': {
    input: { id: string }
    output: { path: string; before: string; after: string; changeType: string }
  }
  'change.accept': { input: { id: string }; output: FileChange }
  'change.reject': { input: { id: string }; output: FileChange }
  'change.revert': { input: { id: string }; output: FileChange }

  'orchestrator.config': { input: void; output: AgentRoleConfig[] }
  'orchestrator.setConfig': { input: { config: AgentRoleConfig[] }; output: AgentRoleConfig[] }
  'orchestrator.run': {
    input: { sessionId: string; prompt: string; roles?: string[] }
    output: { taskId: string }
  }

  'usage.summary': {
    input: { days?: number } | void
    output: UsageSummary
  }
  'usage.list': { input: { limit?: number } | void; output: UsageRecord[] }
  'stats.session': { input: { sessionId: string }; output: SessionStats }

  'db.stats': { input: void; output: DbStats }
  'db.backup': { input: void; output: { path: string } }
  'db.vacuum': { input: void; output: void }

  'commands.list': { input: { projectId?: string } | void; output: CustomCommand[] }

  'mcp.servers': { input: void; output: McpServer[] }
  'mcp.tools': { input: { serverId?: string } | void; output: McpTool[] }
  'mcp.restart': { input: void; output: void }
  'mcp.auth.start': {
    input: { serverId: string }
    output: { url: string; redirectUri: string }
  }
  'mcp.auth.logout': { input: { serverId: string }; output: void }

  'search.global': {
    input: { query: string }
    output: {
      sessions: Session[]
      projects: Project[]
      tasks: Task[]
      files: SearchResult[]
    }
  }
}

export type IpcChannel = keyof IpcContract
export type IpcInput<K extends IpcChannel> = IpcContract[K]['input']
export type IpcOutput<K extends IpcChannel> = IpcContract[K]['output']

export const IPC_CHANNELS = [
  'app.info',
  'app.openExternal',
  'app.showItemInFolder',
  'app.openLogs',
  'app.logs',
  'app.setNativeTheme',
  'app.notify',
  'app.setPreventSleep',
  'window.popout',
  'window.minimize',
  'window.toggleMaximize',
  'window.close',
  'window.state',
  'settings.all',
  'settings.set',
  'settings.reset',
  'provider.list',
  'provider.save',
  'provider.delete',
  'provider.test',
  'provider.discover',
  'provider.setKey',
  'model.list',
  'model.save',
  'model.delete',
  'model.setDefault',
  'project.pick',
  'project.open',
  'project.list',
  'project.remove',
  'project.update',
  'workspace.tree',
  'workspace.readFile',
  'workspace.writeFile',
  'workspace.createFile',
  'workspace.createDir',
  'workspace.rename',
  'workspace.delete',
  'workspace.searchFiles',
  'workspace.searchCode',
  'workspace.pickFiles',
  'session.list',
  'session.create',
  'session.get',
  'session.update',
  'session.delete',
  'session.duplicate',
  'session.messages',
  'session.rewind',
  'session.export',
  'agent.start',
  'agent.cancel',
  'agent.approve',
  'agent.resume',
  'agent.steer',
  'agent.contextUsage',
  'agent.stopAfterTurn',
  'agent.rewind',
  'agent.active',
  'agent.toolList',
  'agent.sandboxPolicy',
  'task.list',
  'task.get',
  'chat.cancel',
  'git.status',
  'git.diff',
  'git.log',
  'git.branches',
  'git.stage',
  'git.unstage',
  'git.commit',
  'git.checkout',
  'git.fetch',
  'git.pull',
  'git.push',
  'git.discard',
  'terminal.create',
  'terminal.write',
  'terminal.resize',
  'terminal.dispose',
  'terminal.list',
  'change.list',
  'change.diff',
  'change.accept',
  'change.reject',
  'change.revert',
  'orchestrator.config',
  'orchestrator.setConfig',
  'orchestrator.run',
  'stats.session',
  'usage.summary',
  'usage.list',
  'db.stats',
  'db.backup',
  'db.vacuum',
  'search.global',
  'commands.list',
  'mcp.servers',
  'mcp.tools',
  'mcp.restart',
  'mcp.auth.start',
  'mcp.auth.logout',
] as const satisfies readonly IpcChannel[]

export interface NexusBridge {
  platform: string
  invoke<K extends IpcChannel>(
    channel: K,
    ...args: IpcInput<K> extends void ? [input?: undefined] : [input: IpcInput<K>]
  ): Promise<IpcOutput<K>>
  onEvent(listener: (envelope: NexusEventEnvelope) => void): () => void
  onWindowState(listener: (state: { maximized: boolean; focused: boolean }) => void): () => void
}

export interface RpcResult<T> {
  ok: boolean
  data?: T
  error?: NexusErrorPayload
}

export { EVENT_CHANNEL, WINDOW_STATE_CHANNEL } from './constants'
