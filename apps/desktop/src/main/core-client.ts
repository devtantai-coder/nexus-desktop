import { Core, type Json } from '@nexus/core'
import { NexusError, type NexusEvent } from '@nexus/shared'
import { logger } from './logger'

export interface CoreClientOptions {
  databasePath: string
  userDataPath: string
  version: string
  isDev: boolean
}

/** In-process wrapper around the TypeScript core (no sidecar, no JSON-RPC pipe). */
export class CoreClient {
  private core: Core | null = null
  private listeners = new Set<(event: NexusEvent) => void>()

  constructor(private readonly options: CoreClientOptions) {}

  async start(): Promise<void> {
    if (this.core !== null) return
    if (this.options.isDev) process.env['NEXUS_DEV'] = '1'
    const core = new Core({
      databasePath: this.options.databasePath,
      userDataDir: this.options.userDataPath,
      appVersion: this.options.version,
    })
    core.events.setSink((event: Json) => {
      for (const listener of this.listeners) {
        try {
          listener(event as NexusEvent)
        } catch (error) {
          logger.warn('event listener failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })
    try {
      core.initialize()
    } catch (error) {
      void core.shutdown()
      throw error instanceof NexusError
        ? error
        : new NexusError('E_DB', error instanceof Error ? error.message : String(error))
    }
    this.core = core
    logger.info('in-process core ready', { databasePath: this.options.databasePath })
  }

  async request<T = unknown>(method: string, params: Json = {}): Promise<T> {
    if (this.core === null) throw new NexusError('E_CONFIG', 'Core is not running')
    return (await this.core.request(method, params)) as T
  }

  onEvent(listener: (event: NexusEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.core?.shutdown()
    this.core = null
  }
}
