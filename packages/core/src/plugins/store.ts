import { Store } from '../store.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

export interface StoreConfig {
  databasePath: string
}

/**
 * Store plugin: owns the SQLite handle and its migration lifecycle.
 *
 * Previously `new Store(...)` + `store.migrate()` + `store.seedDefaults()` were called by
 * hand from `Core.initialize()`. As a plugin the handle is opened on load and closed on
 * unload, so nothing else has to remember to do it.
 */
export const storePlugin: Plugin<StoreConfig> = definePlugin<StoreConfig>({
  name: 'nexus.store',
  description: 'SQLite persistence: settings, providers, sessions, tasks, changes',
  apply(ctx, config) {
    const store = new Store(config.databasePath)
    store.migrate()
    store.seedDefaults()
    ctx.provide(Services.store, store)
    return () => {
      try {
        store.close()
      } catch {
        // already closed
      }
    }
  },
})
