import { McpManager } from '../mcp.ts'
import type { SecretStore } from '../secrets.ts'
import type { Store } from '../store.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/** MCP plugin: Model Context Protocol servers, tool discovery and OAuth flows. */
export const mcpPlugin: Plugin = definePlugin({
  name: 'nexus.mcp',
  description: 'Model Context Protocol server manager',
  inject: ['nexus.store', 'nexus.secrets', 'nexus.events'],
  apply(ctx) {
    const store = ctx.get<Store>(Services.store)
    const secrets = ctx.get<SecretStore>(Services.secrets)
    const mcp = new McpManager(store, secrets, ctx.get(Services.events))
    ctx.provide(Services.mcp, mcp)
    return () => {
      void mcp.close()
    }
  },
})
