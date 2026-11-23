import type React from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  History,
  Pencil,
  RotateCcw,
} from 'lucide-react'
import { useAppStore } from '../../kernel'
import { ChangeCard } from './ChangeCard'
import { Markdown } from '../Markdown'
import { stripInternalBlocks } from '../../lib/artifacts'
import type { Message, Task } from '@nexus/shared'
import type { TaskDetail as Detail } from '@nexus/shared'
import { Button, IconButton, cn } from '../ui'
import { NexusLogo } from '../ui/NexusLogo'

interface ToolPayload {
  tool?: string
  ok?: boolean
  summary?: string
  output?: unknown
  error?: { message?: string; code?: string }
}

const RUNNING_STATES = new Set([
  'idle',
  'planning',
  'running',
  'waiting_tool',
  'waiting_approval',
  'retrying',
])

function parseToolMessage(content: string): ToolPayload {
  try {
    const parsed = JSON.parse(content) as ToolPayload
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    /* fallthrough */
  }
  return { summary: content.slice(0, 200) }
}

function toolOutput(payload: ToolPayload): string {
  if (payload.error?.message) return payload.error.message
  if (typeof payload.output === 'string') return payload.output
  return JSON.stringify(payload.output ?? {}, null, 2)
}

function ToolStatusIcon({ ok }: { ok: boolean }): React.JSX.Element {
  return ok ? (
    <Check size={11} className="text-[var(--success)]" />
  ) : (
    <AlertTriangle size={11} className="text-[var(--danger)]" />
  )
}

const ToolDetail = memo(function ToolDetail({ message }: { message: Message }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const payload = parseToolMessage(message.content)
  const ok = payload.ok !== false
  const output = toolOutput(payload)
  const shown = output.length > 4000 ? `${output.slice(0, 4000)}\n…[cắt bớt]` : output
  return (
    <div className={cn('group/tool min-w-0 py-1')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <ToolStatusIcon ok={ok} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">
          {payload.summary || payload.tool || message.toolCallId || 'tool'}
        </span>
        {output ? (
          <ChevronRight
            size={10}
            className={cn(
              'shrink-0 text-[var(--text-faint)] transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : null}
      </button>
      {open && output ? (
        <pre className="ml-[19px] mt-0.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.55] text-[var(--text-muted)]">
          {shown}
        </pre>
      ) : null}
    </div>
  )
})

const ToolGroup = memo(
  function ToolGroup({ messages }: { messages: Message[] }): React.JSX.Element {
    // Codex: mỗi lệnh và output của nó nối tiếp trong dòng thời gian, không gom nhóm ở trên.
    return (
      <div className="py-0.5">
        {messages.map((message) => (
          <ToolDetail key={message.id} message={message} />
        ))}
      </div>
    )
  },
  (previous, next) =>
    previous.messages.length === next.messages.length &&
    previous.messages.every((message, index) => message === next.messages[index]),
)

function Reasoning({ text, streaming }: { text: string; streaming: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !streaming || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [text, open, streaming])
  const tail = text.length > 320 ? `…${text.slice(-320)}` : text
  const steps = text.split('\n\n').filter((part) => part.trim()).length
  return (
    <div className="mb-1.5" data-reasoning>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12.5px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)]"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {streaming ? 'Đang suy nghĩ…' : steps > 1 ? `Đã suy nghĩ · ${steps} lần` : 'Đã suy nghĩ'}
      </button>
      {open ? (
        <div
          ref={scrollRef}
          className="mt-1.5 max-h-[240px] overflow-y-auto overscroll-contain whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3 text-[13px] leading-relaxed text-[var(--text-muted)]"
        >
          {text}
        </div>
      ) : streaming && tail ? (
        <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-3 text-[12.5px] leading-relaxed text-[var(--text-faint)]">
          {tail}
        </div>
      ) : null}
    </div>
  )
}

const ERROR_HINTS: Record<string, string> = {
  E_AUTH: 'Không xác thực được provider. API key có thể sai hoặc đã hết hạn.',
  E_RATE_LIMIT: 'Provider đang giới hạn tốc độ. Thử lại sau ít phút.',
  E_CONFIG: 'Provider hoặc model chưa được cấu hình đúng.',
  E_CONTEXT_OVERFLOW: 'Cuộc hội thoại vượt context window của model.',
  E_NETWORK: 'Không kết nối được tới provider.',
  E_PROVIDER: 'Provider trả về lỗi.',
  E_TIMEOUT: 'Tác vụ vượt quá thời gian cho phép.',
  E_PERMISSION: 'Thao tác bị từ chối bởi quyền hiện tại.',
}

const AssistantMessage = memo(
  function AssistantMessage({
    message,
    content,
    reasoning,
    streaming,
    isLast,
    onRetry,
  }: {
    message: Message
    content: string
    reasoning: string
    streaming: boolean
    isLast: boolean
    onRetry: () => void
  }): React.JSX.Element {
    const toast = useAppStore((state) => state.toast)
    const navigate = useAppStore((state) => state.navigate)
    const displayContent = useMemo(() => stripInternalBlocks(content), [content])
    const [copied, setCopied] = useState(false)
    const copy = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(displayContent)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch {
        toast({ level: 'warning', title: 'Không sao chép được' })
      }
    }
    return (
      <div className="message-virtual group flex gap-3 py-3">
        <NexusLogo className="mt-1 size-[17px] shrink-0 select-none text-[var(--text-muted)]" />
        <div className="min-w-0 flex-1">
          {reasoning ? <Reasoning text={reasoning} streaming={streaming} /> : null}
          {displayContent ? (
            streaming ? (
              <div className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.65] text-[var(--text)]">
                {displayContent}
                <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-[var(--text-muted)] align-[-0.12em]" />
              </div>
            ) : (
              <div className="assistant-markdown text-[14.5px] leading-[1.65] text-[var(--text)]">
                <Markdown content={displayContent} />
              </div>
            )
          ) : streaming ? (
            reasoning ? null : (
              <div className="flex items-center gap-2 py-1 text-[14px] text-[var(--text-muted)]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--brand-accent)]" />
                Đang xử lý…
              </div>
            )
          ) : message.error ? null : reasoning ? null : (
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-faint)]">
              Model không trả về nội dung.
              <Button size="xs" variant="ghost" onClick={onRetry}>
                Thử lại
              </Button>
            </div>
          )}
          {message.error ? (
            <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-2.5 py-2 text-[13px] text-[var(--danger)]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {ERROR_HINTS[message.error.code] ?? message.error.code}
                </div>
                <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                  {message.error.message}
                </div>
                {['E_AUTH', 'E_CONFIG', 'E_PROVIDER'].includes(message.error.code) ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => navigate({ name: 'settings', section: 'models' })}
                  >
                    Mở Cài đặt → Models
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!streaming ? (
            <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton label={copied ? 'Đã sao chép' : 'Sao chép'} onClick={() => void copy()}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </IconButton>
              {isLast ? (
                <IconButton label="Thử lại" onClick={onRetry}>
                  <RotateCcw size={13} />
                </IconButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.content === next.content &&
    previous.reasoning === next.reasoning &&
    previous.streaming === next.streaming &&
    previous.isLast === next.isLast,
)

interface RenderedMessage {
  message: Message
  content: string
  reasoning: string
  streaming: boolean
}

const UserMessage = memo(
  function UserMessage({
    message,
    content,
    onEdit,
    onRewind,
  }: {
    message: Message
    content: string
    onEdit: () => void
    onRewind?: () => void
  }): React.JSX.Element {
    const toast = useAppStore((state) => state.toast)
    const copy = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(content)
        toast({ level: 'success', title: 'Đã sao chép tin nhắn' })
      } catch {
        toast({ level: 'warning', title: 'Không sao chép được' })
      }
    }
    return (
      <div className="message-virtual group py-2">
        <div className="flex justify-end">
          <div className="bubble-user whitespace-pre-wrap break-words text-[14.5px] leading-[1.55] text-[var(--text)]">
            {content}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-end gap-0.5 text-[12px] font-medium text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100">
          <span>
            {new Date(message.createdAt).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <IconButton label="Sao chép" onClick={() => void copy()}>
            <Copy size={11} />
          </IconButton>
          <IconButton label="Sửa prompt" onClick={onEdit}>
            <Pencil size={11} />
          </IconButton>
          {onRewind ? (
            <IconButton label="Quay lại thời điểm này" onClick={onRewind}>
              <History size={11} />
            </IconButton>
          ) : null}
        </div>
      </div>
    )
  },
  (previous, next) => previous.message === next.message && previous.content === next.content,
)

export function Conversation({
  sessionId,
  messages,
  streamingEnabled,
  task,
  taskDetail,
  onEditPrompt,
  onRetry,
  onRewind,
}: {
  sessionId: string
  messages: Message[]
  streamingEnabled: boolean
  task?: Task | null
  taskDetail?: Detail | null
  onEditPrompt: (prompt: string) => void
  onRetry: (prompt: string) => void
  onRewind?: (message: Message) => void
}): React.JSX.Element {
  const live = useAppStore((state) => state.live)
  const commandLog = useAppStore((state) => state.commandLog)
  const commands = commandLog.filter((entry) => entry.sessionId === sessionId)
  const clearLive = useAppStore((state) => state.clearLive)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const liveForSession = useMemo(
    () => Object.values(live).filter((entry) => entry.sessionId === sessionId),
    [live, sessionId],
  )

  useEffect(() => {
    for (const entry of liveForSession) {
      const persisted = messages.find((message) => message.id === entry.messageId)
      if (persisted && persisted.status !== 'streaming' && persisted.content) {
        clearLive(entry.messageId)
      }
    }
  }, [clearLive, liveForSession, messages])

  const rendered = useMemo(() => {
    const isPlaceholder = (content: string): boolean =>
      /^(Mô hình chỉ trả về phần suy luận|Model không trả về nội dung|Model trả về phản hồi rỗng)/.test(
        content.trim(),
      )
    const visible = messages.filter((message) => {
      if (message.role === 'system') return false
      if (
        message.role === 'assistant' &&
        !message.content.trim() &&
        !message.error &&
        message.status !== 'streaming' &&
        !(message.reasoning ?? '').trim()
      ) {
        return false
      }
      if (message.role === 'assistant' && isPlaceholder(message.content)) return false
      return true
    })
    const mapped: RenderedMessage[] = visible.map((message) => {
      const liveEntry = live[message.id]
      return {
        message,
        content: liveEntry?.content ?? message.content,
        reasoning: liveEntry?.reasoning ?? message.reasoning ?? '',
        streaming: liveEntry ? true : message.status === 'streaming',
      }
    })
    for (const entry of liveForSession) {
      if (!visible.some((message) => message.id === entry.messageId)) {
        mapped.push({
          message: {
            id: entry.messageId,
            sessionId,
            role: 'assistant',
            content: '',
            status: 'streaming',
            createdAt: entry.startedAt,
          },
          content: entry.content,
          reasoning: entry.reasoning,
          streaming: true,
        })
      }
    }
    const merged: RenderedMessage[] = []
    for (const entry of mapped) {
      const previous = merged[merged.length - 1]
      if (entry.message.role === 'assistant' && previous?.message.role === 'assistant') {
        const reasoning = [previous.reasoning, entry.reasoning].filter((part) => part.trim())
        const content = [previous.content, entry.content].filter((part) => part.trim())
        merged[merged.length - 1] = {
          message: previous.message,
          content: content.join('\n\n'),
          reasoning: reasoning.join('\n\n'),
          streaming: previous.streaming || entry.streaming,
        }
        continue
      }
      merged.push(entry)
    }
    return merged
  }, [live, liveForSession, messages, sessionId])

  const toolRuns = useMemo(() => {
    const runs = new Map<number, Message[]>()
    let index = 0
    while (index < rendered.length) {
      const current = rendered[index]
      if (current?.message.role === 'tool') {
        const run: Message[] = [current.message]
        let next = index + 1
        while (next < rendered.length && rendered[next]?.message.role === 'tool') {
          const entry = rendered[next]
          if (entry) run.push(entry.message)
          next += 1
        }
        runs.set(index, run)
        index = next
        continue
      }
      index += 1
    }
    return runs
  }, [rendered])

  const lastAssistantIndex = useMemo(() => {
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (rendered[index]?.message.role === 'assistant') return index
    }
    return -1
  }, [rendered])

  const currentTask = taskDetail?.task ?? task ?? null
  const running = Boolean(streamingEnabled && currentTask && RUNNING_STATES.has(currentTask.state))

  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const pin = (): void => {
      if (stickToBottom.current) scroller.scrollTop = scroller.scrollHeight
    }
    const observer = new ResizeObserver(pin)
    observer.observe(content)
    pin()
    return () => observer.disconnect()
  }, [])

  // Virtualize danh sách message rows: DOM chỉ giữ vài row nhìn thấy — giảm mount/paint với hội thoại dài.
  const virtualizer = useVirtualizer({
    count: rendered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rendered[index]?.message.role === 'user' ? 84 : 160),
    overscan: 6,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickToBottom.current) return
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
    })
    const timer = setTimeout(() => {
      if (stickToBottom.current) element.scrollTop = element.scrollHeight
    }, 140)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.length, rendered[rendered.length - 1]?.content.length, running, currentTask?.plan])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight
        stickToBottom.current = distance < 120
        setAtBottom(distance < 120)
      }}
      className="scroll-gutter min-h-0 flex-1 overflow-y-auto"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none sticky top-0 z-10 -mb-5 h-5 bg-gradient-to-b from-[var(--bg)] to-transparent"
      />
      <div className="mx-auto w-full max-w-[720px] px-5 pb-4 pt-1">
        {rendered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <h2 className="text-[15px] font-normal leading-tight text-[var(--text-muted)]">
              Bắt đầu cuộc trò chuyện
            </h2>
          </div>
        ) : (
          <div
            ref={contentRef}
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map((virtualRow) => {
              const index = virtualRow.index
              const entry = rendered[index]
              if (!entry) return null
              const row =
                entry.message.role === 'user' ? (
                  <UserMessage
                    message={entry.message}
                    content={entry.content}
                    onEdit={() => onEditPrompt(entry.content)}
                    {...(onRewind ? { onRewind: () => onRewind(entry.message) } : {})}
                  />
                ) : entry.message.role === 'tool' ? (
                  toolRuns.get(index) ? (
                    <ToolGroup messages={toolRuns.get(index) as Message[]} />
                  ) : null
                ) : (
                  <AssistantMessage
                    message={entry.message}
                    content={entry.content}
                    reasoning={entry.reasoning}
                    streaming={entry.streaming && streamingEnabled}
                    isLast={index === lastAssistantIndex}
                    onRetry={() => {
                      const previousUser = [...rendered.slice(0, index)]
                        .reverse()
                        .find((item) => item.message.role === 'user')
                      if (previousUser) onRetry(previousUser.content)
                    }}
                  />
                )
              return (
                <div
                  key={entry.message.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row}
                </div>
              )
            })}
          </div>
        )}
        {commands.length ? (
          <div
            aria-label="Kết quả lệnh"
            className="mt-1 border-t border-[var(--border-subtle)] pt-2"
          >
            {commands.map((entry) => (
              <div key={entry.id} className="flex gap-3 py-2">
                <span
                  aria-hidden
                  className="mt-0.5 shrink-0 font-mono text-[13px] text-[var(--text-faint)]"
                >
                  ›
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12.5px] text-[var(--text)]">{entry.command}</div>
                  <div
                    className={`mt-0.5 text-[12.5px] ${
                      entry.level === 'error'
                        ? 'text-[var(--danger)]'
                        : entry.level === 'warning'
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {entry.title}
                  </div>
                  {entry.body ? (
                    <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5 font-mono text-[11px] leading-[1.55] text-[var(--text-muted)]">
                      {entry.body}
                    </pre>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {taskDetail?.fileChanges?.length ? (
          <div className="py-2">
            <div className="pb-1 text-[11px] uppercase tracking-[0.07em] text-[var(--text-faint)]">
              Tệp thay đổi · {taskDetail.fileChanges.length}
            </div>
            {taskDetail.fileChanges.map((change) => (
              <ChangeCard key={change.id} change={change} />
            ))}
          </div>
        ) : null}

        {!atBottom && rendered.length ? (
          <div className="sticky bottom-3 z-10 mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                const element = scrollRef.current
                if (!element) return
                stickToBottom.current = true
                setAtBottom(true)
                element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
              }}
              className="pointer-events-auto flex h-7 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] text-[var(--text-muted)] shadow-[var(--shadow-soft)] transition-colors hover:text-[var(--text)]"
            >
              <ArrowDown size={12} />
              Cuối hội thoại
            </button>
          </div>
        ) : null}

        <div className="h-2" />
      </div>
    </div>
  )
}
