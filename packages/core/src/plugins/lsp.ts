import { LspService, type LspServerConfig } from '../lsp.ts'
import type { Store } from '../store.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/** LSP plugin: language-server lifecycle and diagnostics. */
export const lspPlugin: Plugin = definePlugin({
  name: 'nexus.lsp',
  description: 'Language Server Protocol client manager',
  inject: ['nexus.store', 'nexus.events'],
  apply(ctx) {
    const store = ctx.get<Store>(Services.store)
    const lsp = new LspService(ctx.get(Services.events))
    const servers = store.settingGet('lsp.servers', [])
    if (Array.isArray(servers) && servers.length > 0) {
      lsp.configure(servers as LspServerConfig[])
    }
    ctx.provide(Services.lsp, lsp)
    return () => {
      lsp.dispose()
    }
  },
})
