import { EventBus } from './events.ts'
import { createContainer, type Container } from './plugins/runtime.ts'
import { agentPlugin } from './plugins/agent.ts'
import { apiPlugin, NexusApi } from './plugins/api.ts'
import { eventsPlugin } from './plugins/events.ts'
import { lspPlugin } from './plugins/lsp.ts'
import { mcpPlugin } from './plugins/mcp.ts'
import { providersPlugin } from './plugins/providers.ts'
import { retrievalPlugin } from './plugins/retrieval.ts'
import { secretsPlugin } from './plugins/secrets.ts'
import { storePlugin } from './plugins/store.ts'
import { terminalsPlugin } from './plugins/terminals.ts'
import { toolsPlugin } from './plugins/tools.ts'
import { workspacesPlugin } from './plugins/workspaces.ts'

export type Json = any

export interface CoreOptions {
  databasePath: string
  userDataDir: string
  appVersion: string
}

/**
 * Core host.
 *
 * Everything that used to be instantiated by hand in this constructor is now a cordis
 * plugin over in `./plugins/*`. The host only owns the container, the event bus and the
 * request entry point, which keeps this file small and the lifecycle obvious:
 *
 *   const core = new Core(options)
 *   core.initialize()          // loads every plugin in dependency order
 *   await core.request(...)    // dispatches to `nexus.api`
 *   core.shutdown()            // unloads every plugin in reverse order
 */
export class Core {
  readonly events = new EventBus()
  readonly container: Container = createContainer()
  private readonly options: CoreOptions
  private api: NexusApi | null = null
  private closed = false

  constructor(options: CoreOptions) {
    this.options = options
    this.registerPlugins()
  }

  /** Plugins may be swapped out before `initialize()` (used by tests/builds). */
  protected registerPlugins(): void {
    this.container.registerAll([
      eventsPlugin,
      storePlugin,
      secretsPlugin,
      providersPlugin,
      mcpPlugin,
      workspacesPlugin,
      lspPlugin,
      retrievalPlugin,
      toolsPlugin,
      agentPlugin,
      terminalsPlugin,
      apiPlugin,
    ])
  }

  /**
   * Load every plugin. Async because some plugins (MCP, LSP) may await during setup.
   * `initialize()` is kept as the sync-friendly entry point used by the app: it starts
   * the load and returns, so startup latency is unchanged.
   */
  private loadPromise: Promise<void> | null = null

  initialize(): void {
    this.loadPromise = this.load().catch((error: unknown) => {
      process.stderr.write(
        `nexus-core: plugin load failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      )
    })
  }

  async load(): Promise<void> {
    const { databasePath, userDataDir, appVersion } = this.options
    this.container.pluginConfig(eventsPlugin.name, { bus: this.events })
    this.container.pluginConfig(storePlugin.name, { databasePath })
    this.container.pluginConfig(secretsPlugin.name, { userDataDir })
    this.container.pluginConfig(agentPlugin.name, { userDataDir })
    this.container.pluginConfig(apiPlugin.name, { databasePath, userDataDir, appVersion })

    await this.container.loadAll()
    this.api = this.container.get<NexusApi>('nexus.core')
    this.interruptStaleTasks()
  }

  async request(method: string, params: Json): Promise<Json> {
    if (this.closed) throw new Error('nexus-core: core has been shut down')
    if (this.loadPromise) await this.loadPromise
    if (this.api === null) throw new Error('nexus-core: core is not initialized')
    return this.api.request(method, params)
  }

  shutdown(): void {
    if (this.closed) return
    this.closed = true
    void this.container.unloadAll().catch(() => undefined)
    try {
      this.events.clear()
    } catch {
      // bus already detached
    }
  }

  /** Tasks left `running` when the app died cannot be resumed automatically. */
  private interruptStaleTasks(): void {
    const store = this.container.getService<{ taskActive(): Json[] } & Record<string, any>>(
      'nexus.store',
    )
    if (!store) return
    for (const task of store.taskActive()) {
      const id = String(task['id'] ?? '')
      const error = {
        code: 'E_INTERRUPTED',
        message: 'Tác vụ bị gián đoạn khi ứng dụng khởi động lại.',
      }
      store.taskSetError(id, error)
      store.taskSetSummary(
        id,
        'Tác vụ bị gián đoạn khi ứng dụng khởi động lại. Tiến độ đã được lưu; nhấn Tiếp tục để chạy tiếp.',
      )
      store.taskState(id, 'cancelled', undefined, Date.now())
    }
  }
}

export { NexusError } from './errors.ts'
export { EventBus } from './events.ts'
export { Store } from './store.ts'
export { Workspace } from './workspace.ts'
export { Providers } from './providers.ts'
export { ToolRegistry, ProcessManager } from './tools.ts'
export {
  AgentRuntime,
  projectRules,
  goalPromptLines,
  permanentProviderFailure,
  canonicalToolName,
  errorPayload,
} from './agent.ts'
export { TerminalManager } from './terminal.ts'
export { McpManager } from './mcp.ts'
export { GitEngine } from './git.ts'
export { WorkspaceWatcher } from './watcher.ts'

/* Plugin surface, for hosts that want to compose their own core. */
export { Container, createContainer, definePlugin } from './plugins/runtime.ts'
export { Services } from './plugins/runtime.ts'
export type { Context, Disposable, Plugin } from './plugins/runtime.ts'
export { storePlugin } from './plugins/store.ts'
export { secretsPlugin } from './plugins/secrets.ts'
export { providersPlugin } from './plugins/providers.ts'
export { mcpPlugin } from './plugins/mcp.ts'
export { workspacesPlugin } from './plugins/workspaces.ts'
export { lspPlugin } from './plugins/lsp.ts'
export { retrievalPlugin } from './plugins/retrieval.ts'
export { toolsPlugin } from './plugins/tools.ts'
export { agentPlugin } from './plugins/agent.ts'
export { terminalsPlugin } from './plugins/terminals.ts'
export { apiPlugin, NexusApi } from './plugins/api.ts'
