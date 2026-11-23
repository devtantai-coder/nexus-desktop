import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { McpServer } from '@nexus/shared'
import { api, qk, useAppStore } from '../../kernel'
import {
  CONNECTORS,
  formatKeyValues,
  isValidServerId,
  logoutAuth,
  parseKeyValues,
  readServers,
  removeServer,
  restartMcp,
  serverTarget,
  setServerEnabled,
  splitArgs,
  startAuth,
  upsertServer,
  type McpServerConfig,
} from '../../lib/mcp'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  cn,
} from '../ui'

type FormState = {
  id: string
  command: string
  args: string
  url: string
  transport: 'http' | 'sse'
  headers: string
  env: string
}

const EMPTY_FORM: FormState = {
  id: '',
  command: '',
  args: '',
  url: '',
  transport: 'http',
  headers: '',
  env: '',
}

const TRANSPORTS = [
  { value: 'http', label: 'Streamable HTTP', description: 'POST JSON-RPC tới URL' },
  { value: 'sse', label: 'SSE (cũ)', description: 'GET /sse rồi POST endpoint' },
]

type Health = 'running' | 'idle' | 'error' | 'disabled'

const HEALTH: Record<
  Health,
  { dot: string; label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' }
> = {
  running: { dot: 'bg-[var(--success)]', label: 'đang chạy', tone: 'success' },
  idle: { dot: 'bg-[var(--text-faint)]', label: 'chưa chạy', tone: 'neutral' },
  error: { dot: 'bg-[var(--danger)]', label: 'lỗi', tone: 'danger' },
  disabled: { dot: 'bg-[var(--warning)]', label: 'đã tắt', tone: 'warning' },
}

function healthOf(config: McpServerConfig, live?: McpServer): Health {
  if (config.enabled === false) return 'disabled'
  if (live?.error) return 'error'
  if (live?.status?.running) return 'running'
  return 'idle'
}

function transportChip(config: McpServerConfig): string {
  if (config.transport === 'sse') return 'SSE'
  return config.url ? 'HTTP' : 'STDIO'
}

function toForm(config: McpServerConfig): FormState {
  return {
    id: config.id,
    command: config.command ?? '',
    args: (config.args ?? []).join(' '),
    url: config.url ?? '',
    transport: config.transport === 'sse' ? 'sse' : 'http',
    headers: formatKeyValues(config.headers),
    env: formatKeyValues(config.env),
  }
}

function validate(form: FormState): { id?: string; target?: string } {
  const errors: { id?: string; target?: string } = {}
  const id = form.id.trim()
  if (!id) errors.id = 'Cần ID cho server.'
  else if (!isValidServerId(id)) errors.id = 'Chỉ dùng chữ, số, gạch ngang, gạch dưới (≤ 64 ký tự).'
  const command = form.command.trim()
  const url = form.url.trim()
  if (!command && !url) errors.target = 'Điền Command (stdio) hoặc URL (HTTP/SSE).'
  else if (command && url) errors.target = 'Chọn một transport: Command hoặc URL, không cả hai.'
  else if (url && !/^https?:\/\//i.test(url))
    errors.target = 'URL phải bắt đầu bằng http:// hoặc https://.'
  return errors
}

export function McpPanel(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState<string | null>(null)
  const [authPending, setAuthPending] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ id?: string; target?: string }>({})
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const { data: configs = [] } = useQuery({
    queryKey: ['settings', 'mcp.servers'],
    queryFn: async () => readServers((await api.settings.all()) as Record<string, unknown>),
    staleTime: 5_000,
  })
  const { data: live = [], isFetching } = useQuery({
    queryKey: qk.mcpServers,
    queryFn: () => api.mcp.servers(),
    staleTime: 5_000,
  })
  const { data: tools = [], isFetching: toolsLoading } = useQuery({
    queryKey: qk.mcpTools(expanded ?? undefined),
    queryFn: () => api.mcp.tools(expanded ?? undefined),
    enabled: Boolean(expanded),
    staleTime: 10_000,
    retry: false,
  })

  const liveById = useMemo(() => new Map(live.map((server) => [server.id, server])), [live])
  const counts = useMemo(() => {
    let running = 0
    let failed = 0
    for (const config of configs) {
      const state = healthOf(config, liveById.get(config.id))
      if (state === 'running') running += 1
      if (state === 'error') failed += 1
    }
    return { total: configs.length, running, failed }
  }, [configs, liveById])

  const pendingAuthed = authPending
    ? Boolean(liveById.get(authPending)?.auth?.authenticated)
    : false
  useEffect(() => {
    if (!authPending) return
    if (pendingAuthed) {
      setAuthPending(null)
      return
    }
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: qk.mcpServers }),
      1500,
    )
    const stop = setTimeout(() => setAuthPending(null), 180_000)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [authPending, pendingAuthed, queryClient])

  const fail = (error: unknown): void =>
    toast({ level: 'error', title: 'Không cập nhật được MCP', body: (error as Error).message })

  const openCreate = (preset?: McpServerConfig): void => {
    setEditing(null)
    setErrors({})
    setForm(preset ? toForm(preset) : EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (config: McpServerConfig): void => {
    setEditing(config.id)
    setErrors({})
    setForm(toForm(config))
    setDialogOpen(true)
  }

  const submit = async (): Promise<void> => {
    const found = validate(form)
    setErrors(found)
    if (found.id || found.target) return
    const command = form.command.trim()
    const url = form.url.trim()
    const headers = parseKeyValues(form.headers)
    const env = parseKeyValues(form.env)
    setSaving(true)
    try {
      await upsertServer({
        id: form.id.trim(),
        ...(command ? { command, args: splitArgs(form.args) } : { url }),
        ...(url && form.transport === 'sse' ? { transport: 'sse' as const } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(Object.keys(env).length ? { env } : {}),
      })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setEditing(null)
      toast({ level: 'success', title: editing ? 'Đã lưu server MCP' : 'Đã thêm server MCP' })
    } catch (error) {
      fail(error)
    } finally {
      setSaving(false)
    }
  }

  // "Kiểm tra" = spawn + initialize + tools/list cho riêng server này (mcp.tools có serverId).
  const checkServer = async (id: string): Promise<void> => {
    setChecking(id)
    try {
      const list = await api.mcp.tools(id)
      toast({ level: 'success', title: `${id}: kết nối OK`, body: `${list.length} tool` })
    } catch (error) {
      toast({ level: 'error', title: `${id}: kết nối thất bại`, body: (error as Error).message })
    } finally {
      setChecking(null)
      await queryClient.invalidateQueries({ queryKey: qk.mcpServers })
      await queryClient.invalidateQueries({ queryKey: qk.mcpTools(id) })
      if (expanded) await queryClient.invalidateQueries({ queryKey: qk.mcpTools(expanded) })
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      await removeServer(pendingDelete)
      setPendingDelete(null)
    } catch (error) {
      fail(error)
    }
  }

  return (
    <>
      <section className="mb-7">
        <div className="mb-2 flex items-end justify-between gap-4 px-0.5">
          <div className="min-w-0">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)]">
              MCP servers
            </h2>
            <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              {counts.total === 0
                ? 'Chưa có server nào. Thêm connector hoặc khai báo server của bạn.'
                : `${counts.total} server · ${counts.running} đang chạy${
                    counts.failed ? ` · ${counts.failed} lỗi` : ''
                  }`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="xs"
              variant="ghost"
              icon={<RefreshCw size={12} className={cn(isFetching && 'animate-spin')} />}
              disabled={counts.total === 0}
              onClick={() => void restartMcp().catch(fail)}
            >
              Khởi động lại
            </Button>
            <Button
              size="xs"
              variant="primary"
              icon={<Plus size={13} />}
              onClick={() => openCreate()}
            >
              Thêm MCP server
            </Button>
          </div>
        </div>

        {counts.total === 0 ? (
          <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)]">
            <EmptyState
              title="Chưa cấu hình MCP server"
              description="MCP cho phép agent dùng thêm tool từ process cục bộ hoặc server từ xa qua HTTP/SSE."
              action={
                <Button size="xs" variant="secondary" onClick={() => openCreate()}>
                  Khai báo server đầu tiên
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)]">
            {configs.map((config) => {
              const server = liveById.get(config.id)
              const state = healthOf(config, server)
              const style = HEALTH[state]
              const open = expanded === config.id
              return (
                <li key={config.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn('mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full', style.dot)}
                      role="img"
                      aria-label={style.label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-[var(--text)]">
                          {config.id}
                        </span>
                        <Badge tone="neutral">{transportChip(config)}</Badge>
                        <Badge tone={style.tone}>
                          {state === 'running' ? `${server?.status.tools ?? 0} tool` : style.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11.5px] text-[var(--text-faint)]">
                        {serverTarget(config)}
                      </p>
                      {server?.error ? (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-[var(--radius)] bg-[var(--danger)]/8 px-2 py-1 text-[11.5px] leading-relaxed text-[var(--danger)]">
                          <AlertCircle size={12} className="mt-[2px] shrink-0" />
                          <span className="min-w-0 break-words">{server.error}</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Kiểm tra ${config.id}`}
                        disabled={checking !== null || config.enabled === false}
                        onClick={() => void checkServer(config.id)}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-45"
                      >
                        <Activity
                          size={12}
                          className={cn(checking === config.id && 'animate-pulse')}
                        />
                        Kiểm tra
                      </button>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`Xem tool của ${config.id}`}
                        onClick={() => setExpanded(open ? null : config.id)}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                      >
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Tool
                      </button>
                      <Switch
                        checked={config.enabled !== false}
                        ariaLabel={`Bật ${config.id}`}
                        onCheckedChange={(checked) =>
                          void setServerEnabled(config.id, checked).catch(fail)
                        }
                      />
                      <IconButton label={`Sửa ${config.id}`} onClick={() => openEdit(config)}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        label={`Xoá ${config.id}`}
                        onClick={() => setPendingDelete(config.id)}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>

                  {open ? (
                    <div className="border-t border-[var(--border)] bg-[var(--bg)] py-2.5 pl-[29px] pr-4">
                      {config.url ? (
                        <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                            OAuth
                          </span>
                          <Badge tone={server?.auth?.authenticated ? 'success' : 'warning'}>
                            {server?.auth?.authenticated ? 'đã kết nối' : 'chưa kết nối'}
                          </Badge>
                          {server?.auth?.authenticated ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => void logoutAuth(config.id).catch(fail)}
                            >
                              Đăng xuất
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              variant="secondary"
                              loading={authPending === config.id}
                              onClick={() => {
                                setAuthPending(config.id)
                                void startAuth(config.id).catch((error) => {
                                  setAuthPending(null)
                                  fail(error)
                                })
                              }}
                            >
                              Kết nối
                            </Button>
                          )}
                          {server?.auth?.error ? (
                            <span className="text-[11px] text-[var(--danger)]">
                              {server.auth.error}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {toolsLoading ? (
                        <p className="text-[11.5px] text-[var(--text-faint)]">Đang tải tool…</p>
                      ) : tools.length === 0 ? (
                        <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                          Không có tool trả về. Kiểm tra command/URL, biến môi trường và header.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {tools.map((tool) => (
                            <li key={tool.namespacedName} className="text-[11.5px] leading-relaxed">
                              <span className="font-mono text-[var(--text)]">
                                {tool.namespacedName}
                              </span>
                              {tool.description ? (
                                <span className="text-[var(--text-muted)]">
                                  {' '}
                                  — {tool.description}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      {server?.stderr ? (
                        <div className="mt-2">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                            stderr
                          </p>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
                            {server.stderr}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)]">
            Connector có sẵn
          </h2>
          <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            Thêm một bước, sau đó mở “Sửa” để điền token nếu connector yêu cầu. Cần Node/npx (hoặc
            uvx với Fetch) trong PATH.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CONNECTORS.map((connector) => {
            const added = configs.some((server) => server.id === connector.config.id)
            return (
              <button
                key={connector.config.id}
                type="button"
                disabled={added}
                onClick={() =>
                  void upsertServer({ ...connector.config, enabled: true }).catch(fail)
                }
                className={cn(
                  'group flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left transition-colors',
                  added
                    ? 'cursor-default opacity-55'
                    : 'hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <span className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
                  <Plug size={12} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
                    {connector.name}
                    {added ? <Badge tone="success">đã thêm</Badge> : null}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                    {connector.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditing(null)
            setErrors({})
          }
        }}
        title={editing ? `Sửa ${editing}` : 'Thêm MCP server'}
        description="Server stdio chạy bằng command; server từ xa dùng URL (Streamable HTTP hoặc SSE)."
        width={620}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Huỷ
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
              {editing ? 'Lưu thay đổi' : 'Thêm server'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="ID" hint={errors.id ?? 'Đi vào tên tool: mcp__<id>__<tool>'}>
              <Input
                value={form.id}
                placeholder="my-server"
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
              />
            </Field>
            <Field label="Transport" hint="Chỉ áp dụng khi có URL">
              <Select
                ariaLabel="Transport"
                value={form.transport}
                options={TRANSPORTS}
                onValueChange={(value) =>
                  setForm({ ...form, transport: value === 'sse' ? 'sse' : 'http' })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Command" hint="stdio">
              <Input
                value={form.command}
                placeholder="npx hoặc đường dẫn tuyệt đối"
                onChange={(event) => setForm({ ...form, command: event.target.value })}
              />
            </Field>
            <Field label="Args">
              <Input
                value={form.args}
                placeholder="-y @scope/server"
                onChange={(event) => setForm({ ...form, args: event.target.value })}
              />
            </Field>
            <Field label="URL" hint="HTTP/SSE">
              <Input
                value={form.url}
                placeholder="https://example.com/mcp"
                onChange={(event) => setForm({ ...form, url: event.target.value })}
              />
            </Field>
          </div>

          {errors.target ? (
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--danger)]">
              <AlertCircle size={13} /> {errors.target}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Headers" hint="Mỗi dòng KEY=VALUE (HTTP/SSE)">
              <textarea
                value={form.headers}
                rows={3}
                placeholder="Authorization=Bearer token"
                onChange={(event) => setForm({ ...form, headers: event.target.value })}
                className="w-full resize-y rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[12px] outline-none focus:border-[var(--accent)]"
              />
            </Field>
            <Field label="Env" hint="Mỗi dòng KEY=VALUE (stdio)">
              <textarea
                value={form.env}
                rows={3}
                placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…"
                onChange={(event) => setForm({ ...form, env: event.target.value })}
                className="w-full resize-y rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[12px] outline-none focus:border-[var(--accent)]"
              />
            </Field>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`Xoá ${pendingDelete ?? ''}?`}
        description="Cấu hình bị xoá khỏi settings; process đang chạy sẽ dừng ở lần nạp lại kế tiếp."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => void confirmDelete()}
            >
              Xoá server
            </Button>
          </>
        }
      />
    </>
  )
}
