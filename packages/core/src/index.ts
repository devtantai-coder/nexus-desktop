import { readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'

import { canonicalToolName, errorPayload, projectRules, AgentRuntime, goalPromptLines, permanentProviderFailure } from './agent.ts'
import { NexusError } from './errors.ts'
import { EventBus } from './events.ts'
import { GitEngine } from './git.ts'
import { McpManager } from './mcp.ts'
import { Providers } from './providers.ts'
import { SecretStore } from './secrets.ts'
import { decidePermission, type Risk, riskName } from './security.ts'
import { Store } from './store.ts'
import { TerminalManager } from './terminal.ts'
import { ProcessManager, ToolRegistry } from './tools.ts'
import { basename, homeDir, isDirectory, jsonBool, jsonInt, jsonStr, nowIso, pathJoin, readFileSync, split, startsWith, toLower, trim } from './util.ts'
import { WorkspaceWatcher } from './watcher.ts'
import { Workspace, WorkspaceManager } from './workspace.ts'

 
export type Json = any

export interface CoreOptions {
  databasePath: string
  userDataDir: string
  appVersion: string
}

const trimmedPatch = (patch: Json, keys: string[]): Json => {
  const result: Json = {}
  for (const key of keys) {
    if (patch !== null && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, key)) {
      result[key] = patch[key]
    }
  }
  return result
}

const pathsFrom = (value: Json): string[] => {
  if (!Array.isArray(value)) return []
  return (value as Json[]).filter((entry): entry is string => typeof entry === 'string')
}

const requiredString = (params: Json, key: string): string => {
  const value = typeof params?.[key] === 'string' ? params[key] : ''
  if (value === '') throw new NexusError('E_VALIDATION', `Missing parameter: ${key}`)
  return value
}

const parseFrontmatter = (raw: string): { meta: Record<string, string>; body: string } => {
  const meta: Record<string, string> = {}
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) return { meta, body: raw }
  for (const line of split(match[1] as string, '\n')) {
    const separator = line.indexOf(':')
    if (separator === -1 || separator === 0) continue
    const key = toLower(trim(line.slice(0, separator)))
    let value = trim(line.slice(separator + 1))
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, value.length - 1)
    }
    if (key !== '' && value !== '') meta[key] = value
  }
  return { meta, body: raw.slice(match[0].length) }
}

const commandSlug = (name: string): string => {
  const stem = toLower(basename(name).replace(/\.[^.]+$/, ''))
  let out = ''
  let dash = false
  for (const c of stem) {
    if (/[A-Za-z0-9]/.test(c)) {
      out += c
      dash = false
    } else if (out !== '' && !dash) {
      out += '-'
      dash = true
    }
  }
  return out.replace(/-+$/, '')
}

const toPosix = (value: string): string => value.split(sep).join('/')

export class Core {
  readonly events = new EventBus()
  private readonly store: Store
  private readonly secrets: SecretStore
  private readonly providers: Providers
  private readonly mcp: McpManager
  private readonly workspaces = new WorkspaceManager()
  private readonly processes = new ProcessManager()
  private readonly tools = ToolRegistry.standard()
  private readonly agent: AgentRuntime
  private readonly terminals: TerminalManager
  private readonly watcher: WorkspaceWatcher
  private readonly databasePath: string
  private readonly userDataDir: string
  private readonly appVersion: string
  private closed = false

  constructor(options: CoreOptions) {
    this.databasePath = options.databasePath
    this.userDataDir = options.userDataDir
    this.appVersion = options.appVersion
    this.store = new Store(this.databasePath)
    this.secrets = new SecretStore(this.userDataDir)
    this.providers = new Providers(this.store, this.secrets, this.events)
    this.mcp = new McpManager(this.store, this.secrets, this.events)
    this.agent = new AgentRuntime(
      this.store,
      this.events,
      this.providers,
      this.workspaces,
      this.tools,
      this.processes,
      this.mcp,
      this.userDataDir,
    )
    this.terminals = new TerminalManager(this.events)
    this.watcher = new WorkspaceWatcher(this.events)
  }

  initialize(): void {
    this.store.migrate()
    this.store.seedDefaults()
    for (const task of this.store.taskActive()) {
      const id = jsonStr(task, 'id')
      const error = {
        code: 'E_INTERRUPTED',
        message: 'Tác vụ bị gián đoạn khi ứng dụng khởi động lại.',
      }
      this.store.taskSetError(id, error)
      this.store.taskSetSummary(
        id,
        'Tác vụ bị gián đoạn khi ứng dụng khởi động lại. Tiến độ đã được lưu; nhấn Tiếp tục để chạy tiếp.',
      )
      this.store.taskState(id, 'cancelled', undefined, Date.now())
    }
  }

  shutdown(): void {
    if (this.closed) return
    this.closed = true
    this.agent.cancelAll()
    this.terminals.disposeAll()
    this.processes.disposeAll()
    void this.mcp.close()
    this.watcher.unwatchAll()
    try {
      this.store.close()
    } catch {
      // đã đóng
    }
  }

  private workspaceFor(projectId: string): Workspace {
    const project = this.store.projectGet(projectId)
    if (project === null) throw new NexusError('E_DB', `Project ${projectId} not found`)
    return this.workspaces.ensure(projectId, jsonStr(project, 'path'))
  }

  private gitFor(projectId: string): GitEngine {
    const project = this.store.projectGet(projectId)
    if (project === null) throw new NexusError('E_DB', `Project ${projectId} not found`)
    return new GitEngine(jsonStr(project, 'path'))
  }

  private async openProject(path: string): Promise<Json> {
    if (trim(path) === '') throw new NexusError('E_VALIDATION', 'Project path is required')
    const absolute = resolvePath(path)
    if (!isDirectory(absolute)) throw new NexusError('E_FS', `Not a directory: ${path}`)
    const normalized = toPosix(absolute)
    const engine = new GitEngine(normalized)
    let remote: string | undefined
    let branch: string | undefined
    if (await engine.isRepo()) {
      const url = await engine.remoteUrl()
      if (url !== '') remote = url
      const branches = await engine.branches()
      if (typeof branches?.['current'] === 'string' && branches['current'] !== '') {
        branch = branches['current']
      }
    }
    const project = this.store.projectOpen(normalized, basename(normalized), remote, branch)
    this.workspaces.ensure(jsonStr(project, 'id'), normalized)
    this.watcher.watch(jsonStr(project, 'id'), normalized)
    this.store.settingSet('workspace.activeProjectId', jsonStr(project, 'id'))
    return project
  }

  private collectCommands(directory: string, source: string, projectRoot: string): Json[] {
    const commands: Json[] = []
    let names: string[] = []
    try {
      if (!isDirectory(directory)) return commands
      names = readdirSync(directory)
    } catch {
      return commands
    }
    for (const name of names) {
      if (commands.length >= 200) break
      const full = join(directory, name)
      try {
        if (!statSync(full).isFile()) continue
      } catch {
        continue
      }
      if (!toLower(name).endsWith('.md')) continue
      let raw = ''
      try {
        raw = readFileSync(full, 200000)
      } catch {
        continue
      }
      if (trim(raw) === '') continue
      const { meta, body } = parseFrontmatter(raw)
      const commandName = commandSlug(name)
      if (commandName === '' || trim(body) === '') continue
      let relativePath = name
      if (projectRoot !== '') {
        try {
          relativePath = toPosix(relative(projectRoot, full))
        } catch {
          relativePath = name
        }
      }
      commands.push({
        name: commandName,
        description:
          meta['description'] !== undefined
            ? meta['description']
            : `Custom command (${relativePath})`,
        template: body.slice(0, 100000),
        source,
        path: relativePath,
      })
    }
    return commands
  }

  private listCommands(projectId: string): Json[] {
    const merged: Json[] = []
    const seen = new Set<string>()
    let projectRoot = ''
    if (projectId !== '') {
      const project = this.store.projectGet(projectId)
      if (project !== null) projectRoot = jsonStr(project, 'path')
    }
    const scopes: Json[] = []
    if (projectRoot !== '') {
      scopes.push(this.collectCommands(pathJoin(projectRoot, '.claude/commands'), 'project', projectRoot))
      scopes.push(this.collectCommands(pathJoin(projectRoot, '.nexus/commands'), 'project', projectRoot))
    }
    scopes.push(this.collectCommands(pathJoin(homeDir(), '.claude/commands'), 'global', ''))
    scopes.push(this.collectCommands(pathJoin(homeDir(), '.nexus/commands'), 'global', ''))
    for (const scope of scopes) {
      for (const command of scope as Json[]) {
        const name = jsonStr(command, 'name')
        if (seen.has(name)) continue
        seen.add(name)
        merged.push(command)
        if (merged.length >= 200) break
      }
    }
    merged.sort((left, right) => (jsonStr(left, 'name') < jsonStr(right, 'name') ? -1 : 1))
    return merged
  }

  private globalSearch(query: string): Json {
    const lower = toLower(query)
    let sessions = this.store.sessionList({ query })
    if (sessions.length > 20) sessions = sessions.slice(0, 20)
    const projects = this.store.projectSearch(query, 10)
    const tasks: Json[] = []
    for (const task of this.store.taskList({ limit: 400 })) {
      if (
        toLower(jsonStr(task, 'title')).includes(lower) ||
        toLower(jsonStr(task, 'prompt')).includes(lower)
      ) {
        tasks.push(task)
        if (tasks.length >= 20) break
      }
    }
    const files: Json[] = []
    const allProjects = this.store.projectList()
    for (const project of allProjects.slice(0, 3)) {
      try {
        const workspace = this.workspaces.ensure(jsonStr(project, 'id'), jsonStr(project, 'path'))
        for (const result of workspace.searchFiles(query, 10)) {
          files.push({ path: `${jsonStr(project, 'name')}/${jsonStr(result, 'path')}` })
        }
      } catch {
        // bỏ qua project lỗi
      }
    }
    return { sessions, projects, tasks, files }
  }

  private applyChangeContent(id: string, revert: boolean): Json {
    const change = this.store.fileChangeGet(id)
    if (change === null) throw new NexusError('E_DB', `File change ${id} not found`)
    const projectId = jsonStr(change, 'projectId')
    if (projectId !== '') {
      const workspace = this.workspaceFor(projectId)
      const key = revert ? 'beforeContent' : 'afterContent'
      if (jsonStr(change, 'changeType') === 'create' && revert) {
        try {
          workspace.remove(jsonStr(change, 'path'))
        } catch {
          // đã mất
        }
      } else if (revert) {
        if (typeof change['beforeContent'] === 'string') {
          workspace.writeFile(jsonStr(change, 'path'), change['beforeContent'])
        } else if (jsonStr(change, 'changeType') === 'delete') {
          try {
            workspace.remove(jsonStr(change, 'path'))
          } catch {
            // đã mất
          }
        }
      } else if (typeof change[key] === 'string') {
        workspace.writeFile(jsonStr(change, 'path'), change[key] as string)
      }
    }
    return this.store.fileChangeStatus(id, revert ? 'reverted' : 'accepted')
  }

  private rewindTask(taskId: string): Json {
    const task = this.store.taskGet(taskId)
    if (task === null) throw new NexusError('E_DB', `Task ${taskId} not found`)
    const changes = this.store.fileChangesList({ taskId })
    let reverted = 0
    for (const change of [...changes].reverse()) {
      const status = jsonStr(change, 'status')
      if (status === 'reverted' || status === 'rejected') continue
      try {
        this.applyChangeContent(jsonStr(change, 'id'), true)
        reverted += 1
      } catch {
        // bỏ qua
      }
    }
    this.events.emit('agent.task.rewound', {
      taskId,
      sessionId: jsonStr(task, 'sessionId'),
      reverted,
    })
    return { taskId, reverted }
  }

  private rewindSession(sessionId: string, messageId: string): Json {
    const session = this.store.sessionGet(sessionId)
    if (session === null) throw new NexusError('E_DB', `Session ${sessionId} not found`)
    const messages = this.store.messageList(sessionId)
    let target = -1
    for (let index = 0; index < messages.length; index += 1) {
      if (jsonStr(messages[index], 'id') === messageId) {
        target = index
        break
      }
    }
    if (target < 0) throw new NexusError('E_VALIDATION', 'Message not found in session')
    const targetTime = jsonInt(messages[target], 'createdAt', 0)
    for (const task of this.store.taskActive()) {
      if (jsonStr(task, 'sessionId') === sessionId) this.agent.cancel(jsonStr(task, 'id'))
    }
    let reverted = 0
    const tasks = this.store.taskList({ sessionId, limit: 1000 })
    for (const task of [...tasks].reverse()) {
      if (jsonInt(task, 'createdAt', 0) < targetTime) continue
      const changes = this.store.fileChangesList({ taskId: jsonStr(task, 'id') })
      for (const change of [...changes].reverse()) {
        const status = jsonStr(change, 'status')
        if (status === 'reverted' || status === 'rejected') continue
        try {
          this.applyChangeContent(jsonStr(change, 'id'), true)
          reverted += 1
        } catch {
          // bỏ qua
        }
      }
      this.store.taskRemove(jsonStr(task, 'id'))
    }
    let removed = 0
    for (let index = target + 1; index < messages.length; index += 1) {
      this.store.messageDelete(jsonStr(messages[index], 'id'))
      removed += 1
    }
    this.events.emit('session.rewound', { sessionId, messageId, removed, reverted })
    return { sessionId, messageId, removed, reverted }
  }

  async request(method: string, params: Json): Promise<Json> {
    params = params ?? {}
    switch (method) {
      case 'app.info':
        return {
          name: 'NEXUS Desktop',
          version: this.appVersion,
          platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
          databasePath: this.databasePath,
          userDataPath: this.userDataDir,
          isDev: process.env['NEXUS_DEV'] === '1',
        }
      case 'settings.all':
        return this.store.settingsAll()
      case 'settings.set': {
        const key = requiredString(params, 'key')
        if (!Object.prototype.hasOwnProperty.call(params, 'value')) {
          throw new NexusError('E_VALIDATION', 'Missing value')
        }
        this.store.settingSet(key, params['value'])
        if (key === 'mcp.servers') void this.mcp.reload()
        return null
      }
      case 'settings.reset': {
        const key = jsonStr(params, 'key')
        this.store.settingReset(key === '' ? undefined : key)
        return null
      }
      case 'provider.list':
        return this.providers.list()
      case 'provider.save': {
        if (jsonStr(params, 'kind') === '' || trim(jsonStr(params, 'name')) === '') {
          throw new NexusError('E_VALIDATION', 'Provider kind and name are required')
        }
        return this.providers.save(params)
      }
      case 'provider.delete':
        this.providers.remove(requiredString(params, 'id'))
        return null
      case 'provider.test':
        return this.providers.test(requiredString(params, 'id'))
      case 'provider.discover':
        return this.providers.discover(requiredString(params, 'id'))
      case 'provider.setKey':
        return this.providers.setKey(
          requiredString(params, 'id'),
          Object.prototype.hasOwnProperty.call(params, 'apiKey') ? params['apiKey'] : null,
        )
      case 'model.list': {
        const providerId = jsonStr(params, 'providerId')
        return this.store.modelList(providerId === '' ? undefined : providerId)
      }
      case 'model.save': {
        const providerId = requiredString(params, 'providerId')
        const modelId = requiredString(params, 'modelId')
        this.store.providerRaw(providerId)
        const defaults = Providers.defaultsForModel(modelId)
        const input: Json = { ...params }
        if (!('contextWindow' in input)) input['contextWindow'] = defaults[0]
        if (!('maxOutputTokens' in input)) input['maxOutputTokens'] = defaults[1]
        if (!('categories' in input)) input['categories'] = Providers.inferCategories(modelId)
        if (!('supportsReasoning' in input)) {
          input['supportsReasoning'] = Providers.inferSupportsReasoning(modelId)
        }
        if (!('supportsVision' in input)) {
          const categories = input['categories']
          input['supportsVision'] = Array.isArray(categories) && categories.includes('vision')
        }
        return this.store.modelSave(input)
      }
      case 'model.delete':
        this.store.modelRemove(requiredString(params, 'id'))
        return null
      case 'model.setDefault':
        this.store.modelSetDefault(requiredString(params, 'id'))
        return null
      case 'project.open':
        return this.openProject(requiredString(params, 'path'))
      case 'project.list': {
        const scratchRoot = `${toPosix(pathJoin(this.userDataDir, 'scratch'))}/`
        return this.store
          .projectList()
          .filter((project) => !startsWith(`${toPosix(jsonStr(project, 'path'))}/`, scratchRoot))
      }
      case 'project.remove': {
        const id = requiredString(params, 'id')
        this.watcher.unwatch(id)
        this.workspaces.close(id)
        this.store.projectRemove(id)
        return null
      }
      case 'project.update':
        return this.store.projectUpdate(
          requiredString(params, 'id'),
          trimmedPatch(params, ['name', 'description']),
        )
      case 'workspace.tree': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.tree(jsonStr(params, 'path'), jsonInt(params, 'depth', 3))
      }
      case 'workspace.readFile': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        const result = workspace.readFile(requiredString(params, 'path'))
        return {
          content: result.content,
          language: result.language,
          size: result.size,
          truncated: result.truncated,
          mtimeMs: result.mtimeMs,
        }
      }
      case 'workspace.writeFile': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        const result = workspace.writeFile(
          requiredString(params, 'path'),
          requiredString(params, 'content'),
        )
        return { path: result.path, size: result.size }
      }
      case 'workspace.createFile': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.createFile(requiredString(params, 'path'), jsonStr(params, 'content'))
      }
      case 'workspace.createDir': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.createDir(requiredString(params, 'path'))
      }
      case 'workspace.rename': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.rename(requiredString(params, 'from'), requiredString(params, 'to'))
      }
      case 'workspace.delete': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        workspace.remove(requiredString(params, 'path'))
        return null
      }
      case 'workspace.searchFiles': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.searchFiles(requiredString(params, 'query'), jsonInt(params, 'limit', 50))
      }
      case 'workspace.searchCode': {
        const workspace = this.workspaceFor(requiredString(params, 'projectId'))
        return workspace.searchCode(
          requiredString(params, 'query'),
          jsonBool(params, 'regex'),
          jsonInt(params, 'limit', 60),
        )
      }
      case 'session.list':
        return this.store
          .sessionList(params)
          .filter((session) => !startsWith(jsonStr(session, 'title'), 'Subagent: '))
      case 'session.create': {
        const input = trimmedPatch(params, [
          'projectId', 'title', 'mode', 'providerId', 'modelId', 'permissionMode', 'modelVariant',
        ])
        if (!('providerId' in input) || !('modelId' in input)) {
          const model = this.store.modelDefault()
          if (model !== null) {
            if (!('providerId' in input)) input['providerId'] = jsonStr(model, 'providerId')
            if (!('modelId' in input)) input['modelId'] = jsonStr(model, 'modelId')
            if (!('modelVariant' in input)) input['modelVariant'] = jsonStr(model, 'variant')
          }
        }
        return this.store.sessionCreate(input)
      }
      case 'session.get': {
        const session = this.store.sessionGet(requiredString(params, 'id'))
        if (session === null) throw new NexusError('E_DB', 'Session not found')
        return session
      }
      case 'session.update': {
        const id = requiredString(params, 'id')
        const patch = params?.['patch'] ?? {}
        return this.store.sessionUpdate(
          id,
          trimmedPatch(patch, [
            'title', 'mode', 'providerId', 'modelId', 'permissionMode', 'archived', 'pinned',
            'modelVariant',
          ]),
        )
      }
      case 'session.rewind':
        return this.rewindSession(requiredString(params, 'sessionId'), requiredString(params, 'messageId'))
      case 'session.delete': {
        const id = requiredString(params, 'id')
        for (const task of this.store.taskActive()) {
          if (jsonStr(task, 'sessionId') === id) this.agent.cancel(jsonStr(task, 'id'))
        }
        const scratchBase = toPosix(pathJoin(this.userDataDir, 'scratch'))
        const scratchPath = toPosix(join(scratchBase, id))
        if (startsWith(`${scratchPath}/`, `${scratchBase}/`)) {
          const project = this.store.projectFindByPath(scratchPath)
          if (project !== null) {
            const projectId = jsonStr(project, 'id')
            this.watcher.unwatch(projectId)
            this.workspaces.close(projectId)
            this.store.projectRemove(projectId)
          }
          try {
            rmSync(scratchPath, { recursive: true, force: true })
          } catch {
            // bỏ qua
          }
        }
        this.store.sessionRemove(id)
        return null
      }
      case 'session.duplicate':
        return this.store.sessionDuplicate(requiredString(params, 'id'))
      case 'session.messages':
        return this.store.messageList(requiredString(params, 'sessionId'))
      case 'session.export':
        return { markdown: this.store.sessionExport(requiredString(params, 'sessionId')) }
      case 'agent.start':
        return this.agent.start(params)
      case 'agent.cancel':
        this.agent.cancel(requiredString(params, 'taskId'))
        return null
      case 'agent.approve':
        return this.agent.approve(
          requiredString(params, 'approvalId'),
          jsonBool(params, 'approved'),
          jsonBool(params, 'alwaysAllow'),
        )
      case 'agent.resume':
        return this.agent.resume(requiredString(params, 'taskId'))
      case 'agent.steer':
        return this.agent.steer(requiredString(params, 'taskId'), requiredString(params, 'prompt'))
      case 'agent.contextUsage':
        return this.agent.contextUsage(requiredString(params, 'taskId'))
      case 'agent.stopAfterTurn':
        return this.agent.stopAfterTurn(requiredString(params, 'taskId'))
      case 'agent.rewind':
        return this.rewindTask(requiredString(params, 'taskId'))
      case 'agent.active':
        return this.agent.active()
      case 'agent.sandboxPolicy': {
        const mode = jsonStr(params, 'permissionMode', 'workspace-write')
        const rules: Json[] = []
        for (const risk of ['read', 'write', 'exec', 'network', 'destructive'] as Risk[]) {
          const inside = decidePermission(mode, risk, false, '')
          const outside = decidePermission(mode, risk, true, '')
          rules.push({
            risk: riskName(risk),
            inside: inside.decision,
            outside: outside.decision,
            reason: inside.reason,
          })
        }
        return { mode, rules }
      }
      case 'agent.toolList':
        return this.agent.toolList()
      case 'task.list':
        return this.store.taskList(params)
      case 'task.get': {
        const id = requiredString(params, 'id')
        const task = this.store.taskGet(id)
        if (task === null) throw new NexusError('E_DB', `Task ${id} not found`)
        return {
          task,
          steps: this.store.taskSteps(id),
          toolCalls: this.store.toolCallsList({ taskId: id }),
          fileChanges: this.store.fileChangesList({ taskId: id }),
        }
      }
      case 'chat.cancel': {
        const sessionId = requiredString(params, 'sessionId')
        for (const task of this.store.taskActive()) {
          if (jsonStr(task, 'sessionId') === sessionId) this.agent.cancel(jsonStr(task, 'id'))
        }
        return null
      }
      case 'git.status': {
        const engine = this.gitFor(requiredString(params, 'projectId'))
        return engine.status()
      }
      case 'git.diff': {
        const engine = this.gitFor(requiredString(params, 'projectId'))
        const path = jsonStr(params, 'path')
        return { diff: await engine.diff(path === '' ? undefined : path, jsonBool(params, 'staged')) }
      }
      case 'git.log': {
        const engine = this.gitFor(requiredString(params, 'projectId'))
        return engine.log(jsonInt(params, 'limit', 30))
      }
      case 'git.branches': {
        const engine = this.gitFor(requiredString(params, 'projectId'))
        return engine.branches()
      }
      case 'git.stage': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        await engine.stage(pathsFrom(params?.['paths'] ?? []))
        return engine.status()
      }
      case 'git.unstage': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        await engine.unstage(pathsFrom(params?.['paths'] ?? []))
        return engine.status()
      }
      case 'git.commit': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        const result = await engine.commit(requiredString(params, 'message'), pathsFrom(params?.['paths'] ?? []))
        this.store.gitopsRecord({
          projectId,
          operation: 'commit',
          status: 'success',
          output: jsonStr(result, 'hash'),
        })
        return result
      }
      case 'git.checkout': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        await engine.checkout(requiredString(params, 'branch'), jsonBool(params, 'create'))
        this.store.gitopsRecord({
          projectId,
          operation: 'checkout',
          args: { branch: jsonStr(params, 'branch') },
          status: 'success',
        })
        return engine.status()
      }
      case 'git.fetch':
      case 'git.pull':
      case 'git.push': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        const output =
          method === 'git.fetch' ? await engine.fetch() : method === 'git.pull' ? await engine.pull() : await engine.push()
        this.store.gitopsRecord({
          projectId,
          operation: method.slice(4),
          status: 'success',
          output,
        })
        return { output }
      }
      case 'git.discard': {
        const projectId = requiredString(params, 'projectId')
        const engine = this.gitFor(projectId)
        await engine.discard(pathsFrom(params?.['paths'] ?? []))
        return engine.status()
      }
      case 'terminal.create': {
        const options: Json = { ...params }
        let cwd = jsonStr(params, 'cwd')
        const projectId = jsonStr(params, 'projectId')
        if (cwd === '' && projectId !== '') {
          try {
            cwd = this.workspaceFor(projectId).rootPath
          } catch {
            cwd = ''
          }
        }
        options['cwd'] = cwd
        return this.terminals.create(options)
      }
      case 'terminal.write':
        this.terminals.write(requiredString(params, 'id'), requiredString(params, 'data'))
        return null
      case 'terminal.resize':
        this.terminals.resize(
          requiredString(params, 'id'),
          jsonInt(params, 'cols', 100),
          jsonInt(params, 'rows', 30),
        )
        return null
      case 'terminal.dispose':
        this.terminals.dispose(requiredString(params, 'id'))
        return null
      case 'terminal.list':
        return this.terminals.list()
      case 'change.list':
        return this.store.fileChangesList(params)
      case 'change.diff': {
        const change = this.store.fileChangeGet(requiredString(params, 'id'))
        if (change === null) throw new NexusError('E_DB', 'File change not found')
        return {
          path: jsonStr(change, 'path'),
          before: jsonStr(change, 'beforeContent'),
          after: jsonStr(change, 'afterContent'),
          changeType: jsonStr(change, 'changeType'),
        }
      }
      case 'change.accept':
        return this.store.fileChangeStatus(requiredString(params, 'id'), 'accepted')
      case 'change.reject': {
        const id = requiredString(params, 'id')
        this.applyChangeContent(id, true)
        return this.store.fileChangeStatus(id, 'rejected')
      }
      case 'change.revert': {
        const id = requiredString(params, 'id')
        this.applyChangeContent(id, true)
        return this.store.fileChangeStatus(id, 'reverted')
      }
      case 'orchestrator.config':
        return this.agent.orchestratorConfig()
      case 'orchestrator.setConfig':
        return this.agent.orchestratorSetConfig(params?.['config'] ?? [])
      case 'orchestrator.run':
        return this.agent.orchestratorRun(params)
      case 'stats.session':
        return this.store.sessionStats(jsonStr(params, 'sessionId'))
      case 'usage.summary':
        return this.store.usageSummary(jsonInt(params, 'days', 30))
      case 'usage.list':
        return this.store.usageList(jsonInt(params, 'limit', 100))
      case 'db.stats':
        return this.store.stats()
      case 'db.backup': {
        let stamp = nowIso()
        stamp = stamp.replace(/[:.]/g, '-')
        const destination = pathJoin(pathJoin(this.userDataDir, 'backups'), `nexus-${stamp}.db`)
        return { path: this.store.backup(destination) }
      }
      case 'db.vacuum':
        this.store.vacuum()
        return null
      case 'mcp.servers':
        return this.mcp.listServers()
      case 'mcp.tools':
        return this.mcp.listTools(jsonStr(params, 'serverId'))
      case 'mcp.restart':
        await this.mcp.reload()
        return null
      case 'mcp.auth.start':
        return this.mcp.authStart(requiredString(params, 'serverId'))
      case 'mcp.auth.logout':
        this.mcp.authLogout(requiredString(params, 'serverId'))
        return null
      case 'commands.list':
        return this.listCommands(jsonStr(params, 'projectId'))
      case 'search.global':
        return this.globalSearch(requiredString(params, 'query'))
      case 'shutdown':
        this.shutdown()
        return null
      default:
        throw new NexusError('E_METHOD', `Method not found: ${method}`)
    }
  }
}

export { NexusError } from './errors.ts'
export { EventBus } from './events.ts'
export { Store } from './store.ts'
export { Workspace } from './workspace.ts'
export { Providers } from './providers.ts'
export { ToolRegistry, ProcessManager } from './tools.ts'
export { AgentRuntime, projectRules, goalPromptLines, permanentProviderFailure, canonicalToolName, errorPayload }
export { TerminalManager } from './terminal.ts'
export { McpManager } from './mcp.ts'
export { GitEngine } from './git.ts'
export { WorkspaceWatcher } from './watcher.ts'
