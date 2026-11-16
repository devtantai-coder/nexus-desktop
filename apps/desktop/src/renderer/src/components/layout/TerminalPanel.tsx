import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react'
import { api, useAppStore } from '../../kernel'

interface TermTab {
  id: string
  title: string
  buffer: string
}

/** Bottom panel kiểu Codex: PTY thật qua native core, tab + phím tắt Ctrl+J. */
export function TerminalPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const toast = useAppStore((state) => state.toast)
  const [tabs, setTabs] = useState<TermTab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  const createTerminal = useCallback(async (): Promise<void> => {
    try {
      const info = await api.terminal.create({
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        cols: 100,
        rows: 24,
      })
      setTabs((current) => [...current, { id: info.id, title: info.title || 'shell', buffer: '' }])
      setActive(info.id)
    } catch (error) {
      toast({ level: 'error', title: 'Không mở được terminal', body: (error as Error).message })
    }
  }, [activeProjectId, toast])

  useEffect(() => {
    if (!tabs.length) void createTerminal()
    // Chỉ chạy một lần khi panel mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const off = window.nexus.onEvent((envelope) => {
      const event = envelope as { type?: string; payload?: { terminalId?: string; data?: string } }
      if (event.type === 'terminal.output' && event.payload?.terminalId) {
        const { terminalId, data = '' } = event.payload
        setTabs((current) =>
          current.map((tab) =>
            tab.id === terminalId ? { ...tab, buffer: (tab.buffer + data).slice(-200_000) } : tab,
          ),
        )
      }
      if (event.type === 'terminal.exit' && event.payload?.terminalId) {
        const closed = event.payload.terminalId
        setTabs((current) => current.filter((tab) => tab.id !== closed))
        setActive((current) => (current === closed ? null : current))
      }
    })
    return () => off()
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [tabs, active])

  const close = async (id: string): Promise<void> => {
    await api.terminal.dispose(id).catch(() => undefined)
    setTabs((current) => current.filter((tab) => tab.id !== id))
    setActive((current) => (current === id ? null : current))
  }

  const submit = async (): Promise<void> => {
    if (!active || !draft.trim()) return
    await api.terminal.write(active, `${draft}\r`)
    setDraft('')
  }

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0] ?? null

  return (
    <section className="flex h-[240px] shrink-0 flex-col border-t border-[var(--border)]">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <TerminalIcon size={14} className="shrink-0 text-[var(--text-faint)]" />
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors ${
                tab.id === current?.id
                  ? 'bg-[var(--bg-active)] text-[var(--text)]'
                  : 'text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
              }`}
            >
              {tab.title}
              <Trash2
                size={11}
                className="opacity-60 hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  void close(tab.id)
                }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void createTerminal()}
          aria-label="New terminal"
          className="icon-btn-sm"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bottom panel"
          className="icon-btn-sm"
        >
          <span className="text-[13px]">×</span>
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-[var(--bg-inset)] px-3 py-2 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap text-[var(--text)]"
      >
        {current?.buffer || ''}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
        <span className="shrink-0 font-mono text-[12px] text-[var(--text-faint)]">$</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          aria-label="Terminal input"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-[var(--text-faint)]"
          placeholder="Gõ lệnh rồi Enter"
        />
      </div>
    </section>
  )
}
