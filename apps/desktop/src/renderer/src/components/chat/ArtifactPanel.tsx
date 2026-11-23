import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@nexus/shared'
import { api } from '../../kernel'
import { diffLines } from '../../lib/diff'

type Tab = 'changes' | 'preview'

const isHtml = (path: string): boolean => /\.(html?|svg)$/i.test(path)

function Preview({ change }: { change: FileChange }): React.JSX.Element {
  const content = change.afterContent ?? ''
  if (isHtml(change.path)) {
    return (
      <iframe
        title={`Xem trước ${change.path.split('/').pop() ?? ''}`}
        srcDoc={content}
        sandbox=""
        className="h-full min-h-[240px] w-full rounded-[8px] border border-[var(--border-subtle)] bg-white"
      />
    )
  }
  const rows = diffLines(change.beforeContent ?? '', content)
  if (rows.length === 0) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--bg-code)] p-2 font-mono text-[11.5px] leading-[1.55] text-[var(--text-code)]">
        {content || '(trống)'}
      </pre>
    )
  }
  return (
    <div className="overflow-auto rounded-[8px] border border-[var(--border-subtle)]">
      {rows.map((row, index) => (
        <div
          key={index}
          className={
            row.kind === 'add'
              ? 'bg-[var(--diff-add)] px-2 font-mono text-[11.5px] leading-[1.55] text-[var(--diff-add-text)]'
              : row.kind === 'del'
                ? 'bg-[var(--diff-del)] px-2 font-mono text-[11.5px] leading-[1.55] text-[var(--diff-del-text)]'
                : 'px-2 font-mono text-[11.5px] leading-[1.55] text-[var(--text-muted)]'
          }
        >
          <span className="mr-2 select-none opacity-50">
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
          </span>
          {row.text || ' '}
        </div>
      ))}
    </div>
  )
}

/** Pane bên phải kiểu Codex: Changes / Outputs / Preview. */
export function ArtifactPanel({
  changes,
  summary,
}: {
  changes: FileChange[]
  summary?: React.ReactNode
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('changes')
  const [selected, setSelected] = useState<string | null>(null)
  const [width, setWidth] = useState(340)
  const resizeHandlers = useRef<{ move: (event: MouseEvent) => void; up: () => void } | null>(null)
  // Unmount giữa lúc kéo: phải gỡ listener, nếu không setWidth trên component đã mất.
  useEffect(
    () => () => {
      if (resizeHandlers.current === null) return
      window.removeEventListener('mousemove', resizeHandlers.current.move)
      window.removeEventListener('mouseup', resizeHandlers.current.up)
      resizeHandlers.current = null
    },
    [],
  )
  const active = changes.find((change) => change.id === selected) ?? changes[0] ?? null

  const startResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const onMove = (move: MouseEvent): void => {
      setWidth(Math.max(260, Math.min(720, startWidth - (move.clientX - startX))))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      resizeHandlers.current = null
    }
    if (resizeHandlers.current !== null) {
      window.removeEventListener('mousemove', resizeHandlers.current.move)
      window.removeEventListener('mouseup', resizeHandlers.current.up)
    }
    resizeHandlers.current = { move: onMove, up: onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <aside
      style={{ width }}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--border-subtle)]"
    >
      <div
        role="separator"
        aria-label="Resize outputs panel"
        onMouseDown={startResize}
        className="absolute -left-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize"
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2">
        {(['changes', 'preview'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-label={item === 'changes' ? 'Changes' : 'Preview'}
            data-active={tab === item}
            onClick={() => setTab(item)}
            className={`h-7 rounded-full px-2.5 text-[12.5px] transition-colors ${
              tab === item
                ? 'bg-[var(--bg-active)] text-[var(--text)]'
                : 'text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
            }`}
          >
            {item === 'changes' ? 'Changes' : 'Preview'}
            {item === 'changes' && changes.length ? (
              <span className="ml-1.5 tabular-nums text-[11px]">{changes.length}</span>
            ) : null}
          </button>
        ))}
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label="Mở Outputs trong folder"
          title="Mở trong folder"
          onClick={() => {
            if (active) void api.app.showItemInFolder(active.path)
          }}
          className="icon-btn-sm"
        >
          ↗
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'changes' ? (
          changes.length === 0 ? (
            <p className="text-[12.5px] text-[var(--text-faint)]">Chưa có tệp nào thay đổi.</p>
          ) : (
            changes.map((change) => (
              <button
                key={change.id}
                type="button"
                onClick={() => {
                  setSelected(change.id)
                  setTab('preview')
                }}
                className="mb-1 flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">
                  {change.path.split('/').pop() ?? change.path}
                </span>
                <span className="shrink-0 tabular-nums text-[11.5px] text-[var(--success)]">
                  +{change.addedLines}
                </span>
                <span className="shrink-0 tabular-nums text-[11.5px] text-[var(--danger)]">
                  −{change.removedLines}
                </span>
              </button>
            ))
          )
        ) : active === null ? (
          <p className="text-[12.5px] text-[var(--text-faint)]">
            Chọn một tệp ở Changes để xem trước.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col gap-2">
            <div
              className="truncate font-mono text-[12px] text-[var(--text-muted)]"
              title={active.path}
            >
              {active.path}
            </div>
            <Preview change={active} />
          </div>
        )}
        {summary ? (
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">{summary}</div>
        ) : null}
      </div>
    </aside>
  )
}
