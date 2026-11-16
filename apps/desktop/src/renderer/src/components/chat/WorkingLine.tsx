import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { TaskState, TaskStep, ToolCallRecord } from '@nexus/shared'
import { cn } from '../ui'

const LABELS: Partial<Record<TaskState, string>> = {
  idle: 'Đang chuẩn bị',
  queued: 'Đang chờ',
  planning: 'Đang lập kế hoạch',
  running: 'Đang làm việc',
  waiting_tool: 'Đang chạy công cụ',
  waiting_approval: 'Đang chờ bạn phê duyệt',
  retrying: 'Đang thử lại',
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
}

function ToolRow({ call }: { call: ToolCallRecord }): React.JSX.Element {
  const pending =
    call.status === 'running' || call.status === 'pending' || call.status === 'awaiting_approval'
  const failed = call.status === 'error' || call.status === 'denied' || Boolean(call.error)
  return (
    <div className="flex items-center gap-2 py-[3px] text-[12px]">
      {pending ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-muted)]" />
      ) : failed ? (
        <AlertTriangle size={11} className="shrink-0 text-[var(--danger)]" />
      ) : (
        <Check size={11} className="shrink-0 text-[var(--success)]" />
      )}
      <span
        className={cn('shrink-0 font-mono', failed ? 'text-[var(--danger)]' : 'text-[var(--text)]')}
      >
        {call.toolName}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-faint)]">
        {call.error?.message ?? (pending ? 'đang chạy…' : '')}
      </span>
      {call.durationMs ? (
        <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">
          {call.durationMs < 1000
            ? `${call.durationMs}ms`
            : `${(call.durationMs / 1000).toFixed(1)}s`}
        </span>
      ) : null}
    </div>
  )
}

export function WorkingLine({
  state,
  stepTitle,
  toolName,
  startedAt,
  queued,
  steps = [],
  toolCalls = [],
  fileChangeCount = 0,
  iteration,
  contextTokens,
  onOpen,
}: {
  state?: TaskState
  stepTitle?: string
  toolName?: string
  startedAt?: number
  queued?: number
  steps?: TaskStep[]
  toolCalls?: ToolCallRecord[]
  fileChangeCount?: number
  iteration?: number
  contextTokens?: number
  onOpen?: () => void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const label = useMemo(() => {
    if (state === 'waiting_approval') return LABELS.waiting_approval ?? 'Chờ duyệt'
    if (state === 'waiting_tool' && toolName) return `Đang chạy ${toolName}`
    if (state === 'running' && stepTitle) return stepTitle
    return (state && LABELS[state]) ?? 'Đang làm việc'
  }, [state, stepTitle, toolName])

  const failures = toolCalls.filter(
    (call) => call.status === 'error' || call.status === 'denied' || call.error,
  ).length
  const activeStep = steps.find((step) => step.state === 'running')
  const recentCalls = useMemo(() => [...toolCalls].reverse().slice(0, 8), [toolCalls])
  const hasDetail = recentCalls.length > 0 || steps.length > 0

  return (
    <div data-loop-bar className="relative pt-1.5">
      <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
        <span className="working-dot shrink-0" />
        <span className="working-shimmer min-w-0 truncate">{label}</span>
        {iteration ? (
          <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-[11px] tabular-nums text-[var(--text-muted)]">
            vòng {iteration}
          </span>
        ) : null}
        {toolName && state !== 'waiting_tool' ? (
          <span className="hidden shrink-0 font-mono text-[11px] text-[var(--text-faint)] sm:inline">
            {toolName}
          </span>
        ) : null}
        {queued ? (
          <span
            className="shrink-0 tabular-nums text-[11px] text-[var(--text-muted)]"
            title="Chỉ đạo đang chờ agent xử lý ở lượt kế tiếp"
          >
            {queued} chờ
          </span>
        ) : null}

        <div className="flex-1" />

        <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">
          {[
            toolCalls.length ? `${toolCalls.length} tool` : '',
            failures ? `${failures} lỗi` : '',
            fileChangeCount ? `${fileChangeCount} tệp` : '',
            contextTokens ? `${Math.round(contextTokens / 1000)}k ctx` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {startedAt ? (
          <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">
            {formatElapsed(now - startedAt)}
          </span>
        ) : null}
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Ẩn tiến trình' : 'Xem tiến trình'}
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            Tiến trình
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            Chi tiết
            <ChevronRight size={11} />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 max-h-[300px] space-y-2 overflow-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {steps.length ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
                Kế hoạch · {steps.filter((step) => step.state === 'completed').length}/
                {steps.length}
              </div>
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-1.5 py-[2px] text-[12px]">
                  {step.state === 'completed' ? (
                    <Check size={11} className="shrink-0 text-[var(--success)]" />
                  ) : step.state === 'running' ? (
                    <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text)]" />
                  ) : (
                    <span className="h-[11px] w-[11px] shrink-0 rounded-full border border-[var(--border-strong)]" />
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      step.state === 'completed'
                        ? 'text-[var(--text-faint)] line-through'
                        : 'text-[var(--text-muted)]',
                    )}
                  >
                    {step.title}
                  </span>
                </div>
              ))}
              {activeStep?.description ? (
                <div className="mt-1 truncate text-[11.5px] text-[var(--text-faint)]">
                  {activeStep.description}
                </div>
              ) : null}
            </div>
          ) : null}

          {recentCalls.length ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
                Tool call gần nhất
              </div>
              {recentCalls.map((call) => (
                <ToolRow key={call.id} call={call} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
