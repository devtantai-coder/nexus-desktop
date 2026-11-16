import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
import { McpOauth } from './mcp_oauth.ts'
import type { SecretStore } from './secrets.ts'
import type { Store } from './store.ts'

export type Json = any

interface ServerEntry {
  id: string
  config: Json
  client: Client
  transport: Transport
  http: boolean
  sse: boolean
  url: string
  tools: Json[]
  dead: boolean
  error: string
  stderrTail: string
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

const jsonStringValue = (value: Json, key: string, fallback = ''): string => {
  const item = value?.[key]
  return typeof item === 'string' ? item : fallback
}

const jsonArray = (value: Json): Json[] => (Array.isArray(value) ? (value as Json[]) : [])

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
      await this.stop(server)
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
      void this.stop(server)
    }
    this.servers.clear()
    this.toolIndex.clear()
    this.errors.clear()
    this.config = next
  }

  private async stop(server: ServerEntry): Promise<void> {
    server.dead = true
    try {
      await server.client.close()
    } catch {
      // server đã đóng hoặc transport lỗi — bỏ qua
    }
  }

  private isHttp(config: Json): boolean {
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

  private async authorizationHeader(
    headers: Record<string, string>,
    serverId: string,
  ): Promise<void> {
    const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
    if (hasAuth) return
    const token = await this.oauth.bearer(serverId)
    if (token !== '') headers['Authorization'] = `Bearer ${token}`
  }

  private async createTransport(config: Json, id: string): Promise<Transport> {
    if (this.isHttp(config)) {
      const url = jsonStringValue(config, 'url')
      const headers = this.parseHeaders(config)
      await this.authorizationHeader(headers, id)
      const endpoint = new URL(url)
      const requestInit: RequestInit = { headers }
      if (jsonStringValue(config, 'transport') === 'sse') {
        return new SSEClientTransport(endpoint, {
          requestInit,
          eventSourceInit: {
            fetch: ((input: string | URL | Request, init?: RequestInit) =>
              fetch(input, {
                ...init,
                headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
              })) as typeof fetch,
          },
        })
      }
      return new StreamableHTTPClientTransport(endpoint, { requestInit })
    }
    const command = jsonStringValue(config, 'command')
    if (command === '') throw new NexusError('E_CONFIG', 'MCP server requires id and command')
    const args = jsonArray(config?.['args']).map((arg) =>
      typeof arg === 'string' ? arg : JSON.stringify(arg),
    )
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value
    }
    const envRaw = config?.['env']
    if (envRaw !== null && typeof envRaw === 'object' && !Array.isArray(envRaw)) {
      for (const [key, value] of Object.entries(envRaw)) {
        env[key] = typeof value === 'string' ? value : JSON.stringify(value)
      }
    }
    const cwd = jsonStringValue(config, 'cwd')
    return new StdioClientTransport({
      command,
      args,
      env,
      stderr: 'pipe',
      ...(cwd !== '' ? { cwd } : {}),
    })
  }

  private async spawn(config: Json): Promise<ServerEntry> {
    const id = jsonStringValue(config, 'id')
    if (id === '') throw new NexusError('E_CONFIG', 'MCP server requires id')
    const http = this.isHttp(config)
    const sse = http && jsonStringValue(config, 'transport') === 'sse'
    const server = {
      id,
      config,
      client: new Client({ name: 'nexus-desktop', version: '0.1.0' }, { capabilities: {} }),
      transport: null as unknown as Transport,
      http,
      sse,
      url: jsonStringValue(config, 'url'),
      tools: [] as Json[],
      dead: false,
      error: '',
      stderrTail: '',
    }
    server.transport = await this.createTransport(config, id)
    server.client.onclose = () => {
      server.dead = true
    }
    server.client.onerror = (error: Error) => {
      server.error = error.message
    }
    if (server.transport instanceof StdioClientTransport) {
      server.transport.stderr?.on('data', (chunk: Buffer) => {
        server.stderrTail = (server.stderrTail + chunk.toString('utf8')).slice(-4000)
      })
    }
    server.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      try {
        const listed = await server.client.listTools()
        server.tools = jsonArray(listed.tools)
        this.events.emit('mcp.server.status', { serverId: id, status: 'ready' })
      } catch {
        // server đang đóng — giữ danh sách cũ
      }
    })
    try {
      await server.client.connect(server.transport)
      const listed = await server.client.listTools()
      server.tools = jsonArray(listed.tools)
    } catch (error) {
      server.dead = true
      try {
        await server.client.close()
      } catch {
        // ignore
      }
      const message = error instanceof Error ? error.message : String(error)
      const oauthLikely =
        /\b401\b|unauthori[sz]ed/i.test(message) || /POSTing to endpoint|HTTP error/i.test(message)
      if (oauthLikely && http) {
        this.oauth.invalidate(id)
        throw new NexusError(
          'E_AUTH',
          `${id}: server yêu cầu OAuth hoặc từ chối kết nối (${message}). Bấm “Kết nối” trong Settings → MCP servers.`,
        )
      }
      throw new NexusError('E_TOOL', `${id}: ${message}`)
    }
    return server
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
    try {
      const server = await this.spawn(config)
      this.errors.delete(serverId)
      this.servers.set(serverId, server)
      this.events.emit('mcp.server.status', { serverId, status: 'ready' })
      return server
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.errors.set(serverId, message)
      throw error
    }
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
        if (server.error !== '') info['error'] = server.error.slice(0, 500)
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
    const result = (await server.client.callTool({
      name: tool,
      arguments: args !== null && typeof args === 'object' ? args : {},
    })) as Json
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
