import { AgentRuntime } from '../agent.ts'
import type { McpManager } from '../mcp.ts'
import type { ProcessManager, ToolRegistry } from '../tools.ts'
import type { Providers } from '../providers.ts'
import type { Store } from '../store.ts'
import type { WorkspaceManager } from '../workspace.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

export interface AgentConfig {
  userDataDir: string
}

/** Agent plugin: the task runtime (native loop, Claude SDK and LangGraph engines). */
export const agentPlugin: Plugin<AgentConfig> = definePlugin<AgentConfig>({
  name: 'nexus.agent',
  description: 'Agent runtime: planning, tool loop, approvals, engines',
  inject: [
    'nexus.store',
    'nexus.providers',
    'nexus.workspaces',
    'nexus.tools',
    'nexus.mcp',
  ],
  apply(ctx, config) {
    const agent = new AgentRuntime(
      ctx.get<Store>(Services.store),
      ctx.get(Services.events),
      ctx.get<Providers>(Services.providers),
      ctx.get<WorkspaceManager>(Services.workspaces),
      ctx.get<ToolRegistry>(Services.tools),
      ctx.get<ProcessManager>(Services.processes),
      ctx.get<McpManager>(Services.mcp),
      config.userDataDir,
    )
    ctx.provide(Services.agent, agent)
    return () => {
      agent.close()
    }
  },
})
