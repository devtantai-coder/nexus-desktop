import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@nexus/shared'
import { api, qk, useAppStore } from '../../kernel'
import { newSession, openProject } from '../../lib/actions'
import { fireConfetti } from '../../lib/confetti'
import { BUILTIN_COMMANDS } from '../../lib/slash-parse'
import { cn } from '../ui'

interface Item {
  id: string
  label: string
  hint: string
  group: 'Hành động' | 'Lệnh' | 'Phiên'
  run: () => void | Promise<void>
}

// Ctrl+K: một chỗ để nhảy phiên, chạy lệnh slash và điều hướng.
export function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((state) => state.paletteOpen)
  const setOpen = useAppStore((state) => state.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessions = useQuery({
    queryKey: qk.sessions(),
    queryFn: () => api.sessions.list({}),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [open])

  const items = useMemo((): Item[] => {
    if (!open) return []
    const store = useAppStore.getState()
    const actions: Item[] = [
      {
        id: 'action:new',
        label: 'Hội thoại mới',
        hint: 'Tạo phiên trống',
        group: 'Hành động',
        run: () => void newSession(),
      },
      {
        id: 'action:project',
        label: 'Mở thư mục dự án…',
        hint: 'Chọn thư mục trên máy',
        group: 'Hành động',
        run: () => void openProject(),
      },
      {
        id: 'action:confetti',
        label: 'Confetti cannon',
        hint: '/confetti',
        group: 'Hành động',
        run: () => fireConfetti(),
      },
      {
        id: 'action:scheduled',
        label: 'Scheduled',
        hint: 'Tác vụ định kỳ',
        group: 'Hành động',
        run: () => store.navigate({ name: 'scheduled' }),
      },
      {
        id: 'action:plugins',
        label: 'Plugins',
        hint: 'MCP marketplace',
        group: 'Hành động',
        run: () => store.navigate({ name: 'plugins' }),
      },
      {
        id: 'action:settings',
        label: 'Cài đặt',
        hint: 'Model, quyền, MCP',
        group: 'Hành động',
        run: () => store.navigate({ name: 'settings' }),
      },
      {
        id: 'action:sidebar',
        label: 'Ẩn/hiện sidebar',
        hint: 'Ctrl+B',
        group: 'Hành động',
        run: () => store.toggleSidebar(),
      },
      {
        id: 'action:home',
        label: 'Về trang chủ',
        hint: 'Bắt đầu hội thoại mới',
        group: 'Hành động',
        run: () => store.navigate({ name: 'home' }),
      },
    ]
    const commands: Item[] = BUILTIN_COMMANDS.map((command) => ({
      id: `slash:${command.name}`,
      label: `/${command.name}`,
      hint: command.description,
      group: 'Lệnh',
      run: () => {
        // Không chạy ngay: nhét vào composer để người dùng xem lại trước khi Enter.
        store.setDraftRequest(`/${command.name}${command.args ? ' ' : ''}`)
        store.navigate(store.activeSessionId ? { name: 'chat' } : { name: 'home' })
        store.focusComposer()
      },
    }))
    const jumps: Item[] = ((sessions.data ?? []) as Session[]).slice(0, 40).map((session) => ({
      id: `session:${session.id}`,
      label: session.title || 'Hội thoại',
      hint: session.projectId ? 'Phiên trong dự án' : 'Phiên',
      group: 'Phiên',
      run: () => store.openSession(session.id, session.projectId ?? undefined),
    }))
    return [...actions, ...commands, ...jumps]
  }, [open, sessions.data])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items.slice(0, 40)
    const scored = items
      .map((item) => {
        const label = item.label.toLowerCase()
        const score = label.startsWith(needle)
          ? 3
          : label.includes(needle)
            ? 2
            : item.hint.toLowerCase().includes(needle)
              ? 1
              : 0
        return { item, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, 40).map((entry) => entry.item)
  }, [items, query])

  useEffect(() => {
    setCursor((index) => (index < filtered.length ? index : 0))
  }, [filtered.length])

  if (!open) return null

  const close = (): void => setOpen(false)
  const runItem = (item: Item | undefined): void => {
    if (!item) return
    close()
    void item.run()
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/25 pt-[12vh]"
      onMouseDown={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Bảng lệnh"
        className="animate-pop w-[540px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)] surface-pop"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          aria-label="Tìm hành động, lệnh hoặc phiên"
          placeholder="Hành động, /lệnh hoặc tên phiên…"
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setCursor((index) => (index + step + filtered.length) % Math.max(filtered.length, 1))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              runItem(filtered[cursor])
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
          className="w-full border-b border-[var(--border-subtle)] bg-transparent px-3.5 py-2.5 text-[13px] outline-none placeholder:text-[var(--text-faint)]"
        />
        <div role="listbox" aria-label="Kết quả" className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-[var(--text-faint)]">Không có kết quả</p>
          ) : (
            filtered.map((item, index) => (
              <div key={item.id}>
                {filtered[index - 1]?.group !== item.group ? (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-faint)]">
                    {item.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors',
                    index === cursor ? 'bg-[var(--bg-hover)]' : '',
                  )}
                >
                  <span className="shrink-0 font-mono text-[11.5px] text-[var(--text)]">
                    {item.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-faint)]">
                    {item.hint}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-inset)]/60 px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
          <span className="font-mono">↑↓ chọn</span>
          <span className="font-mono">↵ chạy</span>
          <span className="font-mono">esc đóng</span>
          <span className="ml-auto font-mono">{filtered.length} mục</span>
        </div>
      </div>
    </div>
  )
}
