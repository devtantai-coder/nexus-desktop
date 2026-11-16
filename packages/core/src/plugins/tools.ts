import { ProcessManager, ToolRegistry } from '../tools.ts'
import { registerLspTools } from '../lsp_tools.ts'
import { registerRetrievalTools } from '../retrieval_tools.ts'
import type { LspService } from '../lsp.ts'
import type { RetrievalService } from '../retrieval.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/**
 * Tools plugin: the tool registry and the child-process pool.
 *
 * Tool registration used to be sprinkled into `Core`'s constructor with try/catch around
 * each `register*Tools` call. As a plugin, each registrar declares its own dependency and
 * failures are isolated per registrar instead of being swallowed generically.
 */
export const toolsPlugin: Plugin = definePlugin({
  name: 'nexus.tools',
  description: 'Agent tool registry and process manager',
  inject: ['nexus.lsp', 'nexus.retrieval', 'nexus.events'],
  apply(ctx) {
    const tools = ToolRegistry.standard()
    const processes = new ProcessManager()
    ctx.provide(Services.tools, tools)
    ctx.provide(Services.processes, processes)

    const register = (label: string, fn: () => void): void => {
      try {
        fn()
      } catch (error) {
        globalThis.process?.stderr?.write(
          `nexus-core: ${label} registration failed: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        )
      }
    }

    register('LSP tools', () => registerLspTools(tools, ctx.get<LspService>(Services.lsp)))
    register('retrieval tools', () =>
      registerRetrievalTools(tools, ctx.get<RetrievalService>(Services.retrieval)),
    )

    return () => {
      processes.disposeAll()
    }
  },
})
