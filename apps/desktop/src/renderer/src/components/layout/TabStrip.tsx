import type React from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api, qk, useAppStore } from '../../kernel'

/** Thanh tab phiên đang mở — tương đương "Show tabs" của Codex. */
export function TabStrip(): React.JSX.Element | null {
  const openTabs = useAppStore((state) => state.openTabs)
  const route = useAppStore((state) => state.route)
  const openSession = useAppStore((state) => state.openSession)
  const closeTab = useAppStore((state) => state.closeTab)
  const { data: sessions = [] } = useQuery({
    queryKey: qk.sessions({ archived: false }),
    queryFn: () => api.sessions.list({ archived: false }),
    enabled: openTabs.length > 0,
  })

  if (openTabs.length === 0) return null

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-2">
      {openTabs.map((id) => {
        const session = sessions.find((item) => item.id === id)
        const active = route.name === 'chat' && route.sessionId === id
        return (
          <div
            key={id}
            className={`group flex h-6 max-w-[220px] shrink-0 items-center gap-1 rounded-full pl-2.5 pr-1 text-[12.5px] ${
              active
                ? 'bg-[var(--bg-active)] text-[var(--text)]'
                : 'text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
            }`}
          >
            <button
              type="button"
              onClick={() => openSession(id, session?.projectId ?? undefined)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {session?.title ?? 'Hội thoại'}
            </button>
            <button
              type="button"
              aria-label="Close tab"
              onClick={() => closeTab(id)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-[var(--bg-active)] group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
