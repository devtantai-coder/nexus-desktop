import type React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../kernel'

function duration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 1000) return null
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function count(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function SessionStats({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['session-stats', sessionId],
    queryFn: () => api.stats.session(sessionId),
    refetchInterval: 10_000,
  })
  if (!data || !data.turns) return null

  const parts: string[] = [
    data.steps > 0 ? `${data.turns} lượt · ${data.steps} bước` : `${data.turns} lượt`,
  ]
  const llm = duration(data.llmMs)
  const tool = duration(data.toolMs)
  if (llm) parts.push(tool ? `LLM ${llm} · tool ${tool}` : `LLM ${llm}`)
  const ttft = data.ttftCount > 0 ? data.ttftMs / data.ttftCount : 0
  const decodeMs = Math.max(0, data.llmMs - data.ttftMs)
  // Cửa sổ decode quá ngắn (trả lời vài chục token) cho ra tốc độ vô nghĩa, nên chỉ báo
  // tốc độ khi mẫu đủ lớn; còn lại lấy tốc độ toàn lượt.
  const enoughSample = data.outputTokens >= 25 && decodeMs >= 500
  const speed = enoughSample
    ? data.outputTokens / (decodeMs / 1000)
    : data.llmMs >= 1000
      ? data.outputTokens / (data.llmMs / 1000)
      : 0
  if (ttft > 0 && speed > 0) {
    const shown = Math.round(speed)
    parts.push(`chờ ${(ttft / 1000).toFixed(1)}s · ${shown > 0 ? `${shown} tok/s` : '— tok/s'}`)
  }
  const cache = data.inputTokens > 0 ? (data.cachedTokens / data.inputTokens) * 100 : 0
  parts.push(`cache ${Math.round(cache)}%`)
  parts.push(`${count(data.inputTokens)} vào · ${count(data.outputTokens)} ra`)

  return (
    <div
      data-session-stats
      className="flex justify-center pt-1.5 text-[11px] tabular-nums text-[var(--text-faint)]"
    >
      <span className="truncate" title={parts.join(' | ')}>
        {parts.join('  |  ')}
      </span>
    </div>
  )
}
