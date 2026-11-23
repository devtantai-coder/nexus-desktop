import type { McpServer } from '@nexus/shared'
import { api } from './api'
import { queryClient, qk } from './query'
import { useAppStore } from '../store/app-store'

/** Cấu hình MCP lưu trong setting `mcp.servers`; native core tự spawn lại khi setting đổi. */
export interface McpServerConfig {
  id: string
  /** Server stdio: command + args. Server từ xa: url (streamable HTTP). */
  command?: string
  args?: string[]
  url?: string
  /** Với server từ xa: 'http' (streamable, mặc định) hoặc 'sse' (transport SSE cũ). */
  transport?: 'http' | 'sse'
  headers?: Record<string, string>
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
}

export interface ConnectorPreset {
  name: string
  description: string
  config: McpServerConfig
}

// Catalog connector theo mô hình MCP stdio: native core spawn
// process local, chưa hỗ trợ SSE/HTTP từ xa.
export const CONNECTORS: ConnectorPreset[] = [
  {
    name: 'Filesystem',
    description: 'Đọc/ghi tệp trong thư mục được cấp quyền',
    config: {
      id: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
    },
  },
  {
    name: 'Memory',
    description: 'Bộ nhớ dài hạn dạng knowledge graph',
    config: { id: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    name: 'GitHub',
    description: 'Issue, PR và tìm kiếm code trên GitHub',
    config: {
      id: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    name: 'Fetch',
    description: 'Tải trang web và chuyển sang Markdown',
    config: { id: 'fetch', command: 'uvx', args: ['mcp-server-fetch'] },
  },
  {
    name: 'Brave Search',
    description: 'Tìm kiếm web qua Brave Search API',
    config: {
      id: 'brave-search',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
    },
  },
  {
    name: 'Slack',
    description: 'Đọc kênh và gửi tin nhắn Slack',
    config: {
      id: 'slack',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    },
  },
  {
    name: 'DeepWiki (từ xa)',
    description: 'Wiki repo công khai qua MCP HTTP, không cần cài đặt',
    config: { id: 'deepwiki', url: 'https://mcp.deepwiki.com/mcp' },
  },
  {
    name: 'Puppeteer',
    description: 'Điều khiển trình duyệt headless',
    config: {
      id: 'puppeteer',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
]

export function readServers(settings: Record<string, unknown>): McpServerConfig[] {
  const raw = settings['mcp.servers']
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry): entry is McpServerConfig =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as McpServerConfig).id === 'string',
  )
}

export async function saveServers(next: McpServerConfig[]): Promise<void> {
  await api.settings.set('mcp.servers', next)
  const store = useAppStore.getState()
  useAppStore.setState({ settings: { ...store.settings, 'mcp.servers': next } })
  await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
  await queryClient.invalidateQueries({ queryKey: qk.mcpTools() })
  await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp.servers'] })
}

const currentConfig = async (): Promise<McpServerConfig[]> =>
  readServers((await api.settings.all()) as Record<string, unknown>)

/** Các thao tác đọc-sửa-ghi cấu hình phải nối hàng: hai read cùng lúc ghi đè nhau. */
let configQueue: Promise<unknown> = Promise.resolve()
function withConfigLock<T>(work: () => Promise<T>): Promise<T> {
  const result = configQueue.then(work, work)
  configQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function upsertServer(config: McpServerConfig): Promise<void> {
  return withConfigLock(async () => {
    const current = await currentConfig()
    // Thay cả entry chứ không merge: đổi transport (stdio <-> url) mà merge sẽ để lại
    // command/url cũ và core chọn nhầm transport.
    const next = current.some((entry) => entry.id === config.id)
      ? current.map((entry) =>
          entry.id === config.id ? { enabled: entry.enabled !== false, ...config } : entry,
        )
      : [...current, { enabled: true, ...config }]
    await saveServers(next)
  })
}

export function removeServer(id: string): Promise<void> {
  return withConfigLock(async () => {
    const current = await currentConfig()
    await saveServers(current.filter((entry) => entry.id !== id))
  })
}

export function setServerEnabled(id: string, enabled: boolean): Promise<void> {
  return withConfigLock(async () => {
    const current = await currentConfig()
    await saveServers(current.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)))
  })
}

/** Bắt đầu OAuth: core khám phá metadata + mở callback, trả URL để mở trình duyệt. */
export async function startAuth(serverId: string): Promise<void> {
  const { url } = await api.mcp.authStart(serverId)
  await api.app.openExternal(url)
  await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
}

export async function logoutAuth(serverId: string): Promise<void> {
  await api.mcp.authLogout(serverId)
  await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
  await queryClient.invalidateQueries({ queryKey: qk.mcpTools(serverId) })
}

export async function restartMcp(): Promise<void> {
  await api.mcp.restart()
  await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
  await queryClient.invalidateQueries({ queryKey: qk.mcpTools() })
  await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp.servers'] })
}

export function parseKeyValues(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    // \n và \\ được escape khi format — giải mã lại để round-trip không mất dữ liệu.
    if (key)
      result[key] = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/\\([\\n])/g, (_m, c: string) => (c === 'n' ? '\n' : '\\'))
  }
  return result
}

export function formatKeyValues(values?: Record<string, string>): string {
  if (!values) return ''
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`)
    .join('\n')
}

/** id đi vào tên tool `mcp__<id>__<tool>`, nên chỉ nhận ký tự an toàn. */
export function isValidServerId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
}

export function splitArgs(value: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let started = false
  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        out.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) out.push(current)
  return out
}

export function serverTarget(server: { command?: string; args?: string[]; url?: string }): string {
  if (server.url) return server.url
  return [server.command ?? '', ...(server.args ?? [])].filter(Boolean).join(' ')
}

export function serverLabel(server: McpServer): string {
  return server.status?.running
    ? `đang chạy · ${server.status.tools ?? 0} tool`
    : server.enabled === false
      ? 'đã tắt'
      : 'chưa chạy'
}
