import { WorkspaceManager } from '../workspace.ts'
import { WorkspaceWatcher } from '../watcher.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/**
 * Workspaces plugin: open workspace handles and the file-system watcher.
 *
 * `WorkspaceManager` and `WorkspaceWatcher` are two halves of the same concern (open
 * roots + change notifications), so they live in one plugin and share one teardown.
 */
export const workspacesPlugin: Plugin = definePlugin({
  name: 'nexus.workspaces',
  description: 'Workspace handles and file-system watching',
  inject: ['nexus.events'],
  apply(ctx) {
    const workspaces = new WorkspaceManager()
    const watcher = new WorkspaceWatcher(ctx.get(Services.events))
    ctx.provide(Services.workspaces, workspaces)
    ctx.provide(Services.watcher, watcher)
    return () => {
      watcher.unwatchAll()
    }
  },
})
