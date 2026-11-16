import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
const extname = (path: string): string => {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index) : ''
}

export type Json = any

export interface LspServerConfig {
  languageId: string
  command: string
  args?: string[]
  extensions?: string[]
  initializationOptions?: Json
}

export interface LspPosition {
  line: number
  character: number
}

const DEFAULT_SERVERS: LspServerConfig[] = [
  {
    languageId: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    languageId: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
  },
  {
    languageId: 'rust',
    command: 'rust-analyzer',
    extensions: ['.rs'],
  },
  {
    languageId: 'go',
    command: 'gopls',
    extensions: ['.go'],
  },
]

const toUri = (path: string): string => `file://${path.startsWith('/') ? '' : '/'}${path
  .split('/')
  .map(encodeURIComponent)
  .join('/')}`

const fromUri = (uri: string): string => {
  const raw = uri.startsWith('file://') ? uri.slice(7) : uri
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const positionOf = (position: LspPosition): LspPosition => ({
  line: Math.max(0, Math.trunc(position.line)),
  character: Math.max(0, Math.trunc(position.character)),
})

interface PendingRequest {
  resolve: (value: Json) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

class LspClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private opened = new Set<string>()
  private diagnosticsByPath = new Map<string, Json[]>()
  private stderr = ''
  private startPromise: Promise<void> | null = null

  readonly config: LspServerConfig
  readonly rootPath: string
  private readonly events: EventBus

  constructor(config: LspServerConfig, rootPath: string, events: EventBus) {
    this.config = config
    this.rootPath = rootPath
    this.events = events
  }

  async start(): Promise<void> {
    if (this.startPromise !== null) return this.startPromise
    this.startPromise = this.doStart()
    try {
      await this.startPromise
    } catch (error) {
      this.startPromise = null
      throw error
    }
  }

  private async doStart(): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-8000)
    })
    child.on('error', (error) => this.failAll(error))
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        this.failAll(new Error(`${this.config.command} exited with code ${code}`))
      }
    })
    const rootUri = toUri(this.rootPath)
    await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          references: {},
          publishDiagnostics: {},
          diagnostic: { dynamicRegistration: false },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
      initializationOptions: this.config.initializationOptions ?? {},
    })
    this.notify('initialized', {})
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.slice(0, headerEnd).toString()
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (match === null) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const total = headerEnd + 4 + Number(match[1])
      if (this.buffer.length < total) return
      const body = this.buffer.slice(headerEnd + 4, total).toString()
      this.buffer = this.buffer.slice(total)
      try {
        this.handle(JSON.parse(body))
      } catch {
        // bỏ qua frame không hợp lệ
      }
    }
  }

  private handle(message: Json): void {
    const method = typeof message?.['method'] === 'string' ? message['method'] : ''
    const id = message?.['id']
    if (method !== '' && id !== undefined) {
      const result =
        method === 'workspace/configuration'
          ? []
          : method === 'client/registerCapability' || method === 'window/workDoneProgress/create'
            ? null
            : null
      this.write({ jsonrpc: '2.0', id, result })
      return
    }
    if (method !== '' && id === undefined) {
      if (method === 'textDocument/publishDiagnostics') {
        const uri = typeof message?.['params']?.['uri'] === 'string' ? message['params']['uri'] : ''
        const list = Array.isArray(message?.['params']?.['diagnostics'])
          ? message['params']['diagnostics']
          : []
        if (uri !== '') {
          const path = fromUri(uri)
          this.diagnosticsByPath.set(path, list)
          this.events.emit('nexus/lsp-diagnostics', { path, diagnostics: list })
        }
      }
      return
    }
    if (id === undefined) return
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (message?.['error'] !== undefined) {
      const error = message['error']
      pending.reject(
        new NexusError(
          'E_LSP',
          typeof error?.['message'] === 'string' ? error['message'] : 'LSP request failed',
        ),
      )
      return
    }
    pending.resolve(message?.['result'] ?? null)
  }

  private write(message: Json): void {
    if (this.child === null || this.child.stdin.destroyed) {
      throw new NexusError('E_LSP', `${this.config.command} is not running`)
    }
    const body = JSON.stringify(message)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  private request(method: string, params: Json): Promise<Json> {
    const id = this.nextId
    this.nextId += 1
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new NexusError('E_LSP', `${this.config.command}: ${method} timed out`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private notify(method: string, params: Json): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  async open(path: string): Promise<void> {
    const uri = toUri(path)
    if (this.opened.has(uri)) return
    const text = readFileSync(path, 'utf8')
    this.opened.add(uri)
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.config.languageId,
        version: 1,
        text,
      },
    })
  }

  async hover(path: string, position: LspPosition): Promise<Json> {
    await this.open(path)
    return this.request('textDocument/hover', {
      textDocument: { uri: toUri(path) },
      position: positionOf(position),
    })
  }

  async definition(path: string, position: LspPosition): Promise<Json> {
    await this.open(path)
    return this.request('textDocument/definition', {
      textDocument: { uri: toUri(path) },
      position: positionOf(position),
    })
  }

  async references(path: string, position: LspPosition): Promise<Json> {
    await this.open(path)
    return this.request('textDocument/references', {
      textDocument: { uri: toUri(path) },
      position: positionOf(position),
      context: { includeDeclaration: true },
    })
  }

  async diagnostics(path: string): Promise<Json[]> {
    await this.open(path)
    const cached = this.diagnosticsByPath.get(path)
    if (cached !== undefined) return cached
    try {
      const result = await this.request('textDocument/diagnostic', {
        textDocument: { uri: toUri(path) },
      })
      const list = Array.isArray(result?.['items']) ? result['items'] : []
      this.diagnosticsByPath.set(path, list)
      return list
    } catch {
      return []
    }
  }

  get lastError(): string {
    return this.stderr
  }

  dispose(): void {
    this.failAll(new NexusError('E_LSP', 'LSP client disposed'))
    if (this.child !== null) {
      this.child.stdin.end()
      this.child.kill()
      this.child = null
    }
    this.opened.clear()
    this.diagnosticsByPath.clear()
  }
}

export class LspService {
  private clients = new Map<string, LspClient>()
  private configs: LspServerConfig[]
  private readonly events: EventBus

  constructor(events: EventBus, configs?: LspServerConfig[]) {
    this.events = events
    this.configs = configs && configs.length > 0 ? configs : DEFAULT_SERVERS
  }

  configure(configs: LspServerConfig[]): void {
    if (configs.length === 0) return
    this.dispose()
    this.configs = configs
  }

  servers(): LspServerConfig[] {
    return [...this.configs]
  }

  private configFor(path: string): LspServerConfig | undefined {
    const extension = extname(path).toLowerCase()
    return this.configs.find((config) =>
      (config.extensions ?? []).some((entry) => entry.toLowerCase() === extension),
    )
  }

  private async clientFor(rootPath: string, path: string): Promise<LspClient> {
    const config = this.configFor(path)
    if (config === undefined) {
      throw new NexusError(
        'E_CONFIG',
        `No LSP server configured for ${extname(path) || 'this file type'}.`,
      )
    }
    const key = `${rootPath}::${config.languageId}::${config.command}`
    const existing = this.clients.get(key)
    if (existing !== undefined) return existing
    const client = new LspClient(config, rootPath, this.events)
    try {
      await client.start()
    } catch (error) {
      client.dispose()
      const detail = client.lastError !== '' ? `: ${client.lastError}` : ''
      throw new NexusError(
        'E_CONFIG',
        `Cannot start ${config.command}${detail} (${error instanceof Error ? error.message : String(error)})`,
      )
    }
    this.clients.set(key, client)
    return client
  }

  async hover(rootPath: string, path: string, position: LspPosition): Promise<Json> {
    const client = await this.clientFor(rootPath, path)
    return client.hover(path, position)
  }

  async definition(rootPath: string, path: string, position: LspPosition): Promise<Json> {
    const client = await this.clientFor(rootPath, path)
    return client.definition(path, position)
  }

  async references(rootPath: string, path: string, position: LspPosition): Promise<Json> {
    const client = await this.clientFor(rootPath, path)
    return client.references(path, position)
  }

  async diagnostics(rootPath: string, path: string): Promise<Json[]> {
    const client = await this.clientFor(rootPath, path)
    return client.diagnostics(path)
  }

  dispose(): void {
    for (const client of this.clients.values()) client.dispose()
    this.clients.clear()
  }
}