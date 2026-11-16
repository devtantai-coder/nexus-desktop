import type React from 'react'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Search, Trash2 } from 'lucide-react'
import { api, qk, useAppStore } from '../kernel'

interface CatalogEntry {
  id: string
  name: string
  blurb: string
  category: string
  command: string
  args: string[]
}

// Catalog gọn: các MCP server phổ biến, cài bằng một cú nhấp như Plugins của Codex.
const CATALOG: CatalogEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    blurb: 'Read and edit files in allowed folders',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Issues, pull requests and code search',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  },
  {
    id: 'memory',
    name: 'Memory',
    blurb: 'Persistent knowledge graph for the agent',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    blurb: 'Fetch and convert web pages to markdown',
    category: 'Research',
    command: 'uvx',
    args: ['mcp-server-fetch'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    blurb: 'Control a headless browser',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'postgres',
    name: 'Postgres',
    blurb: 'Query PostgreSQL databases',
    category: 'Data & Analytics',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
  },
  {
    id: 'slack',
    name: 'Slack',
    blurb: 'Read and manage Slack',
    category: 'Communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Search and edit Notion pages',
    category: 'Productivity',
    command: 'npx',
    args: ['-y', 'mcp-notion-server'],
  },
]

interface ServerConfig {
  id: string
  name?: string
  command: string
  args?: string[]
  enabled?: boolean
}

function readServers(all: Record<string, unknown>): ServerConfig[] {
  const raw = all['mcp.servers']
  return Array.isArray(raw) ? (raw as ServerConfig[]) : []
}

export function PluginsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useAppStore((state) => state.toast)
  const [search, setSearch] = useState('')

  const { data: installed = [] } = useQuery({
    queryKey: ['settings', 'mcp.servers'],
    queryFn: async () => readServers((await api.settings.all()) as Record<string, unknown>),
    staleTime: 5_000,
  })
  const { data: live = [] } = useQuery({
    queryKey: qk.mcpServers,
    queryFn: () => api.mcp.servers(),
    staleTime: 5_000,
  })

  const installedIds = useMemo(() => new Set(installed.map((server) => server.id)), [installed])
  const liveById = useMemo(() => new Map(live.map((server) => [server.id, server])), [live])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return CATALOG
    return CATALOG.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.blurb.toLowerCase().includes(needle) ||
        entry.category.toLowerCase().includes(needle),
    )
  }, [search])

  const grouped = useMemo(() => {
    const buckets = new Map<string, CatalogEntry[]>()
    for (const entry of filtered) {
      const list = buckets.get(entry.category)
      if (list) list.push(entry)
      else buckets.set(entry.category, [entry])
    }
    return [...buckets.entries()]
  }, [filtered])

  const install = async (entry: CatalogEntry): Promise<void> => {
    try {
      const next: ServerConfig[] = [
        ...installed.filter((server) => server.id !== entry.id),
        { id: entry.id, name: entry.name, command: entry.command, args: entry.args, enabled: true },
      ]
      await api.settings.set('mcp.servers', next)
      await api.mcp.restart()
      await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp.servers'] })
      await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
      toast({ level: 'success', title: `Đã cài ${entry.name}` })
    } catch (error) {
      toast({
        level: 'error',
        title: `Không cài được ${entry.name}`,
        body: (error as Error).message,
      })
    }
  }

  const remove = async (entry: CatalogEntry): Promise<void> => {
    const next = installed.filter((server) => server.id !== entry.id)
    await api.settings.set('mcp.servers', next)
    await api.mcp.restart()
    await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp.servers'] })
    await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
    toast({ level: 'success', title: `Đã gỡ ${entry.name}` })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-3 px-4">
        <h1 className="text-[14px] font-medium text-[var(--text)]">Plugins</h1>
        <div className="no-drag flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5">
          <Search size={14} className="shrink-0 text-[var(--text-faint)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search plugins"
            aria-label="Search plugins"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <p className="mb-3 text-[13px] text-[var(--text-faint)]">
          Connect plugins to let NEXUS work across your tools
        </p>
        {grouped.map(([category, entries]) => (
          <section key={category} className="mb-4">
            <h2 className="mb-1.5 text-[14px] font-medium text-[var(--text-faint)]">{category}</h2>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {entries.map((entry) => {
                const isInstalled = installedIds.has(entry.id)
                const status = liveById.get(entry.id)
                return (
                  <div
                    key={entry.id}
                    className="group flex items-center gap-3 rounded-[12.5px] border border-[var(--border)] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] text-[var(--text)]">
                          {entry.name}
                        </span>
                        {isInstalled ? (
                          <span className="shrink-0 text-[11.5px] text-[var(--text-faint)]">
                            {status?.status.running
                              ? `running · ${status.status.tools ?? 0} tools`
                              : 'installed'}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-[12.5px] text-[var(--text-faint)]">
                        {entry.blurb}
                      </div>
                    </div>
                    {isInstalled ? (
                      <button
                        type="button"
                        aria-label={`Remove ${entry.name}`}
                        onClick={() => void remove(entry)}
                        className="icon-btn-sm opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Install ${entry.name}`}
                        onClick={() => void install(entry)}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <Plus size={13} />
                        Add
                      </button>
                    )}
                    {isInstalled ? (
                      <Check size={15} className="shrink-0 text-[var(--success)]" />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
