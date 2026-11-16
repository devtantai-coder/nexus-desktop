import type {
  AgentMode,
  AppInfo,
  Attachment,
  ContextUsage,
  CustomCommand,
  TaskDetail,
  DiscoveredModel,
  FileNode,
  GitCommitInfo,
  GitStatus,
  IpcChannel,
  IpcInput,
  IpcOutput,
  McpServer,
  McpTool,
  Message,
  ModelCategory,
  ModelConfig,
  ModelReasoningEffort,
  PermissionMode,
  Project,
  ProviderConfig,
  ProviderKind,
  Session,
  Task,
  SessionStats,
} from '@nexus/shared'

export async function call<K extends IpcChannel>(
  channel: K,
  ...args: IpcInput<K> extends void ? [] : [input: IpcInput<K>]
): Promise<IpcOutput<K>> {
  const invoke = window.nexus.invoke.bind(window.nexus) as (
    target: IpcChannel,
    input?: unknown,
  ) => Promise<unknown>
  return (await invoke(channel, args[0])) as IpcOutput<K>
}

export type { TaskDetail }

export interface ProviderTestResult {
  ok: boolean
  latencyMs?: number
  models?: string[]
  error?: { code: string; message: string }
}

export const api = {
  app: {
    info: () => call('app.info'),
    openExternal: (url: string) => call('app.openExternal', { url }),
    showItemInFolder: (path: string) => call('app.showItemInFolder', { path }),
    openLogs: () => call('app.openLogs'),
    logs: (limit?: number) => call('app.logs', { limit }),
    setNativeTheme: (theme: 'light' | 'dark' | 'system') => call('app.setNativeTheme', { theme }),
    notify: (title: string, body?: string, level?: string) =>
      call('app.notify', { title, body, level }),
  },

  settings: {
    all: () => call('settings.all'),
    set: (key: string, value: unknown) => call('settings.set', { key, value }),
    reset: (key?: string) => call('settings.reset', { key }),
  },
  providers: {
    list: () => call('provider.list'),
    save: (input: {
      id?: string
      kind: ProviderKind
      name: string
      baseUrl?: string
      apiKey?: string | null
      enabled?: boolean
    }) => call('provider.save', input),
    remove: (id: string) => call('provider.delete', { id }),
    test: (id: string) => call('provider.test', { id }) as Promise<ProviderTestResult>,
    discover: (id: string) => call('provider.discover', { id }) as Promise<DiscoveredModel[]>,
    setKey: (id: string, apiKey: string | null) => call('provider.setKey', { id, apiKey }),
  },
  models: {
    list: (providerId?: string) => call('model.list', providerId ? { providerId } : {}),
    save: (input: {
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
    }) => call('model.save', input),
    remove: (id: string) => call('model.delete', { id }),
    setDefault: (id: string) => call('model.setDefault', { id }),
  },
  projects: {
    pick: () => call('project.pick'),
    open: (path: string) => call('project.open', { path }),
    list: () => call('project.list'),
    remove: (id: string) => call('project.remove', { id }),
    update: (id: string, patch: { name?: string; description?: string }) =>
      call('project.update', { id, ...patch }),
  },
  workspace: {
    tree: (projectId: string, path?: string, depth?: number) =>
      call('workspace.tree', { projectId, path, depth }),
    readFile: (projectId: string, path: string) => call('workspace.readFile', { projectId, path }),
    writeFile: (projectId: string, path: string, content: string) =>
      call('workspace.writeFile', { projectId, path, content }),
    createFile: (projectId: string, path: string, content?: string) =>
      call('workspace.createFile', { projectId, path, content }),
    createDir: (projectId: string, path: string) =>
      call('workspace.createDir', { projectId, path }),
    rename: (projectId: string, from: string, to: string) =>
      call('workspace.rename', { projectId, from, to }),
    remove: (projectId: string, path: string) => call('workspace.delete', { projectId, path }),
    searchFiles: (projectId: string, query: string, limit?: number) =>
      call('workspace.searchFiles', { projectId, query, limit }),
    searchCode: (projectId: string, query: string, regex?: boolean, limit?: number) =>
      call('workspace.searchCode', { projectId, query, regex, limit }),
    pickFiles: (kind: 'file' | 'image') =>
      call('workspace.pickFiles', { kind }) as Promise<Attachment[]>,
  },
  sessions: {
    list: (filter?: { projectId?: string; archived?: boolean; query?: string }) =>
      call('session.list', filter ?? {}),
    create: (input?: {
      projectId?: string | null
      title?: string
      mode?: AgentMode
      providerId?: string | null
      modelId?: string | null
      modelVariant?: string | null
      permissionMode?: PermissionMode
    }) => call('session.create', input ?? {}),
    get: (id: string) => call('session.get', { id }),
    update: (
      id: string,
      patch: {
        title?: string
        mode?: AgentMode
        providerId?: string | null
        modelId?: string | null
        modelVariant?: string | null
        permissionMode?: PermissionMode
        archived?: boolean
        pinned?: boolean
      },
    ) => call('session.update', { id, patch }),
    remove: (id: string) => call('session.delete', { id }),
    duplicate: (id: string) => call('session.duplicate', { id }),
    messages: (sessionId: string) => call('session.messages', { sessionId }) as Promise<Message[]>,
    rewind: (sessionId: string, messageId: string) =>
      call('session.rewind', { sessionId, messageId }),
    export: (sessionId: string) => call('session.export', { sessionId }),
  },
  agent: {
    start: (input: {
      sessionId: string
      prompt: string
      mode?: AgentMode
      permissionMode?: PermissionMode
      providerId?: string
      modelId?: string
      projectId?: string
      attachments?: Attachment[]
    }) => call('agent.start', input),
    cancel: (taskId: string) => call('agent.cancel', { taskId }),
    approve: (approvalId: string, approved: boolean, alwaysAllow?: boolean) =>
      call('agent.approve', { approvalId, approved, alwaysAllow }),
    resume: (taskId: string) => call('agent.resume', { taskId }),
    steer: (taskId: string, prompt: string) => call('agent.steer', { taskId, prompt }),
    contextUsage: (taskId: string) =>
      call('agent.contextUsage', { taskId }) as Promise<ContextUsage>,
    stopAfterTurn: (taskId: string) => call('agent.stopAfterTurn', { taskId }),
    rewind: (taskId: string) => call('agent.rewind', { taskId }),
    active: () => call('agent.active'),
    tools: () => call('agent.toolList'),
    sandboxPolicy: (permissionMode: string) => call('agent.sandboxPolicy', { permissionMode }),
  },
  tasks: {
    list: (filter?: { sessionId?: string; projectId?: string; limit?: number }) =>
      call('task.list', filter ?? {}),
    get: (id: string) => call('task.get', { id }) as Promise<TaskDetail>,
    cancel: (taskId: string) => call('agent.cancel', { taskId }),
  },
  git: {
    status: (projectId: string) => call('git.status', { projectId }) as Promise<GitStatus>,
    diff: (projectId: string, path?: string, staged?: boolean) =>
      call('git.diff', { projectId, path, staged }),
    log: (projectId: string, limit?: number) =>
      call('git.log', { projectId, limit }) as Promise<GitCommitInfo[]>,
    branches: (projectId: string) => call('git.branches', { projectId }),
    stage: (projectId: string, paths: string[]) => call('git.stage', { projectId, paths }),
    unstage: (projectId: string, paths: string[]) => call('git.unstage', { projectId, paths }),
    commit: (projectId: string, message: string, paths?: string[]) =>
      call('git.commit', { projectId, message, paths }),
    checkout: (projectId: string, branch: string, create?: boolean) =>
      call('git.checkout', { projectId, branch, create }),
    fetch: (projectId: string) => call('git.fetch', { projectId }),
    pull: (projectId: string) => call('git.pull', { projectId }),
    push: (projectId: string) => call('git.push', { projectId }),
    discard: (projectId: string, paths: string[]) => call('git.discard', { projectId, paths }),
  },

  setPreventSleep: (enabled: boolean) => call('app.setPreventSleep', { enabled }),
  popout: (sessionId: string) => call('window.popout', { sessionId }),
  terminal: {
    create: (input: { projectId?: string; cwd?: string; cols?: number; rows?: number }) =>
      call('terminal.create', input),
    write: (id: string, data: string) => call('terminal.write', { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      call('terminal.resize', { id, cols, rows }),
    dispose: (id: string) => call('terminal.dispose', { id }),
    list: () => call('terminal.list'),
  },
  stats: {
    session: (sessionId: string) => call('stats.session', { sessionId }) as Promise<SessionStats>,
  },
  commands: {
    list: (projectId?: string) =>
      call('commands.list', projectId ? { projectId } : {}) as Promise<CustomCommand[]>,
  },
  usage: {
    summary: (days?: number) => call('usage.summary', days ? { days } : {}),
  },
  search: {
    global: (query: string) => call('search.global', { query }),
  },
  mcp: {
    servers: () => call('mcp.servers') as Promise<McpServer[]>,
    tools: (serverId?: string) =>
      call('mcp.tools', serverId ? { serverId } : {}) as Promise<McpTool[]>,
    restart: () => call('mcp.restart'),
    authStart: (serverId: string) => call('mcp.auth.start', { serverId }),
    authLogout: (serverId: string) => call('mcp.auth.logout', { serverId }),
  },
}

export type { AppInfo, FileNode, ModelConfig, Project, ProviderConfig, Session, Task }
