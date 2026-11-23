import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
})

export const qk = {
  projects: ['projects'] as const,
  sessions: (filter?: Record<string, unknown>) => ['sessions', filter ?? {}] as const,
  session: (id: string) => ['session', id] as const,
  messages: (sessionId: string) => ['messages', sessionId] as const,
  tasks: (filter?: Record<string, unknown>) => ['tasks', filter ?? {}] as const,
  task: (id: string) => ['task', id] as const,
  gitStatus: (projectId: string) => ['git-status', projectId] as const,
  gitLog: (projectId: string) => ['git-log', projectId] as const,
  changes: (filter?: Record<string, unknown>) => ['changes', filter ?? {}] as const,
  providers: ['providers'] as const,
  models: ['models'] as const,
  usageSummary: (days: number) => ['usage-summary', days] as const,
  usageList: ['usage-list'] as const,
  dbStats: ['db-stats'] as const,
  tree: (projectId: string, path?: string) => ['tree', projectId, path ?? ''] as const,
  file: (projectId: string, path: string) => ['file', projectId, path] as const,
  toolList: ['tool-list'] as const,
  mcpServers: ['mcp-servers'] as const,
  mcpTools: (serverId?: string) => ['mcp-tools', serverId ?? 'all'] as const,
}
