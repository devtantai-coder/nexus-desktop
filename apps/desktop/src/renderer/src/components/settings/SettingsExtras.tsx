import type React from 'react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, FolderGit2, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import { api, queryClient, qk, useAppStore } from '../../kernel'
import { MINI_PETS, DEFAULT_PET_ID } from '../pets/registry'
import { Button, Input, Switch } from '../ui'
import type { GitStatus, Session } from '@nexus/shared'

function InfoRow({ label, value }: { label: string; value?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="min-w-0 text-[13px] text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11.5px] text-[var(--text)]">
        {value ?? '—'}
      </span>
    </div>
  )
}

function Group({
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

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + N', 'Cuộc trò chuyện mới'],
  ['Ctrl/Cmd + ,', 'Mở Cài đặt'],
  ['Ctrl/Cmd + B', 'Ẩn/hiện sidebar'],
  ['Ctrl/Cmd + K', 'Bảng lệnh'],
  ['Ctrl/Cmd + Shift + P', 'Bảng lệnh'],
  ['Ctrl/Cmd + J', 'Bật/tắt panel terminal'],
  ['Ctrl/Cmd + Shift + P (trong chat)', 'Popout cửa sổ phiên'],
]

const AUTOMATION_CHANNELS = ['none', 'webhook', 'discord', 'telegram'] as const
type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number]

const REPORT_PRESET = [
  'Tóm tắt các thay đổi và trạng thái công việc gần đây.',
  'Nêu rủi ro còn mở và đề xuất tối đa 3 bước tiếp theo.',
  'Trả lời ngắn gọn bằng tiếng Việt, không dùng emoji.',
].join('\n')

function AutomationPanel(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const settings = useAppStore((state) => state.settings)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const [name, setName] = useState('Báo cáo định kỳ')
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState('0 9 * * 1-5')
  const [channel, setChannel] = useState<AutomationChannel>('none')
  const [target, setTarget] = useState('')
  const [token, setToken] = useState(String(settings['automation.telegramToken'] ?? ''))
  const list = useQuery({
    queryKey: ['automations'],
    queryFn: () => api.automation.list(),
  })
  const jobs = (list.data ?? []) as Array<Record<string, unknown>>

  const act = (work: Promise<unknown>, done: (result: Record<string, unknown>) => void): void => {
    void work
      .then((value) => {
        done((value ?? {}) as Record<string, unknown>)
        void list.refetch()
      })
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Automation lỗi', body: error.message }),
      )
  }

  return (
    <>
      <Group
        title="Automation / Cron"
        description="Lên lịch tác vụ định kỳ bằng cron 5 trường (phút giờ ngày tháng thứ) và gửi kết quả tới webhook, Discord hoặc Telegram."
      >
        <div className="space-y-2 px-4 py-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tên lịch"
              className="text-[12px]"
            />
            <Input
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
              placeholder="0 9 * * 1-5"
              className="font-mono text-[12px]"
            />
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Nội dung tác vụ định kỳ…"
            className="block min-h-[80px] w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[12px] outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as AutomationChannel)}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none"
              aria-label="Kênh gửi kết quả"
            >
              {AUTOMATION_CHANNELS.map((item) => (
                <option key={item} value={item}>
                  {item === 'none' ? 'Không gửi' : item}
                </option>
              ))}
            </select>
            <Input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={channel === 'telegram' ? 'chat_id' : 'https://… webhook'}
              className="text-[12px]"
            />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPrompt(REPORT_PRESET)}
              title="Điền mẫu báo cáo định kỳ"
            >
              Mẫu báo cáo
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() =>
                act(
                  api.automation.create({
                    name,
                    prompt,
                    schedule,
                    channel,
                    target,
                    projectId: activeProjectId ?? '',
                  }),
                  () => toast({ level: 'success', title: 'Đã tạo lịch', body: schedule }),
                )
              }
            >
              <Plus size={12} />
              Tạo lịch
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            Lịch chạy trong ứng dụng, kể cả khi cửa sổ đang mở. Cần có provider/model được bật để
            tác vụ thực thi.
          </p>
        </div>
      </Group>

      <Group title="Lịch đã đặt" description="Bật/tắt, chạy ngay hoặc xoá từng lịch.">
        {jobs.map((job) => {
          const id = String(job['id'] ?? '')
          const enabled = job['enabled'] === true || job['enabled'] === 1
          const next = Number(job['next_run_at'] ?? job['nextRunAt'] ?? 0)
          const last = Number(job['last_run_at'] ?? job['lastRunAt'] ?? 0)
          return (
            <div
              key={id}
              className="space-y-2 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-[var(--text)]">
                    {String(job['name'] ?? 'Automation')}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--text-faint)]">
                    {String(job['schedule'] ?? '')} · kênh {String(job['channel'] ?? 'none')}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(value: boolean) =>
                    act(api.automation.update(id, { enabled: value }), () => {
                      toast({ level: 'success', title: value ? 'Đã bật lịch' : 'Đã tắt lịch' })
                    })
                  }
                />
              </div>
              <p className="text-[11.5px] text-[var(--text-muted)]">
                {next > 0
                  ? `Lần chạy tiếp: ${new Date(next).toLocaleString()}`
                  : 'Chưa tính lần chạy'}
                {last > 0 ? ` · Lần trước: ${new Date(last).toLocaleString()}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    act(api.automation.run(id), (result) => {
                      if (result['ok'] === true) {
                        toast({
                          level: 'success',
                          title: 'Đã chạy ngay',
                          body: String(result['nextRunAt'] ?? ''),
                        })
                      } else {
                        toast({
                          level: 'error',
                          title: 'Chạy lịch thất bại',
                          body: String(result['error'] ?? ''),
                        })
                      }
                    })
                  }
                >
                  <RotateCcw size={12} />
                  Chạy ngay
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    act(api.automation.remove(id), () =>
                      toast({ level: 'success', title: 'Đã xoá lịch' }),
                    )
                  }
                >
                  <Trash2 size={12} />
                  Xoá
                </Button>
              </div>
            </div>
          )
        })}
        {jobs.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-[var(--text-muted)]">Chưa có lịch nào.</p>
        ) : null}
      </Group>

      <Group
        title="Kênh gửi kết quả"
        description="Webhook/Discord dùng URL đích; Telegram dùng bot token và chat_id."
      >
        <div className="space-y-2 px-4 py-3">
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Telegram bot token"
            type="password"
            className="text-[12px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() =>
                act(api.settings.set('automation.telegramToken', token), () =>
                  toast({ level: 'success', title: 'Đã lưu token Telegram' }),
                )
              }
            >
              Lưu token
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                act(
                  api.automation.testChannel(channel === 'none' ? 'webhook' : channel, target),
                  (result) =>
                    toast({
                      level: result['delivered'] === true ? 'success' : 'error',
                      title: 'Kiểm tra kênh',
                      body: String(result['status'] ?? result['channel'] ?? ''),
                    }),
                )
              }
            >
              Test kênh
            </Button>
          </div>
        </div>
      </Group>
    </>
  )
}

/** Các mục Settings bổ sung theo taxonomy của Codex desktop. */
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function MemoryPanel(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const [memoryText, setMemoryText] = useState('')
  const [userText, setUserText] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyHits, setHistoryHits] = useState<Array<Record<string, unknown>>>([])
  const [historySearched, setHistorySearched] = useState(false)

  const filesQuery = useQuery({
    queryKey: ['memory-files'],
    queryFn: () => api.memory.files(),
  })
  const notesQuery = useQuery({
    queryKey: ['memory-notes'],
    queryFn: () => api.memory.list({ limit: 100 }),
  })

  useEffect(() => {
    for (const file of filesQuery.data ?? []) {
      const kind = str(file?.['kind'])
      const content = str(file?.['content'])
      if (kind === 'MEMORY.md') setMemoryText(content)
      if (kind === 'USER.md') setUserText(content)
    }
  }, [filesQuery.data])

  const saveFile = (kind: 'MEMORY.md' | 'USER.md', content: string): void => {
    void api.memory
      .write(kind, content)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['memory-files'] })
        toast({ level: 'success', title: `Đã lưu ${kind}` })
      })
      .catch((error: Error) =>
        toast({ level: 'error', title: `Không lưu được ${kind}`, body: error.message }),
      )
  }

  const notes = notesQuery.data ?? []
  const searchHistory = (): void => {
    const query = historyQuery.trim()
    if (query === '') return
    void api.sessions
      .search(query, 50)
      .then((rows) => {
        setHistoryHits(rows as Array<Record<string, unknown>>)
        setHistorySearched(true)
      })
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Tìm lịch sử lỗi', body: error.message }),
      )
  }

  return (
    <>
      <Group
        title="Persistent memory files"
        description="Hai tệp dùng chung cho mọi phiên chat. Nội dung được đưa vào system prompt; agent có thể đọc/ghi qua memory_file_read / memory_file_write."
      >
        {(['MEMORY.md', 'USER.md'] as const).map((kind) => {
          const file = (filesQuery.data ?? []).find(
            (row: Record<string, unknown>) => str(row?.['kind']) === kind,
          )
          const text = kind === 'MEMORY.md' ? memoryText : userText
          const setter = kind === 'MEMORY.md' ? setMemoryText : setUserText
          return (
            <div
              key={kind}
              className="border-b border-[var(--border-subtle)] px-4 py-3 last:border-0"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[12px] text-[var(--text)]">{kind}</span>
                <span className="truncate font-mono text-[10px] text-[var(--text-faint)]">
                  {str(file?.['path'])}
                </span>
              </div>
              <textarea
                aria-label={`Nội dung ${kind}`}
                value={text}
                onChange={(event) => setter(event.target.value)}
                className="block min-h-[110px] w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 font-mono text-[11.5px] leading-relaxed outline-none"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-[var(--text-faint)]">{text.length} ký tự</span>
                <Button size="xs" variant="secondary" onClick={() => saveFile(kind, text)}>
                  <Save size={12} />
                  Lưu {kind}
                </Button>
              </div>
            </div>
          )
        })}
      </Group>
      <Group
        title="Ghi nhớ dự án"
        description="Ghi chú bền vững theo projectId (hoặc toàn cục nếu chưa mở dự án). Agent đọc lại ở mọi phiên mới."
      >
        {activeProjectId ? (
          <p className="px-4 pt-3 text-[11.5px] text-[var(--text-faint)]">
            Ghi chú mới thuộc dự án đang mở: {activeProjectId}
          </p>
        ) : null}
        {notes.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
            Chưa có ghi chú nào. Agent có thể tự lưu qua save_memory, hoặc thêm thủ công bên dưới.
          </p>
        ) : (
          notes.map((note: Record<string, unknown>) => {
            const id = str(note['id'])
            return (
              <div
                key={id}
                className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] text-[var(--text)]">{str(note['content'])}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-faint)]">
                    [{str(note['kind'])}] · {str(note['projectId']) || 'toàn cục'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Xoá ghi chú ${id}`}
                  onClick={() => {
                    void api.memory
                      .remove(id)
                      .then(
                        () => void queryClient.invalidateQueries({ queryKey: ['memory-notes'] }),
                      )
                      .catch((error: Error) =>
                        toast({
                          level: 'error',
                          title: 'Không xoá được ghi chú',
                          body: error.message,
                        }),
                      )
                  }}
                  className="icon-btn-sm"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })
        )}
        <div className="space-y-2 px-4 py-3">
          <textarea
            aria-label="Ghi chú mới"
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            placeholder="Sự thật, quy ước hoặc quy trình cần nhớ…"
            className="block min-h-[64px] w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[12px] outline-none"
          />
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              const content = noteContent.trim()
              if (content === '') return
              void api.memory
                .create({
                  ...(activeProjectId ? { projectId: activeProjectId } : {}),
                  kind: 'fact',
                  content,
                })
                .then(() => {
                  setNoteContent('')
                  void queryClient.invalidateQueries({ queryKey: ['memory-notes'] })
                  toast({ level: 'success', title: 'Đã lưu ghi chú' })
                })
                .catch((error: Error) =>
                  toast({ level: 'error', title: 'Không lưu được ghi chú', body: error.message }),
                )
            }}
          >
            <Plus size={12} />
            Thêm ghi chú
          </Button>
        </div>
      </Group>
      <Group
        title="Tìm lại lịch sử hội thoại"
        description="Tìm theo nội dung tin nhắn trong mọi phiên; bấm kết quả để mở lại phiên đó."
      >
        <div className="flex gap-2 px-4 py-3">
          <Input
            aria-label="Tìm trong lịch sử hội thoại"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') searchHistory()
            }}
            placeholder="Từ khoá trong tin nhắn…"
            className="text-[12px]"
          />
          <Button size="xs" variant="secondary" onClick={searchHistory}>
            <Search size={12} />
            Tìm
          </Button>
        </div>
        {historySearched && historyHits.length === 0 ? (
          <p className="px-4 pb-4 text-[12.5px] text-[var(--text-faint)]">
            Không tìm thấy tin nhắn khớp.
          </p>
        ) : (
          historyHits.map((hit: Record<string, unknown>) => {
            const sessionId = str(hit['sessionId'])
            return (
              <button
                type="button"
                key={str(hit['id'])}
                onClick={() => {
                  if (sessionId === '') return
                  useAppStore.setState({ activeSessionId: sessionId })
                  useAppStore.getState().navigate({ name: 'chat', sessionId })
                }}
                className="block w-full border-t border-[var(--border-subtle)] px-4 py-2.5 text-left hover:bg-[var(--bg-hover)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[12.5px] text-[var(--text)]">
                    {str(hit['sessionTitle']) || sessionId}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
                    {str(hit['role'])} · {str(hit['createdAt'])}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11.5px] text-[var(--text-muted)]">
                  {str(hit['content'])}
                </p>
              </button>
            )
          })
        )}
      </Group>
    </>
  )
}

export function SettingsExtras({ section }: { section: string }): React.JSX.Element | null {
  const info = useAppStore((state) => state.info)
  const settings = useAppStore((state) => state.settings)
  const setSetting = useAppStore((state) => state.setSetting)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const navigate = useAppStore((state) => state.navigate)
  const toast = useAppStore((state) => state.toast)
  const accent = useAppStore((state) => state.accent)
  const setAccent = useAppStore((state) => state.setAccent)
  const [importText, setImportText] = useState('')
  const [envKey, setEnvKey] = useState('')
  const [envValue, setEnvValue] = useState('')
  const [browserUrl, setBrowserUrl] = useState('')
  const [browserSession, setBrowserSession] = useState('')
  const [browserSelector, setBrowserSelector] = useState('')
  const [browserText, setBrowserText] = useState('')
  const [skillName, setSkillName] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillContent, setSkillContent] = useState('')

  const archivedQuery = useQuery({
    queryKey: qk.sessions({ archived: true }),
    queryFn: () => api.sessions.list({ archived: true }),
    enabled: section === 'archived',
  })
  const gitQuery = useQuery({
    queryKey: ['git-status', activeProjectId ?? 'none'],
    queryFn: () => api.git.status(activeProjectId as string),
    enabled: section === 'git' && Boolean(activeProjectId),
  })
  const configQuery = useQuery({
    queryKey: ['settings-all-export'],
    queryFn: () => api.settings.all(),
    enabled: section === 'configuration',
  })
  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.skills.list(50),
    enabled: section === 'skills',
  })

  if (section === 'memory') return <MemoryPanel />

  if (section === 'archived') {
    const archived = archivedQuery.data ?? []
    return (
      <Group
        title="Archived chats"
        description="Hội thoại đã lưu trữ. Khôi phục để đưa lại vào Recents."
      >
        {archived.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
            Không có hội thoại nào được lưu trữ.
          </p>
        ) : (
          archived.map((session: Session) => (
            <div key={session.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate text-[13px] text-[var(--text)]">
                {session.title}
              </span>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  void api.sessions
                    .update(session.id, { archived: false })
                    .then(() =>
                      queryClient.invalidateQueries({ queryKey: qk.sessions({ archived: true }) }),
                    )
                    .catch((error: Error) =>
                      toast({ level: 'error', title: 'Không khôi phục được', body: error.message }),
                    )
                }}
              >
                Khôi phục
              </Button>
            </div>
          ))
        )}
      </Group>
    )
  }

  if (section === 'storage') {
    return (
      <>
        <Group title="Storage" description="Dữ liệu local của NEXUS Desktop.">
          <InfoRow label="Database" value={info?.databasePath} />
          <InfoRow label="User data" value={info?.userDataPath} />
        </Group>
        <Group title="Maintenance">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 text-[13px] text-[var(--text)]">Xem log ứng dụng</div>
            <Button size="xs" variant="secondary" onClick={() => void api.app.openLogs()}>
              Mở log
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 text-[13px] text-[var(--text)]">Đặt lại toàn bộ cài đặt</div>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                void api.settings
                  .reset()
                  .then(() => toast({ level: 'success', title: 'Đã đặt lại cài đặt' }))
                  .catch((error: Error) =>
                    toast({ level: 'error', title: 'Không đặt lại được', body: error.message }),
                  )
              }}
            >
              <RotateCcw size={12} />
              Đặt lại
            </Button>
          </div>
        </Group>
      </>
    )
  }

  if (section === 'configuration') {
    const raw = JSON.stringify(configQuery.data ?? {}, null, 2)
    return (
      <Group
        title="Configuration"
        description="Giá trị cài đặt hiện tại dạng JSON (chỉ đọc)."
        actions={
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(raw)
                .then(() => toast({ level: 'success', title: 'Đã sao chép cấu hình' }))
            }}
          >
            <Copy size={12} />
            Sao chép
          </Button>
        }
      >
        <pre className="max-h-[420px] overflow-auto px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-[var(--text-code)]">
          {raw}
        </pre>
      </Group>
    )
  }

  if (section === 'shortcuts') {
    return (
      <Group title="Keyboard shortcuts" description="Các phím tắt đang hoạt động.">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 text-[13px] text-[var(--text)]">{label}</span>
            <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
              {keys}
            </kbd>
          </div>
        ))}
      </Group>
    )
  }

  if (section === 'plugins') {
    return (
      <Group title="Plugins" description="Bật/tắt plugin và mở trang quản lý plugin.">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-[13px] text-[var(--text)]">Cho phép plugin</div>
          <Switch
            checked={settings['plugins.enabled'] !== false}
            onCheckedChange={(value: boolean) => {
              void api.settings.set('plugins.enabled', value)
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-[13px] text-[var(--text)]">Quản lý plugin</div>
          <Button size="xs" variant="secondary" onClick={() => navigate({ name: 'plugins' })}>
            Mở Plugins
          </Button>
        </div>
      </Group>
    )
  }

  if (section === 'git') {
    const status = gitQuery.data as GitStatus | undefined
    return (
      <Group
        title="Git"
        description={
          activeProjectId
            ? 'Trạng thái repository của dự án đang mở.'
            : 'Chưa có dự án nào được mở.'
        }
      >
        {!activeProjectId ? (
          <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
            Mở một dự án để xem trạng thái Git.
          </p>
        ) : !status?.isRepo ? (
          <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
            Dự án này chưa phải git repository.
          </p>
        ) : (
          <>
            <InfoRow label="Branch" value={status.branch} />
            <InfoRow label="Upstream" value={status.upstream ?? '—'} />
            <InfoRow label="Ahead / Behind" value={`${status.ahead} / ${status.behind}`} />
            <InfoRow
              label="Working tree"
              value={status.clean ? 'clean' : `${status.files.length} tệp thay đổi`}
            />
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-[13px] text-[var(--text)]">Mở project</span>
              <FolderGit2 size={14} className="shrink-0 text-[var(--text-faint)]" />
            </div>
          </>
        )}
      </Group>
    )
  }

  if (section === 'skills') {
    const skills = skillsQuery.data ?? []
    const reload = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
    }
    return (
      <>
        <Group
          title="Self-improving Skills"
          description="Quy trình được agent tự học sau mỗi task; dùng lại khi làm việc tương tự. Lưu cùng tên sẽ tăng version."
        >
          {skills.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
              Chưa có skill nào. Skill sẽ xuất hiện sau khi một task hoàn thành.
            </p>
          ) : (
            skills.map((skill: Record<string, unknown>) => {
              const id = String(skill['id'] ?? '')
              return (
                <div
                  key={id}
                  className="border-b border-[var(--border-subtle)] px-4 py-2.5 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                      {String(skill['name'] ?? '')}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
                      v{String(skill['version'] ?? 1)} · dùng {String(skill['useCount'] ?? 0)}×
                    </span>
                    <button
                      type="button"
                      aria-label={`Xoá skill ${String(skill['name'] ?? '')}`}
                      onClick={() => {
                        void api.skills.remove(id).then(reload)
                      }}
                      className="icon-btn-sm"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {skill['description'] ? (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-faint)]">
                      {String(skill['description'])}
                    </p>
                  ) : null}
                </div>
              )
            })
          )}
        </Group>
        <Group title="Thêm skill thủ công">
          <div className="space-y-2 px-4 py-3">
            <Input
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              placeholder="ten-skill"
              className="text-[12px]"
            />
            <Input
              value={skillDescription}
              onChange={(event) => setSkillDescription(event.target.value)}
              placeholder="Mô tả ngắn"
              className="text-[12px]"
            />
            <textarea
              value={skillContent}
              onChange={(event) => setSkillContent(event.target.value)}
              placeholder="Quy trình từng bước…"
              className="block min-h-[100px] w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[12px] outline-none"
            />
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                void api.skills
                  .save({
                    name: skillName,
                    description: skillDescription,
                    content: skillContent,
                    tags: ['manual'],
                  })
                  .then(() => {
                    setSkillName('')
                    setSkillDescription('')
                    setSkillContent('')
                    reload()
                    toast({ level: 'success', title: 'Đã lưu skill' })
                  })
                  .catch((error: Error) =>
                    toast({ level: 'error', title: 'Không lưu được skill', body: error.message }),
                  )
              }}
            >
              Lưu skill
            </Button>
          </div>
        </Group>
      </>
    )
  }

  if (section === 'personalization') {
    const options: Array<[string, string]> = [
      ['blue', 'Xanh dương (Codex)'],
      ['green', 'Xanh lá'],
      ['purple', 'Tím'],
      ['orange', 'Cam'],
    ]
    return (
      <Group title="Personalization" description="Màu nhấn của giao diện. Áp dụng ngay.">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-active={(accent ?? 'blue') === value}
            onClick={() => setAccent(value)}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--bg-hover)] ${
              (accent ?? 'blue') === value
                ? 'font-medium text-[var(--text)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: `var(--accent)` }}
            />
            <span className="min-w-0 flex-1">{label}</span>
            {(accent ?? 'blue') === value ? <span className="text-[var(--accent)]">✓</span> : null}
          </button>
        ))}
      </Group>
    )
  }

  if (section === 'import') {
    return (
      <Group
        title="Import"
        description="Dán JSON cài đặt để áp dụng (cặp key/value như settings.all)."
        actions={
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              try {
                const parsed: unknown = JSON.parse(importText)
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error('JSON phải là object')
                }
                void Promise.all(
                  Object.entries(parsed).map(([key, value]) => api.settings.set(key, value)),
                ).then(() => toast({ level: 'success', title: 'Đã áp dụng cài đặt' }))
              } catch (error) {
                toast({
                  level: 'error',
                  title: 'JSON không hợp lệ',
                  body: error instanceof Error ? error.message : String(error),
                })
              }
            }}
          >
            Áp dụng
          </Button>
        }
      >
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'{\n  "appearance.theme": "dark"\n}'}
          className="mx-4 my-3 block min-h-[180px] w-[calc(100%-2rem)] resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </Group>
    )
  }

  if (section === 'environments') {
    const raw = settings['env.vars']
    const vars: Record<string, unknown> =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
    const save = (next: Record<string, unknown>): void => {
      void api.settings
        .set('env.vars', next)
        .then(() => queryClient.invalidateQueries({ queryKey: ['settings-all-export'] }))
    }
    return (
      <>
        <Group
          title="Environments"
          description="Biến môi trường được truyền cho mọi MCP server khi spawn."
        >
          {Object.entries(vars).length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-[var(--text-faint)]">
              Chưa có biến nào. Server vẫn kế thừa môi trường hệ thống.
            </p>
          ) : (
            Object.entries(vars).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">
                  {key}={String(value)}
                </span>
                <button
                  type="button"
                  aria-label={`Xoá ${key}`}
                  onClick={() => {
                    const next = { ...vars }
                    delete next[key]
                    save(next)
                  }}
                  className="icon-btn-sm"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </Group>
        <Group title="Thêm biến">
          <div className="flex items-center gap-2 px-4 py-3">
            <Input
              value={envKey}
              onChange={(event) => setEnvKey(event.target.value)}
              placeholder="TÊN_BIẾN"
              className="min-w-0 flex-1 font-mono text-[12px]"
            />
            <Input
              value={envValue}
              onChange={(event) => setEnvValue(event.target.value)}
              placeholder="giá trị"
              className="min-w-0 flex-1 font-mono text-[12px]"
            />
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                const key = envKey.trim()
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                  toast({
                    level: 'error',
                    title: 'Tên biến không hợp lệ',
                    body: 'Ch dùng chữ, số và gạch dưới; bắt đầu bằng chữ hoặc _.',
                  })
                  return
                }
                save({ ...vars, [key]: envValue })
                setEnvKey('')
                setEnvValue('')
              }}
            >
              <Plus size={12} />
              Thêm
            </Button>
          </div>
        </Group>
      </>
    )
  }

  if (section === 'voice') {
    const supported =
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    return (
      <Group
        title="Voice"
        description={`Nhận diện giọng nói trong trình duyệt: ${supported ? 'khả dụng' : 'không khả dụng'}.`}
      >
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          {supported
            ? 'Trình duyệt hỗ trợ SpeechRecognition. NEXUS không bật tính năng này theo mặc định để giữ chế độ local-first.'
            : 'Môi trường Electron/offline này không cung cấp SpeechRecognition. Không hiển thị tuỳ chọn giả.'}
        </p>
      </Group>
    )
  }

  if (section === 'automation') return <AutomationPanel />

  if (section === 'browser') {
    const run = (
      input: Record<string, unknown>,
      onDone: (result: Record<string, unknown>) => void,
    ): void => {
      void api.browser
        .call(input)
        .then((result) => {
          onDone(result as Record<string, unknown>)
        })
        .catch((error: Error) =>
          toast({ level: 'error', title: 'Browser automation lỗi', body: error.message }),
        )
    }
    return (
      <>
        <Group
          title="Browser Automation"
          description="Điều khiển trình duyệt headless, đọc nội dung web, tương tác biểu mẫu và chụp ảnh. Chỉ nhận URL http/https."
        >
          <div className="space-y-2 px-4 py-3">
            <div className="flex gap-2">
              <Input
                value={browserUrl}
                onChange={(event) => setBrowserUrl(event.target.value)}
                placeholder="https://example.com"
                className="text-[12px]"
              />
              <Button
                size="xs"
                variant="secondary"
                onClick={() =>
                  run({ method: 'open', url: browserUrl }, (result) => {
                    const id = String(result['id'] ?? '')
                    setBrowserSession(id)
                    setBrowserText(
                      `${String(result['title'] ?? '')}\n${String(result['url'] ?? '')}`,
                    )
                    toast({
                      level: 'success',
                      title: 'Đã mở trang',
                      body: String(result['url'] ?? ''),
                    })
                  })
                }
              >
                Mở
              </Button>
            </div>
            {browserSession ? (
              <>
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  phiên: {browserSession}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={browserSelector}
                    onChange={(event) => setBrowserSelector(event.target.value)}
                    placeholder="CSS selector (tuỳ chọn)"
                    className="text-[12px]"
                  />
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      run(
                        {
                          method: 'read',
                          sessionId: browserSession,
                          ...(browserSelector !== '' ? { selector: browserSelector } : {}),
                        },
                        (result) => setBrowserText(String(result['text'] ?? '')),
                      )
                    }
                  >
                    Đọc
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      run({ method: 'screenshot', sessionId: browserSession }, (result) =>
                        toast({
                          level: 'success',
                          title: 'Đã chụp ảnh',
                          body: String(result['path'] ?? ''),
                        }),
                      )
                    }
                  >
                    Chụp ảnh
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      run({ method: 'close', sessionId: browserSession }, () => {
                        setBrowserSession('')
                        setBrowserText('')
                      })
                    }
                  >
                    Đóng
                  </Button>
                </div>
              </>
            ) : null}
            {browserText ? (
              <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                {browserText}
              </pre>
            ) : null}
          </div>
        </Group>
      </>
    )
  }

  if (section === 'computerUse' || section === 'cloud') {
    const messages: Record<string, string> = {
      computerUse:
        'Computer use có sẵn trong Hermes Agent (công cụ computer_use), không nằm trong runtime desktop NEXUS. Không tạo toggle giả.',
      cloud:
        'Cloud tasks, tài khoản và đồng bộ cần backend OpenAI/Codex. NEXUS là bản local-first nên không có các mục này.',
    }
    return (
      <Group title={section === 'cloud' ? 'Cloud' : 'Computer use'}>
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          {messages[section]}
        </p>
      </Group>
    )
  }

  if (section === 'miniPets') {
    const enabled = settings['appearance.pet'] === true
    const selectedId = String(settings['appearance.pet.id'] ?? DEFAULT_PET_ID)
    return (
      <Group
        title="Mini & Pets"
        description="Bạn đồng hành góc phải màn hình — đổi mood theo agent (chạy/chờ duyệt/lỗi/xong)."
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-[13px] text-[var(--text)]">Hiện bạn đồng hành</div>
          <Switch
            checked={enabled}
            ariaLabel="Bật/tắt bạn đồng hành"
            onCheckedChange={(value: boolean) => {
              setSetting('appearance.pet', value)
            }}
          />
        </div>
        {enabled ? (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-1 min-[520px]:grid-cols-3">
            {MINI_PETS.map((pet) => {
              const Pet = pet.Component
              const active = pet.id === selectedId
              return (
                <button
                  key={pet.id}
                  type="button"
                  aria-pressed={active}
                  title={pet.description}
                  onClick={() => setSetting('appearance.pet.id', pet.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-[var(--radius)] border px-2 py-3 transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--bg-hover)]'
                      : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Pet state="idle" size={44} />
                  <span className="text-[11.5px] font-medium text-[var(--text)]">{pet.name}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </Group>
    )
  }

  return null
}
