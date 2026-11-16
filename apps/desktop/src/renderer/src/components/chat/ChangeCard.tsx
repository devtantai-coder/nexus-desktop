import type React from 'react'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FileChange } from '@nexus/shared'
import { diffLines } from '../../lib/diff'
import { cn } from '../ui'

const TONE: Record<string, string> = {
  add: 'bg-[var(--diff-add)] text-[var(--diff-add-text)]',
  del: 'bg-[var(--diff-del)] text-[var(--diff-del-text)]',
  context: 'text-[var(--text-muted)]',
}

const NUM: Record<string, string> = {
  add: 'text-[var(--diff-add-text)]',
  del: 'text-[var(--diff-del-text)]',
}

const SIGN: Record<string, string> = { add: '+', del: '−', context: ' ' }

export function ChangeCard({ change }: { change: FileChange }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = useMemo(
    () => (open ? diffLines(change.beforeContent ?? '', change.afterContent ?? '') : []),
    [open, change.beforeContent, change.afterContent],
  )
  const name = change.path.split('/').pop() ?? change.path
  const dir = change.path.slice(0, Math.max(0, change.path.length - name.length)).replace(/\/$/, '')

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] py-[3px] text-left text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-[var(--text-faint)]" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-[var(--text-faint)]" />
        )}
        <span className="shrink-0 font-mono text-[11.5px] text-[var(--text)]">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-faint)]">
          {dir}
        </span>
        <span className={cn('shrink-0 tabular-nums text-[11px]', NUM.add)}>
          +{change.addedLines}
        </span>
        <span className={cn('shrink-0 tabular-nums text-[11px]', NUM.del)}>
          −{change.removedLines}
        </span>
      </button>
      {open ? (
        <div className="mt-1 max-h-[320px] overflow-auto rounded-[var(--radius)] border border-[var(--border-code)] bg-[var(--bg-code)] py-1.5 font-mono text-[11.5px] leading-[1.55]">
          {lines.length ? (
            lines.map((line, index) => (
              <div key={index} className={`px-3 ${TONE[line.kind]}`}>
                <span className="mr-2 select-none opacity-60">{SIGN[line.kind]}</span>
                {line.text || ' '}
              </div>
            ))
          ) : (
            <div className="px-3 text-[var(--text-faint)]">Không có nội dung để so sánh.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
