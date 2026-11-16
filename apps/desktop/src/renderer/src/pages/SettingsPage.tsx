import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Cpu,
  ExternalLink,
  Info,
  Languages,
  Monitor,
  Moon,
  Palette,
  Plug,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import type { Language, PermissionMode } from '@nexus/shared'
import { api, qk, useAppStore, useT } from '../kernel'
import { Badge, Button, Dialog, Field, Input, Select, Switch, cn } from '../components/ui'
import { ProvidersPanel } from '../components/settings/ProvidersPanel'
import { McpPanel } from '../components/settings/McpPanel'

const SECTION_KEYS = [
  'general',
  'appearance',
  'language',
  'models',
  'mcp',
  'agent',
  'permissions',
  'about',
] as const

type SectionKey = (typeof SECTION_KEYS)[number]

interface SectionMeta {
  labelKey: string
  description: string
  icon: LucideIcon
}

const SECTION_META: Record<SectionKey, SectionMeta> = {
  general: {
    labelKey: 'settings.general',
    description: '',
    icon: SlidersHorizontal,
  },
  appearance: {
    labelKey: 'settings.appearance',
    description: 'Giao diện sáng/tối, cỡ chữ và mật độ hiển thị.',
    icon: Palette,
  },
  language: {
    labelKey: 'settings.language',
    description: 'Ngôn ngữ hiển thị của ứng dụng.',
    icon: Languages,
  },
  models: {
    labelKey: 'settings.models',
    description: 'Model mặc định và nhà cung cấp AI đã cấu hình.',
    icon: Cpu,
  },
  mcp: {
    labelKey: 'settings.mcp',
    description: 'Server Model Context Protocol (stdio) và connector có sẵn.',
    icon: Plug,
  },
  agent: {
    labelKey: 'settings.agent',
    description: 'Quyền, giới hạn vòng lặp, công cụ và hooks.',
    icon: Bot,
  },
  permissions: {
    labelKey: 'settings.permissions',
    description: '',
    icon: ShieldCheck,
  },
  about: {
    labelKey: 'settings.about',
    description: 'Phiên bản và thông tin hệ thống.',
    icon: Info,
  },
}

const SECTION_GROUPS: Array<{ label: string; keys: SectionKey[] }> = [
  { label: '', keys: ['general', 'permissions'] },
  { label: 'NEXUS', keys: ['appearance', 'language', 'models', 'mcp', 'agent', 'about'] },
]

const PERMISSION_MODES: Array<{ mode: PermissionMode; description: string }> = [
  { mode: 'read-only', description: 'Chỉ đọc tệp và trạng thái git. Không ghi, không chạy lệnh.' },
  { mode: 'workspace-write', description: 'Đọc/ghi trong workspace. Lệnh terminal cần phê duyệt.' },
  { mode: 'terminal-approval', description: 'Mọi lệnh và thao tác phá huỷ đều cần phê duyệt.' },
  {
    mode: 'elevated',
    description: 'Thao tác ngoài workspace và phá huỷ vẫn phải phê duyệt thủ công.',
  },
  {
    mode: 'unrestricted',
    description: 'Toàn quyền: không hỏi phê duyệt cho tool, lệnh hoặc thao tác phá huỷ.',
  },
]

const THEME_OPTIONS: Array<{
  value: 'light' | 'dark' | 'system'
  labelKey: string
  icon: LucideIcon
}> = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
]

function SettingsGroup({
  title,
  description,
  actions,
  children,
}: {
  title?: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-5 last:mb-0">
      {title || description || actions ? (
        <div className="flex items-end justify-between gap-4 px-4 pb-1 pt-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[13px] font-medium leading-5 text-[var(--text)]">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 max-w-[560px] text-[12.5px] leading-5 text-[var(--text-faint)]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="border-y border-[var(--border-subtle)]">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-[430] leading-5 text-[var(--text)]">{title}</div>
        {description ? (
          <p className="mt-0.5 max-w-[520px] text-[12.5px] leading-[18px] text-[var(--text-faint)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-2.5">
      <span className="shrink-0 text-[12.5px] text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11.5px] text-[var(--text)]">
        {value ?? '—'}
      </span>
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-4 py-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
      {children}
    </div>
  )
}

function formatJson(value: unknown, mode: 'array' | 'object'): string {
  return JSON.stringify(value ?? (mode === 'array' ? [] : {}), null, 2)
}

function JsonSetting({
  settingKey,
  mode,
  rows,
  hint,
  example,
}: {
  settingKey: string
  mode: 'array' | 'object'
  rows: number
  hint: string
  example: string
}): React.JSX.Element {
  const raw = useAppStore((state) => state.settings[settingKey])
  const setSetting = useAppStore((state) => state.setSetting)
  const toast = useAppStore((state) => state.toast)
  const [text, setText] = useState(() => formatJson(raw, mode))
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!touched) setText(formatJson(raw, mode))
  }, [raw, touched, mode])

  const save = (): void => {
    try {
      const parsed = JSON.parse(text) as unknown
      if (mode === 'array' && !Array.isArray(parsed)) {
        throw new Error('Cấu hình phải là JSON array')
      }
      if (mode === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new Error('Cấu hình phải là JSON object')
      }
      setSetting(settingKey, parsed)
      setTouched(false)
      toast({ level: 'success', title: 'Đã lưu cấu hình' })
    } catch (error) {
      toast({
        level: 'error',
        title: 'Cấu hình không hợp lệ',
        body: (error as Error).message,
      })
    }
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[520px] text-[12px] leading-relaxed text-[var(--text-muted)]">{hint}</p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setText(formatJson(raw, mode))
              setTouched(false)
            }}
          >
            Khôi phục
          </Button>
          <Button size="xs" variant="secondary" disabled={!touched} onClick={save}>
            Lưu
          </Button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setTouched(true)
        }}
        rows={rows}
        spellCheck={false}
        className="mt-3 w-full resize-y rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[11.5px] leading-relaxed outline-none transition-colors focus:border-[var(--border-strong)]"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">{example}</p>
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const t = useT()
  const route = useAppStore((state) => state.route)
  const [section, setSection] = useState<SectionKey>(() => {
    const requested = route.name === 'settings' ? route.section : undefined
    return requested && (SECTION_KEYS as readonly string[]).includes(requested)
      ? (requested as SectionKey)
      : 'general'
  })
  const [query, setQuery] = useState('')
  const [licensesOpen, setLicensesOpen] = useState(false)

  useEffect(() => {
    if (route.name !== 'settings' || !route.section) return
    if ((SECTION_KEYS as readonly string[]).includes(route.section)) {
      setSection(route.section as SectionKey)
    }
  }, [route])

  const settings = useAppStore((state) => state.settings)
  const setSetting = useAppStore((state) => state.setSetting)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const fontSize = useAppStore((state) => state.fontSize)
  const setFontSize = useAppStore((state) => state.setFontSize)
  const density = useAppStore((state) => state.density)
  const setDensity = useAppStore((state) => state.setDensity)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)
  const info = useAppStore((state) => state.info)
  const navigate = useAppStore((state) => state.navigate)

  const toolsQuery = useQuery({
    queryKey: qk.toolList,
    queryFn: () => api.agent.tools(),
    enabled: section === 'agent',
  })
  const projectsQuery = useQuery({
    queryKey: qk.projects,
    queryFn: () => api.projects.list(),
    enabled: section === 'permissions',
  })

  const tools = toolsQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const meta = SECTION_META[section]
  const SectionIcon = meta.icon

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return SECTION_GROUPS.map((group) => ({
      ...group,
      keys: group.keys.filter((key) => {
        if (!needle) return true
        const entry = SECTION_META[key]
        return (
          t(entry.labelKey as Parameters<typeof t>[0])
            .toLowerCase()
            .includes(needle) ||
          entry.description.toLowerCase().includes(needle) ||
          key.includes(needle)
        )
      }),
    })).filter((group) => group.keys.length > 0)
  }, [query, t])

  const allowedToolEntries = useMemo(
    () =>
      Object.entries(settings)
        .filter(([key]) => key.startsWith('agent.allowedTools.'))
        .map(([key, value]) => ({
          key,
          projectId: key.slice('agent.allowedTools.'.length),
          tools: Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string')
            : [],
        }))
        .filter((entry) => entry.tools.length > 0),
    [settings],
  )

  const projectName = (projectId: string): string =>
    projects.find((project) => project.id === projectId)?.name ?? projectId.slice(0, 8)

  return (
    <div className="flex h-full min-w-0 bg-[var(--bg)]">
      <aside className="flex w-[238px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div className="px-3 pb-3 pt-4">
          <button
            type="button"
            onClick={() => navigate({ name: 'home' })}
            className="mb-4 flex items-center gap-1.5 rounded-[var(--radius)] px-1.5 py-1 text-left text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <ArrowLeft size={15} />
            <span className="text-[13px] font-medium">Quay lại</span>
          </button>
          <h1 className="px-1.5 text-[21px] font-semibold tracking-[-0.02em] text-[var(--text)]">
            {t('nav.settings')}
          </h1>
          <div className="relative mt-3">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm cài đặt"
              className="h-8 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] pl-7 pr-2.5 text-[12px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
            />
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {visibleGroups.length === 0 ? (
            <p className="px-2 py-6 text-[12px] text-[var(--text-faint)]">
              Không tìm thấy mục cài đặt.
            </p>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)]">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.keys.map((key) => {
                    const entry = SECTION_META[key]
                    const Icon = entry.icon
                    const active = key === section
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setSection(key)}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 rounded-[var(--radius)] px-2.5 text-left text-[13px] transition-colors',
                          active
                            ? 'bg-[var(--bg-active)] font-medium text-[var(--text)]'
                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
                        )}
                      >
                        <Icon
                          size={14}
                          className={active ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}
                        />
                        <span className="truncate">
                          {key === 'general'
                            ? 'General'
                            : key === 'permissions'
                              ? 'Permissions'
                              : t(entry.labelKey as Parameters<typeof t>[0])}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </nav>
        <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--text-faint)]">
          NEXUS Desktop {info?.version ? `v${info.version}` : ''}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[726px] px-0 pb-16 pt-2">
          <header
            className={cn('mb-7 flex items-start gap-3 px-0.5', !meta.description && 'sr-only')}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              <SectionIcon size={15} />
            </span>
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-[var(--text)]">
                {section === 'general'
                  ? 'General'
                  : section === 'permissions'
                    ? 'Permissions'
                    : t(meta.labelKey as Parameters<typeof t>[0])}
              </h2>
              <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                {meta.description}
              </p>
            </div>
          </header>

          {section === 'general' ? (
            <>
              <SettingsGroup title="Hành vi mặc định">
                <SettingRow
                  title="Agent mode"
                  description="Chế độ mặc định cho phiên mới và composer."
                >
                  <Select
                    value={(settings['agent.defaultMode'] as string) ?? 'agent'}
                    options={['ask', 'plan', 'code', 'agent', 'review', 'debug'].map((mode) => ({
                      value: mode,
                      label: t(`mode.${mode}` as Parameters<typeof t>[0]),
                    }))}
                    onValueChange={(value) => setSetting('agent.defaultMode', value)}
                    className="w-[170px]"
                  />
                </SettingRow>
                <SettingRow title="Quyền mặc định" description="Mức quyền khi bắt đầu phiên mới.">
                  <Select
                    value={(settings['agent.permissionMode'] as string) ?? 'workspace-write'}
                    options={PERMISSION_MODES.map(({ mode }) => ({
                      value: mode,
                      label: t(`perm.${mode}` as Parameters<typeof t>[0]),
                    }))}
                    onValueChange={(value) => setSetting('agent.permissionMode', value)}
                    className="w-[170px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Agent engine"
                  description="Bộ máy chạy agent. Tự động ưu tiên Claude Agent SDK khi có provider Anthropic; LangGraph dùng state graph, có human-in-the-loop."
                >
                  <Select
                    value={(settings['agent.engine'] as string) ?? 'auto'}
                    options={[
                      { value: 'auto', label: 'Tự động (ưu tiên Claude)' },
                      { value: 'native', label: 'Nexus native' },
                      { value: 'claude-agent-sdk', label: 'Claude Agent SDK' },
                      { value: 'langgraph', label: 'LangGraph' },
                    ]}
                    onValueChange={(value) => setSetting('agent.engine', value)}
                    className="w-[190px]"
                  />
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup title="Composer" description="Hành vi hộp soạn tin như Codex desktop.">
                <SettingRow
                  title="Enter để gửi"
                  description="Tắt: Enter xuống dòng, Ctrl+Enter mới gửi."
                >
                  <Switch
                    checked={Boolean(settings['composer.enterSends'] ?? true)}
                    onCheckedChange={(value) => setSetting('composer.enterSends', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Hiện mức dùng ngữ cảnh"
                  description="Hiển thị số token đã dùng dưới composer."
                >
                  <Switch
                    checked={Boolean(settings['composer.showUsage'] ?? true)}
                    onCheckedChange={(value) => setSetting('composer.showUsage', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Gửi khi tác vụ đang chạy"
                  description="Queue: xếp hàng chờ xong. Interrupt: huỷ và chạy prompt mới."
                >
                  <Select
                    value={(settings['composer.busySend'] as string) ?? 'queue'}
                    options={[
                      { value: 'queue', label: 'Queue' },
                      { value: 'interrupt', label: 'Interrupt' },
                    ]}
                    onValueChange={(value) => setSetting('composer.busySend', value)}
                    className="w-[150px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Thông báo cần duyệt"
                  description="Bật thông báo hệ thống khi agent xin quyền."
                >
                  <Switch
                    checked={Boolean(settings['app.notifyOnApproval'] ?? true)}
                    onCheckedChange={(value) => setSetting('app.notifyOnApproval', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Thông báo khi tác vụ xong"
                  description="Bật thông báo hệ thống khi cửa sổ không được focus."
                >
                  <Switch
                    checked={Boolean(settings['app.notifyOnFinish'] ?? true)}
                    onCheckedChange={(value) => setSetting('app.notifyOnFinish', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Xác nhận trước khi đóng cửa sổ"
                  description="Hỏi lại khi tác vụ đang chạy."
                >
                  <Switch
                    checked={Boolean(settings['app.confirmClose'] ?? true)}
                    onCheckedChange={(value) => setSetting('app.confirmClose', value)}
                  />
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup title="General" description="Vị trí lưu, ngôn ngữ và hành vi cửa sổ.">
                <SettingRow
                  title="Projectless chat folder"
                  description="Nơi lưu dữ liệu của các chat không thuộc dự án."
                >
                  <div className="flex items-center gap-2">
                    <span className="max-w-[190px] truncate text-[12px] text-[var(--text-faint)]">
                      {(settings['general.projectlessFolder'] as string) ?? '~/.nexus/chats'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const picked = await api.projects.pick()
                        if (picked) await setSetting('general.projectlessFolder', picked.path)
                      }}
                    >
                      Change
                    </Button>
                  </div>
                </SettingRow>
                <SettingRow
                  title="Default file open destination"
                  description="Nơi mở tệp và thư mục mặc định."
                >
                  <Select
                    value={(settings['general.openDestination'] as string) ?? 'editor'}
                    options={[
                      { value: 'editor', label: 'VS Code' },
                      { value: 'fileManager', label: 'File manager' },
                      { value: 'internal', label: 'Trong NEXUS' },
                    ]}
                    onValueChange={(value) => setSetting('general.openDestination', value)}
                    className="w-[170px]"
                  />
                </SettingRow>
                <SettingRow title="Language" description="Ngôn ngữ giao diện ứng dụng.">
                  <Select
                    value={(settings['app.language'] as string) ?? 'auto'}
                    options={[
                      { value: 'auto', label: 'Auto detect' },
                      { value: 'vi', label: 'Tiếng Việt' },
                      { value: 'en', label: 'English' },
                    ]}
                    onValueChange={(value) => setSetting('app.language', value)}
                    className="w-[170px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Confirm before closing a window"
                  description="Cảnh báo khi phím tắt đóng tab sẽ đóng cả cửa sổ."
                >
                  <Select
                    value={(settings['app.confirmClose'] as string) ?? 'shortcut'}
                    options={[
                      { value: 'shortcut', label: 'Close shortcut only' },
                      { value: 'always', label: 'Always' },
                      { value: 'never', label: 'Never' },
                    ]}
                    onValueChange={(value) => setSetting('app.confirmClose', value)}
                    className="w-[190px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Full view by default"
                  description="Tab nội dung mở toàn màn hình trong chat mới."
                >
                  <Switch
                    checked={Boolean(settings['app.fullViewDefault'] ?? false)}
                    onCheckedChange={(value) => setSetting('app.fullViewDefault', value)}
                  />
                </SettingRow>
                <SettingRow title="Bottom panel" description="Hiện nút bottom panel trên header.">
                  <Switch
                    checked={settings['app.bottomPanel'] !== false}
                    onCheckedChange={(value) => setSetting('app.bottomPanel', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Prevent sleep while running"
                  description="Giữ máy không ngủ khi agent đang chạy task."
                >
                  <Switch
                    checked={Boolean(settings['app.preventSleep'] ?? false)}
                    onCheckedChange={(value) => {
                      void setSetting('app.preventSleep', value)
                      void api.setPreventSleep(value)
                    }}
                  />
                </SettingRow>
                <SettingRow
                  title="Automatically archive inactive chats"
                  description="Lưu trữ chat không hoạt động sau một thời gian."
                >
                  <Select
                    value={(settings['app.autoArchive'] as string) ?? 'never'}
                    options={[
                      { value: 'never', label: 'Never' },
                      { value: '7d', label: '7 days' },
                      { value: '30d', label: '30 days' },
                    ]}
                    onValueChange={(value) => setSetting('app.autoArchive', value)}
                    className="w-[140px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Compress local chat history"
                  description="Nén lịch sử chat cũ để tiết kiệm dung lượng."
                >
                  <Switch
                    checked={Boolean(settings['app.compressHistory'] ?? true)}
                    onCheckedChange={(value) => setSetting('app.compressHistory', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Available reasoning efforts"
                  description="Chọn mức effort hiện trong bộ chọn model."
                >
                  <Select
                    value={(settings['models.efforts'] as string) ?? 'five'}
                    options={[
                      { value: 'five', label: '5 selected' },
                      { value: 'all', label: 'All levels' },
                      { value: 'core', label: '4 selected' },
                    ]}
                    onValueChange={(value) => setSetting('models.efforts', value)}
                    className="w-[150px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Open source licenses"
                  description="Thông báo bản quyền của thư viện đi kèm."
                >
                  <Button variant="ghost" size="sm" onClick={() => setLicensesOpen(true)}>
                    View
                  </Button>
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Plugins" description="Cho phép agent dùng plugin đã cài.">
                <SettingRow title="Allow plugins" description="Tắt để agent không gọi MCP tool.">
                  <Switch
                    checked={settings['plugins.enabled'] !== false}
                    onCheckedChange={(value) => {
                      void setSetting('plugins.enabled', value)
                      void api.mcp.restart()
                    }}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Composer">
                <SettingRow
                  title="Plain text composer"
                  description="Giữ code, Markdown và link là văn bản thường khi soạn."
                >
                  <Switch
                    checked={Boolean(settings['composer.plainText'] ?? false)}
                    onCheckedChange={(value) => setSetting('composer.plainText', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Show context window usage"
                  description="Hiện số token đã dùng dưới composer."
                >
                  <Switch
                    checked={settings['composer.showUsage'] !== false}
                    onCheckedChange={(value) => setSetting('composer.showUsage', value)}
                  />
                </SettingRow>
                <SettingRow title="Send shortcut" description="Khi nào Enter gửi prompt.">
                  <Select
                    value={settings['composer.enterSends'] === false ? 'ctrl' : 'enter'}
                    options={[
                      { value: 'enter', label: 'Enter' },
                      { value: 'ctrl', label: 'Ctrl+Enter' },
                    ]}
                    onValueChange={(value) => setSetting('composer.enterSends', value === 'enter')}
                    className="w-[150px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Follow-up behavior"
                  description="Queue: xếp hàng khi agent chạy. Steer: huỷ và chạy prompt mới."
                >
                  <Select
                    value={(settings['composer.busySend'] as string) ?? 'queue'}
                    options={[
                      { value: 'queue', label: 'Queue' },
                      { value: 'interrupt', label: 'Steer' },
                    ]}
                    onValueChange={(value) => setSetting('composer.busySend', value)}
                    className="w-[150px]"
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Popout Window">
                <SettingRow
                  title="Popout Window hotkey"
                  description="Phím tắt mở chat trong cửa sổ riêng."
                >
                  <Select
                    value={(settings['app.popoutHotkey'] as string) ?? 'off'}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'ctrl-shift-p', label: 'Ctrl+Shift+P' },
                      { value: 'alt-shift-p', label: 'Alt+Shift+P' },
                    ]}
                    onValueChange={(value) => setSetting('app.popoutHotkey', value)}
                    className="w-[170px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Default to standalone chat"
                  description="Chat mới bắt đầu ngoài dự án."
                >
                  <Switch
                    checked={Boolean(settings['app.standaloneChat'] ?? false)}
                    onCheckedChange={(value) => setSetting('app.standaloneChat', value)}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Notifications">
                <SettingRow
                  title="Turn completion notifications"
                  description="Khi nào báo hiệu tác vụ xong."
                >
                  <Select
                    value={(settings['app.notifyOnFinishMode'] as string) ?? 'unfocused'}
                    options={[
                      { value: 'unfocused', label: 'Only when unfocused' },
                      { value: 'always', label: 'Always' },
                      { value: 'never', label: 'Never' },
                    ]}
                    onValueChange={(value) => setSetting('app.notifyOnFinishMode', value)}
                    className="w-[190px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Enable permission notifications"
                  description="Báo khi thread cần bạn duyệt."
                >
                  <Switch
                    checked={settings['app.notifyOnApproval'] !== false}
                    onCheckedChange={(value) => setSetting('app.notifyOnApproval', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Enable question notifications"
                  description="Báo khi thread hỏi lại."
                >
                  <Switch
                    checked={settings['app.notifyOnQuestion'] !== false}
                    onCheckedChange={(value) => setSetting('app.notifyOnQuestion', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Notification sound"
                  description="Âm thanh cho hoàn tất và xin quyền."
                >
                  <Select
                    value={(settings['app.notifySound'] as string) ?? 'default'}
                    options={[
                      { value: 'default', label: 'Default' },
                      { value: 'none', label: 'None' },
                    ]}
                    onValueChange={(value) => setSetting('app.notifySound', value)}
                    className="w-[140px]"
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Toys">
                <SettingRow
                  title="Confetti cannon"
                  description="Bắn pháo giấy khi bạn gõ /confetti."
                >
                  <Switch
                    checked={settings['ui.confetti'] !== false}
                    onCheckedChange={(value) => setSetting('ui.confetti', value)}
                  />
                </SettingRow>
              </SettingsGroup>
            </>
          ) : null}

          {section === 'appearance' ? (
            <>
              <SettingsGroup title="Giao diện" description="Sáng, tối hoặc theo hệ thống.">
                <div className="grid grid-cols-3 gap-2 px-4 py-3.5">
                  {THEME_OPTIONS.map((option) => {
                    const Icon = option.icon
                    const active = theme === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setTheme(option.value)}
                        className={cn(
                          'flex h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border text-[12.5px] transition-colors',
                          active
                            ? 'border-[var(--border-strong)] bg-[var(--bg-active)] font-medium text-[var(--text)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
                        )}
                      >
                        <Icon size={14} />
                        {t(option.labelKey as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
              </SettingsGroup>
              <SettingsGroup title="Hiển thị">
                <div className="grid grid-cols-2 gap-4 px-4 py-3.5">
                  <Field label={`Cỡ chữ · ${fontSize}px`}>
                    <input
                      type="range"
                      min={12}
                      max={18}
                      value={fontSize}
                      onChange={(event) => setFontSize(Number(event.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </Field>
                  <Field label="Mật độ">
                    <Select
                      value={density}
                      options={[
                        { value: 'comfortable', label: 'Thoải mái' },
                        { value: 'compact', label: 'Gọn' },
                      ]}
                      onValueChange={(value) => setDensity(value as 'compact' | 'comfortable')}
                      className="w-full"
                    />
                  </Field>
                </div>
                <SettingRow title="Minimap" description="Bản đồ thu nhỏ của tệp trong editor.">
                  <Switch
                    checked={Boolean(settings['editor.minimap'] ?? true)}
                    onCheckedChange={(value) => setSetting('editor.minimap', value)}
                  />
                </SettingRow>
                <SettingRow
                  title="Word wrap"
                  description="Tự động xuống dòng khi dòng code quá dài."
                >
                  <Switch
                    checked={Boolean(settings['editor.wordWrap'] ?? false)}
                    onCheckedChange={(value) => setSetting('editor.wordWrap', value)}
                  />
                </SettingRow>
              </SettingsGroup>
            </>
          ) : null}

          {section === 'language' ? (
            <SettingsGroup title="Ngôn ngữ giao diện" description="Mặc định là tiếng Việt.">
              <SettingRow title="Ngôn ngữ" description="Áp dụng ngay cho toàn bộ giao diện.">
                <Select
                  value={language}
                  options={[
                    { value: 'vi', label: 'Tiếng Việt' },
                    { value: 'en', label: 'English' },
                  ]}
                  onValueChange={(value) => setLanguage(value as Language)}
                  className="w-[170px]"
                />
              </SettingRow>
            </SettingsGroup>
          ) : null}

          {section === 'mcp' ? <McpPanel /> : null}

          {section === 'models' ? (
            <>
              <ProvidersPanel />
              {info && !info.encryptionAvailable ? (
                <p className="rounded-[var(--radius-lg)] border border-[var(--warning)]/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--warning)]">
                  Keychain hệ thống không khả dụng — khoá được mã hoá AES-256-GCM bằng khoá cục bộ
                  quyền 0600.
                </p>
              ) : null}
            </>
          ) : null}

          {section === 'agent' ? (
            <>
              <SettingsGroup title="Quyền">
                <SettingRow
                  title="Toàn quyền — không phê duyệt"
                  description="Tool, terminal, network và thao tác phá huỷ chạy ngay, không hiện hộp thoại xác nhận."
                >
                  <Switch
                    checked={Boolean(settings['agent.fullAccess'] ?? true)}
                    onCheckedChange={(value) => setSetting('agent.fullAccess', value)}
                  />
                </SettingRow>
                {(settings['agent.fullAccess'] ?? true) ? (
                  <div className="px-4 py-3 text-[11.5px] leading-relaxed text-[var(--warning)]">
                    Đang tắt mọi approval gate. Chỉ bật khi bạn tin tưởng workspace và model đang
                    dùng.
                  </div>
                ) : null}
              </SettingsGroup>
              <SettingsGroup
                title="Giới hạn"
                description="0 = không giới hạn; có thể huỷ bất kỳ lúc nào."
              >
                <div className="grid grid-cols-2 gap-4 px-4 py-3.5">
                  <Field label="Số vòng tối đa" hint="0 = không giới hạn.">
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={Number(settings['agent.maxIterations'] ?? 0)}
                      onChange={(event) =>
                        setSetting(
                          'agent.maxIterations',
                          Math.max(0, Math.min(500, Number(event.target.value))),
                        )
                      }
                    />
                  </Field>
                </div>
              </SettingsGroup>
              <SettingsGroup
                title="Công cụ"
                description="Công cụ bị chặn theo mode sẽ không được expose."
              >
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5">
                    <span className="text-[13.5px] font-medium text-[var(--text)]">
                      Công cụ khả dụng
                    </span>
                    <span className="flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
                      {tools.length}
                      <ChevronDown
                        size={14}
                        className="transition-transform group-open:rotate-180"
                      />
                    </span>
                  </summary>
                  <div className="border-t border-[var(--border)]">
                    {tools.length ? (
                      tools.map((tool) => (
                        <div key={tool.name} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="min-w-[140px] truncate font-mono text-[11.5px] text-[var(--text)]">
                            {tool.name}
                          </span>
                          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                            {tool.description}
                          </span>
                          <Badge
                            tone={
                              tool.risk === 'destructive'
                                ? 'danger'
                                : tool.risk === 'exec' || tool.risk === 'network'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {tool.risk}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <EmptyRow>Chưa tải được danh sách công cụ.</EmptyRow>
                    )}
                  </div>
                </details>
              </SettingsGroup>
              <SettingsGroup
                title="Hooks"
                description="Chạy lệnh shell trước/sau tool và khi task kết thúc."
              >
                <JsonSetting
                  settingKey="agent.hooks"
                  mode="object"
                  rows={9}
                  hint="JSON object với preToolUse / postToolUse / stop. Mỗi entry gồm matcher (regex) và command; exit ≠ 0 ở preToolUse sẽ chặn tool."
                  example='Ví dụ: {"preToolUse":[{"matcher":"write_file|edit_file","command":"npm run lint"}],"stop":[{"command":"echo done"}]}'
                />
              </SettingsGroup>
            </>
          ) : null}

          {section === 'permissions' ? (
            <>
              <SettingsGroup title="Permissions">
                <SettingRow
                  title="Default permissions"
                  description="NEXUS đọc và sửa tệp trong workspace; có thể xin thêm quyền khi cần."
                >
                  <Select
                    value={(settings['agent.permissionMode'] as string) ?? 'workspace-write'}
                    options={[
                      { value: 'read-only', label: 'Read only' },
                      { value: 'workspace-write', label: 'Workspace write' },
                      { value: 'terminal-approval', label: 'Approval required' },
                      { value: 'elevated', label: 'Elevated' },
                      { value: 'unrestricted', label: 'Full access' },
                    ]}
                    onValueChange={(value) => setSetting('agent.permissionMode', value)}
                    className="w-[190px]"
                  />
                </SettingRow>
                <SettingRow
                  title="Full access"
                  description="Toàn quyền: sửa mọi tệp và chạy lệnh có mạng mà không cần duyệt. Tăng mạnh rủi ro mất dữ liệu, rò rỉ hoặc hành vi ngoài ý muốn."
                >
                  <Switch
                    checked={(settings['agent.permissionMode'] as string) === 'unrestricted'}
                    onCheckedChange={(value) =>
                      void setSetting(
                        'agent.permissionMode',
                        value ? 'unrestricted' : 'workspace-write',
                      )
                    }
                  />
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup
                title="Mặc định"
                description="Áp dụng cho phiên mới; thay đổi được lưu ngay."
              >
                <SettingRow
                  title="Mức quyền"
                  description="Quyết định được enforce trong core, độc lập với ý định của model."
                >
                  <Select
                    value={(settings['agent.permissionMode'] as string) ?? 'workspace-write'}
                    options={PERMISSION_MODES.map(({ mode }) => ({
                      value: mode,
                      label: t(`perm.${mode}` as Parameters<typeof t>[0]),
                    }))}
                    onValueChange={(value) => setSetting('agent.permissionMode', value)}
                    className="w-[190px]"
                  />
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup title="Chế độ">
                {PERMISSION_MODES.map(({ mode, description }) => (
                  <div key={mode} className="flex items-start gap-3 px-4 py-2.5">
                    <Badge>{mode}</Badge>
                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                      {description}
                    </p>
                  </div>
                ))}
              </SettingsGroup>
              <SettingsGroup
                title="Quyền đã ghi nhớ"
                description="Các tool được “luôn cho phép” theo từng dự án."
              >
                {allowedToolEntries.length ? (
                  allowedToolEntries.map((entry) => (
                    <div key={entry.key} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium text-[var(--text)]">
                          {projectName(entry.projectId)}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-faint)]">
                          {entry.tools.join(', ')}
                        </p>
                      </div>
                      <Button size="xs" variant="ghost" onClick={() => setSetting(entry.key, [])}>
                        Xoá
                      </Button>
                    </div>
                  ))
                ) : (
                  <EmptyRow>Chưa có quyền nào được ghi nhớ.</EmptyRow>
                )}
              </SettingsGroup>
              <SettingsGroup title="Bảo vệ bổ sung">
                <div className="space-y-2 px-4 py-3.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  <p>• Path traversal và symlink escape bị chặn ở workspace engine.</p>
                  <p>
                    • Lệnh nguy hiểm (rm -rf /, mkfs, piped shell, force push…) bị chặn hoặc buộc
                    phê duyệt.
                  </p>
                  <p>• Nội dung repository được đánh dấu untrusted, không được coi là chỉ dẫn.</p>
                  <p>• Ghi tệp atomic; thay đổi được ghi lại để review hoặc hoàn tác.</p>
                </div>
              </SettingsGroup>
            </>
          ) : null}

          {section === 'about' ? (
            <>
              <SettingsGroup
                title="NEXUS Desktop"
                description="Premium AI coding agent environment."
              >
                <InfoRow label="Version" value={info?.version} />
                <InfoRow label="Electron" value={info?.electron} />
                <InfoRow label="Chromium" value={info?.chrome} />
                <InfoRow label="Node" value={info?.node} />
                <InfoRow
                  label="Platform"
                  value={info ? `${info.platform} · ${info.arch}` : undefined}
                />
                <InfoRow label="User data" value={info?.userDataPath} />
                <InfoRow
                  label="Secret storage"
                  value={
                    info?.encryptionAvailable ? 'AES-256-GCM · secrets.key 0600' : 'Không khả dụng'
                  }
                />
              </SettingsGroup>
              <SettingsGroup title="Dự án">
                <SettingRow
                  title="Mã nguồn"
                  description="devtantai-coder/nexus-desktop trên GitHub."
                >
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      void api.app.openExternal('https://github.com/devtantai-coder/nexus-desktop')
                    }
                  >
                    <ExternalLink size={12} />
                    GitHub
                  </Button>
                </SettingRow>
              </SettingsGroup>
              <p className="px-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
                NEXUS không tuyên bố code an toàn tuyệt đối dựa trên AI review. Kết quả review và
                kiểm thử là tư vấn; quyết định cuối cùng thuộc về người dùng.
              </p>
            </>
          ) : null}
          <Dialog
            open={licensesOpen}
            onOpenChange={setLicensesOpen}
            title="Open source licenses"
            footer={
              <Button variant="ghost" onClick={() => setLicensesOpen(false)}>
                Close
              </Button>
            }
          >
            <ul className="space-y-1.5 text-[12.5px] text-[var(--text-muted)]">
              <li>Electron — MIT</li>
              <li>Chromium — BSD-3-Clause</li>
              <li>Node.js — MIT</li>
              <li>React — MIT</li>
              <li>Tailwind CSS — MIT</li>
              <li>Lucide — ISC</li>
            </ul>
          </Dialog>
        </div>
      </main>
    </div>
  )
}
