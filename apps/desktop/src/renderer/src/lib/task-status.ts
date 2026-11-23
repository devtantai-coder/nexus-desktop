import type { TaskState } from '@nexus/shared'

/** Codex-style order: work that needs attention first, then finished work. */
const STATE_ORDER: TaskState[] = [
  'running',
  'waiting_tool',
  'waiting_approval',
  'retrying',
  'queued',
  'planning',
  'idle',
  'failed',
  'cancelled',
  'completed',
]

export function taskStateRank(state: string): number {
  const index = STATE_ORDER.indexOf(state as TaskState)
  return index === -1 ? STATE_ORDER.length : index
}

export function sortTasksByState<T extends { state: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => taskStateRank(a.state) - taskStateRank(b.state))
}
