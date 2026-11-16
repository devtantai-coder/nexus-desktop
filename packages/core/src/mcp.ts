import { spawn, type ChildProcess } from 'node:child_process'

import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
import { httpRequest } from './http.ts'
import { McpOauth } from './mcp_oauth.ts'
import type { SecretStore } from './secrets.ts'
import type { Store } from './store.ts'
import { trim, split } from './util.ts'

 
export type Json = any

interface PendingCall {
  resolve: (value: Json) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface ServerEntry {
  id: string
  config: Json
  http: boolean
  sse: boolean
  url: string
  postUrl: string
  sessionId: string
  headers: Record<string, string>
  child?: ChildProcess
  lineBuffer: string
  nextId: number
  dead: boolean
  initialized: boolean
  pending: Map<number, PendingCall>
  tools: Json[]
  error: string
  stderrTail: string
  stopStream: boolean
  sseAbort?: AbortController
}

interface ToolRef {
  name: string
  serverId: string
  toolName: string
}

const sanitize = (value: string): string => {
  let out = ''
  for (const c of value) {
    if (/[A-Za-z0-9_-]/.test(c)) out += c
    else out += '_'
  }
  return out === '' ? 'tool' : out
}

const parseMessageId = (value: Json): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? -1 : parsed
  }
  return -1
}

const jsonStringValue = (value: Json, key: string, fallback = ''): string => {
  const item = value?.[key]
  return typeof item === 'string' ? item : fallback
}

const jsonArray = (value: Json): Json[] =>
  Array.isArray(value) ? (value as Json[]) : []

const jsonBool = (value: Json, key: string, fallback = false): boolean => {
  const item = value?.[key]
  return typeof item === 'boolean' ? item : fallback
}

export class McpManager {
  private readonly store: Store
  private readonly secrets: SecretStore
  private readonly events: EventBus
  private readonly oauth: McpOauth
  private config: Json = null
  private readonly servers = new Map<string, ServerEntry>()
  private readonly toolIndex = new Map<string, ToolRef>()
  private readonly errors = new Map<string, string>()

  constructor(store: Store, secrets: SecretStore, events: EventBus) {
    this.store = store
    this.secrets = secrets
    this.events = events
    this.oauth = new McpOauth(store, secrets)
  }

  async close(): Promise<void> {
    for (const server of this.servers.values()) {
      this.stop(server)
    }
    this.servers.clear()
    this.toolIndex.clear()
    this.errors.clear()
    this.config = null
  }

  private loadConfig(): Json {
    const value = this.store.settingGet('mcp.servers', [])
    return Array.isArray(value) ? (value as Json) : []
  }

  private syncConfig(): void {
    const next = this.loadConfig()
    if (JSON.stringify(next) === JSON.stringify(this.config)) return
    for (const server of this.servers.values()) {
      this.stop(server)
    }
    this.servers.clear()
    this.toolIndex.clear()
    this.errors.clear()
    this.config = next
  }

  private async stop(server: ServerEntry): Promise<void> {
    server.stopStream = true
    server.sseAbort?.abort()
    // Mọi call đang chờ bị huỷ: server sẽ bị dừng bên dưới.
    for (const [id, pending] of [...server.pending]) {
      clearTimeout(pending.timer)
      server.pending.delete(id)
      pending.reject(new NexusError('E_TOOL', `MCP server ${server.id} stopped`))
    }
    const child = server.child
    if (child && child.pid !== undefined) {
      child.stdin?.destroy()
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // đã thoát
        }
      }
    }
    server.dead = true
  }

  private httpTransport(config: Json): boolean {
    const url = jsonStringValue(config, 'url')
    return url.startsWith('http://') || url.startsWith('https://')
  }

  private parseHeaders(config: Json): Record<string, string> {
    const headers: Record<string, string> = {}
    const raw = config?.['headers']
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') headers[key] = value
      }
    }
    return headers
  }

  private async authorizationHeader(headers: Record<string, string>, serverId: string): Promise<void> {
    const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
    if (hasAuth) return
    const token = await this.oauth.bearer(serverId)
    if (token !== '') headers['Authorization'] = `Bearer ${token}`
  }

  private async spawnHttp(config: Json, sse: boolean): Promise<ServerEntry> {
    const id = jsonStringValue(config, 'id')
    const url = jsonStringValue(config, 'url')
    if (id === '' || url === '') {
      throw new NexusError('E_CONFIG', 'MCP server requires id and url')
    }
    const server: ServerEntry = {
      id,
      config,
      http: !sse,
      sse,
      url,
      postUrl: '',
      sessionId: '',
      headers: this.parseHeaders(config),
      lineBuffer: '',
      nextId: 1,
      dead: false,
      initialized: false,
      pending: new Map(),
      tools: [],
      error: '',
      stderrTail: '',
      stopStream: false,
    }
    if (sse) this.startSseStream(server)
    return server
  }

  private async spawnStdio(config: Json): Promise<ServerEntry> {
    const id = jsonStringValue(config, 'id')
    const command = jsonStringValue(config, 'command')
    if (id === '' || command === '') {
      throw new NexusError('E_CONFIG', 'MCP server requires id and command')
    }
    const args = jsonArray(config?.['args']).map((arg) =>
      typeof arg === 'string' ? arg : JSON.stringify(arg),
    )
    const envRaw = config?.['env']
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (envRaw !== null && typeof envRaw === 'object' && !Array.isArray(envRaw)) {
      for (const [key, value] of Object.entries(envRaw)) {
        env[key] = typeof value === 'string' ? value : JSON.stringify(value)
      }
    }
    let child: ChildProcess
    try {
      child = spawn(command, args, {
        env,
        detached: true,
        ...(typeof config?.['cwd'] === 'string' && config['cwd'] !== '' ? { cwd: config['cwd'] } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new NexusError('E_CONFIG', error instanceof Error ? error.message : String(error))
    }
    if (child.pid === undefined) {
      throw new NexusError('E_CONFIG', 'Cannot spawn MCP server')
    }
    const server: ServerEntry = {
      id,
      config,
      http: false,
      sse: false,
      url: '',
      postUrl: '',
      sessionId: '',
      headers: {},
      child,
      lineBuffer: '',
      nextId: 1,
      dead: false,
      initialized: false,
      pending: new Map(),
      tools: [],
      error: '',
      stderrTail: '',
      stopStream: false,
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      server.lineBuffer += chunk.toString('utf8')
      let position = server.lineBuffer.indexOf('\n')
      while (position !== -1) {
        const line = trim(server.lineBuffer.slice(0, position))
        server.lineBuffer = server.lineBuffer.slice(position + 1)
        if (line !== '') {
          let message: Json = null
          try {
            message = JSON.parse(line)
          } catch {
            message = null
          }
          if (message !== null) this.deliver(server, message)
        }
        position = server.lineBuffer.indexOf('\n')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      server.stderrTail = (server.stderrTail + chunk.toString('utf8')).slice(-4000)
    })
    const onExit = (): void => {
      server.dead = true
      for (const [id, pending] of [...server.pending]) {
        clearTimeout(pending.timer)
        server.pending.delete(id)
        pending.reject(new NexusError('E_TOOL', `MCP server ${server.id} exited`))
      }
    }
    child.on('exit', onExit)
    child.on('error', onExit)
    return server
  }

  private async spawn(config: Json): Promise<ServerEntry> {
    const wantsSse = this.httpTransport(config) && jsonStringValue(config, 'transport') === 'sse'
    if (this.httpTransport(config)) {
      return this.spawnHttp(config, wantsSse)
    }
    return this.spawnStdio(config)
  }

  private startSseStream(server: ServerEntry): void {
    server.stopStream = false
    const buffer = { text: '' }
    const controller = new AbortController()
    server.sseAbort = controller
    const authorization: Record<string, string> = { ...server.headers }
    void this.authorizationHeader(authorization, server.id).then(async () => {
      const headers: Record<string, string> = { Accept: 'text/event-stream', ...authorization }
      const response = await httpRequest(
        {
          url: server.url,
          method: 'GET',
          headers,
          timeoutSeconds: 0,
        },
        (data: Buffer) => {
          buffer.text += data.toString('utf8')
          let start = 0
          let position = buffer.text.indexOf('\n')
          while (position !== -1) {
            const line = trim(buffer.text.slice(start, position))
            start = position + 1
            if (line.startsWith('data:')) {
              const payload = trim(line.slice(5))
              if (payload !== '' && payload.startsWith('{') === false) {
                let endpoint = payload
                if (!endpoint.startsWith('http')) {
                  const scheme = server.url.indexOf('://')
                  const path = scheme === -1 ? -1 : server.url.indexOf('/', scheme + 3)
                  const origin = path === -1 ? server.url : server.url.slice(0, path)
                  endpoint = endpoint.startsWith('/') ? origin + endpoint : `${origin}/${endpoint}`
                }
                server.postUrl = endpoint
                continue
              }
              try {
                const message = JSON.parse(payload) as Json
                if (message !== null) this.deliver(server, message)
              } catch {
                // keepalive / partial json — bỏ qua
              }
              continue
            }
            if (line !== '' && line.startsWith('{')) {
              try {
                const message = JSON.parse(line) as Json
                if (message !== null) this.deliver(server, message)
              } catch {
                // bỏ qua
              }
            }
            position = buffer.text.indexOf('\n', start)
          }
          buffer.text = buffer.text.slice(Math.max(0, start))
          return !server.stopStream
        },
        controller.signal,
      )
      if (!server.stopStream) {
        if (response.error !== '' && response.error !== 'cancelled') {
          server.error = response.error
        }
        server.dead = true
        for (const [id, pending] of [...server.pending]) {
          clearTimeout(pending.timer)
          server.pending.delete(id)
          pending.reject(new NexusError('E_TOOL', 'MCP SSE stream closed'))
        }
      }
    })
  }

  private deliver(server: ServerEntry, message: Json): void {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return
    const hasId =
      Object.prototype.hasOwnProperty.call(message, 'id') &&
      ((Object.prototype.hasOwnProperty.call(message, 'result') && message['result'] !== undefined) ||
        Object.prototype.hasOwnProperty.call(message, 'error'))
    if (hasId) {
      const id = parseMessageId(message['id'])
      const pending = server.pending.get(id)
      if (pending === undefined) return
      server.pending.delete(id)
      clearTimeout(pending.timer)
      const error = message['error']
      if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
        pending.reject(new NexusError('E_TOOL', jsonStringValue(error, 'message', 'MCP error')))
      } else {
        pending.resolve(message['result'] ?? null)
      }
      return
    }
    if (typeof message['method'] === 'string' && message['id'] !== undefined) {
      if (server.sse) return // SSE: client -> server chỉ POST một chiều
      const reply = {
        jsonrpc: '2.0',
        id: message['id'],
        error: { code: -32601, message: 'Client method not supported' },
      }
      this.writeLine(server, JSON.stringify(reply))
    }
    // notifications : bỏ qua.
  }

  private writeLine(server: ServerEntry, line: string): boolean {
    const child = server.child
    if (child?.stdin && !server.dead) {
      try {
        return child.stdin.write(`${line}\n`)
      } catch {
        server.dead = true
        return false
      }
    }
    return false
  }

  private async callHttp(
    server: ServerEntry,
    message: Json,
    timeoutMs: number,
  ): Promise<Json> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2024-11-05',
      ...server.headers,
    }
    await this.authorizationHeader(headers, server.id)
    if (server.sessionId !== '') headers['Mcp-Session-Id'] = server.sessionId
    const response = await httpRequest({
      url: server.url,
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000)),
    })
    if (response.error !== '') {
      throw new NexusError('E_TOOL', `${server.id}: ${response.error}`)
    }
    // Node lowercases header names.
    const session = response.headers['mcp-session-id']
    if (typeof session === 'string' && session !== '') server.sessionId = session
    if (response.status === 401) {
      this.oauth.invalidate(server.id)
      throw new NexusError(
        'E_AUTH',
        `${server.id}: server yêu cầu OAuth. Bấm “Kết nối” trong Settings → MCP servers.`,
      )
    }
    if (response.status >= 400) {
      const detail = trim(response.body).slice(0, 300)
      throw new NexusError('E_TOOL', `${server.id}: HTTP ${response.status}${detail !== '' ? ` ${detail}` : ''}`)
    }
    if (message['id'] === undefined) return null
    let parsed: Json = null
    if (response.body.includes('data:')) {
      for (const rawLine of split(response.body, '\n')) {
        const line = trim(rawLine)
        if (!line.startsWith('data:')) continue
        const payload = trim(line.slice(5))
        try {
          const candidate = JSON.parse(payload) as Json
          if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
            if (Object.prototype.hasOwnProperty.call(candidate, 'result') ||
                Object.prototype.hasOwnProperty.call(candidate, 'error')) {
              parsed = candidate
            }
          }
        } catch {
          // bỏ qua frame không phải JSON
        }
      }
    } else {
      try {
        parsed = JSON.parse(response.body)
      } catch {
        parsed = null
      }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new NexusError('E_TOOL', `${server.id}: MCP response is not valid JSON`)
    }
    const error = parsed['error']
    if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
      throw new NexusError('E_TOOL', `${server.id}: ${jsonStringValue(error, 'message', 'MCP error')}`)
    }
    return parsed['result'] ?? null
  }

  private async request(
    server: ServerEntry,
    method: string,
    params: Json,
    timeoutMs: number,
  ): Promise<Json> {
    if (server.dead) {
      throw new NexusError('E_TOOL', `MCP server ${server.id} is not running`)
    }
    const message: Json = {
      jsonrpc: '2.0',
      id: server.nextId,
      method,
      params: params ?? {},
    }
    if (server.http) {
      server.nextId += 1
      return this.callHttp(server, message, timeoutMs)
    }
    const id = server.nextId
    server.nextId += 1
    const pending = this.createPending(server, timeoutMs, method, id)
    message.id = id
    if (server.sse) {
      if (server.postUrl === '') {
        const ready = await waitFor(
          () => server.postUrl !== '' || server.dead,
          Math.min(timeoutMs, 20000),
        )
        if (!ready || server.postUrl === '') {
          throw new NexusError('E_TIMEOUT', `${server.id}: MCP SSE endpoint not announced`)
        }
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...server.headers,
      }
      await this.authorizationHeader(headers, server.id)
      server.pending.set(id, pending)
      const response = await httpRequest({
        url: server.postUrl,
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000)),
      })
      if (response.error !== '') {
        server.pending.delete(id)
        clearTimeout(pending.timer)
        throw new NexusError('E_TOOL', `${server.id}: ${response.error}`)
      }
      return pending.promise
    }
    // stdio transport
    server.pending.set(id, pending)
    if (!this.writeLine(server, JSON.stringify(message))) {
      server.pending.delete(id)
      clearTimeout(pending.timer)
      throw new NexusError('E_TOOL', `Cannot write to MCP server ${server.id}`)
    }
    return pending.promise
  }

  private createPending(
    server: ServerEntry,
    timeoutMs: number,
    method: string,
    id: number,
  ): PendingCall & { promise: Promise<Json> } {
    let resolveRef: (value: Json) => void = () => {}
    let rejectRef: (error: Error) => void = () => {}
    const promise = new Promise<Json>((resolve, reject) => {
      resolveRef = resolve
      rejectRef = reject
    })
    const timer = setTimeout(() => {
      server.pending.delete(id)
      rejectRef(new NexusError('E_TIMEOUT', `MCP request timed out: ${method}`))
    }, timeoutMs)
    return { resolve: resolveRef, reject: rejectRef, timer, promise }
  }

  private async notify(server: ServerEntry, method: string, params: Json): Promise<void> {
    const message: Json = { jsonrpc: '2.0', method }
    if (params !== null && params !== undefined) message['params'] = params
    if (server.http || server.sse) {
      try {
        if (server.http) {
          await this.callHttp(server, message, 15000)
        } else {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...server.headers,
          }
          await this.authorizationHeader(headers, server.id)
          if (server.postUrl !== '') {
            await httpRequest({
              url: server.postUrl,
              method: 'POST',
              headers,
              body: JSON.stringify(message),
              timeoutSeconds: 15,
            })
          }
        }
      } catch {
        // notifications không cần ack
      }
      return
    }
    this.writeLine(server, JSON.stringify(message))
  }

  private async initialize(server: ServerEntry): Promise<Json> {
    const params = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nexus-desktop', version: '0.1.0' },
    }
    const result = await this.request(server, 'initialize', params, 30000)
    await this.notify(server, 'notifications/initialized', null)
    server.initialized = true
    return result
  }

  private async fetchTools(server: ServerEntry): Promise<Json> {
    const result = await this.request(server, 'tools/list', {}, 30000)
    const tools = jsonArray(result?.['tools'])
    server.tools = tools
    return tools
  }

  private async ensure(serverId: string): Promise<ServerEntry> {
    this.syncConfig()
    const existing = this.servers.get(serverId)
    if (existing !== undefined && !existing.dead) return existing
    let config: Json = null
    for (const entry of jsonArray(this.config)) {
      if (jsonStringValue(entry, 'id') === serverId) {
        config = entry
        break
      }
    }
    if (config === null) throw new NexusError('E_CONFIG', `MCP server not found: ${serverId}`)
    if (!jsonBool(config, 'enabled', true)) {
      throw new NexusError('E_CONFIG', `MCP server is disabled: ${serverId}`)
    }
    const server = await this.spawn(config)
    try {
      await this.initialize(server)
      await this.fetchTools(server)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.errors.set(serverId, message)
      await this.stop(server)
      throw error
    }
    this.errors.delete(serverId)
    this.servers.set(serverId, server)
    this.events.emit('mcp.server.status', { serverId, status: 'ready' })
    return server
  }

  async reload(): Promise<void> {
    for (const server of this.servers.values()) {
      await this.stop(server)
    }
    this.servers.clear()
    this.toolIndex.clear()
    this.errors.clear()
    this.config = null
  }

  async listServers(): Promise<Json[]> {
    this.syncConfig()
    const result: Json[] = []
    for (const entry of jsonArray(this.config)) {
      const id = jsonStringValue(entry, 'id')
      const info: Json = {
        id,
        command: jsonStringValue(entry, 'command'),
        args: Array.isArray(entry?.['args']) ? entry['args'] : [],
        url: jsonStringValue(entry, 'url'),
        transport: jsonStringValue(entry, 'transport'),
        enabled: jsonBool(entry, 'enabled', true),
      }
      const server = this.servers.get(id)
      if (server !== undefined && !server.dead) {
        info['status'] = { running: true, tools: server.tools.length }
      } else {
        info['status'] = { running: false }
      }
      if (jsonStringValue(entry, 'url') !== '') {
        info['auth'] = this.oauth.status(id)
      }
      const failure = this.errors.get(id)
      if (failure !== undefined) info['error'] = failure.slice(0, 500)
      if (server !== undefined) {
        const tail = server.stderrTail
        if (tail !== '') info['stderr'] = tail.length > 2000 ? tail.slice(tail.length - 2000) : tail
      }
      result.push(info)
    }
    return result
  }

  async listTools(serverId = ''): Promise<Json[]> {
    this.syncConfig()
    const result: Json[] = []
    const describe = (server: ServerEntry): void => {
      for (const tool of server.tools) {
        const toolName = jsonStringValue(tool, 'name')
        if (toolName === '') continue
        result.push({
          ...(serverId === '' ? { serverId: server.id } : {}),
          name: toolName,
          namespacedName: `mcp__${sanitize(server.id)}__${sanitize(toolName)}`,
          description: jsonStringValue(tool, 'description'),
          inputSchema: tool?.['inputSchema'] ?? {},
        })
      }
    }
    if (serverId !== '') {
      const server = await this.ensure(serverId)
      describe(server)
      return result
    }
    for (const entry of jsonArray(this.config)) {
      if (!jsonBool(entry, 'enabled', true)) continue
      try {
        describe(await this.ensure(jsonStringValue(entry, 'id')))
      } catch {
        // server lỗi — bỏ qua, error surface qua listServers()
      }
    }
    return result
  }

  async agentTools(): Promise<Json[]> {
    this.syncConfig()
    const result: Json[] = []
    this.toolIndex.clear()
    for (const entry of jsonArray(this.config)) {
      if (!jsonBool(entry, 'enabled', true)) continue
      const id = jsonStringValue(entry, 'id')
      if (id === '') continue
      try {
        const server = await this.ensure(id)
        for (const tool of server.tools) {
          const toolName = jsonStringValue(tool, 'name')
          if (toolName === '') continue
          let namespaced = `mcp__${sanitize(id)}__${sanitize(toolName)}`
          let suffix = 2
          while (this.toolIndex.has(namespaced)) {
            namespaced = `${namespaced}_${suffix}`
            suffix += 1
          }
          this.toolIndex.set(namespaced, { name: namespaced, serverId: id, toolName })
          result.push({
            name: namespaced,
            description: jsonStringValue(tool, 'description', `MCP tool ${toolName}`),
            parameters: tool?.['inputSchema'] ?? {},
            serverId: id,
            toolName,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const server = this.servers.get(id)
        if (server !== undefined) server.error = message
      }
    }
    return result
  }

  cachedAgentTools(): Json[] {
    const result: Json[] = []
    for (const [id, server] of this.servers) {
      if (server.dead) continue
      for (const tool of server.tools) {
        const toolName = jsonStringValue(tool, 'name')
        if (toolName === '') continue
        result.push({
          name: `mcp__${sanitize(id)}__${sanitize(toolName)}`,
          description: jsonStringValue(tool, 'description'),
          parameters: tool?.['inputSchema'] ?? {},
          serverId: id,
          toolName,
        })
      }
    }
    return result
  }

  callNamespaced(name: string, args: Json): Promise<Json> {
    const reference = this.toolIndex.get(name)
    if (reference === undefined) {
      throw new NexusError('E_TOOL', `MCP tool not found: ${name}`)
    }
    return this.call(reference.serverId, reference.toolName, args)
  }

  async call(serverId: string, tool: string, args: Json): Promise<Json> {
    this.syncConfig()
    const server = await this.ensure(serverId)
    const params = { name: tool, arguments: args !== null && typeof args === 'object' ? args : {} }
    const result = await this.request(server, 'tools/call', params, 120000)
    if (jsonBool(result, 'isError')) {
      let message = ''
      const content = result?.['content']
      if (Array.isArray(content)) {
        for (const item of content as Json[]) {
          if (jsonStringValue(item, 'type') === 'text') {
            message += jsonStringValue(item, 'text')
          }
        }
      }
      throw new NexusError('E_TOOL', message === '' ? 'MCP tool failed' : message)
    }
    return result
  }

  async authStart(serverId: string): Promise<Json> {
    this.syncConfig()
    let config: Json = null
    for (const entry of jsonArray(this.config)) {
      if (jsonStringValue(entry, 'id') === serverId) {
        config = entry
        break
      }
    }
    if (config === null) throw new NexusError('E_CONFIG', `MCP server not found: ${serverId}`)
    const resource = jsonStringValue(config, 'url')
    if (resource === '') {
      throw new NexusError('E_CONFIG', `MCP server has no URL: ${serverId}`)
    }
    return this.oauth.start(serverId, resource)
  }

  authLogout(serverId: string): void {
    this.syncConfig()
    this.oauth.clear(serverId)
  }
}

const waitFor = async (
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return condition()
}
